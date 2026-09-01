'use client';

/**
 * Phase 1.4 outbid toast: when a plot we led flips to rival-led, show a
 * single FIFO toast with a jump action. Auto-dismisses after ~8s, aria-live
 * polite, dismissible via Escape or close button.
 */

import { useEffect, useRef, useState } from 'react';
import { useCityStore } from '@/lib/city/store';
import { sectorLabel } from '@/lib/city/hud-hooks';
import { flyToPlot } from '@/lib/city/camera-rig';
import { formatPrice } from '@/lib/tiers';

const TOAST_MS = 8000;

export function OutbidToast() {
  const outbidPlotIds = useCityStore((s) => s.outbidPlotIds);
  const plots = useCityStore((s) => s.plots);
  const [toastId, setToastId] = useState<string | null>(null);
  const prevRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Detect NEW outbid flips only (sticky set may already contain old ones).
    let newest: string | null = null;
    outbidPlotIds.forEach((id) => {
      if (!prevRef.current.has(id)) newest = id;
    });
    prevRef.current = new Set(outbidPlotIds);
    if (newest) setToastId(newest);
  }, [outbidPlotIds]);

  useEffect(() => {
    if (!toastId) return;
    const timer = setTimeout(() => setToastId(null), TOAST_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setToastId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [toastId]);

  const plot = toastId ? plots.get(toastId) ?? null : null;
  const step = plot ? (plot.status === 'LIVE' ? plot.currentPriceCents ?? 0 : 0) : 0;
  if (!toastId || !plot) return null;

  return (
    <div aria-live="polite">
      <div
        data-testid="hud-outbid-toast"
        role="alert"
        className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[#ffb400]/60 bg-[#050508]/95 px-4 py-2.5 font-mono text-[12px] text-[#ffb400] shadow-[0_0_24px_rgba(255,180,0,0.25)] backdrop-blur-sm"
      >
        <span>
          Sector {sectorLabel(plot)} contested{step > 0 ? ` — +${formatPrice(step)} to retain` : ''}
        </span>
        <button
          type="button"
          onClick={() => {
            setToastId(null);
            flyToPlot(plot.id);
          }}
          className="rounded border border-[#ffb400]/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#ffb400] hover:bg-[#ffb400]/10"
        >
          Jump & Outbid
        </button>
        <button
          type="button"
          onClick={() => setToastId(null)}
          aria-label="Dismiss notification"
          className="text-[14px] leading-none text-[#6b7a8c] hover:text-[#e8f6ff]"
        >
          ×
        </button>
      </div>
    </div>
  );
}