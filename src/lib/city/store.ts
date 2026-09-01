/**
 * Client-side city store (phase 1.3). Holds the 49-plot map keyed by id,
 * plus the caller's own PreBid ids for the ownership check.
 *
 * Ownership is DERIVED, never trusted from the public API:
 *   ownedLeading(plot) = plot.status === 'LIVE' && myPreBidIds.has(plot.currentLeaderPreBidId)
 */

import { create } from 'zustand';
import { deriveOutbidPlotIds } from './ownership';
import type { PlotDto } from '@/types/api';

export interface CityState {
  plots: Map<string, PlotDto>;
  myPreBidIds: Set<string>;
  /** Plots where we WERE leading and a rival took the lead this cycle. */
  outbidPlotIds: Set<string>;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;

  setPlots: (plots: PlotDto[]) => void;
  setMyPreBids: (ids: string[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  markFetched: () => void;
}

export const useCityStore = create<CityState>()((set) => ({
  plots: new Map<string, PlotDto>(),
  myPreBidIds: new Set<string>(),
  outbidPlotIds: new Set<string>(),
  loading: false,
  error: null,
  lastFetchedAt: null,

  setPlots: (plots) =>
    set((state) => {
      const next = new Map(plots.map((p) => [p.id, p]));
      // Outbid detection: we led the previous snapshot of a LIVE cycle but
      // the leader id changed while the cycle is still open. Cycle END
      // (LIVE -> IDLE) is a normal lease expiry, not an outbid.
      const outbid = deriveOutbidPlotIds(state.plots, next, state.myPreBidIds);
      return { plots: next, outbidPlotIds: outbid };
    }),
  setMyPreBids: (ids) => set({ myPreBidIds: new Set(ids) }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  markFetched: () => set({ lastFetchedAt: Date.now() }),
}));

/** Ownership derived from store slices - the ONLY ownership check in the app. */
export function isOwnedLeading(
  plot: PlotDto,
  myPreBidIds: Set<string>,
  currentLeaderPreBidId?: string,
): boolean {
  return plot.status === 'LIVE' && !!currentLeaderPreBidId && myPreBidIds.has(currentLeaderPreBidId);
}