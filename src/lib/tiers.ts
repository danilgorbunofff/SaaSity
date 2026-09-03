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

/**
 * How long a cycle may sit in RESOLVING before the sweep reopens it.
 * Kept at >= 2x the primary sweep cadence (GitHub Actions every 5 min —
 * see docs/deployment.md): a healthy settlement that spans one missed tick
 * must never look "stuck". M3 lengthens settlements (sequential Stripe
 * calls); revisit then.
 */
export const RESOLVING_TIMEOUT_MINUTES = 10;

/**
 * Alert line for ended-but-still-OPEN cycles: 2x the primary 5-minute
 * cadence. Past this, the primary scheduler (or every fallback) has missed
 * at least two ticks — page-worthy, not noise. resolveEndedCycles logs a
 * structured warn and reports staleCount/maxStaleMs in its outcome (which
 * the cron route surfaces in its JSON for external monitors).
 */
export const STALE_ENDED_CYCLE_ALERT_MINUTES = 10;

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Part 6 `mrr-copy`: ONE display convention for the MRR badge.
 * Storage is raw user text (`$12k` or `$12k MRR` — both in the wild); display
 * appends ` MRR` only when the text doesn't already end with it, so the
 * detail card and the 3D billboard render the identical string.
 */
export function formatMrrBadge(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (text === '') return null;
  return /\bmrr$/i.test(text) ? text : `${text} MRR`;
}
