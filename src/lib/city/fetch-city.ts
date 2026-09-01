/**
 * City data fetcher (phase 1.3) — single place that knows the endpoints.
 * StaleTime strategy: plots 5s (matches the API's s-maxage=5), me/bids 60s
 * (ownership set changes rarely); both refetch on window focus.
 */

import type { PlotDto, PlotsResponseDto } from '@/types/api';

export interface CitySnapshot {
  plots: PlotDto[];
  myPreBidIds: string[];
}

export async function fetchCitySnapshot(): Promise<CitySnapshot> {
  const [data, myPreBidIds] = await Promise.all([
    fetch('/api/plots', { cache: 'no-store' }).then(async (res) => {
      if (!res.ok) throw new Error(`plots fetch failed: ${res.status}`);
      return res.json() as Promise<PlotsResponseDto>;
    }),
    // me/bids failing is non-fatal in every way (anonymous visitor, HTTP
    // error, or network rejection) — degrade gracefully to an empty set.
    fetch('/api/me/bids', { cache: 'no-store' })
      .then(async (res) =>
        res.ok ? ((await res.json()) as { preBidIds: string[] }).preBidIds : [],
      )
      .catch(() => [] as string[]),
  ]);

  return { plots: data.plots, myPreBidIds };
}
