/**
 * Phase 2.4 — in-process realtime pub/sub bus + typed emit helpers, hardened
 * by Part 4 (`serverless-local-bus`) with a durable DB outbox behind it.
 *
 * Transport: SSE + outbox-backed fan-out (Neon Postgres only — no extra
 * broker). `publish()` notifies local listeners synchronously (same-process
 * immediacy) AND hands the event to the durable sink installed per server
 * process by `./outbox`; every instance's SSE loop polls rows newer than its
 * cursor, so cross-instance delivery lands within OUTBOX_POLL_MS. The
 * process-local Set is therefore a latency optimization, never the fan-out
 * infrastructure — a bid handled by instance B reaches a browser on instance
 * A through the outbox even when the two processes share nothing else.
 * Every producer (bid/claim routes, worker) publishes through the emit*
 * family so M3's Stripe flow gets realtime updates for free once it calls
 * the same code paths.
 *
 * Privacy invariant (binding, from 0.3 + Part 1 lifecycle fix): maxBidCents,
 * non-leading bidders' brand/identity, AND the current auction's
 * provisional leader's brand are structurally absent from every event
 * payload. Only a confirmed, paid TENANT's brand is ever broadcast — on
 * cycle:resolved, when a winner actually settles. bid:placed carries only
 * the opaque leaderPreBidId, never a brand.
 */

import type { TenantBrandDto } from '@/types/api';

export interface RealtimeEvent {
  type: 'bid:placed' | 'cycle:extended' | 'cycle:resolved';
  /** Monotonic per-connection sequence is assigned by the SSE route, not here. */
  plotId: string;
  cycleId: string | null;
  currentPriceCents: number | null;
  leaderPreBidId: string | null;
  isProxy?: boolean;
  endAt: string | null;
  winner: { preBidId: string; brand: TenantBrandDto } | null;
  clearingPriceCents: number | null;
  /**
   * Part 4 `next-cycle-realtime-state`: the COMPLETE next-cycle public
   * snapshot (never partial). leaderPreBidId is the opaque auction-progress
   * pointer — same privacy shape as PlotDto.currentLeaderPreBidId; the
   * provisional leader's brand is NEVER included (Part 1: no free exposure
   * before payment).
   */
  nextCycle: {
    cycleId: string;
    endAt: string;
    openingPriceCents: number | null;
    currentPriceCents: number | null;
    leaderPreBidId: string | null;
  } | null;
}

/** Public brand snapshot as carried by engine Resolution / PreBid rows. */
export interface BrandSnapshot {
  companyName: string | null;
  tagline: string | null;
  targetUrl: string | null;
  twitterHandle: string | null;
  mrrText: string | null;
}

type Listener = (event: RealtimeEvent) => void;

// Module-level listener registry — one bus per Node process.
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Part 4 `serverless-local-bus`: the Set above only reaches listeners in
 * THIS process. A durable cross-instance sink (the DB outbox — see
 * `./outbox`) is registered per server process via `setRealtimeSink`; every
 * `publish` below fans out locally AND hands the event to the sink, so worker
 * events and API mutation events share one transport. Unit tests import this
 * module WITHOUT the sink installed, which keeps publish pure and DB-free.
 */
type DurableSink = (event: RealtimeEvent) => void;
let durableSink: DurableSink | null = null;

export function setRealtimeSink(sink: DurableSink | null): void {
  durableSink = sink;
}

export function publish(event: RealtimeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // One bad consumer must never break the publish loop.
      listeners.delete(listener);
    }
  }
  if (durableSink) {
    try {
      durableSink(event);
    } catch (err) {
      // Cross-instance fan-out must never break the request path or the
      // local loop above — the failure is logged for ops alerting.
      console.error('[realtime] durable sink failed', err);
    }
  }
}

/**
 * Natural idempotency key for an event — stable across the local bus and an
 * outbox redelivery of the same logical occurrence, so the SSE route (and
 * any future consumer) can dedupe without a shared sequence space:
 *   bid:placed     → one key per (cycle, price, leader) triple;
 *   cycle:extended → one key per (cycle, endAt) pair;
 *   cycle:resolved → one key per resolved cycle (emitted exactly once per
 *                    resolution; reconcile replays reuse the same cycleId).
 */
export function eventKeyOf(
  event: Pick<
    RealtimeEvent,
    'type' | 'cycleId' | 'currentPriceCents' | 'leaderPreBidId' | 'endAt' | 'clearingPriceCents'
  >,
): string {
  switch (event.type) {
    case 'bid:placed':
      return `bid:${event.cycleId}:${event.currentPriceCents}:${event.leaderPreBidId}`;
    case 'cycle:extended':
      return `ext:${event.cycleId}:${event.endAt}`;
    case 'cycle:resolved':
      return `res:${event.cycleId}:${event.clearingPriceCents}`;
  }
}

export function toTenantBrandDto(brand: BrandSnapshot): TenantBrandDto {
  return {
    companyName: brand.companyName ?? null,
    tagline: brand.tagline ?? null,
    twitterHandle: brand.twitterHandle ?? null,
    // Logo display cache lives on the Plot row only (M4 4.3 serves uploads);
    // until uploads exist the public payload structurally has no logo URL.
    logoUrl: null,
    mrrText: brand.mrrText ?? null,
    logoHidden: false,
    targetUrl: brand.targetUrl ?? null,
  };
}

function emit(
  type: RealtimeEvent['type'],
  base: Omit<RealtimeEvent, 'type' | 'isProxy'>,
  isProxy?: boolean,
): void {
  publish({ type, ...base, ...(isProxy !== undefined ? { isProxy } : {}) });
}

/**
 * bid/claim routes, after tx commit. NO brand is broadcast here — the
 * current auction leader has not won or paid anything yet, so publishing
 * their brand would give them free billboard exposure (Part 1 fix). Only
 * the opaque leaderPreBidId goes out, so a bidder can match it against
 * their own /api/me/bids ids to derive "am I leading" without exposing
 * who they are to anyone else.
 */
export function emitBidPlaced(input: {
  plotId: string;
  cycleId: string;
  currentPriceCents: number;
  /** The leader's preBid id — already public via PlotDto; keeps client ownership derivation exact. */
  leaderPreBidId: string;
  isProxy: boolean;
  endAt: string;
}): void {
  emit(
    'bid:placed',
    {
      plotId: input.plotId,
      cycleId: input.cycleId,
      currentPriceCents: input.currentPriceCents,
      leaderPreBidId: input.leaderPreBidId,
      endAt: input.endAt,
      winner: null,
      clearingPriceCents: null,
      nextCycle: null,
    },
    input.isProxy,
  );
}

/** Bid route only — fires when soft-close extended endAt this request. */
export function emitCycleExtended(input: {
  plotId: string;
  cycleId: string;
  endAt: string;
}): void {
  emit('cycle:extended', {
    plotId: input.plotId,
    cycleId: input.cycleId,
    currentPriceCents: null,
    leaderPreBidId: null,
    endAt: input.endAt,
    winner: null,
    clearingPriceCents: null,
    nextCycle: null,
  });
}

/**
 * 2.3 worker, after its final tx commits. No bidderId is broadcast (Part 4
 * `public-bidder-id`: an anonymous bidder identifier must never reach every
 * connected client) — only the winner's brand, which is also the plot's
 * new public tenant.
 */
export function emitCycleResolved(input: {
  plotId: string;
  cycleId: string;
  winner: { preBidId: string; brand: BrandSnapshot } | null;
  clearingPriceCents: number | null;
  nextCycle: {
    cycleId: string;
    endAt: string;
    openingPriceCents: number | null;
    currentPriceCents: number | null;
    leaderPreBidId: string | null;
  } | null;
}): void {
  emit('cycle:resolved', {
    plotId: input.plotId,
    cycleId: input.cycleId,
    currentPriceCents: null,
    leaderPreBidId: null,
    endAt: null,
    winner: input.winner
      ? { preBidId: input.winner.preBidId, brand: toTenantBrandDto(input.winner.brand) }
      : null,
    clearingPriceCents: input.clearingPriceCents,
    nextCycle: input.nextCycle,
  });
}
