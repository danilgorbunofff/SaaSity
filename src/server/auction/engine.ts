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

  let priceCents: number;
  if (sorted.length === 1) {
    priceCents = floorCents;
  } else {
    priceCents = Math.min(leader.maxBidCents, sorted[1].maxBidCents + incrementCents);
    if (priceCents < floorCents) priceCents = floorCents;
  }

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
 * currentPriceCents, and the Plot's leader display cache.
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
): Promise<Resolution | null> {
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

  await tx.auctionCycle.update({
    where: { id: cycle.id },
    data: { currentPriceCents: resolution.priceCents },
  });

  await tx.plot.update({
    where: { id: cycle.plotId },
    data: {
      currentLeaderPreBidId: resolution.leaderPreBidId,
      leaderCompanyName: resolution.brand.companyName,
      leaderTagline: resolution.brand.tagline,
      leaderTwitterHandle: resolution.brand.twitterHandle,
      leaderLogoUrl: null,
      leaderMrrText: resolution.brand.mrrText,
      leaderTargetUrl: resolution.brand.targetUrl,
    },
  });

  return resolution;
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
  const existing = await tx.preBid.findFirst({
    where: {
      plotId: args.plotId,
      bidderId: args.bidderId,
      status: 'ACTIVE',
      // Match the bidder's live row for this target: exact-cycle row, or the
      // queued next-cycle row when cycleId is null (or being set now).
      OR: [
        { cycleId: args.cycleId ?? undefined },
        { cycleId: null },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  if (existing && existing.maxBidCents >= args.maxBidCents && existing.cycleId === args.cycleId) {
    // Existing commitment already at least as strong for this target — keep it.
    return existing.id;
  }

  if (existing) {
    await tx.preBid.update({
      where: { id: existing.id },
      data: {
        maxBidCents: args.maxBidCents,
        // Moving from queued (null) into the live cycle on attach.
        cycleId: args.cycleId,
        companyName: args.brand.companyName,
        tagline: args.brand.tagline ?? null,
        targetUrl: args.brand.targetUrl,
        twitterHandle: args.brand.twitterHandle,
        mrrText: args.brand.mrrText ?? null,
      },
    });
    return existing.id;
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

  await tx.auctionCycle.update({
    where: { id: cycle.id },
    data: {
      endAt: newEndAt,
      softCloseExtensions: cycle.softCloseExtensions + Math.round(pushMs / 60000),
    },
  });

  return { extended: true, newEndAt };
}
