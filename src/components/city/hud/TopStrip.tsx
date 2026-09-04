'use client';

/**
 * Phase 1.4 HUD top strip: brand mark, per-tier idle/live counts, live
 * activity meter (sum of LIVE current prices) and next-close countdown.
 * Pure DOM, derives everything from the city store - no extra fetches.
 *
 * Tick scoping: countdown refreshes off the shared 5s grid tick - the
 * per-second 1 Hz tick is reserved for the detail card (1.5 invariant).
 */

import { useState } from 'react';
import { useCityStore } from '@/lib/city/store';
import type { ConnectionState } from '@/lib/city/store';
import { useCityValueCents, formatHudCountdown, hudNowMs } from '@/lib/city/hud-hooks';
import { useTick } from '@/components/city/PlotSkins';
import { useReducedMotion } from '@/lib/city/reduced-motion';
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
    nextEndAt:
      nextEndAtMs === Infinity || nextEndAtMs <= now
        ? null
        : formatHudCountdown(new Date(nextEndAtMs).toISOString(), now),
  };
}

function formatSyncAge(lastSyncAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - lastSyncAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

const CONNECTION_COPY: Record<ConnectionState, { label: string; dot: string; pulse: boolean }> = {
  live: { label: 'LIVE', dot: 'bg-[#00f0ff]', pulse: false },
  connecting: { label: 'CONNECTING…', dot: 'bg-[#6b7a8c]', pulse: true },
  reconnecting: { label: 'RECONNECTING…', dot: 'bg-[#ffb400]', pulse: true },
  offline: { label: 'OFFLINE', dot: 'bg-[#ff5a5a]', pulse: false },
};

/**
 * Part 4 realtime-harden: stream health + data freshness, always visible.
 * The dot is the socket state; the age is time since the last applied
 * server contact (snapshot, event, or resync). Quiet auctions read
 * "LIVE · 12m" — silence is normal on 12h cycles, not staleness.
 */
function ConnectionBadge() {
  const connection = useCityStore((s) => s.connection);
  const lastSyncAt = useCityStore((s) => s.lastSyncAt);
  const tick = useTick();
  void tick; // re-render at most every 5s for the sync age
  const reduceMotion = useReducedMotion();
  const copy = CONNECTION_COPY[connection];
  const age = lastSyncAt == null ? null : formatSyncAge(lastSyncAt, hudNowMs());
  return (
    <span
      role="status"
      aria-label={`Connection ${copy.label}${age ? `, synced ${age} ago` : ''}`}
      title={
        connection === 'live'
          ? 'Live auction feed. Data age counts up between server contacts.'
          : connection === 'offline'
            ? 'No network — showing the last synced state. Reconnect to resume live prices.'
            : 'Reconnecting the live feed — showing the last synced state.'
      }
      className="inline-flex items-center gap-1.5"
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${copy.dot}${copy.pulse && !reduceMotion ? ' animate-pulse' : ''}`}
      />
      <span className="text-[9px] uppercase tracking-[0.2em] text-[#6b7a8c]">
        {copy.label}
        {connection === 'live' && age ? (
          <span className="ml-1 normal-case tracking-normal">· {age}</span>
        ) : null}
      </span>
    </span>
  );
}

export function TopStrip() {
  const counters = useCounters();
  const valueCents = useCityValueCents();
  const loading = useCityStore((s) => s.loading);
  const reduceMotion = useReducedMotion();
  // Part 6 `mobile-hud-overlap`: phones get a one-line summary — secondary
  // metrics live behind a disclosure instead of wrapping over the scene.
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      data-testid="hud-top-strip"
      className="pointer-events-none absolute left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-20 max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-full border border-[#12303a] bg-[#050508]/85 px-4 py-1.5 font-mono text-xs tracking-wide text-[#9fd8e6] shadow-[0_0_18px_rgba(0,240,255,0.12)] backdrop-blur-sm"
    >
      <span aria-hidden className="text-[#00f0ff]">
        ▲
      </span>
      <span className="text-[10px] uppercase tracking-[0.25em] text-[#9fd8e6]">SaaSity</span>
      <span className="mx-2 text-[#2a3a46]">|</span>
      {/* Always-visible essentials: live count + next close. */}
      <span className="text-[#00f0ff]">{counters.live}</span> live
      {counters.nextEndAt ? (
        <>
          <span className="mx-2 text-[#2a3a46]">|</span>
          next close <span className="text-[#00f0ff]">{counters.nextEndAt}</span>
        </>
      ) : null}
      {/* Secondary metrics: inline on sm+, disclosed on phones. */}
      <span className="hidden sm:inline">
        <span className="mx-2 text-[#2a3a46]">|</span>
        {TIER_ORDER.map((tier) => (
          <span key={tier}>
            <span className="text-[#6b7a8c]">{tier.slice(0, 2)}</span>{' '}
            <span className="text-[#00f0ff]">{counters.perTier[tier].live}</span>/
            <span>{counters.perTier[tier].idle}</span>
            <span className="mx-2 text-[#2a3a46]">·</span>
          </span>
        ))}
        <span>{counters.idle}</span> idle
        <span className="mx-2 text-[#2a3a46]">|</span>
        <span className="text-[#ffb400]">{formatPrice(valueCents)}</span> committed
        <span className="mx-2 text-[#2a3a46]">|</span>
        <span className="items-center gap-1.5" aria-hidden>
          <span className="inline-block h-2 w-2 rounded-full bg-[#00f0ff]" />
          <span className="text-[10px] text-[#9fd8e6]"> yours</span>
          <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[#ffb400]" />
          <span className="text-[10px] text-[#9fd8e6]"> outbid</span>
        </span>
        {loading ? (
          <span className={`ml-2 text-[#6b7a8c]${reduceMotion ? '' : ' animate-pulse'}`}>
            SYNCING…
          </span>
        ) : null}
        <span className="mx-2 text-[#2a3a46]">|</span>
        <ConnectionBadge />
      </span>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide city stats' : 'Show city stats'}
        className="pointer-events-auto ml-2 rounded-full border border-[#12303a] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#9fd8e6] hover:border-[#00f0ff]/50 sm:hidden"
      >
        {expanded ? 'less' : 'stats'}
      </button>
      {expanded ? (
        <span className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-t border-[#12303a] pt-1 text-[11px] sm:hidden">
          {TIER_ORDER.map((tier) => (
            <span key={tier}>
              <span className="text-[#6b7a8c]">{tier}</span>{' '}
              <span className="text-[#00f0ff]">{counters.perTier[tier].live}</span>/
              <span>{counters.perTier[tier].idle}</span>
            </span>
          ))}
          <span>{counters.idle} idle</span>
          <span className="text-[#ffb400]">{formatPrice(valueCents)} committed</span>
          {loading ? (
            <span className={reduceMotion ? undefined : 'animate-pulse'}>SYNCING…</span>
          ) : null}
          <ConnectionBadge />
        </span>
      ) : null}
    </div>
  );
}
