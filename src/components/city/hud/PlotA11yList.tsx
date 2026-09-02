'use client';

/**
 * Phase 1.4 a11y: visually-hidden, Tab-reachable list of all 49 plots.
 * Activating an entry selects + flies to the plot - screen-reader and
 * keyboard-only users get the same navigation as minimap / My Leases.
 */

import { useCityStore } from '@/lib/city/store';
import { sectorLabel, formatHudCountdown, hudNowMs } from '@/lib/city/hud-hooks';
import { useTick } from '@/components/city/PlotSkins';
import { flyToPlot } from '@/lib/city/camera-rig';
import { formatPrice } from '@/lib/tiers';

export function PlotA11yList() {
  const plots = useCityStore((s) => s.plots);
  const setSelectedPlotId = useCityStore((s) => s.setSelectedPlotId);
  // Refresh countdown text off the shared 5s grid tick, NOT the 1 Hz hud
  // tick — per-second updates are scoped to the detail card (1.5 invariant).
  const tick = useTick();
  const now = hudNowMs();
  void tick;

  const sorted = Array.from(plots.values()).sort((a, b) => a.id.localeCompare(b.id));

  return (
    <ul className="sr-only" aria-label="All city plots">
      {sorted.map((p) => {
        const label =
          p.status === 'LIVE'
            ? `Sector ${sectorLabel(p)}, live, ${formatPrice(p.currentPriceCents ?? 0)}, ${formatHudCountdown(p.endAt ?? new Date(now).toISOString(), now)} left`
            : `Sector ${sectorLabel(p)}, idle, floor price`;
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => {
                setSelectedPlotId(p.id);
                flyToPlot(p.id);
              }}
            >
              {label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}