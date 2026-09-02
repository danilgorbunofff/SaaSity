/**
 * Client-side city store (phase 1.3). Holds the 49-plot map keyed by id,
 * plus the caller's own PreBid ids for the ownership/tenancy checks.
 *
 * Ownership and tenancy are DERIVED, never trusted from the public API —
 * see ./ownership for the two (deliberately distinct) truth tables.
 */

import { create } from 'zustand';
import { deriveOutbidPlotIds, mergeOutbidPlotIds, isOwnedLeading, isTenant } from './ownership';
import type { PlotDto } from '@/types/api';

export interface CityState {
  plots: Map<string, PlotDto>;
  myPreBidIds: Set<string>;
  /** Plots where we WERE leading and a rival took the lead this cycle. */
  outbidPlotIds: Set<string>;
  /** Single source of truth for the inspected plot (1.4). null = none. */
  selectedPlotId: string | null;
  /** Currently hovered plot (1.4) — hover highlight + pointer cursor. */
  hoveredPlotId: string | null;
  /** True while the My Leases empty-state CTA highlights IDLE plots (auto-expires). */
  highlightIdle: boolean;
  /** ?debug=1 QA toggle: render ownedLeading skin layer on every plot. */
  debugForceOwned: boolean;
  /** Phase 2.5 — dev fast-forward available on this deployment (server truth). */
  mockResolveEnabled: boolean;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;

  setPlots: (plots: PlotDto[]) => void;
  /** Phase 2.4 — patch one plot in place from a realtime event. */
  patchPlot: (plotId: string, patch: Partial<PlotDto>) => void;
  setMyPreBids: (ids: string[]) => void;
  setSelectedPlotId: (plotId: string | null) => void;
  setHoveredPlotId: (plotId: string | null) => void;
  pulseIdlePlots: () => void;
  setDebugForceOwned: (v: boolean) => void;
  setMockResolveEnabled: (v: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  markFetched: () => void;
}

export const useCityStore = create<CityState>()((set) => ({
  plots: new Map<string, PlotDto>(),
  myPreBidIds: new Set<string>(),
  outbidPlotIds: new Set<string>(),
  selectedPlotId: null,
  hoveredPlotId: null,
  highlightIdle: false,
  debugForceOwned: false,
  mockResolveEnabled: false,
  loading: false,
  error: null,
  lastFetchedAt: null,

  setPlots: (plots) =>
    set((state) => {
      const next = new Map(plots.map((p) => [p.id, p]));
      // Outbid detection: we led the previous snapshot of a LIVE cycle but
      // the leader id changed while the cycle is still open. Cycle END
      // (LIVE -> IDLE) is a normal lease expiry, not an outbid. Flips MERGE
      // into the existing set (sticky) — a rival's lead persists on every
      // refetch until we re-take the lead or the cycle ends.
      const flips = deriveOutbidPlotIds(state.plots, next, state.myPreBidIds);
      const outbid = mergeOutbidPlotIds(state.outbidPlotIds, flips, next, state.myPreBidIds);
      // Fade selection when the plot vanishes from the city (keeps HUD honest).
      if (state.selectedPlotId && !next.has(state.selectedPlotId)) {
        return { plots: next, outbidPlotIds: outbid, selectedPlotId: null };
      }
      return { plots: next, outbidPlotIds: outbid };
    }),
  // Realtime patch runs the SAME outbid-derivation + selection-fade
  // pipeline as setPlots — a rival lead arriving over SSE must raise the
  // outbid state exactly like a full refetch does.
  patchPlot: (plotId, patch) =>
    set((state) => {
      const current = state.plots.get(plotId);
      if (!current) return state;
      const patched: PlotDto = { ...current, ...patch };
      const next = new Map(state.plots);
      next.set(plotId, patched);
      const flips = deriveOutbidPlotIds(state.plots, next, state.myPreBidIds);
      const outbid = mergeOutbidPlotIds(state.outbidPlotIds, flips, next, state.myPreBidIds);
      return { plots: next, outbidPlotIds: outbid };
    }),
  setMyPreBids: (ids) => set({ myPreBidIds: new Set(ids) }),
  setSelectedPlotId: (plotId) => set({ selectedPlotId: plotId }),
  setHoveredPlotId: (plotId) => set({ hoveredPlotId: plotId }),
  pulseIdlePlots: () => {
    set({ highlightIdle: true });
    setTimeout(() => set({ highlightIdle: false }), 8000);
  },
  setDebugForceOwned: (v) => set({ debugForceOwned: v }),
  setMockResolveEnabled: (v) => set({ mockResolveEnabled: v }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  markFetched: () => set({ lastFetchedAt: Date.now() }),
}));

/**
 * Re-exported so component imports can pull ownership/tenancy helpers from
 * the same module as the store hook — ./ownership is the single source of
 * truth (also unit-tested directly there).
 */
export { isOwnedLeading, isTenant };