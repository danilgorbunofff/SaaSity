/**
 * Phase 2.5 — the mock-money kill switch.
 *
 * The whole point: a deployment that has NOT opted into `MOCK_PAYMENTS=1`
 * must never crown a winner nobody paid for. Without the flag every
 * settlement stub throws, so the capture cascade degrades to "no winner"
 * instead of faking a successful charge.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runCaptureCascade,
  capturePreBidAuthorization,
  cancelPreBidAuthorization,
  authorizePreBidAtAttach,
  type CandidateRow,
} from '../../src/server/auction/finalize';
import { isMockPaymentsEnabled, MockPaymentsDisabledError } from '../../src/server/mock-payments';

function candidate(id: string, maxBidCents: number): CandidateRow {
  return {
    id,
    bidderId: `bidder-${id}`,
    maxBidCents,
    companyName: `Company ${id}`,
    tagline: null,
    targetUrl: `https://${id}.example.com`,
    twitterHandle: `@${id}`,
    mrrText: null,
    stripePaymentIntentId: null,
  };
}

const CANDIDATES = [candidate('a', 5000), candidate('b', 3000), candidate('c', 1000)];

async function cascade(): Promise<{
  winnerPreBidId: string | null;
  clearingPriceCents: number | null;
  captureFailedPreBidIds: string[];
}> {
  const failed: string[] = [];
  return runCaptureCascade({
    candidates: CANDIDATES,
    computeRemainingPrice: (c, remaining) => {
      const highestOther = remaining.reduce((m, r) => Math.max(m, r.maxBidCents), 0);
      return Math.max(500, Math.min(c.maxBidCents, highestOther + 100));
    },
    capture: (row, amountCents) => capturePreBidAuthorization(row, amountCents),
    cancel: (row) => cancelPreBidAuthorization(row),
    markLost: async (id) => {
      failed.push(id);
    },
  }).then((outcome) => ({
    winnerPreBidId: outcome.winnerPreBidId,
    clearingPriceCents: outcome.clearingPriceCents,
    captureFailedPreBidIds: failed,
  }));
}

test('MOCK_PAYMENTS off: no settlement is faked', async () => {
  const previous = process.env.MOCK_PAYMENTS;
  delete process.env.MOCK_PAYMENTS;
  try {
    assert.equal(isMockPaymentsEnabled(), false);
    await assert.rejects(() => capturePreBidAuthorization(CANDIDATES[0], 3100), MockPaymentsDisabledError);
    await assert.rejects(() => cancelPreBidAuthorization(CANDIDATES[0]), MockPaymentsDisabledError);
    await assert.rejects(() => authorizePreBidAtAttach(CANDIDATES[0]), MockPaymentsDisabledError);
  } finally {
    if (previous === undefined) delete process.env.MOCK_PAYMENTS;
    else process.env.MOCK_PAYMENTS = previous;
  }
});

test('MOCK_PAYMENTS off: the cascade yields NO winner (never an unpaid tenant)', async () => {
  const previous = process.env.MOCK_PAYMENTS;
  delete process.env.MOCK_PAYMENTS;
  try {
    const outcome = await cascade();
    assert.equal(outcome.winnerPreBidId, null, 'a failed capture must never produce a winner');
    assert.equal(outcome.clearingPriceCents, null);
    assert.deepEqual(outcome.captureFailedPreBidIds, ['a', 'b', 'c']);
  } finally {
    if (previous === undefined) delete process.env.MOCK_PAYMENTS;
    else process.env.MOCK_PAYMENTS = previous;
  }
});

test('MOCK_PAYMENTS=1: stubs settle at second price', async () => {
  const previous = process.env.MOCK_PAYMENTS;
  process.env.MOCK_PAYMENTS = '1';
  try {
    assert.equal(isMockPaymentsEnabled(), true);
    assert.equal(await capturePreBidAuthorization(CANDIDATES[0], 3100), 3100);
    await assert.doesNotReject(() => cancelPreBidAuthorization(CANDIDATES[0]));
    await assert.doesNotReject(() => authorizePreBidAtAttach(CANDIDATES[0]));

    const outcome = await cascade();
    assert.equal(outcome.winnerPreBidId, 'a');
    assert.equal(outcome.clearingPriceCents, 3100, 'second price: 3000 + increment 100');
    assert.deepEqual(outcome.captureFailedPreBidIds, [], 'nothing failed with the flag on');
  } finally {
    if (previous === undefined) delete process.env.MOCK_PAYMENTS;
    else process.env.MOCK_PAYMENTS = previous;
  }
});
