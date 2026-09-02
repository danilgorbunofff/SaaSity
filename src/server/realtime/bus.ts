/**
 * Phase 2.4 — in-process realtime pub/sub bus + typed emit helpers.
 *
 * Transport decision made once in phase 0.2 (SSE + in-process bus over
 * Supabase Realtime — 49 plots, single region, bursty-not-huge fan-out);
 * 2.4 implements it. Every producer (bid/claim routes, worker) publishes
 * through the emit* family so M3's Stripe flow gets realtime updates for
 * free once it calls the same code paths.
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
  nextCycle: { cycleId: string; endAt: string; openingPriceCents: number | null } | null;
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

export function publish(event: RealtimeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // One bad consumer must never break the publish loop.
      listeners.delete(listener);
    }
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
  nextCycle: { cycleId: string; endAt: string; openingPriceCents: number | null } | null;
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
