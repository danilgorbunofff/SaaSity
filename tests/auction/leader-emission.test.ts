/**
 * P0-3 regression — `bid:placed.leaderPreBidId` must name the ACTUAL
 * resolution leader, not the caller.
 *
 * Bug: bid/claim routes emitted `result.preBidId` (caller's row) on the
 * happy path while computing `isLeader` from the resolution. When the
 * caller did not take the lead (e.g. A leads $100 max, B bids $20 above
 * the minimum), the event named B as leader — every live client derived
 * ownership from that id and flipped wrong.
 *
 * The routes now thread `resolution.leaderPreBidId` through the tx result
 * and emit it. This test pins the engine half of that contract (the repro
 * shape) so the emission fix can never silently regress: the leader for
 * this shape MUST be A, and the price MUST be second-price, so any future
 * emission of "caller's id" is observably wrong.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeResolution, type ActivePreBidRow } from '../../src/server/auction/engine';

function row(id: string, bidder: string, maxBidCents: number, atMs: number): ActivePreBidRow {
  return {
    id,
    bidderId: bidder,
    maxBidCents,
    createdAt: new Date(1_700_000_000_000 + atMs),
    companyName: `Co ${id}`,
    tagline: null,
    targetUrl: `https://${id}.test`,
    twitterHandle: id,
    mrrText: null,
  };
}

test('non-taking challenger does not become leader: A($100) vs B($20)', () => {
  const resolution = computeResolution(
    [row('pre-a', 'bidder-a', 10_000, 0), row('pre-b', 'bidder-b', 2_000, 1)],
    500, // floor
    100, // increment
  );
  assert.ok(resolution);
  // Leader stays A; second-price = min(10000, 2000 + 100).
  assert.equal(resolution.leaderPreBidId, 'pre-a');
  assert.equal(resolution.leaderBidderId, 'bidder-a');
  assert.equal(resolution.priceCents, 2_100);
  // The route contract: emit resolution.leaderPreBidId, and
  // isLeader for B's request is false. (Typed as string first so the
  // positive asserts above don't narrow the comparison away.)
  const leader: string = resolution.leaderBidderId;
  assert.equal(leader === 'bidder-b', false);
});

test('claim-path shape: queued survivor out-maxes claimer, survivor leads', () => {
  const resolution = computeResolution(
    [row('pre-claimer', 'bidder-claimer', 1_000, 1), row('pre-queued', 'bidder-q', 5_000, 0)],
    500,
    100,
  );
  assert.ok(resolution);
  assert.equal(resolution.leaderPreBidId, 'pre-queued');
  assert.equal(resolution.leaderBidderId, 'bidder-q');
  const claimerLeader: string = resolution.leaderBidderId;
  assert.equal(claimerLeader === 'bidder-claimer', false);
});
