/**
 * Phase 2.3 — realtime bus seam for 2.4.
 *
 * 2.4 swaps this no-op for the real in-process pub/sub feeding SSE; every
 * producer (worker, routes) publishes through this one interface so the
 * event contract is fixed before the transport lands.
 */

export type RealtimeEvent =
  | { type: 'cycle:resolved'; plotId: string; cycleId: string; winner: { bidderId: string; companyName: string | null } | null; clearingPriceCents: number | null }
  | { type: 'cycle:opened'; plotId: string; cycleId: string; endAt: string; openingPriceCents: number | null };

export function publish(event: RealtimeEvent): void {
  // Phase 2.4 replaces this with the real bus implementation.
  if (process.env.NODE_ENV !== 'production') {
    console.log('[realtime:stub]', JSON.stringify(event));
  }
}
