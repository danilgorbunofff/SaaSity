'use client';

/**
 * Phase 1.4 HUD top strip: plot counts + live activity meter.
 * Pure DOM, derives everything from the city store - no extra fetches.
 */

import { useCityStore } from '@/lib/city/store';
import { useCityValueCents, formatHudCountdown, hudNowMs, useHudTick } from '@/lib/city/hud-hooks';
import { formatPrice } from '@/lib/tiers';

interface Counters {
  idle: number;
  live: number;
  nextEndAt: string | null;
}

function useCounters(): Counters {
  const plots = useCityStore((s) => s.plots);
  const tick = useHudTick();
  return (() => {
    let idle = 0;
    let live = 0;
    let nextEndAtMs = Infinity;
    plots.forEach((p) => {
      if (p.status === 'LIVE') {
        live += 1;
        if (p.endAt) {
          const ms = new Date(p.endAt).getTime();
          if (ms < nextEndAtMs) nextEndAtMs = ms;
        }
      } else {
        idle += 1;
      }
    });
    const now = hudNowMs();
    void tick;
    return {
      idle,
      live,
      nextEndAtMs: nextEndAtMs === Infinity ? null : nextEndAtMs,
      nextEndAt: nextEndAtMs === Infinity || nextEndAtMs <= now ? null : formatHudCountdown(new Date(nextEndAtMs).toISOString(), now),
    } satisfies Counters & { nextEndAtMs: number | null };
  })();
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
      {loading ? <span className="ml-2 animate-pulse text-[#6b7a8c]">SYNCING…</span> : null}
    </div>
  );
}