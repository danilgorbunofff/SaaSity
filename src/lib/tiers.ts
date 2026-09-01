/**
 * Tier economics — single source of truth for the auction engine.
 * Pricing/duration are per-tier constants, NOT per-plot DB fields.
 * Clean-slate rule: every new cycle snapshots these values at creation,
 * so opening minimum bids always reset to the tier floor.
 */

export type PlotTier = 'OUTER' | 'MID' | 'CORE';

export interface TierConfig {
  /** Auction cycle duration in hours */
  durationHours: number;
  /** Opening minimum bid (floor) in cents */
  floorCents: number;
  /** Proxy/manual bid increment step in cents */
  incrementCents: number;
}

export const TIERS: Record<PlotTier, TierConfig> = {
  OUTER: { durationHours: 6, floorCents: 100, incrementCents: 50 },
  MID: { durationHours: 12, floorCents: 500, incrementCents: 100 },
  CORE: { durationHours: 24, floorCents: 2500, incrementCents: 500 },
};

/** Soft-close window: any bid inside the final N minutes extends the countdown. */
export const SOFT_CLOSE_MINUTES = 3;

/** Total cap on extensions from soft-close, per cycle. */
export const SOFT_CLOSE_CAP_MINUTES = 120;

/** How long a cycle stays in RESOLVING state before the worker escalates. */
export const RESOLVING_TIMEOUT_MINUTES = 5;

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
