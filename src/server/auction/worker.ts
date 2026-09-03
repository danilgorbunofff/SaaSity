import { prisma } from '@/server/prisma';
import {
  lockPlot,
  resolveCycle,
  attachPreBidsToCycle,
  activateTenant,
  secondPriceFor,
} from '@/server/auction/engine';
import {
  runCaptureCascade,
  cancelPreBidAuthorization,
  authorizeAttachedRows,
} from '@/server/auction/finalize';
import { emitCycleResolved } from '@/server/realtime/bus';
import { TIERS, RESOLVING_TIMEOUT_MINUTES, STALE_ENDED_CYCLE_ALERT_MINUTES } from '@/lib/tiers';

/**
 * Phase 2.3 — expiry sweep worker.
 *
 * Resolves OPEN cycles whose endAt has passed:
 *   1. Recovers cycles stuck in RESOLVING past the timeout back to OPEN —
 *      EXCEPT cycles holding a CONFIRMED capture (those await reconcile,
 *      never reopening: Part 3 capture-replay).
 *   2. Claims each ended cycle via a conditional OPEN -> RESOLVING update
 *      guarded by endAt <= sweep timestamp (race arbiter against parallel
 *      workers AND against late bids that extended the soft-close window).
 *   3. Main tx (holding lockPlot): defensive re-resolution, then collects
 *      ACTIVE candidates.
 *   4. Capture cascade OUTSIDE any tx (M3 Stripe captures must not poison
 *      resolution transactions), persisted per money intent BEFORE each
 *      Stripe call: definitive card failures fall through to the next
 *      candidate; retryable/unknown failures ABORT the pass (the cycle
 *      returns to OPEN, the next sweep retries under the same idempotency
 *      keys — never a fallback on uncertain money).
 *   5. Settle + rotate (settleAndRotate, shared with reconcile): final tx A
 *      settles rows, rotates tenant data, stages the next cycle; authorize
 *      loop outside any tx; rotation tx B attaches survivors and resolves
 *      (or cancels the shell).
 *   6. Publishes realtime events (at-least-once: reconcile re-emits).
 *   7. Sweep tail: reconcileCapturedCycle settles RESOLVING cycles holding
 *      a confirmed capture (crash between charge and commit), and
 *      RELEASE_FAILED rows are retried under their original keys.
 *
 * Settlement state machine (persisted in SettlementAttempt, kinds
 * CAPTURE/RELEASE):
 *   PENDING -> CAPTURED | FAILED_DEFINITIVE | FAILED_RETRYABLE
 *   PENDING -> RELEASED | RELEASE_FAILED (-> RELEASED on sweep retry)
 * A CAPTURED row for an idempotency key is success without a new Stripe
 * call. See src/server/auction/finalize.ts (cascade) and
 * prisma/schema.prisma (SettlementAttempt) for the crash-point contract.
 */

export interface Outcome {
  plotId: string;
  cycleId: string;
  winnerPreBidId: string | null;
  winnerBidderId: string | null;
  winnerBrand: {
    companyName: string | null;
    tagline: string | null;
    targetUrl: string | null;
    twitterHandle: string | null;
    mrrText: string | null;
  } | null;
  clearingPriceCents: number | null;
  nextCycleId: string | null;
  nextEndAt: Date | null;
  openingPriceCents: number | null;
}

async function recoverStuckResolving(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RESOLVING_TIMEOUT_MINUTES * 60_000);
  const res = await prisma.auctionCycle.updateMany({
    where: {
      status: 'RESOLVING',
      updatedAt: { lt: cutoff },
      // Part 3 capture-replay: a cycle holding a CONFIRMED capture is never
      // "stuck" — it awaits reconcile, not reopening. Reopening it would let
      // the next sweep re-cascade and double-charge.
      settlementAttempts: { none: { status: 'CAPTURED' } },
    },
    data: { status: 'OPEN' },
  });
  return res.count;
}

/**
 * Pure staleness summary over ended-but-still-OPEN cycle end-times (Part 3
 * cron alert). A cycle counts as stale once it has been ended longer than
 * STALE_ENDED_CYCLE_ALERT_MINUTES — i.e. the primary scheduler plus every
 * fallback missed at least two ticks. Unit-tested in
 * tests/auction/cron-staleness.test.ts.
 */
export function staleCyclesSummary(
  endedEndAtMs: number[],
  nowMs: number,
): { staleCount: number; maxStaleMs: number } {
  const thresholdMs = STALE_ENDED_CYCLE_ALERT_MINUTES * 60_000;
  let staleCount = 0;
  let maxStaleMs = 0;
  for (const endAtMs of endedEndAtMs) {
    const staleMs = nowMs - endAtMs;
    if (staleMs <= 0) continue;
    if (staleMs > maxStaleMs) maxStaleMs = staleMs;
    if (staleMs > thresholdMs) staleCount += 1;
  }
  return { staleCount, maxStaleMs };
}

/**
 * Resolve exactly one cycle by id. Exported so 2.5's dev fast-forward
 * trigger calls THIS function (never a parallel implementation) — the mock
 * path and the cron path are byte-identical from here down.
 *
 * `now` is the sweep's single captured timestamp: the eligibility query in
 * resolveEndedCycles, the claim predicate below, and the under-lock recheck
 * all use THIS value (never a fresh Date.now()), so a cycle extended by a
 * late bid is consistently ineligible for the whole run.
 *
 * Returns null when the cycle was not OPEN (already resolved, or another
 * worker/trigger claimed it first) or when it is no longer expired because
 * a late bid extended its soft-close window.
 */
/**
 * Settle + rotate phases shared by the live path (resolveOneCycle, fed by
 * the capture cascade) and the reconcile path (reconcileCapturedCycle, fed
 * by the recorded CAPTURED attempt). Signature and behavior are identical
 * for both: settle tx A (RESOLVED/WON/LOST/tenant/stage-next), authorize
 * loop OUTSIDE any tx, rotation tx B (attach survivors/resolve-or-cancel).
 */
async function settleAndRotate(args: {
  cycleId: string;
  plotId: string;
  plotTier: string;
  now: Date;
  winnerPreBidId: string | null;
  clearingPriceCents: number | null;
}): Promise<{
  winnerRow: {
    id: string;
    bidderId: string;
    companyName: string;
    tagline: string | null;
    targetUrl: string;
    twitterHandle: string;
    mrrText: string | null;
  } | null;
  nextCycleId: string | null;
  nextEndAt: Date | null;
  openingPriceCents: number | null;
} | null> {
  const { cycleId, plotId, plotTier, now, winnerPreBidId, clearingPriceCents } = args;
  // ---- Final tx A: settle rows, rotate tenant data, stage next cycle ----
  // Settles the old cycle and (when queued pre-bids exist) creates the
  // next OPEN cycle + flips the plot LIVE — but attaches NOTHING yet.
  // Authorization (Stripe I/O) runs after commit; attachment takes only
  // survivor ids in tx B, so an unauthorized row can never enter a cycle.
  const settled = await prisma.$transaction(async (tx) => {
    await lockPlot(tx, plotId);
    const reRead = await tx.auctionCycle.findUnique({ where: { id: cycleId } });
    if (!reRead || reRead.status !== 'RESOLVING') return null;

    const remaining = await tx.preBid.findMany({
      where: { cycleId, status: 'ACTIVE' },
      orderBy: [{ maxBidCents: 'desc' }, { createdAt: 'asc' }],
    });
    const winnerRow =
      winnerPreBidId != null
        ? remaining.find((p) => p.id === winnerPreBidId) ?? null
        : null;

    await tx.auctionCycle.update({
      where: { id: cycleId },
      data: {
        status: 'RESOLVED',
        resolvedAt: now,
        clearingPriceCents: clearingPriceCents,
        winnerPreBidId: winnerPreBidId,
      },
    });

    if (winnerRow) {
      // Re-run resolution BEFORE marking the winner WON: the winner is
      // still ACTIVE here, so this records the cycle's final repricing
      // tick if a capture failure upstream promoted a lower bidder (pure
      // ledger/currentPriceCents bookkeeping now — resolveCycle no longer
      // touches any publicly-displayed field).
      await resolveCycle(tx, reRead, {});
      // Activate the tenant — the ONLY place a plot's publicly-displayed
      // tenant changes. Decoupled from resolveCycle, so opening (or
      // failing to open) a next cycle below can never disturb it.
      await activateTenant(tx, reRead.plotId, winnerRow, now);
      await tx.preBid.update({
        where: { id: winnerRow.id },
        data: { status: 'WON' },
      });
    }

    const loserIds = remaining
      .filter((p) => p.id !== winnerPreBidId)
      .map((p) => p.id);
    if (loserIds.length > 0) {
      await tx.preBid.updateMany({
        where: { id: { in: loserIds } },
        data: { status: 'LOST' },
      });
    }

    // Stage the next cycle from queued pre-bids, or drop the plot to IDLE.
    const queued = await tx.preBid.findMany({
      where: { plotId: reRead.plotId, cycleId: null, status: 'ACTIVE' },
      orderBy: [{ maxBidCents: 'desc' }, { createdAt: 'asc' }],
    });

    let nextCycleId: string | null = null;
    let nextEndAt: Date | null = null;

    if (queued.length > 0) {
      const cfg = TIERS[plotTier as keyof typeof TIERS];
      const startedAt = now;
      const endAt = new Date(startedAt.getTime() + cfg.durationHours * 60 * 60_000);
      const nextCycle = await tx.auctionCycle.create({
        data: {
          plotId: reRead.plotId,
          status: 'OPEN',
          floorPriceCents: cfg.floorCents,
          incrementCents: cfg.incrementCents,
          durationMinutes: cfg.durationHours * 60,
          startedAt,
          endAt,
        },
      });
      nextCycleId = nextCycle.id;
      nextEndAt = endAt;
      await tx.plot.update({
        where: { id: reRead.plotId },
        data: { status: 'LIVE', currentCycleId: nextCycle.id },
      });
    } else {
      // No next cycle materialized: the plot becomes claimable again at
      // the tier floor. Auction progress resets (no open auction, no
      // leader pointer) but tenant* fields are NEVER touched here — the
      // active tenant (if any) persists through IDLE exactly as they do
      // through a next auction opening. Tenancy only ever changes via
      // activateTenant, which already ran above when winnerRow existed.
      await tx.plot.update({
        where: { id: reRead.plotId },
        data: {
          status: 'IDLE',
          currentCycleId: null,
          currentLeaderPreBidId: null,
        },
      });
    }

    if (shouldFailSettle()) {
      // Crash-point test hook: aborts tx A before commit (all settle
      // writes roll back; the confirmed capture stays on record).
      throw new Error('Injected settle failure (crash before commit)');
    }

    return {
      winnerRow,
      nextCycleId,
      nextEndAt,
      queuedIds: queued.map((q) => q.id),
    };
  });

  if (settled === null) return null;

  // ---- Authorization seam (Part 3, T4): Stripe I/O OUTSIDE every tx ----
  // Failures expire while still queued; only survivor ids attach below,
  // so proxy resolution (tx B) prices survivors only.
  let authorizedIds: string[] = [];
  if (settled.queuedIds.length > 0) {
    const auth = await authorizeAttachedRows(settled.queuedIds);
    authorizedIds = auth.authorizedIds;
  }

  // ---- Final tx B: attach survivors, open the next cycle for real ----
  let nextCycleId: string | null = settled.nextCycleId;
  let nextEndAt: Date | null = settled.nextEndAt;
  let openingPriceCents: number | null = null;

  if (nextCycleId !== null) {
    const stagedCycleId = nextCycleId;
    const rotated = await prisma.$transaction(async (tx) => {
      await lockPlot(tx, plotId);
      const nextCycle = await tx.auctionCycle.findUnique({ where: { id: stagedCycleId } });
      if (!nextCycle || nextCycle.status !== 'OPEN') {
        // The staged cycle vanished mid-handover (only the dev
        // fast-forward can do this — it settles any OPEN cycle). Leave
        // survivors queued; that path's own rotation picks them up.
        console.warn(
          `[auction:worker] staged next cycle ${nextCycleId} no longer OPEN; leaving ${authorizedIds.length} authorized pre-bid(s) queued`,
        );
        return null;
      }

      await attachPreBidsToCycle(tx, authorizedIds, nextCycle.id);

      const surviving = await tx.preBid.findMany({
        where: { cycleId: nextCycle.id, status: 'ACTIVE' },
        orderBy: [{ maxBidCents: 'desc' }, { createdAt: 'asc' }],
      });
      let opening: number | null = null;
      if (surviving.length > 0) {
        const resolution = await resolveCycle(tx, nextCycle, {});
        opening = resolution?.priceCents ?? null;
      } else {
        // Every queued pre-bid failed authorization at attach: the cycle
        // would be an empty shell nobody can bid on until the sweep finds
        // it. Cancel it; the IDLE transition below applies.
        await tx.auctionCycle.update({
          where: { id: nextCycle.id },
          data: { status: 'CANCELLED' },
        });
        await tx.plot.update({
          where: { id: nextCycle.plotId },
          data: { status: 'IDLE', currentCycleId: null, currentLeaderPreBidId: null },
        });
        return { cancelled: true as const, opening };
      }
      return { cancelled: false as const, opening };
    });

    if (rotated === null) {
      // Staged cycle vanished (see above) — report no next cycle; the
      // survivors stay queued for the following rotation.
      nextCycleId = null;
      nextEndAt = null;
    } else {
      openingPriceCents = rotated.opening;
      if (rotated.cancelled) {
        nextCycleId = null;
        nextEndAt = null;
      }
    }
  }
  return {
    winnerRow: settled.winnerRow,
    nextCycleId,
    nextEndAt,
    openingPriceCents,
  };
}

// Crash-point test hook (settlement-crash-proof P3): one-shot flag that
// aborts settle tx A before commit. No production path touches it.
let failNextSettle = false;

export function injectSettleFailure(): void {
  failNextSettle = true;
}

export function clearSettleFailures(): void {
  failNextSettle = false;
}

function shouldFailSettle(): boolean {
  return failNextSettle;
}

export async function resolveOneCycle(cycleId: string, now: Date): Promise<Outcome | null> {
  // Race arbiter: exactly one claimant flips OPEN -> RESOLVING — and only
  // while the cycle is still expired as of the sweep timestamp. The endAt
  // predicate is the late-bid guard: a bid that extended endAt past `now`
  // (soft-close) fails this claim, so the cycle stays OPEN with its full new
  // window intact instead of being settled out from under the bidder.
  const claimed = await prisma.auctionCycle.updateMany({
    where: { id: cycleId, status: 'OPEN', endAt: { lte: now } },
    data: { status: 'RESOLVING' },
  });
  if (claimed.count === 0) return null;

  // Set true once the cascade runs: only then can a confirmed capture
  // exist and the finally guard below has work to do. Early exits below
  // skip the guard (and its query) entirely. Declared outside the try —
  // the finally block cannot see try-block-scoped lets.
  let reachedCascade = false;
  let settledOk = false;

  try {
    // ---- Main tx: defensive re-resolution + candidate collection ----
    // Read the cycle outside the tx just to learn plotId for the lock key —
    // bids contend on the same key (lockPlot(plotId)) in the bid route.
    const preRead = await prisma.auctionCycle.findUniqueOrThrow({
      where: { id: cycleId },
      select: { plotId: true },
    });
    const collected = await prisma.$transaction(async (tx) => {
      await lockPlot(tx, preRead.plotId);
      const cycle = await tx.auctionCycle.findUnique({ where: { id: cycleId } });
      if (!cycle || cycle.status !== 'RESOLVING') return null;
      // Recheck expiry under the plot lock: a bid tx that read the cycle as
      // OPEN before the claim landed may have committed a soft-close
      // extension while queued on the lock. Settle nothing — hand the cycle
      // back to OPEN with its full extended window intact.
      if (cycle.endAt.getTime() > now.getTime()) {
        await tx.auctionCycle.update({
          where: { id: cycleId },
          data: { status: 'OPEN' },
        });
        return null;
      }
      const plot = await tx.plot.findUnique({ where: { id: cycle.plotId } });
      if (!plot) return null;

      const fresh = await resolveCycle(tx, cycle, {});
      if (fresh && cycle.currentPriceCents !== null && fresh.priceCents !== cycle.currentPriceCents) {
        console.warn(
          `[auction:worker] price disagreement on cycle ${cycle.id}: stored=${cycle.currentPriceCents} fresh=${fresh.priceCents}`,
        );
      }

      return { plotId: plot.id, tier: plot.tier };
    });

    if (collected === null) return null;
    const plotId: string = collected.plotId;
    const plotTier = collected.tier;

    // ---- Capture cascade: OUTSIDE any tx by design ----
    const cycleRow = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
    reachedCascade = true;
    const candidates = await prisma.preBid.findMany({
      where: { cycleId, status: 'ACTIVE' },
      orderBy: [{ maxBidCents: 'desc' }, { createdAt: 'asc' }],
    });

    const cascade = await runCaptureCascade({
      cycleId,
      candidates,
      computeRemainingPrice: (candidate, remaining) => {
        // Shared second-price math — the same formula computeResolution
        // uses, so the cascade can never drift from the engine's pricing.
        const highestOther =
          remaining.length === 0
            ? null
            : remaining.reduce((m, r) => Math.max(m, r.maxBidCents), 0);
        return secondPriceFor(
          candidate.maxBidCents,
          highestOther,
          cycleRow.floorPriceCents,
          cycleRow.incrementCents,
        );
      },
      markLost: async (candidateId, reason) => {
        await prisma.preBid.update({
          where: { id: candidateId },
          data: { status: 'LOST', lostReason: reason },
        });
      },
    });

    if (cascade.aborted) {
      // Retryable/unknown capture failure with money state uncertain: settle
      // NOTHING and select NO fallback. No capture was confirmed, so handing
      // the cycle back to OPEN is safe — the next sweep retries under the
      // same idempotency keys. (Contrast the finally guard below, which
      // refuses to reopen once a capture IS confirmed.)
      await prisma.auctionCycle.update({
        where: { id: cycleId },
        data: { status: 'OPEN' },
      });
      return null;
    }

    const settled = await settleAndRotate({
      cycleId,
      plotId,
      plotTier,
      now,
      winnerPreBidId: cascade.winnerPreBidId,
      clearingPriceCents: cascade.clearingPriceCents,
    });

    if (settled === null) return null;
    const { nextCycleId, nextEndAt, openingPriceCents } = settled;

    const outcome: Outcome = buildOutcome({
      plotId,
      cycleId,
      winnerPreBidId: cascade.winnerPreBidId,
      winnerRow: settled.winnerRow,
      clearingPriceCents: cascade.clearingPriceCents,
      nextCycleId,
      nextEndAt,
      openingPriceCents,
    });

    // ONE spec-shaped event per resolution, emitted HERE (not by callers):
    // the cron sweep and 2.5's dev fast-forward share this exact path, so
    // every resolution publishes and neither caller can drift. Winner brand
    // (or null for the IDLE path) + the next cycle's opening state. No
    // bidderId goes out — see bus.ts's emitCycleResolved doc.
    // At-least-once: a crash after commit re-emits via reconcile — consumers
    // key off cycleId, and patching the same RESOLVED state twice is a no-op.
    publishOutcome(outcome);
    settledOk = true;

    return outcome;
  } finally {
    // Safety net: if anything above threw after claiming, un-stick the
    // cycle so the next sweep retries it. Skipped on the success path (a
    // RESOLVED cycle with a CAPTURED row is the normal outcome, not a
    // crash) and before the cascade runs (nothing could have captured yet).
    // A cycle with a CONFIRMED capture is NEVER reopened without
    // reconciliation (Part 3 capture-replay): reopening it would let the
    // next sweep re-cascade and charge a fallback bidder for money already
    // taken. reconcileCapturedCycle (called by the sweep) settles those.
    if (!settledOk && reachedCascade) {
      const captured = await prisma.settlementAttempt
        .findFirst({ where: { cycleId, status: 'CAPTURED' }, select: { id: true } })
        .catch(() => null);
      if (captured) {
        console.warn(
          `[auction:worker] cycle ${cycleId} failed mid-settlement AFTER a confirmed capture; ` +
            `leaving RESOLVING for reconcile (never reopening without reconciliation)`,
        );
      } else {
        await prisma.auctionCycle
          .updateMany({
            where: { id: cycleId, status: 'RESOLVING' },
            data: { status: 'OPEN' },
          })
          .catch(() => {});
      }
    }
  }
}

export async function resolveEndedCycles(): Promise<{
  recovered: number;
  resolved: number;
  reconciled: number;
  releasesRetried: number;
  staleCount: number;
  maxStaleMs: number;
}> {
  const now = new Date();
  const recovered = await recoverStuckResolving(now);

  const ended = await prisma.auctionCycle.findMany({
    where: { status: 'OPEN', endAt: { lte: now } },
    select: { id: true, endAt: true },
    orderBy: { endAt: 'asc' },
  });

  // Part 3 cron alert: ended cycles that outlived the expected worker
  // interval. Logged structurally for log-based monitors and returned for
  // the cron route's JSON (external monitors key off staleCount > 0).
  const { staleCount, maxStaleMs } = staleCyclesSummary(
    ended.map((e) => e.endAt.getTime()),
    now.getTime(),
  );
  if (staleCount > 0) {
    console.warn(
      `[auction:worker] stale ended cycles: count=${staleCount} ` +
        `maxStaleMs=${maxStaleMs} (alert line: ${STALE_ENDED_CYCLE_ALERT_MINUTES}min)`,
    );
  }

  let resolved = 0;
  for (const { id } of ended) {
    try {
      // resolveOneCycle publishes cycle:resolved itself — the sweep only counts.
      const outcome = await resolveOneCycle(id, now);
      if (outcome === null) continue;
      resolved += 1;
    } catch (err) {
      // One poisoned cycle must never abort the sweep for the rest. The
      // cycle keeps its claim (or the finally guard's decision) and is
      // retried on the next tick.
      console.error(`[auction:worker] resolveOneCycle failed for cycle ${id}`, err);
    }
  }

  // Part 3 capture-replay: reconcile cycles that hold a confirmed capture
  // but never settled (crash between capture and commit), oldest first.
  let reconciled = 0;
  const captives = await prisma.auctionCycle.findMany({
    where: { status: 'RESOLVING', settlementAttempts: { some: { status: 'CAPTURED' } } },
    select: { id: true },
    orderBy: { endAt: 'asc' },
  });
  for (const { id } of captives) {
    try {
      const outcome = await reconcileCapturedCycle(id, now);
      if (outcome === null) continue;
      reconciled += 1;
    } catch (err) {
      console.error(`[auction:worker] reconcileCapturedCycle failed for cycle ${id}`, err);
    }
  }

  // Retry persisted loser-release failures (same idempotency keys — M3
  // cancel is idempotent, so a release that actually landed is a no-op).
  let releasesRetried = 0;
  const stuckReleases = await prisma.settlementAttempt.findMany({
    where: { status: 'RELEASE_FAILED' },
    select: { id: true, preBidId: true, idempotencyKey: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  for (const rel of stuckReleases) {
    try {
      await cancelPreBidAuthorization(
        { id: rel.preBidId, stripePaymentIntentId: null },
        rel.idempotencyKey,
      );
      await prisma.settlementAttempt.update({
        where: { id: rel.id },
        data: { status: 'RELEASED' },
      });
      releasesRetried += 1;
    } catch {
      // Still failing — stays RELEASE_FAILED for the next sweep.
    }
  }

  return { recovered, resolved, reconciled, releasesRetried, staleCount, maxStaleMs };
}

/**
 * Shared outcome assembly for the live path and the reconcile path.
 * winnerRow is the settled winner row (or null for a winnerless cycle).
 */
function buildOutcome(args: {
  plotId: string;
  cycleId: string;
  winnerPreBidId: string | null;
  winnerRow: {
    bidderId: string;
    companyName: string;
    tagline: string | null;
    targetUrl: string;
    twitterHandle: string;
    mrrText: string | null;
  } | null;
  clearingPriceCents: number | null;
  nextCycleId: string | null;
  nextEndAt: Date | null;
  openingPriceCents: number | null;
}): Outcome {
  return {
    plotId: args.plotId,
    cycleId: args.cycleId,
    winnerPreBidId: args.winnerPreBidId,
    winnerBidderId: args.winnerRow?.bidderId ?? null,
    winnerBrand: args.winnerRow
      ? {
          companyName: args.winnerRow.companyName,
          tagline: args.winnerRow.tagline,
          targetUrl: args.winnerRow.targetUrl,
          twitterHandle: args.winnerRow.twitterHandle,
          mrrText: args.winnerRow.mrrText,
        }
      : null,
    clearingPriceCents: args.clearingPriceCents,
    nextCycleId: args.nextCycleId,
    nextEndAt: args.nextEndAt,
    openingPriceCents: args.openingPriceCents,
  };
}

function publishOutcome(outcome: Outcome): void {
  emitCycleResolved({
    plotId: outcome.plotId,
    cycleId: outcome.cycleId,
    winner:
      outcome.winnerBrand != null && outcome.winnerPreBidId != null
        ? { preBidId: outcome.winnerPreBidId, brand: outcome.winnerBrand }
        : null,
    clearingPriceCents: outcome.clearingPriceCents,
    nextCycle:
      outcome.nextCycleId != null && outcome.nextEndAt != null
        ? {
            cycleId: outcome.nextCycleId,
            endAt: outcome.nextEndAt.toISOString(),
            openingPriceCents: outcome.openingPriceCents,
          }
        : null,
  });
}

/**
 * Reconcile a cycle that holds a CONFIRMED capture but never settled (Part
 * 3 capture-replay) — the crash landed between the Stripe charge and the
 * settle commit. Settles from the recorded CAPTURED attempt (no new Stripe
 * call, no fallback selection), then publishes the outcome.
 *
 * Idempotent: a RESOLVED cycle returns its stored outcome (crash after
 * commit — the event may re-emit, which consumers tolerate by cycleId).
 * Returns null when there is nothing to reconcile.
 */
export async function reconcileCapturedCycle(cycleId: string, now: Date): Promise<Outcome | null> {
  const cycle = await prisma.auctionCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) return null;
  if (cycle.status === 'RESOLVED') return readStoredOutcome(cycleId);
  if (cycle.status !== 'RESOLVING') return null;

  const captured = await prisma.settlementAttempt.findFirst({
    where: { cycleId, status: 'CAPTURED' },
    orderBy: { createdAt: 'desc' },
  });
  if (!captured || captured.amountCents == null) return null;

  const plot = await prisma.plot.findUnique({ where: { id: cycle.plotId } });
  if (!plot) return null;

  const settled = await settleAndRotate({
    cycleId,
    plotId: plot.id,
    plotTier: plot.tier,
    now,
    winnerPreBidId: captured.preBidId,
    clearingPriceCents: captured.amountCents,
  });
  if (settled === null) return null;

  const outcome = buildOutcome({
    plotId: plot.id,
    cycleId,
    winnerPreBidId: captured.preBidId,
    winnerRow: settled.winnerRow,
    clearingPriceCents: captured.amountCents,
    nextCycleId: settled.nextCycleId,
    nextEndAt: settled.nextEndAt,
    openingPriceCents: settled.openingPriceCents,
  });
  publishOutcome(outcome);
  return outcome;
}

/**
 * Rebuilds the outcome of an already-RESOLVED cycle from stored rows (no
 * writes, no Stripe calls) — the idempotent-replay half of reconcile.
 */
async function readStoredOutcome(cycleId: string): Promise<Outcome | null> {
  const cycle = await prisma.auctionCycle.findUnique({ where: { id: cycleId } });
  if (!cycle || cycle.status !== 'RESOLVED') return null;
  const winnerRow = cycle.winnerPreBidId
    ? await prisma.preBid.findUnique({ where: { id: cycle.winnerPreBidId } })
    : null;
  const plot = await prisma.plot.findUnique({ where: { id: cycle.plotId } });
  const nextCycle =
    plot?.currentCycleId != null
      ? await prisma.auctionCycle.findUnique({ where: { id: plot.currentCycleId } })
      : null;
  return buildOutcome({
    plotId: cycle.plotId,
    cycleId,
    winnerPreBidId: cycle.winnerPreBidId,
    winnerRow,
    clearingPriceCents: cycle.clearingPriceCents,
    nextCycleId: nextCycle && nextCycle.status === 'OPEN' ? nextCycle.id : null,
    nextEndAt: nextCycle && nextCycle.status === 'OPEN' ? nextCycle.endAt : null,
    openingPriceCents: nextCycle?.currentPriceCents ?? null,
  });
}
