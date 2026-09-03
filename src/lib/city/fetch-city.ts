/**
 * City data fetcher (phase 1.3) — single place that knows the endpoints.
 * StaleTime strategy: plots 5s (matches the API's s-maxage=5), me/bids 60s
 * (ownership set changes rarely); both refetch on window focus.
 */

import type { PlotDto, PlotsResponseDto } from '@/types/api';
import type { OwnerPosition } from './ownership';

export interface CitySnapshot {
  plots: PlotDto[];
  myPreBidIds: string[];
  /** Part 4 `outbid-reconstruction`: the private owner projection. */
  myPositions: OwnerPosition[];
  /** Phase 2.5 — server truth: is the dev fast-forward path live here? */
  mockResolveEnabled: boolean;
}

interface MeBidsResponse {
  preBidIds: string[];
  /** Present on current servers; absent on older ones — default to []. */
  positions?: OwnerPosition[];
}

export async function fetchCitySnapshot(): Promise<CitySnapshot> {
  const [data, me] = await Promise.all([
    fetch('/api/plots', { cache: 'no-store' }).then(async (res) => {
      if (!res.ok) throw new Error(`plots fetch failed: ${res.status}`);
      return res.json() as Promise<PlotsResponseDto>;
    }),
    // me/bids failing is non-fatal in every way (anonymous visitor, HTTP
    // error, or network rejection) — degrade gracefully to an empty set.
    fetch('/api/me/bids', { cache: 'no-store' })
      .then(async (res) =>
        res.ok ? ((await res.json()) as MeBidsResponse) : { preBidIds: [], positions: [] },
      )
      .catch(() => ({ preBidIds: [], positions: [] }) as MeBidsResponse),
  ]);

  const positions = Array.isArray(me.positions) ? me.positions : [];
  // Back-compat: derive ids from the projection when the server sent it
  // (identical filter), otherwise fall back to the legacy id list.
  const myPreBidIds =
    positions.length > 0 ? positions.map((p) => p.preBidId) : (me.preBidIds ?? []);
  return {
    plots: data.plots,
    myPreBidIds,
    myPositions: positions,
    mockResolveEnabled: data.mockResolveEnabled === true,
  };
}

/** Owner projection only — the lightweight refresh after claim/bid/resolution. */
export async function fetchMyPositions(): Promise<{
  preBidIds: string[];
  positions: OwnerPosition[];
}> {
  try {
    const res = await fetch('/api/me/bids', { cache: 'no-store' });
    if (!res.ok) return { preBidIds: [], positions: [] };
    const me = (await res.json()) as MeBidsResponse;
    const positions = Array.isArray(me.positions) ? me.positions : [];
    const preBidIds =
      positions.length > 0 ? positions.map((p) => p.preBidId) : (me.preBidIds ?? []);
    return { preBidIds, positions };
  } catch {
    return { preBidIds: [], positions: [] };
  }
}
