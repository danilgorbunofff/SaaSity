import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCaptureCascade, CaptureFailureError } from '../../src/server/auction/finalize';
import { secondPriceFor } from '../../src/server/auction/engine';
import { makeMemoryAttemptStore } from './attempt-store-fake';

type Cand = {
  id: string;
  bidderId: string;
  maxBidCents: number;
  companyName: string;
  tagline: string | null;
  targetUrl: string;
  twitterHandle: string;
  mrrText: string | null;
  stripePaymentIntentId: string | null;
};

function cand(id: string, maxBidCents: number): Cand {
  return {
    id,
    bidderId: `bidder-${id}`,
    maxBidCents,
    companyName: `Co ${id}`,
    tagline: null,
    targetUrl: `https://${id}.example.com`,
    twitterHandle: `${id}`,
    mrrText: null,
    stripePaymentIntentId: `pi_${id}`,
  };
}

const FLOOR = 100;
const INCREMENT = 50;

// Same math the worker wires in — shared secondPriceFor from the engine.
function priceFor(candidate: Cand, remaining: Cand[]): number {
  const highestOther =
    remaining.length === 0 ? null : Math.max(...remaining.map((r) => r.maxBidCents));
  return secondPriceFor(candidate.maxBidCents, highestOther, FLOOR, INCREMENT);
}

interface Harness {
  captured: Array<{ id: string; amount: number }>;
  cancelled: string[];
  lost: Array<{ id: string; reason: string }>;
  failCapture: Set<string>;
  failCancel: Set<string>;
  failCaptureRetryable: Set<string>;
  store: ReturnType<typeof makeMemoryAttemptStore>;
}

function makeHarness(): Harness {
  return {
    captured: [],
    cancelled: [],
    lost: [],
    failCapture: new Set(),
    failCancel: new Set(),
    failCaptureRetryable: new Set(),
    store: makeMemoryAttemptStore(),
  };
}

function runCascade(candidates: Cand[], h: Harness) {
  return runCaptureCascade({
    cycleId: 'test-cycle',
    candidates,
    computeRemainingPrice: (c, remaining) => priceFor(c, remaining as Cand[]),
    capture: async (pb, amountCents) => {
      if (h.failCaptureRetryable.has(pb.id)) {
        throw new CaptureFailureError(pb.id, 'injected-transport', true);
      }
      // Definitive card decline (plain harness failures are declines — an
      // UNKNOWN error would abort the pass instead of falling through).
      if (h.failCapture.has(pb.id)) throw new CaptureFailureError(pb.id, 'injected-decline', false);
      h.captured.push({ id: pb.id, amount: amountCents });
      return amountCents;
    },
    cancel: async (pb) => {
      if (h.failCancel.has(pb.id)) throw new Error(`injected cancel failure for ${pb.id}`);
      h.cancelled.push(pb.id);
    },
    markLost: async (preBidId, reason) => {
      h.lost.push({ id: preBidId, reason });
    },
    store: h.store,
  });
}

test('cascade: best candidate wins at second price, others released', async () => {
  const h = makeHarness();
  const a = cand('a', 1000);
  const b = cand('b', 800);
  const outcome = await runCascade([a, b], h);

  assert.equal(outcome.winnerPreBidId, 'a');
  // min(1000, 800 + 50)
  assert.equal(outcome.clearingPriceCents, 850);
  assert.deepEqual(h.captured, [{ id: 'a', amount: 850 }]);
  assert.deepEqual(h.cancelled, ['b']);
  assert.equal(h.lost.length, 0);
  assert.deepEqual(outcome.captureFailedPreBidIds, []);
  assert.deepEqual(outcome.releasedPreBidIds, ['b']);
});

test('cascade: single candidate pays the floor', async () => {
  const h = makeHarness();
  const outcome = await runCascade([cand('solo', 9000)], h);

  assert.equal(outcome.winnerPreBidId, 'solo');
  assert.equal(outcome.clearingPriceCents, FLOOR);
  assert.deepEqual(h.captured, [{ id: 'solo', amount: FLOOR }]);
});

test('cascade: capture failure falls through to next candidate, re-priced', async () => {
  const h = makeHarness();
  h.failCapture.add('a');
  const a = cand('a', 2000);
  const b = cand('b', 1500);
  const c = cand('c', 1200);
  const outcome = await runCascade([a, b, c], h);

  assert.equal(outcome.winnerPreBidId, 'b');
  // b wins over {c}: min(1500, 1200 + 50)
  assert.equal(outcome.clearingPriceCents, 1250);
  assert.deepEqual(h.captured, [{ id: 'b', amount: 1250 }]);
  assert.deepEqual(h.lost, [{ id: 'a', reason: 'capture_failed' }]);
  assert.deepEqual(outcome.captureFailedPreBidIds, ['a']);
  // a is out of the running; c loses the cascade and is released
  assert.deepEqual(h.cancelled, ['c']);
  assert.deepEqual(outcome.releasedPreBidIds, ['c']);
});

test('cascade: all captures fail -> no winner, everyone marked lost', async () => {
  const h = makeHarness();
  h.failCapture.add('a').add('b');
  const outcome = await runCascade([cand('a', 1000), cand('b', 900)], h);

  assert.equal(outcome.winnerPreBidId, null);
  assert.equal(outcome.clearingPriceCents, null);
  assert.equal(h.captured.length, 0);
  assert.deepEqual(
    h.lost.map((l) => l.id).sort(),
    ['a', 'b'],
  );
  for (const l of h.lost) assert.equal(l.reason, 'capture_failed');
  assert.deepEqual(h.cancelled, []);
});

test('cascade: release (cancel) failure never blocks resolution', async () => {
  const h = makeHarness();
  h.failCancel.add('b');
  const outcome = await runCascade([cand('a', 1000), cand('b', 800)], h);

  assert.equal(outcome.winnerPreBidId, 'a');
  assert.equal(outcome.clearingPriceCents, 850);
  assert.deepEqual(h.cancelled, []); // b's cancel threw
  assert.deepEqual(outcome.releasedPreBidIds, []); // not counted as released
  assert.equal(h.lost.length, 0); // and it must NOT be marked lost either
  // ...but the failed release persists for sweep retry instead of vanishing.
  assert.deepEqual(outcome.releaseFailedPreBidIds, ['b']);
  assert.equal(
    h.store.rows.filter((r) => r.kind === 'RELEASE' && r.status === 'RELEASE_FAILED').length,
    1,
  );
});

test('cascade: unknown capture errors abort the pass (no fallback on uncertain money)', async () => {
  const h = makeHarness();
  const outcome = await runCaptureCascade({
    cycleId: 'test-cycle',
    candidates: [cand('a', 2000), cand('b', 1500)],
    computeRemainingPrice: (c, remaining) => priceFor(c, remaining as Cand[]),
    capture: async () => {
      throw new Error('mystery transport explosion');
    },
    cancel: async (pb) => {
      h.cancelled.push(pb.id);
    },
    markLost: async (preBidId, reason) => {
      h.lost.push({ id: preBidId, reason });
    },
    store: h.store,
  });

  assert.equal(outcome.aborted, true);
  assert.equal(outcome.winnerPreBidId, null);
  assert.equal(h.lost.length, 0); // no fallback selected, nobody marked lost
  assert.deepEqual(h.cancelled, []); // no releases without a winner
  assert.deepEqual(
    h.store.rows.map((r) => r.status),
    ['FAILED_RETRYABLE'],
  );
});

test('cascade: retryable failure aborts without touching later candidates', async () => {
  const h = makeHarness();
  h.failCaptureRetryable.add('a');
  const outcome = await runCascade([cand('a', 2000), cand('b', 1500)], h);

  assert.equal(outcome.aborted, true);
  assert.equal(outcome.winnerPreBidId, null);
  assert.equal(h.captured.length, 0); // b never attempted
  assert.equal(h.lost.length, 0);
});

test('cascade: already-captured key is success without a new Stripe call', async () => {
  const h = makeHarness();
  const a = cand('a', 1000);
  const b = cand('b', 800);
  // A previous pass charged a at 850 but crashed before recording the win.
  const key = 'saasity:v1:capture:test-cycle:a:850';
  const pending = await h.store.createPending({
    cycleId: 'test-cycle',
    preBidId: 'a',
    kind: 'CAPTURE',
    amountCents: 850,
    idempotencyKey: key,
  });
  await h.store.markAttempt(pending.id, { status: 'CAPTURED' });

  const outcome = await runCascade([a, b], h);

  assert.equal(outcome.winnerPreBidId, 'a');
  assert.equal(outcome.clearingPriceCents, 850);
  assert.deepEqual(h.captured, []); // adopted — Stripe never called again
  assert.deepEqual(outcome.releasedPreBidIds, ['b']);
});

test('cascade: every candidate pays at least the floor', async () => {
  // Second price below floor clamps up: leader 300 vs other 100 -> 150 > 100.
  assert.equal(secondPriceFor(300, 100, FLOOR, INCREMENT), 150);
  assert.equal(secondPriceFor(90, null, FLOOR, INCREMENT), FLOOR);
  assert.equal(secondPriceFor(5000, 4000, FLOOR, INCREMENT), 4050);
});
