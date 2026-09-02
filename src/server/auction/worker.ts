import { prisma } from '@/server/prisma';
import {
  lockPlot,
  resolveCycle,
  attachQueuedPreBids,
  activateTenant,
  secondPriceFor,
} from '@/server/auction/engine';
import {
  runCaptureCascade,
  capturePreBidAuthorization,
  cancelPreBidAuthorization,
  authorizePreBidAtAttach,
} from '@/server/auction/finalize';
import { emitCycleResolved } from '@/server/realtime/bus';
import { TIERS, RESOLVING_TIMEOUT_MINUTES } from '@/lib/tiers';

/**
 * Phase 2.3 — expiry sweep worker.
 *
 * Resolves OPEN cycles whose endAt has passed:
 *   1. Recovers cycles stuck in RESOLVING past the timeout back to OPEN.
 *   2. Claims each ended cycle via a conditional OPEN -> RESOLVING update
 *      (race arbiter against parallel workers).
 *   3. Main tx (holding lockPlot): defensive re-resolution, then collects
 *      ACTIVE candidates.
 *   4. Capture cascade OUTSIDE any tx (M3 Stripe captures must not poison
 *      resolution transactions).
 *   5. Final tx (holding lockPlot): settles rows, rotates tenant data,
 *      opens the next cycle from queued pre-bids or drops the plot to IDLE.
 *   6. Publishes realtime events.
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
    where: { status: 'RESOLVING', updatedAt: { lt: cutoff } },
    data: { status: 'OPEN' },
  });
  return res.count;
}

/**
 * Resolve exactly one cycle by id. Exported so 2.5's dev fast-forward
 * trigger calls THIS function (never a parallel implementation) — the mock
 * path and the cron path are byte-identical from here down.
 *
 * Returns null when the cycle was not OPEN (already resolved, or another
 * worker/trigger claimed it first).
 */
export async function resolveOneCycle(cycleId: string, now: Date): Promise<Outcome | null> {
  // Race arbiter: exactly one claimant flips OPEN -> RESOLVING.
  const claimed = await prisma.auctionCycle.updateMany({
    where: { id: cycleId, status: 'OPEN' },
    data: { status: 'RESOLVING' },
  });
  if (claimed.count === 0) return null;

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
    const candidates = await prisma.preBid.findMany({
      where: { cycleId, status: 'ACTIVE' },
      orderBy: [{ maxBidCents: 'desc' }, { createdAt: 'asc' }],
    });

    const cascade = await runCaptureCascade({
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
      capture: (candidate, amountCents) =>
        capturePreBidAuthorization(candidate, amountCents),
      cancel: (candidate) => cancelPreBidAuthorization(candidate),
      markLost: async (candidateId, reason) => {
        await prisma.preBid.update({
          where: { id: candidateId },
          data: { status: 'LOST', lostReason: reason },
        });
      },
    });

    // ---- Final tx: settle rows, rotate tenant data, next cycle or idle ----
    const settled = await prisma.$transaction(async (tx) => {
      await lockPlot(tx, plotId);
      const reRead = await tx.auctionCycle.findUnique({ where: { id: cycleId } });
      if (!reRead || reRead.status !== 'RESOLVING') return null;

      const remaining = await tx.preBid.findMany({
        where: { cycleId, status: 'ACTIVE' },
        orderBy: [{ maxBidCents: 'desc' }, { createdAt: 'asc' }],
      });
      const winnerRow =
        cascade.winnerPreBidId != null
          ? remaining.find((p) => p.id === cascade.winnerPreBidId) ?? null
          : null;

      await tx.auctionCycle.update({
        where: { id: cycleId },
        data: {
          status: 'RESOLVED',
          resolvedAt: now,
          clearingPriceCents: cascade.clearingPriceCents,
          winnerPreBidId: cascade.winnerPreBidId,
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
        .filter((p) => p.id !== cascade.winnerPreBidId)
        .map((p) => p.id);
      if (loserIds.length > 0) {
        await tx.preBid.updateMany({
          where: { id: { in: loserIds } },
          data: { status: 'LOST' },
        });
      }

      // Next cycle from queued pre-bids, or drop the plot to IDLE.
      const queued = await tx.preBid.findMany({
        where: { plotId: reRead.plotId, cycleId: null, status: 'ACTIVE' },
        orderBy: [{ maxBidCents: 'desc' }, { createdAt: 'asc' }],
      });

      let nextCycleId: string | null = null;
      let nextEndAt: Date | null = null;
      let openingPriceCents: number | null = null;

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
        await attachQueuedPreBids(tx, reRead.plotId, nextCycle.id);

        // Authorize each attached pre-bid; failures expire out non-blockingly.
        const attached = await tx.preBid.findMany({
          where: { cycleId: nextCycle.id, status: 'ACTIVE' },
        });
        for (const pb of attached) {
          try {
            await authorizePreBidAtAttach(pb);
          } catch {
            await tx.preBid.update({
              where: { id: pb.id },
              data: { status: 'EXPIRED', lostReason: 'expired' },
            });
          }
        }

        const surviving = await tx.preBid.findMany({
          where: { cycleId: nextCycle.id, status: 'ACTIVE' },
          orderBy: [{ maxBidCents: 'desc' }, { createdAt: 'asc' }],
        });
        if (surviving.length > 0) {
          const opening = await resolveCycle(tx, nextCycle, {});
          openingPriceCents = opening?.priceCents ?? null;
        } else {
          // Every queued pre-bid failed authorization at attach: the cycle
          // would be an empty shell nobody can bid on until the sweep finds
          // it. Cancel it; the IDLE transition below applies.
          await tx.auctionCycle.update({
            where: { id: nextCycle.id },
            data: { status: 'CANCELLED' },
          });
          nextCycleId = null;
          nextEndAt = null;
        }
      }

      if (nextCycleId === null) {
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

      return {
        winnerRow,
        nextCycleId,
        nextEndAt,
        openingPriceCents,
      };
    });

    if (settled === null) return null;

    const outcome: Outcome = {
      plotId,
      cycleId,
      winnerPreBidId: cascade.winnerPreBidId,
      winnerBidderId: settled.winnerRow?.bidderId ?? null,
      winnerBrand: settled.winnerRow
        ? {
            companyName: settled.winnerRow.companyName,
            tagline: settled.winnerRow.tagline,
            targetUrl: settled.winnerRow.targetUrl,
            twitterHandle: settled.winnerRow.twitterHandle,
            mrrText: settled.winnerRow.mrrText,
          }
        : null,
      clearingPriceCents: cascade.clearingPriceCents,
      nextCycleId: settled.nextCycleId,
      nextEndAt: settled.nextEndAt,
      openingPriceCents: settled.openingPriceCents,
    };

    // ONE spec-shaped event per resolution, emitted HERE (not by callers):
    // the cron sweep and 2.5's dev fast-forward share this exact path, so
    // every resolution publishes and neither caller can drift. Winner brand
    // (or null for the IDLE path) + the next cycle's opening state. No
    // bidderId goes out — see bus.ts's emitCycleResolved doc.
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

    return outcome;
  } finally {
    // Safety net: if anything above threw after claiming, un-stick the
    // cycle so the next sweep retries it. RESOLVED cycles are untouched.
    await prisma.auctionCycle
      .updateMany({
        where: { id: cycleId, status: 'RESOLVING' },
        data: { status: 'OPEN' },
      })
      .catch(() => {});
  }
}

export async function resolveEndedCycles(): Promise<{ recovered: number; resolved: number }> {
  const now = new Date();
  const recovered = await recoverStuckResolving(now);

  const ended = await prisma.auctionCycle.findMany({
    where: { status: 'OPEN', endAt: { lte: now } },
    select: { id: true },
    orderBy: { endAt: 'asc' },
  });

  let resolved = 0;
  for (const { id } of ended) {
    const outcome = await resolveOneCycle(id, now);
    // resolveOneCycle publishes cycle:resolved itself — the sweep only counts.
    if (outcome === null) continue;
    resolved += 1;
  }

  return { recovered, resolved };
}
