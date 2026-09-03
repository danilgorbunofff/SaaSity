import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isOwnedLeading,
  deriveOutbidPlotIds,
  deriveOutbidFromPositions,
  mergeOutbidPlotIds,
  isClosingSoon,
  CLOSING_SOON_MS,
  type OwnerPosition,
} from '../../src/lib/city/ownership';
import type { PlotDto } from '../../src/types/api';

function plot(overrides: Partial<PlotDto> & Pick<PlotDto, 'id' | 'status'>): PlotDto {
  return {
    id: overrides.id,
    tier: 'OUTER',
    originX: 0,
    originY: 0,
    spanX: 1,
    spanY: 1,
    status: overrides.status,
    currentPriceCents: overrides.currentPriceCents,
    endAt: overrides.endAt,
    cycleId: overrides.cycleId,
    currentLeaderPreBidId: overrides.currentLeaderPreBidId,
  };
}

function pos(
  overrides: Partial<OwnerPosition> & Pick<OwnerPosition, 'preBidId' | 'plotId'>,
): OwnerPosition {
  return { cycleId: null, status: 'ACTIVE', ...overrides };
}

const BID_A = 'pb-a';
const BID_B = 'pb-b';
const BID_C = 'pb-c';

test('isOwnedLeading truth table', () => {
  const mine = new Set([BID_A]);

  assert.equal(
    isOwnedLeading(plot({ id: 'p1', status: 'LIVE', currentLeaderPreBidId: BID_A }), mine, BID_A),
    true,
  );
  assert.equal(
    isOwnedLeading(plot({ id: 'p2', status: 'IDLE', currentLeaderPreBidId: BID_A }), mine, BID_A),
    false,
  );
  assert.equal(
    isOwnedLeading(plot({ id: 'p3', status: 'LIVE', currentLeaderPreBidId: BID_B }), mine, BID_B),
    false,
  );
  assert.equal(isOwnedLeading(plot({ id: 'p4', status: 'LIVE' }), mine, undefined), false);
  assert.equal(
    isOwnedLeading(
      plot({ id: 'p5', status: 'LIVE', currentLeaderPreBidId: BID_A }),
      mine,
      undefined,
    ),
    false,
  );
  assert.equal(isOwnedLeading(plot({ id: 'p6', status: 'LIVE' }), new Set(), undefined), false);
});

test('deriveOutbidPlotIds: leader swap while LIVE marks outbid', () => {
  const myBids = new Set([BID_A]);
  const prev = new Map([['p1', plot({ id: 'p1', status: 'LIVE', currentLeaderPreBidId: BID_A })]]);
  const next = new Map([['p1', plot({ id: 'p1', status: 'LIVE', currentLeaderPreBidId: BID_B })]]);
  const out = deriveOutbidPlotIds(prev, next, myBids);
  assert.ok(out.has('p1'));
});

test('deriveOutbidPlotIds: LIVE -> IDLE is expiry, not outbid', () => {
  const myBids = new Set([BID_A]);
  const prev = new Map([['p1', plot({ id: 'p1', status: 'LIVE', currentLeaderPreBidId: BID_A })]]);
  const next = new Map([['p1', plot({ id: 'p1', status: 'IDLE' })]]);
  const out = deriveOutbidPlotIds(prev, next, myBids);
  assert.equal(out.size, 0);
});

test('deriveOutbidPlotIds: rival-vs-rival swap never marks outbid', () => {
  const myBids = new Set([BID_C]);
  const prev = new Map([['p1', plot({ id: 'p1', status: 'LIVE', currentLeaderPreBidId: BID_A })]]);
  const next = new Map([['p1', plot({ id: 'p1', status: 'LIVE', currentLeaderPreBidId: BID_B })]]);
  const out = deriveOutbidPlotIds(prev, next, myBids);
  assert.equal(out.size, 0);
});

test('deriveOutbidPlotIds: no previous snapshot -> no outbid', () => {
  const myBids = new Set([BID_A]);
  const prev = new Map();
  const next = new Map([['p1', plot({ id: 'p1', status: 'LIVE', currentLeaderPreBidId: BID_B })]]);
  assert.equal(deriveOutbidPlotIds(prev, next, myBids).size, 0);
});

test('isClosingSoon boundary (3 minutes)', () => {
  const now = Date.parse('2025-01-01T00:00:00.000Z');
  assert.equal(isClosingSoon(undefined, now), false);
  assert.equal(isClosingSoon(new Date(now + CLOSING_SOON_MS).toISOString(), now), false);
  assert.equal(isClosingSoon(new Date(now + CLOSING_SOON_MS - 1).toISOString(), now), true);
  assert.equal(isClosingSoon(new Date(now - 1).toISOString(), now), false);
});

test('mergeOutbidPlotIds: flips stick across refetches while rival still leads', () => {
  const myBids = new Set([BID_A]);
  const next = new Map([['p1', plot({ id: 'p1', status: 'LIVE', currentLeaderPreBidId: BID_B })]]);
  const out = mergeOutbidPlotIds(new Set(['p1']), new Set(), next, myBids);
  assert.ok(out.has('p1'), 'previously-outbid plot stays outbid on refetch');
});

test('mergeOutbidPlotIds: prune when we re-take the lead', () => {
  const myBids = new Set([BID_A]);
  const next = new Map([['p1', plot({ id: 'p1', status: 'LIVE', currentLeaderPreBidId: BID_A })]]);
  const out = mergeOutbidPlotIds(new Set(['p1']), new Set(), next, myBids);
  assert.equal(out.has('p1'), false);
});

test('mergeOutbidPlotIds: prune when cycle ends (LIVE -> IDLE)', () => {
  const myBids = new Set([BID_A]);
  const next = new Map([['p1', plot({ id: 'p1', status: 'IDLE' })]]);
  const out = mergeOutbidPlotIds(new Set(['p1']), new Set(), next, myBids);
  assert.equal(out.has('p1'), false);
});

test('mergeOutbidPlotIds: prune when plot vanishes from snapshot', () => {
  const myBids = new Set([BID_A]);
  const next = new Map<string, PlotDto>();
  const out = mergeOutbidPlotIds(new Set(['p1']), new Set(), next, myBids);
  assert.equal(out.has('p1'), false);
});

test('mergeOutbidPlotIds: new flips are added to the sticky set', () => {
  const myBids = new Set([BID_A]);
  const next = new Map([
    ['p1', plot({ id: 'p1', status: 'LIVE', currentLeaderPreBidId: BID_B })],
    ['p2', plot({ id: 'p2', status: 'LIVE', currentLeaderPreBidId: BID_C })],
  ]);
  const out = mergeOutbidPlotIds(new Set(['p1']), new Set(['p2']), next, myBids);
  assert.ok(out.has('p1') && out.has('p2'));
});

test('deriveOutbidFromPositions: ACTIVE row on the current cycle, rival leads → outbid (refresh-while-outbid)', () => {
  const plots = new Map([
    ['p1', plot({ id: 'p1', status: 'LIVE', cycleId: 'c1', currentLeaderPreBidId: BID_B })],
  ]);
  // I never observed the flip — the snapshot alone reconstructs it.
  const out = deriveOutbidFromPositions(plots, [
    pos({ preBidId: BID_A, plotId: 'p1', cycleId: 'c1' }),
  ]);
  assert.ok(out.has('p1'));
});

test('deriveOutbidFromPositions: leading, won, leaderless, stale-cycle, and idle cases stay quiet', () => {
  const plots = new Map([
    ['lead', plot({ id: 'lead', status: 'LIVE', cycleId: 'c1', currentLeaderPreBidId: BID_A })],
    ['won', plot({ id: 'won', status: 'IDLE', cycleId: undefined })],
    ['empty', plot({ id: 'empty', status: 'LIVE', cycleId: 'c1' })],
    ['stale', plot({ id: 'stale', status: 'LIVE', cycleId: 'c2', currentLeaderPreBidId: BID_B })],
    [
      'idle',
      plot({ id: 'idle', status: 'IDLE', cycleId: undefined, currentLeaderPreBidId: undefined }),
    ],
  ]);
  const positions = [
    pos({ preBidId: BID_A, plotId: 'lead', cycleId: 'c1' }),
    // WON rows are tenancy, never outbid — even if someone else "leads".
    { preBidId: 'pb-won', plotId: 'won', cycleId: null, status: 'WON' },
    // My ACTIVE row is on the OLD cycle; the plot already rotated.
    pos({ preBidId: BID_A, plotId: 'stale', cycleId: 'c1' }),
    // LOST rows are history, not contention.
    { preBidId: 'pb-lost', plotId: 'idle', cycleId: 'c0', status: 'LOST' },
  ];
  assert.equal(deriveOutbidFromPositions(plots, positions).size, 0);
});

test('mergeOutbidPlotIds with positions: cycle rotation clears the stale contest', () => {
  const myBids = new Set([BID_A]);
  const positions = [pos({ preBidId: BID_A, plotId: 'p1', cycleId: 'c1' })];
  // The plot rotated to c2 while my projection still names c1 (pre-refresh
  // transient): the old contest ends — no sticky outbid leaks across cycles.
  const rotated = new Map([
    ['p1', plot({ id: 'p1', status: 'LIVE', cycleId: 'c2', currentLeaderPreBidId: BID_B })],
  ]);
  const out = mergeOutbidPlotIds(new Set(['p1']), new Set(), rotated, myBids, positions);
  assert.equal(out.has('p1'), false);
});

test('mergeOutbidPlotIds with positions: LOST row clears; still-losing fresh cycle re-adds', () => {
  const myBids = new Set([BID_A]);
  const live = new Map([
    ['p1', plot({ id: 'p1', status: 'LIVE', cycleId: 'c2', currentLeaderPreBidId: BID_B })],
  ]);
  // My old row went LOST and I have nothing on c2: contest over, clear.
  const lost: OwnerPosition[] = [{ preBidId: BID_A, plotId: 'p1', cycleId: 'c1', status: 'LOST' }];
  assert.equal(mergeOutbidPlotIds(new Set(['p1']), new Set(), live, myBids, lost).has('p1'), false);
  // My queued row attached to c2 but loses: the snapshot derivation re-adds.
  const losing: OwnerPosition[] = [pos({ preBidId: 'pb-a2', plotId: 'p1', cycleId: 'c2' })];
  const mine = new Set(['pb-a2']);
  assert.ok(mergeOutbidPlotIds(new Set(), new Set(['p1']), live, mine, losing).has('p1'));
});
