'use client';

/**
 * Phase 1.4 HUD top strip: brand mark, per-tier idle/live counts, live
 * activity meter (sum of LIVE current prices) and next-close countdown.
 * Pure DOM, derives everything from the city store - no extra fetches.
 *
 * Tick scoping: countdown refreshes off the shared 5s grid tick - the
 * per-second 1 Hz tick is reserved for the detail card (1.5 invariant).
 */

import { useCityStore } from '@/lib/city/store';
import { useCityValueCents, formatHudCountdown, hudNowMs } from '@/lib/city/hud-hooks';
import { useTick } from '@/components/city/PlotSkins';
import { formatPrice } from '@/lib/tiers';
import type { PlotDto } from '@/types/api';

const TIER_ORDER = ['CORE', 'MID', 'OUTER'] as const;

interface Counters {
  perTier: Record<PlotDto['tier'], { idle: number; live: number }>;
  idle: number;
  live: number;
  nextEndAt: string | null;
}

function useCounters(): Counters {
  const plots = useCityStore((s) => s.plots);
  const tick = useTick();
  void tick; // countdown freshness: re-render at most every 5s

  const perTier = {
    CORE: { idle: 0, live: 0 },
    MID: { idle: 0, live: 0 },
    OUTER: { idle: 0, live: 0 },
  } as Counters['perTier'];
  let idle = 0;
  let live = 0;
  let nextEndAtMs = Infinity;
  plots.forEach((p) => {
    const bucket = perTier[p.tier] ?? null;
    if (p.status === 'LIVE') {
      live += 1;
      if (bucket) bucket.live += 1;
      if (p.endAt) {
        const ms = new Date(p.endAt).getTime();
        if (ms < nextEndAtMs) nextEndAtMs = ms;
      }
    } else {
      idle += 1;
      if (bucket) bucket.idle += 1;
    }
  });
  const now = hudNowMs();
  return {
    perTier,
    idle,
    live,
    nextEndAt: nextEndAtMs === Infinity || nextEndAtMs <= now ? null : formatHudCountdown(new Date(nextEndAtMs).toISOString(), now),
  };
}

export function TopStrip() {
  const counters = useCounters();
  const valueCents = useCityValueCents();
  const loading = useCityStore((s) => s.loading);

  return (
    <div
      data-testid="hud-top-strip"
      className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-[#12303a] bg-[#050508]/85 px-4 py-1.5 font-mono text-[11px] tracking-wide text-[#9fd8e6] shadow-[0_0_18px_rgba(0,240,255,0.12)] backdrop-blur-sm"
    >
      <span aria-hidden className="text-[#00f0ff]">▲</span>
      <span className="text-[10px] uppercase tracking-[0.25em] text-[#6b7a8c]">SaaSity</span>
      <span className="mx-2 text-[#2a3a46]">|</span>
      {TIER_ORDER.map((tier) => (
        <span key={tier}>
          <span className="text-[#6b7a8c]">{tier.slice(0, 2)}</span>{' '}
          <span className="text-[#00f0ff]">{counters.perTier[tier].live}</span>/
          <span>{counters.perTier[tier].idle}</span>
          <span className="mx-2 text-[#2a3a46]">·</span>
        </span>
      ))}
      <span className="text-[#00f0ff]">{counters.live}</span> live
      <span className="mx-2 text-[#2a3a46]">|</span>
      <span>{counters.idle}</span> idle
      <span className="mx-2 text-[#2a3a46]">|</span>
      <span className="text-[#ffb400]">{formatPrice(valueCents)}</span> committed
      {counters.nextEndAt ? (
        <>
          <span className="mx-2 text-[#2a3a46]">|</span>
          next close <span className="text-[#00f0ff]">{counters.nextEndAt}</span>
        </>
      ) : null}
      <span className="mx-2 text-[#2a3a46]">|</span>
      <span className="flex items-center gap-1.5" aria-hidden>
        <span className="inline-block h-2 w-2 rounded-full bg-[#00f0ff]" />
        <span className="text-[9px] text-[#6b7a8c]">yours</span>
        <span className="inline-block h-2 w-2 rounded-full bg-[#ffb400]" />
        <span className="text-[9px] text-[#6b7a8c]">outbid</span>
      </span>
      {loading ? <span className="ml-2 animate-pulse text-[#6b7a8c]">SYNCING…</span> : null}
    </div>
  );
}