'use client';

/**
 * Phase 1.4 detail card: screen-space panel for the selected plot.
 * Live per-second countdown uses its own 1 Hz hud tick, mounted only while
 * a plot is selected.
 *
 * Part 1 lifecycle fix: tenant display (who's on the billboard) and auction
 * progress (current bid/countdown for the NEXT lease) are two independent
 * sections — a plot can show a tenant while IDLE (no auction open) or while
 * LIVE (someone bidding to replace them next).
 *
 * Phase 2.5: when the deployment runs the mock money path the card exposes a
 * dev-only fast-forward that forces `endAt` to now and runs the real worker
 * resolution — the same button the modal's success view offers.
 */

import { useState } from 'react';
import { useCityStore, isOwnedLeading } from '@/lib/city/store';
import { useBidFormStore } from '@/lib/bid/bid-form-store';
import { loadBrand } from '@/lib/bid/brand-memory';
import { useHudTick, hudNowMs, formatHudCountdown, sectorLabel } from '@/lib/city/hud-hooks';
import { flyToPlot } from '@/lib/city/camera-rig';
import { formatPrice, TIERS, formatMrrBadge } from '@/lib/tiers';
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

function TenantMeta({ plot }: { plot: PlotDto }) {
  const tenant = plot.tenant;
  return (
    <div className="space-y-1">
      {tenant?.companyName ? (
        <div dir="auto" className="break-words text-sm font-semibold text-[#e8f6ff]">
          {tenant.companyName}
        </div>
      ) : (
        <div className="text-[13px] italic text-[#3a4a56]">No tenant yet</div>
      )}
      {tenant?.tagline ? (
        <div dir="auto" className="break-words text-xs text-[#9fd8e6]">
          {tenant.tagline}
        </div>
      ) : null}
      <div className="flex items-center gap-3 font-mono text-[11px] text-[#6b7a8c]">
        {tenant?.twitterHandle ? <span>{tenant.twitterHandle}</span> : null}
        {formatMrrBadge(tenant?.mrrText) ? (
          <span className="text-[#ffb400]">{formatMrrBadge(tenant?.mrrText)}</span>
        ) : null}
      </div>
      {tenant?.targetUrl ? (
        <a
          href={tenant.targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[12px] text-[#00f0ff] underline decoration-[#00f0ff]/40 hover:decoration-[#00f0ff]"
        >
          Visit site →
        </a>
      ) : null}
    </div>
  );
}

function AuctionMeta({ plot }: { plot: PlotDto }) {
  const tick = useHudTick();
  const now = hudNowMs();
  const countdown = plot.endAt ? formatHudCountdown(plot.endAt, now) : '00:00';
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
    </>
  );
}

/** Phase 2.5 — dev-only: force this cycle to end now and resolve it for real. */
function DevFastForward({ cycleId }: { cycleId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/mock-resolve/${encodeURIComponent(cycleId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'resolve' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      window.dispatchEvent(new Event('city-refetch'));
    } catch {
      setError('Network error — resolution did not run.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 border-t border-[#12303a] pt-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        title="Dev only (MOCK_PAYMENTS=1) — forces endAt to now and runs the real worker resolution"
        className="w-full rounded border border-[#ffb400]/60 bg-[#ffb400]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#ffb400] hover:bg-[#ffb400]/20 disabled:opacity-50"
      >
        {busy ? 'Resolving…' : '⏩ Fast-forward resolution'}
      </button>
      {error ? <div className="mt-1 text-[11px] text-[#ff5c8a]">{error}</div> : null}
    </div>
  );
}

export function DetailCard() {
  const selectedPlotId = useCityStore((s) => s.selectedPlotId);
  const plot = useCityStore((s) =>
    s.selectedPlotId ? (s.plots.get(s.selectedPlotId) ?? null) : null,
  );
  const myPreBidIds = useCityStore((s) => s.myPreBidIds);
  const outbidPlotIds = useCityStore((s) => s.outbidPlotIds);
  const setSelectedPlotId = useCityStore((s) => s.setSelectedPlotId);
  const mockResolveEnabled = useCityStore((s) => s.mockResolveEnabled);
  const openBidForm = useBidFormStore((s) => s.openBidForm);

  if (!selectedPlotId || !plot) return null;
  const owned = isOwnedLeading(plot, myPreBidIds, plot.currentLeaderPreBidId);
  const outbid = outbidPlotIds.has(plot.id) && plot.status === 'LIVE' && !owned;

  return (
    <aside
      data-testid="hud-detail-card"
      aria-label={`Sector plot ${plot.id} details`}
      className="absolute right-3 top-14 z-20 max-h-[calc(100dvh-7rem)] w-64 overflow-y-auto rounded-lg border border-[#12303a] bg-[#050508]/90 p-4 shadow-[0_0_24px_rgba(0,240,255,0.15)] backdrop-blur-sm max-sm:bottom-[max(5.5rem,env(safe-area-inset-bottom))] max-sm:left-3 max-sm:top-auto max-sm:max-h-[46dvh] max-sm:w-auto"
    >
      <CardHeader plot={plot} />
      {plot.tenant ? (
        <div className="mt-2 space-y-1 border-b border-[#12303a] pb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#6b7a8c]">
            Current tenant
          </span>
          <TenantMeta plot={plot} />
        </div>
      ) : null}
      {plot.status === 'LIVE' ? (
        <div className="mt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#6b7a8c]">
            {plot.tenant ? 'Bidding for next lease' : 'Open auction'}
          </span>
          <div className="mt-1">
            <AuctionMeta plot={plot} />
          </div>
          {mockResolveEnabled && plot.cycleId ? <DevFastForward cycleId={plot.cycleId} /> : null}
          {owned ? (
            <button
              type="button"
              disabled
              title="You currently hold the top bid for the next lease"
              className="mt-4 min-h-11 w-full cursor-not-allowed rounded border border-[#00f0ff]/40 bg-[#00f0ff]/10 px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-[#00f0ff]/70"
            >
              ★ Leading — next lease
            </button>
          ) : outbid ? (
            <div className="mt-4">
              <div className="rounded border border-[#ffb400]/60 bg-[#ffb400]/10 px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-wider text-[#ffb400] animate-[city-outbid-flash_0.8s_ease-in-out_infinite]">
                ⚠️ Outbid: +{formatPrice(tierIncrementCents(plot.tier))} to retain
              </div>
              <button
                type="button"
                onClick={() => {
                  flyToPlot(plot.id);
                  openBidForm(plot.id, 'bid', { prefill: loadBrand(plot.id) });
                }}
                title="Fly to the plot and re-take the lead"
                className="mt-2 min-h-11 w-full rounded border border-[#ffb400]/70 bg-[#ffb400]/10 px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-[#ffb400] hover:bg-[#ffb400]/20 active:bg-[#ffb400]/30"
              >
                Jump &amp; outbid
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => openBidForm(plot.id, 'bid', { prefill: loadBrand(plot.id) })}
                className="w-full rounded border border-[#00f0ff]/60 bg-[#00f0ff]/15 px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-[#00f0ff] hover:bg-[#00f0ff]/25"
              >
                Place a bid
              </button>
              <button
                type="button"
                onClick={() => openBidForm(plot.id, 'prebid', { prefill: loadBrand(plot.id) })}
                title="Queue a proxy bid for the NEXT cycle — the system bids for you up to your max"
                className="w-full rounded border border-[#12303a] bg-[#0b0e14] px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-[#9fd8e6] hover:border-[#00f0ff]/40"
              >
                Schedule pre-bid →
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <div className="font-mono text-2xl font-bold text-[#e8f6ff]">
            {formatPrice(TIERS[plot.tier].floorCents)}
          </div>
          <div className="mt-1 text-[12px] text-[#6b7a8c]">
            floor price — {plot.tenant ? 'open bidding for the next lease' : 'idle slot'}
          </div>
          <button
            type="button"
            onClick={() => openBidForm(plot.id, 'claim', { prefill: loadBrand(plot.id) })}
            className="mt-4 min-h-11 w-full rounded border border-[#00f0ff]/60 bg-[#00f0ff]/15 px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-[#00f0ff] hover:bg-[#00f0ff]/25"
          >
            {plot.tenant ? 'Start next auction' : 'Claim this plot'}
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setSelectedPlotId(null)}
        className="absolute right-2 top-2 flex min-h-11 min-w-11 items-center justify-center rounded text-sm leading-none text-[#9fd8e6] hover:text-[#e8f6ff] focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
        aria-label="Close details"
      >
        ×
      </button>
    </aside>
  );
}
