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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevRef = useRef<Set<string>>(new Set());

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
  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.createdAt < TOAST_MS));
    }, 1000);
    return () => clearInterval(interval);
  }, [toasts.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setToasts((prev) => prev.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div aria-live="polite" className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 flex-col-reverse gap-2">
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
            role="alert"
            className="flex items-center gap-3 rounded-lg border border-[#ffb400]/60 bg-[#050508]/95 px-4 py-2.5 font-mono text-[12px] text-[#ffb400] shadow-[0_0_24px_rgba(255,180,0,0.25)] backdrop-blur-sm"
          >
            <span>
              Sector {sectorLabel(plot)} contested{step > 0 ? ` — +${formatPrice(step)} to retain` : ''}
            </span>
            <button
              type="button"
              onClick={() => {
                dismiss(toast.id);
                flyToPlot(plot.id);
                // 2.1: the toast's click now opens the real bid form.
                useBidFormStore.getState().openBidForm(plot.id, 'bid');
              }}
              className="rounded border border-[#ffb400]/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#ffb400] hover:bg-[#ffb400]/10"
            >
              Jump & Outbid
            </button>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="text-[14px] leading-none text-[#6b7a8c] hover:text-[#e8f6ff]"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}