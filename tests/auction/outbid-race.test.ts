/**
 * Part 6 `outbid-retry` — race test with two near-simultaneous bidders.
 *
 * Headless scope: the DB serialization (pg advisory lock) is Part 2's
 * tested territory. What Part 6 owns is the contract across the race:
 * engine second-price math -> route 409 minimum -> client retry form.
 * This test pins that chain end to end with pure engine math plus a
 * stubbed 409: whatever order A(800) and B(1200) land in, the resolution
 * is identical, and the loser's retry minimum equals engine price +
 * increment exactly — never a stale client-computed number.
 */
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { computeResolution, type ActivePreBidRow } from '../../src/server/auction/engine';
import { submitBid } from '../../src/lib/bid/submit-bid';

const FLOOR = 500; // MID tier
const INC = 100;

function row(id: string, maxBidCents: number, atMs: number): ActivePreBidRow {
  return {
    id,
    bidderId: `bidder-${id}`,
    maxBidCents,
    createdAt: new Date(1_700_000_000_000 + atMs),
    companyName: `Co ${id}`,
    tagline: null,
    targetUrl: `https://${id}.test`,
    twitterHandle: id,
    mrrText: null,
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

test('simultaneous bids resolve identically regardless of arrival order', () => {
  const aFirst = computeResolution([row('a', 800, 0), row('b', 1200, 1)], FLOOR, INC);
  const bFirst = computeResolution([row('b', 1200, 0), row('a', 800, 1)], FLOOR, INC);
  assert.deepEqual(aFirst, bFirst);
  assert.equal(aFirst?.leaderBidderId, 'bidder-b');
  // Second-price: min(1200, 800 + 100).
  assert.equal(aFirst?.priceCents, 900);
});

test('loser retry minimum equals engine price + increment through submitBid', async () => {
  const resolution = computeResolution([row('a', 800, 0), row('b', 1200, 1)], FLOOR, INC);
  assert.ok(resolution);
  // Route formula (bid/route.ts): minimumNext = currentPrice + increment.
  const serverMinimum = resolution.priceCents + INC;
  assert.equal(serverMinimum, 1000);

  // A's stale in-flight bid (850, typed before B landed) loses with 409.
  stubFetch(409, {
    code: 'outbid',
    error: 'Bid below the current minimum',
    minimumNextBidCents: serverMinimum,
    currentPriceCents: resolution.priceCents,
  });
  const r = await submitBid({
    plotId: 'mid-01',
    mode: 'bid',
    values: {
      plotId: 'mid-01',
      companyName: 'Co a',
      targetUrl: 'https://a.test',
      twitterHandle: 'a',
      maxBidCents: 850,
    },
  });
  assert.equal(r.kind, 'outbid');
  assert.equal(r.kind === 'outbid' && r.minimumNextBidCents, serverMinimum);
});
