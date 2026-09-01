/**
 * Pure ownership/outbid derivation (phase 1.3). Kept free of React and
 * zustand so node:test can exercise the truth tables directly.
 *
 * Ownership is DERIVED client-side, never trusted from the server as a flag:
 *   ownedLeading(plot) = plot.status === 'LIVE'
 *     && plot.currentLeaderPreBidId exists
 *     && myPreBidIds.has(currentLeaderPreBidId)
 */

import type { PlotDto } from '@/types/api';

/** The ONLY ownership check in the app. */
export function isOwnedLeading(
  plot: PlotDto,
  myPreBidIds: Set<string>,
  currentLeaderPreBidId?: string,
): boolean {
  return (
    plot.status === 'LIVE' && !!currentLeaderPreBidId && myPreBidIds.has(currentLeaderPreBidId)
  );
}

/**
 * Outbid detection between two snapshots: we led the PREVIOUS snapshot of a
 * plot's LIVE cycle, and the leader id changed while the cycle is still
 * open. LIVE -> IDLE is a normal lease expiry, not an outbid.
 */
export function deriveOutbidPlotIds(
  prevPlots: Map<string, PlotDto>,
  nextPlots: Map<string, PlotDto>,
  myPreBidIds: Set<string>,
): Set<string> {
  const outbid = new Set<string>();
  for (const [id, next] of nextPlots) {
    const prev = prevPlots.get(id);
    if (
      prev?.status === 'LIVE' &&
      prev.currentLeaderPreBidId &&
      myPreBidIds.has(prev.currentLeaderPreBidId) &&
      next.status === 'LIVE' &&
      next.currentLeaderPreBidId !== prev.currentLeaderPreBidId
    ) {
      outbid.add(id);
    }
  }
  return outbid;
}

/** Closing-soon threshold: any time left under 3 minutes (soft-close window). */
export const CLOSING_SOON_MS = 3 * 60 * 1000;

export function isClosingSoon(endAt: string | undefined, now: number): boolean {
  if (!endAt) return false;
  const ms = new Date(endAt).getTime() - now;
  return ms > 0 && ms < CLOSING_SOON_MS;
}
