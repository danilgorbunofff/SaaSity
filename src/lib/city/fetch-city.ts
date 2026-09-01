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
  const [plotsRes, meRes] = await Promise.all([
    fetch('/api/plots', { cache: 'no-store' }),
    fetch('/api/me/bids', { cache: 'no-store' }),
  ]);

  if (!plotsRes.ok) {
    throw new Error(`plots fetch failed: ${plotsRes.status}`);
  }
  // me/bids failing is non-fatal (anonymous visitor) — degrade gracefully.
  const myPreBidIds = meRes.ok ? ((await meRes.json()) as { preBidIds: string[] }).preBidIds : [];

  const data = (await plotsRes.json()) as PlotsResponseDto;
  return { plots: data.plots, myPreBidIds };
}
