/**
 * Phase 2.4 — SSE client, hardened by Part 4. One EventSource per page;
 * events patch plots in place through the store's patch pipeline (no full
 * refetch on normal ticks). Every reconnect delivers a fresh `snapshot`
 * frame (server restarts its per-connection seq), which re-anchors state; a
 * seq gap between typed events forces one full refetch. `visibilitychange`
 * resyncs on tab wake-up.
 *
 * Part 4 `realtime-harden` contract:
 *   - connection states (store.connection): connecting → live while frames
 *     flow; reconnecting while the retry loop owns the socket; offline while
 *     the browser reports no network. Freshness is store.lastSyncAt, a
 *     separate concern — quiet 12h auctions stay `live` without traffic.
 *   - malformed frames: one bad frame is skipped; MAX_BAD_FRAMES in a row
 *     forces a snapshot re-anchor (a corrupt-but-alive stream is worse than
 *     a reconnect). Unknown event TYPE names never arrive here at all —
 *     listeners are registered per known type, so a newer server stays
 *     forward-compatible with this client.
 *   - offline/online: offline marks the badge immediately (the socket is
 *     left to the browser); online re-anchors via fullResync.
 *   - handler ownership (Part 4 consolidation decision): THIS module owns
 *     the stream (visibilitychange → re-anchor); CityScene's DataBinder owns
 *     data (window focus + explicit city-refetch → full snapshot incl. the
 *     owner projection, which the stream never carries). Two handlers, two
 *     jobs, no overlap.
 *   - multi-tab: tabs share nothing client-side (no BroadcastChannel) — the
 *     server is the source of truth, the API layer is last-write-wins, and
 *     every tab converges via its own stream/snapshot. Focus refetch covers
 *     the cross-tab staleness window (bid in tab A, glance at tab B).
 */

import { fetchCitySnapshot, fetchMyPositions } from './fetch-city';
import { useCityStore } from './store';
import type { PlotDto, RealtimeEventDto } from '@/types/api';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;

let source: EventSource | null = null;
let lastSeq: number | null = null;
let backoffMs = BASE_BACKOFF_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closedByUs = false;
// Part 4 malformed-frame policy: isolated bad frames are skipped; a run of
// MAX_BAD_FRAMES consecutive failures forces a snapshot re-anchor.
let consecutiveBadFrames = 0;
const MAX_BAD_FRAMES = 3;

/**
 * Part 4 surfacing policy: one failed resync is a warning (transient
 * blips are normal); MAX_RESYNC_FAILURES in a row means the client is
 * flying blind — raise the shared error surface (ErrorChip + manual retry)
 * instead of only logging. Success clears OUR error, never anyone else's.
 */
const RESYNC_FAILED_MSG = 'Live sync failed — showing the last synced state.';
let consecutiveResyncFailures = 0;
const MAX_RESYNC_FAILURES = 3;

async function fullResync(reason: string): Promise<void> {
  try {
    const snap = await fetchCitySnapshot();
    const { setPlots, setMyPositions, setMockResolveEnabled, markFetched, markSynced, setError, error } =
      useCityStore.getState();
    // Positions BEFORE plots: setPlots derives snapshot outbid from the
    // current projection, so the projection must already be fresh.
    setMyPositions(snap.myPositions);
    setPlots(snap.plots);
    setMockResolveEnabled(snap.mockResolveEnabled);
    markFetched();
    markSynced();
    consecutiveResyncFailures = 0;
    if (error === RESYNC_FAILED_MSG) setError(null);
  } catch {
    // Resync failure is non-fatal — the next event or reconnect retries.
    console.warn('[realtime] resync failed:', reason);
    consecutiveResyncFailures += 1;
    if (consecutiveResyncFailures >= MAX_RESYNC_FAILURES) {
      useCityStore.getState().setError(RESYNC_FAILED_MSG);
    }
  }
}

// Unknown-plot throttle: an event naming a plot outside our snapshot means
// genuine sync loss (plot set changed under us) — re-anchor, but at most
// once per window so a corrupt server can't resync-storm the client.
let lastUnknownPlotResync = 0;
const UNKNOWN_PLOT_RESYNC_MS = 5_000;

function resyncForUnknownPlot(plotId: string): void {
  const now = Date.now();
  if (now - lastUnknownPlotResync < UNKNOWN_PLOT_RESYNC_MS) return;
  lastUnknownPlotResync = now;
  void fullResync(`unknown plot ${plotId}`);
}

/**
 * Part 4 `outbid-reconstruction`: lightweight owner refresh after claim,
 * bid, and resolution — re-anchors outbid/tenant derivations to server
 * truth (rows may have gone WON/LOST, cycles may have rotated) without a
 * full plot refetch. setMyPositions also re-derives the sticky outbid set.
 */
export async function refreshMyPositions(): Promise<void> {
  try {
    const { positions } = await fetchMyPositions();
    useCityStore.getState().setMyPositions(positions);
  } catch {
    console.warn('[realtime] owner refresh failed');
  }
}

/**
 * Applies one realtime event to the store. Exported for unit tests (the
 * atomic next-cycle swap and idempotent re-application are Part 4
 * acceptance behavior); production callers go through the SSE handlers.
 */
export function applyEvent(event: RealtimeEventDto): void {
  const { patchPlot } = useCityStore.getState();
  // Unknown plot (the plot set changed under us, or our snapshot predates
  // it): re-anchor instead of dropping the event into the void — otherwise
  // the client sits on a stale grid forever while the stream looks alive.
  if (!useCityStore.getState().plots.has(event.plotId)) {
    resyncForUnknownPlot(event.plotId);
    return;
  }

  switch (event.type) {
    case 'bid:placed': {
      if (event.currentPriceCents == null || event.cycleId == null) return;
      patchPlot(event.plotId, {
        status: 'LIVE',
        cycleId: event.cycleId,
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
      // Part 4 `next-cycle-realtime-state`: ONE atomic patch per outcome —
      // cycleId, status, leader, price, endAt, and tenant swap together, so
      // the client can never show a LIVE next cycle with the previous
      // winner's auction state (or vice versa). The tenant rotates to the
      // winner's brand for the full lease, independent of whether a next
      // cycle opened below; with no winner the standing tenant persists
      // untouched (a failed capture never evicts — Part 1 invariant).
      if (event.winner) {
        patchPlot(event.plotId, {
          tenant: event.winner.brand,
          tenantPreBidId: event.winner.preBidId,
          ...(event.nextCycle
            ? {
                status: 'LIVE',
                cycleId: event.nextCycle.cycleId,
                endAt: event.nextCycle.endAt,
                currentPriceCents: event.nextCycle.currentPriceCents ?? undefined,
                currentLeaderPreBidId: event.nextCycle.leaderPreBidId ?? undefined,
              }
            : {
                status: 'IDLE',
                cycleId: undefined,
                endAt: undefined,
                currentPriceCents: undefined,
                currentLeaderPreBidId: undefined,
              }),
        });
      } else if (event.nextCycle) {
        // No winner this cycle, but a queued pre-bid opened a fresh auction
        // right away. The existing tenant (if any) is UNAFFECTED — only
        // auction-progress fields change here.
        patchPlot(event.plotId, {
          status: 'LIVE',
          cycleId: event.nextCycle.cycleId,
          endAt: event.nextCycle.endAt,
          currentPriceCents: event.nextCycle.currentPriceCents ?? undefined,
          currentLeaderPreBidId: event.nextCycle.leaderPreBidId ?? undefined,
        });
      } else {
        // Empty resolution: claimable again. `tenant`/`tenantPreBidId`
        // persist untouched — resolving with no winner is NOT an eviction.
        patchPlot(event.plotId, {
          status: 'IDLE',
          cycleId: undefined,
          endAt: undefined,
          currentPriceCents: undefined,
          currentLeaderPreBidId: undefined,
        });
      }
      // Ownership may have changed under us (our row went WON/LOST, a cycle
      // rotated) — refresh the private owner projection (Part 4
      // `outbid-reconstruction`) so outbid/tenant derivations re-anchor to
      // server truth instead of stale ids.
      void refreshMyPositions();
      break;
    }
  }
}

/**
 * Typed-event entry point. Exported for unit tests (malformed-frame policy,
 * seq-gap resync); production wires it per known event type in connect().
 */
export function onTyped(ev: { lastEventId: string; data: string }): void {
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
    const parsed: unknown = JSON.parse(ev.data);
    assertEventShape(parsed);
    applyEvent(parsed);
    noteHealthyFrame();
  } catch {
    noteBadFrame();
  }
}

/**
 * Minimal structural gate: a frame with the right type name but a missing
 * plotId (or a non-object payload) is a transport failure, not a no-op —
 * silently swallowing it would freeze the client on corrupt data while the
 * stream looks alive. Unknown event TYPE names never reach here: listeners
 * are registered per known type, so a newer server's new types are ignored
 * (forward-compatible) without tripping this counter.
 */
function assertEventShape(event: unknown): asserts event is RealtimeEventDto {
  if (typeof event !== 'object' || event === null) throw new Error('non-object frame');
  const e = event as Record<string, unknown>;
  if (e.type !== 'bid:placed' && e.type !== 'cycle:extended' && e.type !== 'cycle:resolved') {
    throw new Error(`unknown event type: ${String(e.type)}`);
  }
  if (typeof e.plotId !== 'string' || e.plotId.length === 0) throw new Error('frame without plotId');
}

/** A healthy frame: reset the failure counter, mark stream + data fresh. */
function noteHealthyFrame(): void {
  consecutiveBadFrames = 0;
  const { setConnection, markSynced, connection } = useCityStore.getState();
  markSynced();
  if (connection !== 'live' && connection !== 'offline') setConnection('live');
}

/**
 * Part 4 malformed-frame policy: isolated corruption is tolerated (a single
 * bad frame is skipped), but a run of structurally invalid frames means the
 * transport can no longer be trusted — force a snapshot re-anchor instead
 * of silently ignoring the stream into staleness.
 */
function noteBadFrame(): void {
  consecutiveBadFrames += 1;
  if (consecutiveBadFrames >= MAX_BAD_FRAMES) {
    consecutiveBadFrames = 0;
    void fullResync('repeated malformed frames');
  }
}

/**
 * Snapshot entry point. Exported for unit tests; production wires it to the
 * `snapshot` event in connect().
 */
export function onSnapshot(ev: { lastEventId: string; data: string }): void {
  // Reconnects restart the server's per-connection seq — re-anchor here.
  const seq = Number(ev.lastEventId);
  if (Number.isFinite(seq)) lastSeq = seq;
  try {
    const data = JSON.parse(ev.data) as { plots: PlotDto[] };
    if (!Array.isArray(data.plots)) throw new Error('snapshot without plots');
    const { setPlots, markFetched } = useCityStore.getState();
    setPlots(data.plots);
    markFetched();
    noteHealthyFrame();
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

  const { setConnection, connection } = useCityStore.getState();
  if (connection !== 'offline') setConnection('connecting');
  source = new EventSource('/api/events');

  source.addEventListener('open', () => {
    backoffMs = BASE_BACKOFF_MS;
  });
  // Listeners are registered per KNOWN type only — a newer server's new
  // event types arrive with no listener and are ignored (forward-compat),
  // never tripping the malformed-frame counter.
  source.addEventListener('snapshot', onSnapshot as unknown as EventListener);
  source.addEventListener('bid:placed', onTyped as unknown as EventListener);
  source.addEventListener('cycle:extended', onTyped as unknown as EventListener);
  source.addEventListener('cycle:resolved', onTyped as unknown as EventListener);

  source.addEventListener('error', () => {
    // While CONNECTING the browser retries on its own; on a hard close we
    // drive our own exponential backoff loop.
    if (source && source.readyState === EventSource.CLOSED) {
      source = null;
      if (closedByUs || reconnectTimer) return;
      const { setConnection, connection } = useCityStore.getState();
      if (connection !== 'offline') setConnection('reconnecting');
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

function onOnline(): void {
  if (closedByUs || typeof window === 'undefined') return;
  // Back on the network: re-anchor immediately (cheap, correct), and make
  // sure the stream exists — a hard failure while offline leaves no source.
  const { connection } = useCityStore.getState();
  if (connection === 'offline') useCityStore.getState().setConnection('connecting');
  if (!source) connect();
  void fullResync('online');
}

function onOffline(): void {
  // Badge first: the browser keeps retrying the socket on its own, so there
  // is nothing to tear down — but the user must see the state.
  useCityStore.getState().setConnection('offline');
}

export function startRealtime(): void {
  if (typeof window === 'undefined') return;
  closedByUs = false;
  lastSeq = null;
  consecutiveBadFrames = 0;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    useCityStore.getState().setConnection('offline');
  }
  if (!source) connect();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
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
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
}
