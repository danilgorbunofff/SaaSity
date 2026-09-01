'use client';

/**
 * Phase 1.4 detail card: screen-space panel for the selected plot.
 * Live per-second countdown uses its own 1 Hz hud tick, mounted only while
 * a plot is selected. Bidding actions are disabled until phase 2 (M2).
 */

import { useCityStore } from '@/lib/city/store';
import { useHudTick, hudNowMs, formatHudCountdown, sectorLabel } from '@/lib/city/hud-hooks';
import { formatPrice, TIERS } from '@/lib/tiers';
import { tierIncrementCents } from '@/components/city/PlotSkins';
import type { PlotDto } from '@/types/api';

function CardHeader({ plot }: { plot: PlotDto }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-mono text-[11px] tracking-[0.2em] text-[#6b7a8c]">
        SECTOR {sectorLabel(plot)}
      </span>
      <span className="font-mono text-[10px] uppercase text-[#00f0ff]">{plot.tier}</span>
    </div>
  );
}

function LiveMeta({ plot }: { plot: PlotDto }) {
  const tick = useHudTick();
  const now = hudNowMs();
  const countdown = plot.endAt ? formatHudCountdown(plot.endAt, now) : '00:00';
  const leader = plot.leader;
  void tick;
  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-2xl font-bold text-[#00f0ff]">
          {formatPrice(plot.currentPriceCents ?? 0)}
        </span>
        <span className="font-mono text-[12px] text-[#9fd8e6]">{countdown} left</span>
      </div>
      <div className="mt-1 text-[12px] text-[#6b7a8c]">
        next bid +{formatPrice(tierIncrementCents(plot.tier))}
      </div>
      <div className="mt-3 space-y-1 border-t border-[#12303a] pt-3">
        {leader?.companyName ? (
          <div className="text-[14px] font-semibold text-[#e8f6ff]">{leader.companyName}</div>
        ) : (
          <div className="text-[13px] italic text-[#3a4a56]">Anonymous leader</div>
        )}
        {leader?.tagline ? <div className="text-[12px] text-[#9fd8e6]">{leader.tagline}</div> : null}
        <div className="flex items-center gap-3 font-mono text-[11px] text-[#6b7a8c]">
          {leader?.twitterHandle ? <span>{leader.twitterHandle}</span> : null}
          {leader?.mrrText ? <span className="text-[#ffb400]">{leader.mrrText} MRR</span> : null}
        </div>
        {leader?.leaderTargetUrl ? (
          <a
            href={leader.leaderTargetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-[12px] text-[#00f0ff] underline decoration-[#00f0ff]/40 hover:decoration-[#00f0ff]"
          >
            Visit site →
          </a>
        ) : null}
      </div>
    </>
  );
}

export function DetailCard() {
  const selectedPlotId = useCityStore((s) => s.selectedPlotId);
  const plot = useCityStore((s) => (s.selectedPlotId ? s.plots.get(s.selectedPlotId) ?? null : null));
  const myPreBidIds = useCityStore((s) => s.myPreBidIds);
  const setSelectedPlotId = useCityStore((s) => s.setSelectedPlotId);

  if (!selectedPlotId || !plot) return null;
  const owned = plot.status === 'LIVE' && !!plot.currentLeaderPreBidId && myPreBidIds.has(plot.currentLeaderPreBidId);

  return (
    <aside
      data-testid="hud-detail-card"
      aria-label={`Sector plot ${plot.id} details`}
      className="absolute right-3 top-14 z-20 w-64 rounded-lg border border-[#12303a] bg-[#050508]/90 p-4 shadow-[0_0_24px_rgba(0,240,255,0.15)] backdrop-blur-sm"
    >
      <CardHeader plot={plot} />
      {plot.status === 'LIVE' ? (
        <div className="mt-2">
          <LiveMeta plot={plot} />
          {owned ? (
            <button
              type="button"
              disabled
              title="You currently hold the lead on this lease"
              className="mt-4 w-full cursor-not-allowed rounded border border-[#00f0ff]/40 bg-[#00f0ff]/10 px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-[#00f0ff]/70"
            >
              ★ Your HQ — leading
            </button>
          ) : (
            <button
              type="button"
              disabled
              title="Bidding opens soon"
              className="mt-4 w-full cursor-not-allowed rounded border border-[#2a3a46] bg-[#0b0e14] px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-[#6b7a8c]"
            >
              Place a bid
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <div className="font-mono text-2xl font-bold text-[#e8f6ff]">
            {formatPrice(TIERS[plot.tier].floorCents)}
          </div>
          <div className="mt-1 text-[12px] text-[#6b7a8c]">floor price — idle slot</div>
          <button
            type="button"
            disabled
            title="Bidding opens soon"
            className="mt-4 w-full cursor-not-allowed rounded border border-[#2a3a46] bg-[#0b0e14] px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-[#6b7a8c]"
          >
            Claim this plot
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setSelectedPlotId(null)}
        className="absolute right-2 top-2 rounded px-1.5 text-[14px] leading-none text-[#6b7a8c] hover:text-[#e8f6ff]"
        aria-label="Close details"
      >
        ×
      </button>
    </aside>
  );
}