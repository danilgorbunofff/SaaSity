/**
 * Pure ownership/outbid derivation (phase 1.3). Kept free of React and
 * zustand so node:test can exercise the truth tables directly.
 *
 * Ownership is DERIVED client-side, never trusted from the server as a flag:
 *   ownedLeading(plot) = plot.status === 'LIVE'
 *     && plot.currentLeaderPreBidId exists
 *     && myPreBidIds.has(currentLeaderPreBidId)
 *
 * Tenancy (Part 1 lifecycle fix) is a SEPARATE derivation:
 *   isTenant(plot) = plot.tenantPreBidId exists && myPreBidIds.has(tenantPreBidId)
 * Deliberately INDEPENDENT of plot.status — a lease persists through IDLE
 * and LIVE alike, unlike ownedLeading which only ever describes an open
 * auction's provisional leader.
 */

import type { PlotDto } from '@/types/api';

/**
 * Privacy-safe owner projection row (Part 4 `outbid-reconstruction`): the
 * caller's OWN pre-bid, scoped to plot + cycle + status. Never a maxBid,
 * never another bidder's row — the server filters by the caller's cookie.
 */
export interface OwnerPosition {
  preBidId: string;
  plotId: string;
  cycleId: string | null;
  status: string;
}

/** The ONLY leading-bid check in the app. */
export function isOwnedLeading(
  plot: PlotDto,
  myPreBidIds: Set<string>,
  currentLeaderPreBidId?: string,
): boolean {
  return (
    plot.status === 'LIVE' && !!currentLeaderPreBidId && myPreBidIds.has(currentLeaderPreBidId)
  );
}

/** The ONLY tenancy check in the app — distinct from isOwnedLeading. */
export function isTenant(plot: PlotDto, myPreBidIds: Set<string>): boolean {
  return !!plot.tenantPreBidId && myPreBidIds.has(plot.tenantPreBidId);
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

/**
 * Sticky outbid merge: flips accumulate across snapshots so the amber badge
 * persists on every refetch (a rival's lead is still a rival's lead). A plot
 * leaves the set only when we re-take the lead, the cycle ends (LIVE -> IDLE
 * = expiry, not contention), the plot vanishes from the snapshot, our
 * position on that cycle is gone (row LOST/WON/EXPIRED — a resolved contest
 * is history, not an active outbid), or the cycle ROTATED under us (a new
 * cycleId is a fresh contest; stale outbid from the old cycle must not
 * persist — Part 4 `outbid-reconstruction`). The last two rules need the
 * private owner projection; without it (`positions` omitted, e.g. anonymous
 * visitors) the merge behaves exactly as before.
 */
export function mergeOutbidPlotIds(
  prevOutbid: Set<string>,
  flips: Set<string>,
  nextPlots: Map<string, PlotDto>,
  myPreBidIds: Set<string>,
  positions?: OwnerPosition[],
): Set<string> {
  const merged = new Set(prevOutbid);
  flips.forEach((id) => merged.add(id));
  const activePlots = new Map<string, OwnerPosition[]>();
  if (positions) {
    for (const pos of positions) {
      if (pos.status !== 'ACTIVE') continue;
      const list = activePlots.get(pos.plotId) ?? [];
      list.push(pos);
      activePlots.set(pos.plotId, list);
    }
  }
  for (const id of merged) {
    const p = nextPlots.get(id);
    if (
      !p ||
      p.status !== 'LIVE' ||
      (!!p.currentLeaderPreBidId && myPreBidIds.has(p.currentLeaderPreBidId))
    ) {
      merged.delete(id);
      continue;
    }
    if (positions) {
      const mine = activePlots.get(id) ?? [];
      // No ACTIVE row on this plot anymore (LOST/WON/EXPIRED mid-cycle, or
      // never bid): not a contender, not outbid.
      // A cycle rotation (plot.cycleId no longer matches any of my ACTIVE
      // rows here) ends the old contest: clear; the snapshot derivation
      // re-adds it if I am STILL losing the fresh cycle after refresh.
      const stillContested = mine.some(
        (pos) => pos.cycleId == null || p.cycleId == null || pos.cycleId === p.cycleId,
      );
      if (!stillContested) merged.delete(id);
    }
  }
  return merged;
}

/**
 * Snapshot-derived outbid (Part 4 `outbid-reconstruction`): my ACTIVE
 * position sits on this plot's CURRENT cycle, but a different pre-bid leads
 * it. Derived from current server snapshots — so a refresh WHILE outbid (or
 * an immediate next-cycle rotation where my queued row attached but loses)
 * reconstructs the state without ever having observed the lead flip live.
 */
export function deriveOutbidFromPositions(
  plots: Map<string, PlotDto>,
  positions: OwnerPosition[],
): Set<string> {
  const outbid = new Set<string>();
  for (const pos of positions) {
    if (pos.status !== 'ACTIVE' || !pos.cycleId) continue;
    const plot = plots.get(pos.plotId);
    if (
      plot?.status === 'LIVE' &&
      plot.cycleId === pos.cycleId &&
      plot.currentLeaderPreBidId &&
      plot.currentLeaderPreBidId !== pos.preBidId
    ) {
      outbid.add(pos.plotId);
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
