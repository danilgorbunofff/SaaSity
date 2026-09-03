/**
 * Part 4 `next-cycle-realtime-state` + `outbid-reconstruction`: the client
 * applies cycle:resolved atomically (cycleId/status/leader/price/endAt swap
 * together) and reconstructs outbid from server snapshots after refresh.
 *
 * Drives the real zustand store in node. fetch is stubbed: the resolved
 * handler's owner refresh reads /api/me/bids, which the stub answers from
 * a script-controlled projection.
 */

import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { useCityStore } from '../../src/lib/city/store';
import { applyEvent, onTyped, onSnapshot } from '../../src/lib/city/realtime';
import type { PlotDto, RealtimeEventDto } from '../../src/types/api';

const PLOT = 'plot-7';
const OLD_CYCLE = 'cycle-old';
const NEW_CYCLE = 'cycle-new';
const WINNER_PB = 'pb-winner';
const NEXT_LEADER_PB = 'pb-next-leader';
const MY_QUEUED_PB = 'pb-mine-queued';

const TENANT_BRAND = {
  companyName: 'Winner Co',
  tagline: 'Paid up',
  twitterHandle: 'winnerco',
  logoUrl: null,
  mrrText: '$9k MRR',
  logoHidden: false,
  targetUrl: 'https://winner.example.com',
};

let meBidsStub: { preBidIds: string[]; positions: unknown[] } = { preBidIds: [], positions: [] };
let plotsStub: unknown[] = [];
let plotsFetchCount = 0;
let fetchShouldFail = false;

// @ts-expect-error test-only fetch stub (node has a global fetch to replace)
globalThis.fetch = async (url: string) => {
  if (fetchShouldFail) throw new Error('network down');
  if (String(url).includes('/api/me/bids')) {
    return { ok: true, json: async () => meBidsStub };
  }
  if (String(url).includes('/api/plots')) {
    plotsFetchCount += 1;
    return { ok: true, json: async () => ({ plots: plotsStub, mockResolveEnabled: false }) };
  }
  throw new Error(`unexpected fetch in test: ${url}`);
};

function seedLivePlot(overrides: Partial<PlotDto> = {}): void {
  useCityStore.setState({
    plots: new Map<string, PlotDto>([
      [
        PLOT,
        {
          id: PLOT,
          tier: 'MID',
          originX: 0,
          originY: 0,
          spanX: 1,
          spanY: 1,
          status: 'LIVE',
          cycleId: OLD_CYCLE,
          currentPriceCents: 3100,
          endAt: '2026-05-01T00:00:00.000Z',
          currentLeaderPreBidId: WINNER_PB,
          ...overrides,
        },
      ],
    ]),
    myPreBidIds: new Set<string>(),
    myPositions: [],
    outbidPlotIds: new Set<string>(),
  });
}

function resolvedEvent(overrides: Partial<RealtimeEventDto> = {}): RealtimeEventDto {
  return {
    type: 'cycle:resolved',
    plotId: PLOT,
    cycleId: OLD_CYCLE,
    currentPriceCents: null,
    leaderPreBidId: null,
    endAt: null,
    winner: { preBidId: WINNER_PB, brand: TENANT_BRAND },
    clearingPriceCents: 3100,
    nextCycle: {
      cycleId: NEW_CYCLE,
      endAt: '2026-05-02T00:00:00.000Z',
      openingPriceCents: 500,
      currentPriceCents: 500,
      leaderPreBidId: NEXT_LEADER_PB,
    },
    ...overrides,
  };
}

beforeEach(() => {
  meBidsStub = { preBidIds: [], positions: [] };
  plotsStub = [];
  plotsFetchCount = 0;
  useCityStore.setState({ connection: 'connecting', lastSyncAt: null });
  // NOTE: realtime.ts keeps module-level stream state (lastSeq, bad-frame
  // counter) that intentionally survives across these cases — seqs below
  // are chained increasingly (…, 1, 2, 4, 5, 6, 7, 8) so each test starts
  // where the previous one anchored, exactly like one long-lived stream.
});

test('cycle:resolved with winner + next cycle swaps everything atomically (A rotates into B)', () => {
  seedLivePlot();
  applyEvent(resolvedEvent());
  const p = useCityStore.getState().plots.get(PLOT)!;
  // The previous winner A is the tenant; the next cycle B is fully formed —
  // never "LIVE with the old winner's auction state".
  assert.equal(p.status, 'LIVE');
  assert.equal(p.cycleId, NEW_CYCLE);
  assert.equal(p.currentPriceCents, 500);
  assert.equal(p.endAt, '2026-05-02T00:00:00.000Z');
  assert.equal(p.currentLeaderPreBidId, NEXT_LEADER_PB);
  assert.equal(p.tenantPreBidId, WINNER_PB);
  assert.equal(p.tenant?.companyName, 'Winner Co');
});

test('cycle:resolved is idempotent — replaying the same event is a no-op', () => {
  seedLivePlot();
  const ev = resolvedEvent();
  applyEvent(ev);
  const first = useCityStore.getState().plots.get(PLOT)!;
  applyEvent(ev);
  const second = useCityStore.getState().plots.get(PLOT)!;
  assert.deepEqual(second, first);
});

test('cycle:resolved with winner and no next cycle goes IDLE, clears auction fields, keeps tenant', () => {
  seedLivePlot();
  applyEvent(resolvedEvent({ nextCycle: null }));
  const p = useCityStore.getState().plots.get(PLOT)!;
  assert.equal(p.status, 'IDLE');
  assert.equal(p.cycleId, undefined);
  assert.equal(p.currentPriceCents, undefined);
  assert.equal(p.endAt, undefined);
  assert.equal(p.currentLeaderPreBidId, undefined);
  assert.equal(p.tenantPreBidId, WINNER_PB);
});

test('cycle:resolved with no winner but a next cycle keeps the standing tenant untouched', () => {
  seedLivePlot({
    tenantPreBidId: 'pb-old-tenant',
    tenant: { ...TENANT_BRAND, companyName: 'Old Tenant' },
  });
  applyEvent(resolvedEvent({ winner: null, clearingPriceCents: null }));
  const p = useCityStore.getState().plots.get(PLOT)!;
  assert.equal(p.status, 'LIVE');
  assert.equal(p.cycleId, NEW_CYCLE);
  assert.equal(p.tenantPreBidId, 'pb-old-tenant');
  assert.equal(p.tenant?.companyName, 'Old Tenant');
});

test('bid:placed tracks the cycle it prices (no cycleId drift)', () => {
  seedLivePlot({ cycleId: OLD_CYCLE, currentLeaderPreBidId: 'pb-x', currentPriceCents: 500 });
  applyEvent({
    type: 'bid:placed',
    plotId: PLOT,
    cycleId: NEW_CYCLE,
    currentPriceCents: 600,
    leaderPreBidId: 'pb-y',
    endAt: '2026-05-03T00:00:00.000Z',
    winner: null,
    clearingPriceCents: null,
    nextCycle: null,
  });
  const p = useCityStore.getState().plots.get(PLOT)!;
  assert.equal(p.cycleId, NEW_CYCLE);
  assert.equal(p.currentPriceCents, 600);
  assert.equal(p.currentLeaderPreBidId, 'pb-y');
});

test('refresh-while-outbid: snapshot + positions reconstruct the loss without an observed flip', () => {
  seedLivePlot({ cycleId: OLD_CYCLE, currentLeaderPreBidId: 'pb-rival' });
  const s = useCityStore.getState();
  // Fresh client: never saw the flip, then both snapshot halves land.
  s.setMyPositions([
    { preBidId: MY_QUEUED_PB, plotId: PLOT, cycleId: OLD_CYCLE, status: 'ACTIVE' },
  ]);
  s.setPlots([...s.plots.values()]);
  assert.ok(useCityStore.getState().outbidPlotIds.has(PLOT), 'outbid reconstructed from snapshot');
});

test('rotation clears stale outbid; still-losing the fresh cycle re-adds after refresh', () => {
  seedLivePlot({ cycleId: OLD_CYCLE, currentLeaderPreBidId: 'pb-rival' });
  const s = useCityStore.getState();
  s.setMyPositions([{ preBidId: 'pb-mine', plotId: PLOT, cycleId: OLD_CYCLE, status: 'ACTIVE' }]);
  s.setPlots([...s.plots.values()]);
  assert.ok(useCityStore.getState().outbidPlotIds.has(PLOT));

  // Rotation lands (my projection still names the old cycle): cleared.
  applyEvent(resolvedEvent({ winner: { preBidId: 'pb-rival', brand: TENANT_BRAND } }));
  assert.ok(!useCityStore.getState().outbidPlotIds.has(PLOT), 'stale contest cleared on rotation');

  // Owner refresh: my queued row attached to the new cycle but loses → back.
  useCityStore
    .getState()
    .setMyPositions([
      { preBidId: MY_QUEUED_PB, plotId: PLOT, cycleId: NEW_CYCLE, status: 'ACTIVE' },
    ]);
  assert.ok(useCityStore.getState().outbidPlotIds.has(PLOT), 'fresh-cycle outbid re-derived');
});

function typedFrame(seq: number | null, data: string): { lastEventId: string; data: string } {
  return { lastEventId: seq == null ? '' : String(seq), data };
}

test('a healthy typed frame marks the stream live and records sync time', () => {
  seedLivePlot();
  assert.equal(useCityStore.getState().connection, 'connecting');
  onTyped(
    typedFrame(
      1,
      JSON.stringify({
        type: 'bid:placed',
        plotId: PLOT,
        cycleId: OLD_CYCLE,
        currentPriceCents: 600,
        leaderPreBidId: 'pb-rival',
        endAt: null,
        winner: null,
        clearingPriceCents: null,
        nextCycle: null,
      }),
    ),
  );
  const s = useCityStore.getState();
  assert.equal(s.connection, 'live');
  assert.ok(typeof s.lastSyncAt === 'number' && s.lastSyncAt > 0);
  assert.equal(s.plots.get(PLOT)?.currentPriceCents, 600);
});

test('a seq gap forces a snapshot re-anchor instead of applying the frame', async () => {
  seedLivePlot({ currentPriceCents: 500 });
  // Stream anchored at 1 by the previous test; 2 applies cleanly…
  onTyped(
    typedFrame(
      2,
      JSON.stringify({
        type: 'bid:placed',
        plotId: PLOT,
        cycleId: OLD_CYCLE,
        currentPriceCents: 600,
        leaderPreBidId: 'pb-rival',
        endAt: null,
        winner: null,
        clearingPriceCents: null,
        nextCycle: null,
      }),
    ),
  );
  assert.equal(useCityStore.getState().plots.get(PLOT)?.currentPriceCents, 600);
  // …then 4 skips 3: gap → resync (echoes the anchored plot), no apply.
  plotsStub = [{ ...useCityStore.getState().plots.get(PLOT)! }];
  onTyped(
    typedFrame(
      4,
      JSON.stringify({
        type: 'bid:placed',
        plotId: PLOT,
        cycleId: OLD_CYCLE,
        currentPriceCents: 9999,
        leaderPreBidId: 'pb-rival',
        endAt: null,
        winner: null,
        clearingPriceCents: null,
        nextCycle: null,
      }),
    ),
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(plotsFetchCount, 1);
  assert.equal(useCityStore.getState().plots.get(PLOT)?.currentPriceCents, 600);
});

test('isolated bad frames are skipped; three in a row force a resync', async () => {
  seedLivePlot();
  // lastSeq is 4: 5 and 6 are in-window but corrupt → skipped, no resync.
  onTyped(typedFrame(5, 'not-json{{{'));
  onTyped(typedFrame(6, JSON.stringify({ type: 'bid:placed' }))); // no plotId
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(plotsFetchCount, 0);
  // Third consecutive failure → the transport is distrusted → re-anchor.
  onTyped(typedFrame(7, JSON.stringify({ type: 'nonsense', plotId: PLOT })));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(plotsFetchCount, 1);
});

test('a snapshot frame re-anchors plots, seq, and sync time', () => {
  seedLivePlot({ currentPriceCents: 500 });
  onSnapshot(
    typedFrame(
      7,
      JSON.stringify({
        plots: [{ ...useCityStore.getState().plots.get(PLOT)!, currentPriceCents: 700 }],
      }),
    ),
  );
  const s = useCityStore.getState();
  assert.equal(s.plots.get(PLOT)?.currentPriceCents, 700);
  assert.equal(s.connection, 'live');
  assert.ok(typeof s.lastSyncAt === 'number');
});

test('an event for an unknown plot re-anchors (throttled), never silently drops', async () => {
  seedLivePlot();
  // The re-anchor echoes the known grid back (server truth still has it).
  plotsStub = [{ ...useCityStore.getState().plots.get(PLOT)! }];
  const alien = {
    type: 'bid:placed',
    plotId: 'plot-that-does-not-exist',
    cycleId: 'c-x',
    currentPriceCents: 100,
    leaderPreBidId: 'pb-x',
    endAt: null,
    winner: null,
    clearingPriceCents: null,
    nextCycle: null,
  };
  // lastSeq is 7: 8 applies in-window… except the plot is unknown → resync.
  onTyped(typedFrame(8, JSON.stringify(alien)));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(plotsFetchCount, 1);
  // …and an immediate repeat does NOT resync-storm (5s throttle).
  onTyped(typedFrame(9, JSON.stringify(alien)));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(plotsFetchCount, 1);
  // The known grid is untouched by the alien frame.
  assert.ok(useCityStore.getState().plots.has(PLOT));
});

test('repeated resync failures surface an error; recovery clears it', async () => {
  seedLivePlot();
  fetchShouldFail = true;
  try {
    // lastSeq is 9: three gaps → three failed resyncs → error surfaces.
    onTyped(typedFrame(11, '{}'));
    onTyped(typedFrame(13, '{}'));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(useCityStore.getState().error, null, 'two failures still silent');
    onTyped(typedFrame(15, '{}'));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(
      useCityStore.getState().error,
      'Live sync failed — showing the last synced state.',
    );
  } finally {
    fetchShouldFail = false;
  }
  // Next gap succeeds → our error clears, grid re-anchors.
  plotsStub = [{ ...useCityStore.getState().plots.get(PLOT)! }];
  onTyped(typedFrame(17, '{}'));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(useCityStore.getState().error, null);
});
