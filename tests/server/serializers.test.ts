/**
 * Part 7 `test-coverage-gap` — REST serializer privacy tests.
 *
 * `serializePlot` / `serializeBidTick` are the ONLY shapes the public API may
 * emit (REST 0.3, SSE 2.4 both reuse them). These tests pin the privacy
 * invariant structurally: even if a caller passes a row object carrying
 * private columns, the serialized JSON must not contain them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializePlot, serializeBidTick } from '../../src/server/serializers';
import type { Plot, AuctionCycle } from '../../src/generated/prisma/client';

function plotBase(
  overrides: Record<string, unknown> = {},
): Plot & { currentCycle: AuctionCycle | null } {
  return {
    id: 'mid-01',
    tier: 'MID',
    originX: 1,
    originY: 1,
    spanX: 2,
    spanY: 2,
    status: 'IDLE',
    currentCycleId: null,
    currentLeaderPreBidId: null,
    tenantPreBidId: null,
    tenantSince: null,
    tenantCompanyName: null,
    tenantTagline: null,
    tenantTwitterHandle: null,
    tenantLogoUrl: null,
    tenantMrrText: null,
    tenantLogoHidden: false,
    tenantTargetUrl: null,
    currentCycle: null,
    ...overrides,
  } as unknown as Plot & { currentCycle: AuctionCycle | null };
}

function liveCycle(): AuctionCycle {
  return {
    id: 'cycle-1',
    currentPriceCents: 600,
    endAt: new Date('2026-09-03T12:00:00.000Z'),
  } as unknown as AuctionCycle;
}

function assertNoPrivateLeak(json: string, label: string): void {
  for (const needle of [
    'maxBid',
    'bidderRef',
    'bidderId',
    'stripe',
    'secret',
    'paymentIntent',
    'cookie',
  ]) {
    assert.ok(
      !json.toLowerCase().includes(needle.toLowerCase()),
      `${label} leaks ${needle}: ${json}`,
    );
  }
}

test('IDLE plot without tenant serializes base fields only', () => {
  const dto = serializePlot(plotBase());
  assert.equal(dto.id, 'mid-01');
  assert.equal(dto.status, 'IDLE');
  assert.equal(dto.currentPriceCents, undefined);
  assert.equal(dto.endAt, undefined);
  assert.equal(dto.cycleId, undefined);
  assert.equal(dto.tenant, undefined);
  assertNoPrivateLeak(JSON.stringify(dto), 'idle plot');
});

test('IDLE plot keeps its paid tenant brand but no live auction fields', () => {
  const dto = serializePlot(
    plotBase({
      tenantPreBidId: 'pre-1',
      tenantCompanyName: 'CodeShip',
      tenantTagline: 'Ship it',
      tenantTargetUrl: 'https://codeship.dev',
    }),
  );
  assert.equal(dto.tenant?.companyName, 'CodeShip');
  assert.equal(dto.tenantPreBidId, 'pre-1');
  assert.equal(dto.currentPriceCents, undefined);
  assert.equal(dto.cycleId, undefined);
  assertNoPrivateLeak(JSON.stringify(dto), 'idle plot with tenant');
});

test('LIVE plot exposes price/endAt/cycleId/opaque leader id, never private columns', () => {
  const dto = serializePlot(
    plotBase({
      status: 'LIVE',
      currentCycleId: 'cycle-1',
      currentLeaderPreBidId: 'pre-9',
      currentCycle: liveCycle(),
      // Private columns a careless caller might pass through on the row object.
      maxBidCents: 99999,
      bidderRef: 'opaque-but-private',
      stripePaymentIntentId: 'pi_secret',
    }),
  );
  assert.equal(dto.currentPriceCents, 600);
  assert.equal(dto.endAt, '2026-09-03T12:00:00.000Z');
  assert.equal(dto.cycleId, 'cycle-1');
  assert.equal(dto.currentLeaderPreBidId, 'pre-9');
  assertNoPrivateLeak(JSON.stringify(dto), 'live plot');
});

test('LIVE plot keeps tenant brand independent of the open auction', () => {
  const dto = serializePlot(
    plotBase({
      status: 'LIVE',
      currentCycleId: 'cycle-1',
      currentLeaderPreBidId: 'pre-9',
      currentCycle: liveCycle(),
      tenantPreBidId: 'pre-2',
      tenantCompanyName: 'OldWinner',
    }),
  );
  assert.equal(dto.tenant?.companyName, 'OldWinner');
  assert.equal(dto.currentLeaderPreBidId, 'pre-9');
});

test('bid tick serializes exactly id/amount/isProxy/createdAt', () => {
  const dto = serializeBidTick({
    id: 'bid-1',
    amountCents: 600,
    isProxy: true,
    createdAt: new Date('2026-09-03T12:00:00.000Z'),
    maxBidCents: 5000,
    bidderId: 'nope',
  } as unknown as Parameters<typeof serializeBidTick>[0]);
  assert.deepEqual(dto, {
    id: 'bid-1',
    amountCents: 600,
    isProxy: true,
    createdAt: '2026-09-03T12:00:00.000Z',
  });
  assertNoPrivateLeak(JSON.stringify(dto), 'bid tick');
});
