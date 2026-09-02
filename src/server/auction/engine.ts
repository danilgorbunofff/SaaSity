/**
 * Phase 2.2 — atomic auction engine.
 *
 * Concurrency model: every mutating request opens a transaction and first
 * takes a Postgres transaction-scoped advisory lock keyed by plotId
 * (pg_advisory_xact_lock). That serializes all claims/bids/pre-bids on one
 * plot while leaving other plots fully parallel, and it cannot deadlock
 * because a transaction only ever locks a single plot's key.
 *
 * The leader/price math lives in one place: computeResolution (pure,
 * unit-tested) + resolveCycle (transactional applier). Claim, bid and
 * pre-bid routes all funnel through these helpers — no second
 * implementation may ever exist (phase 2.2 exit criterion).
 */

import { TIERS, SOFT_CLOSE_MINUTES, SOFT_CLOSE_CAP_MINUTES } from '@/lib/tiers';
import type { Prisma, AuctionCycle, Plot } from '@/generated/prisma/client';

export type Tx = Prisma.TransactionClient;

export interface ActivePreBidRow {
  id: string;
  bidderId: string;
  maxBidCents: number;
  createdAt: Date;
  // Brand snapshot copied onto the Plot display cache when this pre-bid leads.
  companyName: string;
  tagline: string | null;
  targetUrl: string;
  twitterHandle: string;
  mrrText: string | null;
}

export interface Resolution {
  leaderPreBidId: string;
  leaderBidderId: string;
  priceCents: number;
  brand: {
    companyName: string;
    tagline: string | null;
    targetUrl: string;
    twitterHandle: string;
    mrrText: string | null;
  };
}

/**
 * Second-price for one candidate over the others: min(own max, highest
 * other + increment), clamped up to the floor. The single-candidate case
 * pays the floor. Shared by computeResolution and the worker's capture
 * cascade so the two can never drift apart.
 */
export function secondPriceFor(
  candidateMaxBidCents: number,
  otherMaxBidCents: number | null,
  floorCents: number,
  incrementCents: number,
): number {
  if (otherMaxBidCents === null) return floorCents;
  return Math.max(floorCents, Math.min(candidateMaxBidCents, otherMaxBidCents + incrementCents));
}

/**
 * Pure second-price math. activePreBids are the cycle's ACTIVE pre-bids.
 *  - 1 bidder: price = floor.
 *  - N bidders: price = min(leader.maxBid, second.maxBid + increment),
 *    clamped up to the floor (leader always pays at least the floor).
 * Ties on maxBidCents break by earliest createdAt (first-come leads).
 */
export function computeResolution(
  activePreBids: ActivePreBidRow[],
  floorCents: number,
  incrementCents: number,
): Resolution | null {
  if (activePreBids.length === 0) return null;

  const sorted = [...activePreBids].sort(
    (a, b) => b.maxBidCents - a.maxBidCents || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const leader = sorted[0];

  const priceCents = secondPriceFor(
    leader.maxBidCents,
    sorted.length > 1 ? sorted[1].maxBidCents : null,
    floorCents,
    incrementCents,
  );

  return {
    leaderPreBidId: leader.id,
    leaderBidderId: leader.bidderId,
    priceCents,
    brand: {
      companyName: leader.companyName,
      tagline: leader.tagline,
      targetUrl: leader.targetUrl,
      twitterHandle: leader.twitterHandle,
      mrrText: leader.mrrText,
    },
  };
}

/** Serialize all mutations for one plot inside the caller's transaction. */
export async function lockPlot(tx: Tx, plotId: string): Promise<void> {
  // $executeRaw (not $queryRaw): the blocking pg_advisory_xact_lock returns
  // a void column the pg adapter cannot deserialize as a result set —
  // execute treats it as a command and never parses columns.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${plotId}::text, 0))`;
}

interface ResolveOptions {
  /**
   * When the resolution price equals this caller's submitted max (and they
   * lead), the ledger tick is attributed as their manual bid rather than a
   * proxy tick. Undefined (pre-bid attach) always records proxy.
   */
  humanSubmitCents?: number;
}

/**
 * The ONLY place a cycle's leader/currentPrice is recomputed and applied.
 * Loads the cycle's ACTIVE pre-bids, runs computeResolution, and when
 * leader or price changed writes: one ledger Bid (proxy unless the human
 * caller IS the new leader at exactly their submitted max), the cycle's
 * currentPriceCents, and Plot.currentLeaderPreBidId (auction progress only
 * — never a brand; see activateTenant for the publicly-displayed tenant).
 * Safe to call repeatedly, including for a brand-new cycle, without ever
 * disturbing whatever tenant is currently displayed on the plot.
 *
 * Must be called inside a transaction that already holds lockPlot.
 */
export async function resolveCycle(
  tx: Tx,
  cycle: Pick<
    AuctionCycle,
    'id' | 'plotId' | 'floorPriceCents' | 'incrementCents' | 'currentPriceCents'
  >,
  options: ResolveOptions = {},
): Promise<(Resolution & { tickId?: string }) | null> {
  const active = await tx.preBid.findMany({
    where: { cycleId: cycle.id, status: 'ACTIVE' },
    select: {
      id: true,
      bidderId: true,
      maxBidCents: true,
      createdAt: true,
      companyName: true,
      tagline: true,
      targetUrl: true,
      twitterHandle: true,
      mrrText: true,
    },
  });

  const resolution = computeResolution(active, cycle.floorPriceCents, cycle.incrementCents);
  if (!resolution) return null;

  const priceChanged = resolution.priceCents !== cycle.currentPriceCents;
  const plotIsLeader =
    options.humanSubmitCents !== undefined && resolution.priceCents === options.humanSubmitCents;

  if (priceChanged) {
    await tx.bid.create({
      data: {
        cycleId: cycle.id,
        plotId: cycle.plotId,
        preBidId: resolution.leaderPreBidId,
        bidderId: resolution.leaderBidderId,
        amountCents: resolution.priceCents,
        isProxy: !plotIsLeader,
      },
    });
  }

  // Leader rotated without a price move (e.g. earlier same-max bidder wins
  // the tie-break): the ledger must still show the takeover even though the
  // price didn't move. Skip the very first tick when no price existed yet —
  // the priceChanged branch above already wrote it.
  if (!priceChanged && cycle.currentPriceCents !== null) {
    const lastTick = await tx.bid.findFirst({
      where: { cycleId: cycle.id },
      orderBy: { createdAt: 'desc' },
      select: { preBidId: true },
    });
    if (lastTick?.preBidId !== resolution.leaderPreBidId) {
      await tx.bid.create({
        data: {
          cycleId: cycle.id,
          plotId: cycle.plotId,
          preBidId: resolution.leaderPreBidId,
          bidderId: resolution.leaderBidderId,
          amountCents: resolution.priceCents,
          isProxy: true,
        },
      });
    }
  }

  await tx.auctionCycle.update({
    where: { id: cycle.id },
    data: { currentPriceCents: resolution.priceCents },
  });

  // AUCTION PROGRESS ONLY: the opaque leading-preBid pointer, never a brand.
  // A bidder matches this against their own PreBid ids to derive "am I
  // leading" — the provisional leader of an OPEN auction has not won or
  // paid anything yet, so their brand must never be written to a
  // publicly-displayed field here. Tenant activation is a separate,
  // one-time event handled by activateTenant() at successful settlement.
  await tx.plot.update({
    where: { id: cycle.plotId },
    data: { currentLeaderPreBidId: resolution.leaderPreBidId },
  });

  return resolution;
}

/**
 * The ONLY place a plot's publicly-displayed tenant changes. Called by the
 * worker exactly once per cycle, and only after the capture cascade
 * (finalize.ts) has actually collected payment for `winner`. Activates the
 * winner for the full lease — i.e. until THIS function is called again for
 * the same plot, regardless of whether/when a later auction opens, extends,
 * or fails to produce a new winner. Must be called inside a transaction
 * that already holds lockPlot.
 */
export async function activateTenant(
  tx: Tx,
  plotId: string,
  winner: { id: string; companyName: string; tagline: string | null; targetUrl: string; twitterHandle: string; mrrText: string | null },
  now: Date,
): Promise<void> {
  await tx.plot.update({
    where: { id: plotId },
    data: {
      tenantPreBidId: winner.id,
      tenantSince: now,
      tenantCompanyName: winner.companyName,
      tenantTagline: winner.tagline,
      tenantTwitterHandle: winner.twitterHandle,
      tenantLogoUrl: null,
      tenantMrrText: winner.mrrText,
      tenantLogoHidden: false,
      tenantTargetUrl: winner.targetUrl,
    },
  });
}

export interface QueuedBrand {
  companyName: string;
  tagline?: string | null;
  targetUrl: string;
  twitterHandle: string;
  mrrText?: string | null;
}

/**
 * Create a PreBid for a bidder on a plot, upmerging with any existing live
 * row for the same target: queued next-cycle pre-bid (cycleId null) or the
 * bidder's ACTIVE pre-bid in this cycle. maxBid moves upward only.
 * Returns the pre-bid id. Caller must hold lockPlot.
 */
export async function upsertPreBid(
  tx: Tx,
  args: {
    plotId: string;
    cycleId: string | null;
    bidderId: string;
    maxBidCents: number;
    brand: QueuedBrand;
  },
): Promise<string> {
  // Match the bidder's live row for this target. Prefer the exact-cycle row
  // over the queued next-cycle row so a bidder holding both never merges the
  // wrong one (e.g. raising their live bid while a queued row also exists).
  //
  // `cycleId` is passed through EXACTLY: `null` must filter `IS NULL`
  // (the queued next-cycle row), never fall back to "any row" — collapsing
  // null to undefined silently turned a next-cycle pre-bid into a top-up of
  // the bidder's row in the RUNNING cycle (phase 2.5 fix).
  const exact = await tx.preBid.findFirst({
    where: {
      plotId: args.plotId,
      bidderId: args.bidderId,
      status: 'ACTIVE',
      cycleId: args.cycleId,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (exact) {
    if (exact.maxBidCents >= args.maxBidCents) {
      // Existing commitment already at least as strong for this target — keep it.
      return exact.id;
    }
    await tx.preBid.update({
      where: { id: exact.id },
      data: {
        maxBidCents: args.maxBidCents,
        companyName: args.brand.companyName,
        tagline: args.brand.tagline ?? null,
        targetUrl: args.brand.targetUrl,
        twitterHandle: args.brand.twitterHandle,
        mrrText: args.brand.mrrText ?? null,
      },
    });
    return exact.id;
  }

  // No exact-cycle row: fall back to the bidder's queued next-cycle row
  // (cycleId null) — usable for a next-cycle target or when attaching it
  // into a freshly opened live cycle (cycleId moves null -> cycle id).
  const queued = await tx.preBid.findFirst({
    where: {
      plotId: args.plotId,
      bidderId: args.bidderId,
      status: 'ACTIVE',
      cycleId: null,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (queued) {
    await tx.preBid.update({
      where: { id: queued.id },
      data: {
        maxBidCents: args.maxBidCents,
        cycleId: args.cycleId,
        companyName: args.brand.companyName,
        tagline: args.brand.tagline ?? null,
        targetUrl: args.brand.targetUrl,
        twitterHandle: args.brand.twitterHandle,
        mrrText: args.brand.mrrText ?? null,
      },
    });
    return queued.id;
  }

  const created = await tx.preBid.create({
    data: {
      plotId: args.plotId,
      cycleId: args.cycleId,
      bidderId: args.bidderId,
      maxBidCents: args.maxBidCents,
      companyName: args.brand.companyName,
      tagline: args.brand.tagline ?? null,
      targetUrl: args.brand.targetUrl,
      twitterHandle: args.brand.twitterHandle,
      mrrText: args.brand.mrrText ?? null,
      status: 'ACTIVE',
    },
  });
  return created.id;
}

/**
 * Claim path core: transition IDLE -> LIVE and spin up the clean-slate
 * cycle snapshotting the plot tier's economics. Returns null when the plot
 * was claimed concurrently (conditional updateMany is the race arbiter).
 * Caller must hold lockPlot; run inside its transaction.
 */
export async function startCycle(
  tx: Tx,
  plot: Pick<Plot, 'id' | 'tier'>,
  now: Date,
): Promise<AuctionCycle | null> {
  const cfg = TIERS[plot.tier as keyof typeof TIERS];

  const updated = await tx.plot.updateMany({
    where: { id: plot.id, status: 'IDLE' },
    data: { status: 'LIVE' },
  });
  if (updated.count === 0) return null;

  const cycle = await tx.auctionCycle.create({
    data: {
      plotId: plot.id,
      status: 'OPEN',
      floorPriceCents: cfg.floorCents,
      incrementCents: cfg.incrementCents,
      durationMinutes: cfg.durationHours * 60,
      startedAt: now,
      endAt: new Date(now.getTime() + cfg.durationHours * 60 * 60 * 1000),
    },
  });

  await tx.plot.update({
    where: { id: plot.id },
    data: { currentCycleId: cycle.id },
  });

  return cycle;
}

/**
 * Attach queued (cycleId = null) pre-bids to a freshly created cycle.
 * Caller must hold lockPlot; run inside its transaction.
 */
export async function attachQueuedPreBids(tx: Tx, plotId: string, cycleId: string): Promise<void> {
  await tx.preBid.updateMany({
    where: { plotId, cycleId: null, status: 'ACTIVE' },
    data: { cycleId },
  });
}

export interface SoftCloseResult {
  extended: boolean;
  newEndAt: Date;
}

/**
 * Reset-based soft-close: when a bid lands inside the final
 * SOFT_CLOSE_MINUTES window, endAt is pushed to receivedAt +
 * SOFT_CLOSE_MINUTES (max with current endAt), capped at
 * SOFT_CLOSE_CAP_MINUTES of total extensions per cycle.
 * Caller must hold lockPlot; run inside its transaction.
 */
export async function applySoftClose(
  tx: Tx,
  cycle: Pick<AuctionCycle, 'id' | 'endAt' | 'softCloseExtensions'>,
  receivedAt: Date,
): Promise<SoftCloseResult> {
  const windowMs = SOFT_CLOSE_MINUTES * 60 * 1000;
  const remaining = cycle.endAt.getTime() - receivedAt.getTime();

  if (remaining > windowMs) return { extended: false, newEndAt: cycle.endAt };

  const extensionBudgetLeft =
    (SOFT_CLOSE_CAP_MINUTES - cycle.softCloseExtensions) * 60 * 1000;
  if (extensionBudgetLeft <= 0) {
    return { extended: false, newEndAt: cycle.endAt };
  }

  const pushMs = Math.min(windowMs, extensionBudgetLeft);
  const newEndAt = new Date(Math.max(cycle.endAt.getTime(), receivedAt.getTime() + pushMs));

  // A partial grant may be smaller than the time already left — then nothing
  // moves and no budget is consumed.
  if (newEndAt.getTime() <= cycle.endAt.getTime()) {
    return { extended: false, newEndAt: cycle.endAt };
  }

  await tx.auctionCycle.update({
    where: { id: cycle.id },
    data: {
      endAt: newEndAt,
      softCloseExtensions: cycle.softCloseExtensions + Math.round(pushMs / 60000),
    },
  });

  return { extended: true, newEndAt };
}
