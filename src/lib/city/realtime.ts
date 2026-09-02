/**
 * Phase 2.4 — SSE client. One EventSource per page; events patch plots in
 * place through the store's patch pipeline (no full refetch on normal
 * ticks). Every reconnect delivers a fresh `snapshot` frame (server restarts
 * its per-connection seq), which re-anchors state; a seq gap between typed
 * events forces one full refetch. `visibilitychange` resync on tab wake-up.
 */

import { fetchCitySnapshot } from './fetch-city';
import { useCityStore } from './store';
import type { PlotDto, RealtimeEventDto } from '@/types/api';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;

let source: EventSource | null = null;
let lastSeq: number | null = null;
let backoffMs = BASE_BACKOFF_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closedByUs = false;

async function fullResync(reason: string): Promise<void> {
  try {
    const snap = await fetchCitySnapshot();
    const { setPlots, setMyPreBids, setMockResolveEnabled, markFetched } =
      useCityStore.getState();
    setPlots(snap.plots);
    setMyPreBids(snap.myPreBidIds);
    setMockResolveEnabled(snap.mockResolveEnabled);
    markFetched();
  } catch {
    // Resync failure is non-fatal — the next event or reconnect retries.
    console.warn('[realtime] resync failed:', reason);
  }
}

function applyEvent(event: RealtimeEventDto): void {
  const { plots, patchPlot } = useCityStore.getState();
  if (!plots.has(event.plotId)) return; // Unknown plot — refetch reconciles.

  switch (event.type) {
    case 'bid:placed': {
      if (event.currentPriceCents == null || event.cycleId == null) return;
      patchPlot(event.plotId, {
        status: 'LIVE',
        currentPriceCents: event.currentPriceCents,
        ...(event.endAt ? { endAt: event.endAt } : {}),
        // Leader preBid id is public (same field as /api/plots) — keeps
        // ownership/outbid derivation exact without a refetch. Never a
        // brand: the provisional leader hasn't won or paid anything yet
        // (Part 1 lifecycle fix) — `tenant` is deliberately untouched here.
        currentLeaderPreBidId: event.leaderPreBidId ?? undefined,
      });
      break;
    }
    case 'cycle:extended': {
      if (event.endAt == null) return;
      patchPlot(event.plotId, { status: 'LIVE', endAt: event.endAt });
      break;
    }
    case 'cycle:resolved': {
      if (event.winner) {
        // A winner settled: they are the new standing tenant. Display
        // rotates to their brand for the full lease — independent of
        // whether a next cycle opens below.
        patchPlot(event.plotId, {
          tenant: event.winner.brand,
          tenantPreBidId: event.winner.preBidId,
          currentLeaderPreBidId: undefined,
          ...(event.nextCycle
            ? {
                status: 'LIVE',
                endAt: event.nextCycle.endAt,
                currentPriceCents: event.nextCycle.openingPriceCents ?? undefined,
              }
            : { status: 'IDLE', endAt: undefined, currentPriceCents: undefined }),
        });
      } else if (event.nextCycle) {
        // No winner this cycle, but a queued pre-bid opened a fresh auction
        // right away. The existing tenant (if any) is UNAFFECTED — a failed
        // capture never evicts a standing tenant (Part 1 invariant) — so
        // only auction-progress fields change here.
        patchPlot(event.plotId, {
          status: 'LIVE',
          endAt: event.nextCycle.endAt,
          currentPriceCents: event.nextCycle.openingPriceCents ?? undefined,
        });
      } else {
        // Empty resolution: claimable again. The existing tenant (if any)
        // persists untouched — resolving with no winner is NOT an eviction
        // (Part 1 invariant), so `tenant`/`tenantPreBidId` are deliberately
        // absent from this patch rather than cleared.
        patchPlot(event.plotId, {
          status: 'IDLE',
          endAt: undefined,
          currentPriceCents: undefined,
          currentLeaderPreBidId: undefined,
        });
      }
      break;
    }
  }
}

function onTyped(ev: MessageEvent): void {
  const seq = Number(ev.lastEventId);
  if (Number.isFinite(seq)) {
    if (lastSeq !== null && seq > lastSeq + 1) {
      lastSeq = seq;
      void fullResync('seq gap');
      return;
    }
    lastSeq = seq;
  }
  try {
    applyEvent(JSON.parse(ev.data) as RealtimeEventDto);
  } catch {
    // Malformed frame — ignore; snapshot/resync keeps us honest.
  }
}

function onSnapshot(ev: MessageEvent): void {
  // Reconnects restart the server's per-connection seq — re-anchor here.
  const seq = Number(ev.lastEventId);
  if (Number.isFinite(seq)) lastSeq = seq;
  try {
    const data = JSON.parse(ev.data) as { plots: PlotDto[] };
    const { setPlots, markFetched } = useCityStore.getState();
    setPlots(data.plots);
    markFetched();
  } catch {
    void fullResync('malformed snapshot');
  }
}

function connect(): void {
  if (closedByUs || typeof window === 'undefined') return;
  if (source) {
    source.close();
    source = null;
  }

  source = new EventSource('/api/events');

  source.addEventListener('open', () => {
    backoffMs = BASE_BACKOFF_MS;
  });
  source.addEventListener('snapshot', onSnapshot as EventListener);
  source.addEventListener('bid:placed', onTyped as EventListener);
  source.addEventListener('cycle:extended', onTyped as EventListener);
  source.addEventListener('cycle:resolved', onTyped as EventListener);

  source.addEventListener('error', () => {
    // While CONNECTING the browser retries on its own; on a hard close we
    // drive our own exponential backoff loop.
    if (source && source.readyState === EventSource.CLOSED) {
      source = null;
      if (closedByUs || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        connect();
      }, backoffMs);
    }
  });
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') {
    // Wake-up resync: anchor to server truth, then keep streaming.
    void fullResync('visibilitychange');
  }
}

export function startRealtime(): void {
  if (typeof window === 'undefined') return;
  closedByUs = false;
  lastSeq = null;
  if (!source) connect();
  document.addEventListener('visibilitychange', onVisibility);
}

export function stopRealtime(): void {
  closedByUs = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (source) {
    source.close();
    source = null;
  }
  document.removeEventListener('visibilitychange', onVisibility);
}
