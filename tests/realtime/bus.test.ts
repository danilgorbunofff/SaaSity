/**
 * Phase 2.4 — in-process bus tests: fan-out, unsubscribe (no leak), emit
 * helpers publish exactly the public spec shape (no maxBidCents anywhere;
 * Part 1 lifecycle fix: no auction-leader brand and no bidderId anywhere —
 * only a confirmed, paid tenant's brand, on cycle:resolved).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  subscribe,
  publish,
  setRealtimeSink,
  eventKeyOf,
  emitBidPlaced,
  emitCycleExtended,
  emitCycleResolved,
  type RealtimeEvent,
} from '../../src/server/realtime/bus';

const BRAND = {
  companyName: 'Acme',
  tagline: 'Ship fast',
  twitterHandle: 'acme',
  mrrText: '$12k MRR',
  logoUrl: null,
  logoHidden: false,
  targetUrl: 'https://acme.test',
};

test('publish fans out to every subscriber', () => {
  const seenA: RealtimeEvent[] = [];
  const seenB: RealtimeEvent[] = [];
  const unsubA = subscribe((ev) => seenA.push(ev));
  const unsubB = subscribe((ev) => seenB.push(ev));

  publish({
    type: 'bid:placed',
    plotId: 'A1',
    cycleId: 'c1',
    currentPriceCents: 500,
    leaderPreBidId: 'pb1',
    endAt: new Date().toISOString(),
    winner: null,
    clearingPriceCents: null,
    nextCycle: null,
  });

  assert.equal(seenA.length, 1);
  assert.equal(seenB.length, 1);
  assert.equal(seenA[0].plotId, 'A1');
  assert.equal(seenB[0].plotId, 'A1');

  unsubA();
  unsubB();
});

test('unsubscribed listener stops receiving; failed listener is dropped without breaking others', () => {
  const dead: string[] = [];
  const alive: string[] = [];

  const unsubDead = subscribe(() => {
    dead.push('x');
    throw new Error('listener blew up');
  });
  const unsubAlive = subscribe((ev) => alive.push(ev.plotId));

  publish({
    type: 'cycle:extended',
    plotId: 'B2',
    cycleId: 'c2',
    currentPriceCents: null,
    leaderPreBidId: null,
    endAt: new Date().toISOString(),
    winner: null,
    clearingPriceCents: null,
    nextCycle: null,
  });

  assert.deepEqual(dead, ['x']); // ran once, then dropped
  assert.deepEqual(alive, ['B2']);

  unsubDead(); // double-unsubscribe is safe
  unsubDead();
  unsubAlive();

  publish({
    type: 'cycle:extended',
    plotId: 'B3',
    cycleId: 'c3',
    currentPriceCents: null,
    leaderPreBidId: null,
    endAt: new Date().toISOString(),
    winner: null,
    clearingPriceCents: null,
    nextCycle: null,
  });
  assert.deepEqual(dead, ['x']); // no further calls — no leak
  assert.deepEqual(alive, ['B2']);
});

test('emitBidPlaced publishes public bid shape (no maxBidCents, no brand, leaderPreBidId exposed)', () => {
  const seen: RealtimeEvent[] = [];
  const unsub = subscribe((ev) => seen.push(ev));

  emitBidPlaced({
    plotId: 'C3',
    cycleId: 'c9',
    currentPriceCents: 1500,
    leaderPreBidId: 'pb-42',
    isProxy: true,
    endAt: '2026-01-01T00:00:00.000Z',
  });

  assert.equal(seen.length, 1);
  const ev = seen[0];
  assert.equal(ev.type, 'bid:placed');
  assert.equal(ev.isProxy, true);
  assert.equal(ev.currentPriceCents, 1500);
  assert.equal(ev.leaderPreBidId, 'pb-42');
  assert.equal(ev.winner, null);
  // Part 1 lifecycle fix: the provisional leader of an open auction has not
  // won or paid anything — no brand may ever accompany bid:placed.
  assert.equal('leader' in ev, false);
  assert.equal('tenant' in ev, false);
  // Privacy: no private bid data may leak into the payload.
  assert.equal('maxBidCents' in ev, false);
  assert.equal(JSON.stringify(ev).includes('maxBidCents'), false);
  assert.equal(JSON.stringify(ev).includes('companyName'), false);

  unsub();
});

test('emitCycleExtended publishes only plot/cycle/endAt', () => {
  const seen: RealtimeEvent[] = [];
  const unsub = subscribe((ev) => seen.push(ev));

  emitCycleExtended({ plotId: 'D4', cycleId: 'c10', endAt: '2026-01-01T00:10:00.000Z' });

  assert.equal(seen.length, 1);
  const ev = seen[0];
  assert.equal(ev.type, 'cycle:extended');
  assert.equal(ev.endAt, '2026-01-01T00:10:00.000Z');
  assert.equal(ev.currentPriceCents, null);
  assert.equal(ev.winner, null);
  assert.equal(ev.nextCycle, null);

  unsub();
});

test('emitCycleResolved carries winner preBidId + tenant brand + next cycle, or both null (IDLE) — never a bidderId', () => {
  const seen: RealtimeEvent[] = [];
  const unsub = subscribe((ev) => seen.push(ev));

  emitCycleResolved({
    plotId: 'E5',
    cycleId: 'c11',
    winner: {
      preBidId: 'pb-winner-1',
      brand: {
        companyName: 'Acme',
        tagline: 'Ship fast',
        targetUrl: 'https://acme.test',
        twitterHandle: 'acme',
        mrrText: '$12k MRR',
      },
    },
    clearingPriceCents: 2000,
    nextCycle: {
      cycleId: 'c12',
      endAt: '2026-01-02T00:00:00.000Z',
      openingPriceCents: 2500,
      currentPriceCents: 2500,
      leaderPreBidId: 'pb-queued-7',
    },
  });

  assert.equal(seen.length, 1);
  const ev = seen[0];
  assert.equal(ev.type, 'cycle:resolved');
  assert.equal(ev.winner?.preBidId, 'pb-winner-1');
  assert.deepEqual(ev.winner?.brand, BRAND);
  assert.equal(ev.clearingPriceCents, 2000);
  // Part 4 `next-cycle-realtime-state`: the COMPLETE next-cycle public
  // snapshot rides along — leader pointer + price, never a leader brand.
  assert.deepEqual(ev.nextCycle, {
    cycleId: 'c12',
    endAt: '2026-01-02T00:00:00.000Z',
    openingPriceCents: 2500,
    currentPriceCents: 2500,
    leaderPreBidId: 'pb-queued-7',
  });
  // Part 4 `public-bidder-id` fix: an anonymous bidder identifier must
  // never be broadcast to every connected client.
  assert.equal('bidderId' in (ev.winner ?? {}), false);
  assert.equal(JSON.stringify(ev).includes('bidderId'), false);

  // Empty-resolution (IDLE) path.
  emitCycleResolved({
    plotId: 'E5',
    cycleId: 'c13',
    winner: null,
    clearingPriceCents: null,
    nextCycle: null,
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].winner, null);
  assert.equal(seen[1].nextCycle, null);

  unsub();
});

test('eventKeyOf: same logical occurrence shares a key across local + outbox copies; distinct occurrences differ', () => {
  const base = {
    type: 'bid:placed' as const,
    cycleId: 'c1',
    currentPriceCents: 500,
    leaderPreBidId: 'pb1',
    endAt: '2026-01-01T00:00:00.000Z',
    clearingPriceCents: null,
  };
  // Key stability: identical fields → identical key (redelivery dedupes).
  assert.equal(eventKeyOf(base), eventKeyOf({ ...base }));
  // Any field change → different key (a new bid/price/leader is new news).
  assert.notEqual(eventKeyOf(base), eventKeyOf({ ...base, currentPriceCents: 600 }));
  assert.notEqual(eventKeyOf(base), eventKeyOf({ ...base, leaderPreBidId: 'pb2' }));
  assert.notEqual(eventKeyOf(base), eventKeyOf({ ...base, cycleId: 'c2' }));
  // Per-type namespaces never collide.
  assert.notEqual(
    eventKeyOf({
      type: 'cycle:extended',
      cycleId: 'c1',
      currentPriceCents: null,
      leaderPreBidId: null,
      endAt: '2026-01-01T00:00:00.000Z',
      clearingPriceCents: null,
    }),
    eventKeyOf({ ...base }),
  );
  // Resolutions key off the resolved cycle: reconcile replays reuse it.
  const res = {
    type: 'cycle:resolved' as const,
    cycleId: 'c9',
    currentPriceCents: null,
    leaderPreBidId: null,
    endAt: null,
    clearingPriceCents: 3100,
  };
  assert.equal(eventKeyOf(res), eventKeyOf({ ...res }));
  assert.notEqual(eventKeyOf(res), eventKeyOf({ ...res, cycleId: 'c10' }));
});

test('durable sink receives every publish; a throwing sink never breaks local delivery', () => {
  const local: RealtimeEvent[] = [];
  const sunk: RealtimeEvent[] = [];
  const unsub = subscribe((ev) => local.push(ev));
  setRealtimeSink((ev) => sunk.push(ev));
  try {
    emitCycleExtended({ plotId: 'F6', cycleId: 'c20', endAt: '2026-01-01T00:10:00.000Z' });
    assert.equal(local.length, 1);
    assert.equal(sunk.length, 1);
    assert.equal(sunk[0].plotId, 'F6');

    // A failing sink is isolated: local subscribers still get the event.
    setRealtimeSink(() => {
      throw new Error('outbox down');
    });
    emitCycleExtended({ plotId: 'F7', cycleId: 'c21', endAt: '2026-01-01T00:11:00.000Z' });
    assert.equal(local.length, 2);
    assert.equal(local[1].plotId, 'F7');
  } finally {
    // Unit tests run WITHOUT the sink — restore purity for other files.
    setRealtimeSink(null);
    unsub();
  }
});
