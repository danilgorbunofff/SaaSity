'use client';

/**
 * Phase 1.4 outbid toast: when a plot we led flips to rival-led, enqueue a
 * FIFO toast (max 3 visible) with a jump action. Each toast auto-dismisses
 * after ~8s; Escape dismisses the oldest. aria-live polite, dismissible via
 * close button.
 */

import { useEffect, useRef, useState } from 'react';
import { useCityStore } from '@/lib/city/store';
import { sectorLabel } from '@/lib/city/hud-hooks';
import { flyToPlot } from '@/lib/city/camera-rig';
import { useBidFormStore } from '@/lib/bid/bid-form-store';
import { loadBrand } from '@/lib/bid/brand-memory';
import { formatPrice } from '@/lib/tiers';
import { tierIncrementCents } from '@/components/city/PlotSkins';

const TOAST_MS = 8000;
const MAX_TOASTS = 3;

interface Toast {
  id: string;
  createdAt: number;
}

export function OutbidToast() {
  const outbidPlotIds = useCityStore((s) => s.outbidPlotIds);
  const plots = useCityStore((s) => s.plots);
  const setSelectedPlotId = useCityStore((s) => s.setSelectedPlotId);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevRef = useRef<Set<string>>(new Set());
  /** Dismissal pauses while the pointer/focus is inside (readable toasts). */
  const pausedRef = useRef(false);

  useEffect(() => {
    // Detect NEW outbid flips only (sticky set may already contain old ones).
    const fresh: Toast[] = [];
    outbidPlotIds.forEach((id) => {
      if (!prevRef.current.has(id)) fresh.push({ id, createdAt: Date.now() });
    });
    prevRef.current = new Set(outbidPlotIds);
    if (fresh.length > 0) {
      setToasts((prev) => [...prev, ...fresh].slice(-MAX_TOASTS));
    }
  }, [outbidPlotIds]);

  // Per-toast auto-dismiss: one shared sweep, timers derived from createdAt.
  // Skipped while hovered/focused so a reader never loses the message mid-read.
  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => {
      if (pausedRef.current) return;
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.createdAt < TOAST_MS));
    }, 1000);
    return () => clearInterval(interval);
  }, [toasts.length]);

  useEffect(() => {
    // FIFO: Escape dismisses the OLDEST visible toast first — unless a
    // modal owns Escape (BidModal form / discard-confirm), which has its
    // own deterministic Escape handling that must win.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"], [role="alertdialog"]')) return;
      setToasts((prev) => prev.slice(1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const setPaused = (paused: boolean) => {
    // The sweep reads the ref live — no re-render needed.
    pausedRef.current = paused;
  };

  // Durable outbid: toasts expire, but the contested state is sticky in the
  // store — keep one compact revisitable chip so the state survives refresh
  // and the toast's disappearance (detail card + minimap carry the rest).
  if (toasts.length === 0) {
    if (outbidPlotIds.size === 0) return null;
    const firstId = Array.from(outbidPlotIds)[0];
    const first = plots.get(firstId);
    if (!first) return null;
    return (
      <div className="absolute bottom-3 left-1/2 z-30 max-w-[calc(100vw-2rem)] -translate-x-1/2">
        <button
          type="button"
          onClick={() => {
            setSelectedPlotId(firstId);
            flyToPlot(firstId);
          }}
          title="Review contested plots"
          className="flex min-h-11 items-center gap-2 rounded-full border border-[#ffb400]/50 bg-[#050508]/95 px-4 py-2 font-mono text-xs text-[#ffb400] shadow-[0_0_24px_rgba(255,180,0,0.2)] backdrop-blur-sm hover:bg-[#ffb400]/10 focus-visible:outline-2 focus-visible:outline-[#ffb400]"
        >
          <span aria-hidden>⚠</span>
          {outbidPlotIds.size} contested — review Sector {sectorLabel(first)}
          {outbidPlotIds.size > 1 ? ` +${outbidPlotIds.size - 1}` : ''}
        </button>
      </div>
    );
  }

  return (
    // Single polite live region: new toast nodes are announced on insert.
    // Items carry NO nested role="alert" (conflicting assertive-in-polite).
    <div
      aria-live="polite"
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="absolute bottom-3 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col-reverse items-center gap-2"
    >
      {toasts.map((toast) => {
        const plot = plots.get(toast.id);
        if (!plot) return null;
        // Match the RoofBadge / detail card: the retention cost is one tier
        // increment, not the plot's full current price.
        const step = tierIncrementCents(plot.tier);
        return (
          <div
            key={toast.id}
            data-testid="hud-outbid-toast"
            className="flex max-w-full items-center gap-3 rounded-lg border border-[#ffb400]/60 bg-[#050508]/95 px-4 py-2.5 font-mono text-xs text-[#ffb400] shadow-[0_0_24px_rgba(255,180,0,0.25)] backdrop-blur-sm"
          >
            <span>
              Sector {sectorLabel(plot)} contested
              {step > 0 ? ` — +${formatPrice(step)} to retain` : ''}
            </span>
            <button
              type="button"
              onClick={() => {
                dismiss(toast.id);
                flyToPlot(plot.id);
                // 2.1: the toast's click now opens the real bid form.
                // Part 6: prefilled with the caller's own saved brand.
                useBidFormStore
                  .getState()
                  .openBidForm(plot.id, 'bid', { prefill: loadBrand(plot.id) });
              }}
              className="min-h-11 shrink-0 rounded border border-[#ffb400]/70 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-[#ffb400] hover:bg-[#ffb400]/10 active:bg-[#ffb400]/20 focus-visible:outline-2 focus-visible:outline-[#ffb400]"
            >
              Jump & Outbid
            </button>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label={`Dismiss contested notification for Sector ${sectorLabel(plot)}`}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-sm leading-none text-[#9fd8e6] hover:text-[#e8f6ff] focus-visible:outline-2 focus-visible:outline-[#ffb400]"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
