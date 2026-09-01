import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isOwnedLeading,
  deriveOutbidPlotIds,
  isClosingSoon,
  CLOSING_SOON_MS,
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
    currentLeaderPreBidId: overrides.currentLeaderPreBidId,
    endAt: overrides.endAt,
  };
}

const BID_A = 'pb-a';
const BID_B = 'pb-b';
const BID_C = 'pb-c';

test('isOwnedLeading truth table', () => {
  const mine = new Set([BID_A]);

  assert.equal(isOwnedLeading(plot({ id: 'p1', status: 'LIVE', currentLeaderPreBidId: BID_A }), mine, BID_A), true);
  assert.equal(isOwnedLeading(plot({ id: 'p2', status: 'IDLE', currentLeaderPreBidId: BID_A }), mine, BID_A), false);
  assert.equal(isOwnedLeading(plot({ id: 'p3', status: 'LIVE', currentLeaderPreBidId: BID_B }), mine, BID_B), false);
  assert.equal(isOwnedLeading(plot({ id: 'p4', status: 'LIVE' }), mine, undefined), false);
  assert.equal(isOwnedLeading(plot({ id: 'p5', status: 'LIVE', currentLeaderPreBidId: BID_A }), mine, undefined), false);
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