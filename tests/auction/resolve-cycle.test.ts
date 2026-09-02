/**
 * Phase 2.2 — pure second-price resolution math tests (no DB).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeResolution, type ActivePreBidRow } from '../../src/server/auction/engine';

function row(
  id: string,
  maxBidCents: number,
  createdAtOffsetMs: number = 0,
  bidderId: string = `bidder-${id}`,
): ActivePreBidRow {
  return {
    id,
    bidderId,
    maxBidCents,
    createdAt: new Date(1_700_000_000_000 + createdAtOffsetMs),
    companyName: `Co ${id}`,
    tagline: null,
    targetUrl: `https://${id}.test`,
    twitterHandle: id,
    mrrText: null,
  };
}

const FLOOR = 100;
const INC = 50;

test('empty pre-bids resolve to null', () => {
  assert.equal(computeResolution([], FLOOR, INC), null);
});

test('single bidder pays the floor', () => {
  const r = computeResolution([row('a', 10_000)], FLOOR, INC);
  assert.ok(r);
  assert.equal(r.leaderPreBidId, 'a');
  assert.equal(r.priceCents, FLOOR);
});

test('two bidders: price = second + increment', () => {
  const r = computeResolution([row('a', 1000), row('b', 500)], FLOOR, INC);
  assert.ok(r);
  assert.equal(r.leaderPreBidId, 'a');
  assert.equal(r.priceCents, 550);
});

test('leader max caps the price (leader never pays own max)', () => {
  const r = computeResolution([row('a', 520), row('b', 500)], FLOOR, INC);
  assert.ok(r);
  assert.equal(r.priceCents, 520); // min(520, 500+50)
});

test('price never drops below the floor even with tiny maxes', () => {
  const r = computeResolution([row('a', 101), row('b', 100)], FLOOR, INC);
  assert.ok(r);
  assert.equal(r.leaderPreBidId, 'a');
  assert.equal(r.priceCents, 101); // min(101, 150) = 101 >= floor, no clamp
});

test('floor clamp applies when second+increment < floor', () => {
  const r = computeResolution([row('a', 5000), row('b', 10)], FLOOR, INC);
  assert.ok(r);
  assert.equal(r.priceCents, FLOOR);
});

test('ties on maxBid break by earliest createdAt', () => {
  const r = computeResolution([row('late', 1000, 5_000), row('early', 1000, 0)], FLOOR, INC);
  assert.ok(r);
  assert.equal(r.leaderPreBidId, 'early');
  assert.equal(r.priceCents, 1000); // min(1000, 1000+50)
});

test('three bidders: price keyed off the second-highest only', () => {
  const r = computeResolution([row('a', 2000), row('b', 800), row('c', 100)], FLOOR, INC);
  assert.ok(r);
  assert.equal(r.leaderPreBidId, 'a');
  assert.equal(r.priceCents, 850); // min(2000, 800+50); c irrelevant
});

test('brand snapshot comes from the leader row', () => {
  const r = computeResolution([row('a', 1000), row('b', 900)], FLOOR, INC);
  assert.ok(r);
  assert.equal(r.brand.companyName, 'Co a');
  assert.equal(r.brand.targetUrl, 'https://a.test');
  assert.equal(r.brand.twitterHandle, 'a');
});
