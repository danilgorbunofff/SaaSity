'use client';

/**
 * Part 6 `no-help-onboarding`: a reachable list of open auctions with tier
 * filters — the keyboard/screen-reader path to every live auction, and the
 * touch path that doesn't require hunting towers in 3D. Derives from the
 * store (zero fetches), sorted by closing time.
 */

import { useMemo, useState } from 'react';
import { useCityStore } from '@/lib/city/store';
import { sectorLabel, formatHudCountdown, hudNowMs } from '@/lib/city/hud-hooks';
import { useTick } from '@/components/city/PlotSkins';
import { flyToPlot } from '@/lib/city/camera-rig';
import { formatPrice } from '@/lib/tiers';
import type { PlotTier } from '@/lib/tiers';

type Filter = 'ALL' | PlotTier;
type Sort = 'ends' | 'price';

const FILTERS: Filter[] = ['ALL', 'CORE', 'MID', 'OUTER'];

export function AuctionList() {
  const plots = useCityStore((s) => s.plots);
  const outbidPlotIds = useCityStore((s) => s.outbidPlotIds);
  const setSelectedPlotId = useCityStore((s) => s.setSelectedPlotId);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sort, setSort] = useState<Sort>('ends');
  const [contestedOnly, setContestedOnly] = useState(false);
  const tick = useTick();
  void tick; // countdown freshness off the shared 5s grid tick

  const live = useMemo(() => {
    const rows = Array.from(plots.values()).filter(
      (p) =>
        p.status === 'LIVE' &&
        (filter === 'ALL' || p.tier === filter) &&
        (!contestedOnly || outbidPlotIds.has(p.id)),
    );
    rows.sort((a, b) => {
      if (sort === 'price') {
        return (a.currentPriceCents ?? 0) - (b.currentPriceCents ?? 0);
      }
      const ae = a.endAt ? new Date(a.endAt).getTime() : Infinity;
      const be = b.endAt ? new Date(b.endAt).getTime() : Infinity;
      return ae - be;
    });
    return rows;
  }, [plots, filter, sort, contestedOnly, outbidPlotIds]);

  const liveCount = useMemo(
    () => Array.from(plots.values()).filter((p) => p.status === 'LIVE').length,
    [plots],
  );

  const now = hudNowMs();

  return (
    <div data-testid="hud-auctions" className="absolute left-3 top-16 z-20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="min-h-11 rounded-full border border-[#12303a] bg-[#050508]/85 px-3 py-1.5 font-mono text-xs tracking-wide text-[#9fd8e6] shadow-[0_0_18px_rgba(0,240,255,0.08)] backdrop-blur-sm hover:border-[#00f0ff]/50 hover:text-[#00f0ff] focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
      >
        🔨 Auctions ({liveCount}) ▾
      </button>
      {open ? (
        <div className="absolute left-0 top-full mt-1 max-h-[min(60dvh,24rem)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-[#12303a] bg-[#050508]/95 p-2 backdrop-blur-sm">
          <div role="group" aria-label="Filter auctions by tier" className="mb-2 flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`min-h-11 flex-1 rounded border px-1 py-1 font-mono text-[11px] uppercase tracking-wider focus-visible:outline-2 focus-visible:outline-[#00f0ff] ${
                  filter === f
                    ? 'border-[#00f0ff]/60 bg-[#00f0ff]/15 text-[#00f0ff]'
                    : 'border-[#12303a] text-[#6b7a8c] hover:text-[#9fd8e6]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Sort auctions" className="mb-1 flex gap-1">
            {(['ends', 'price'] as Sort[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                aria-pressed={sort === s}
                className={`min-h-11 flex-1 rounded border px-1 py-1 font-mono text-[11px] uppercase tracking-wider focus-visible:outline-2 focus-visible:outline-[#00f0ff] ${
                  sort === s
                    ? 'border-[#00f0ff]/60 bg-[#00f0ff]/15 text-[#00f0ff]'
                    : 'border-[#12303a] text-[#6b7a8c] hover:text-[#9fd8e6]'
                }`}
              >
                {s === 'ends' ? 'Closing soon' : 'Cheapest'}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setContestedOnly((v) => !v)}
              aria-pressed={contestedOnly}
              title="Only plots where you were outbid"
              className={`min-h-11 flex-1 rounded border px-1 py-1 font-mono text-[11px] uppercase tracking-wider focus-visible:outline-2 focus-visible:outline-[#ffb400] ${
                contestedOnly
                  ? 'border-[#ffb400]/60 bg-[#ffb400]/15 text-[#ffb400]'
                  : 'border-[#12303a] text-[#6b7a8c] hover:text-[#9fd8e6]'
              }`}
            >
              ⚠ Contested
            </button>
          </div>
          {live.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-[#6b7a8c]" role="status">
              No live auctions{filter === 'ALL' ? '' : ` in ${filter}`} — claim an idle plot to open
              one.
            </p>
          ) : (
            <ul className="space-y-1">
              {live.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlotId(p.id);
                      flyToPlot(p.id);
                    }}
                    aria-label={`Sector ${sectorLabel(p)}, ${p.tier}, ${formatPrice(p.currentPriceCents ?? 0)}, closes in ${p.endAt ? formatHudCountdown(p.endAt, now) : 'unknown'}`}
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left font-mono text-xs text-[#9fd8e6] hover:bg-[#0b0e14] active:bg-[#12303a] hover:text-[#00f0ff] focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
                  >
                    <span>
                      <span className="text-[#00f0ff]">{sectorLabel(p)}</span>{' '}
                      <span className="text-[#6b7a8c]">{p.tier}</span>{' '}
                      <span>{formatPrice(p.currentPriceCents ?? 0)}</span>
                    </span>
                    <span className="shrink-0 text-[#ffb400]">
                      {p.endAt ? formatHudCountdown(p.endAt, now) : '—'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
