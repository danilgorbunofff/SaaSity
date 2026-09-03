/**
 * Part 3 (cron-not-configured) — the staleness alert is a pure function of
 * ended-cycle end-times, so the alert line is pinned by unit tests, not by
 * waiting for a real outage.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staleCyclesSummary } from '../../src/server/auction/worker';
import { STALE_ENDED_CYCLE_ALERT_MINUTES } from '../../src/lib/tiers';

const MIN = 60_000;
const NOW = 1_786_000_000_000;

test('no ended cycles: nothing stale', () => {
  assert.deepEqual(staleCyclesSummary([], NOW), { staleCount: 0, maxStaleMs: 0 });
});

test('recently ended cycles (one tick missed): observed, not stale', () => {
  const out = staleCyclesSummary([NOW - 5 * MIN, NOW - 60_000], NOW);
  assert.equal(out.staleCount, 0);
  assert.equal(out.maxStaleMs, 5 * MIN);
});

test('cycles past the alert line count as stale', () => {
  const out = staleCyclesSummary(
    [NOW - (STALE_ENDED_CYCLE_ALERT_MINUTES + 1) * MIN, NOW - 2 * MIN, NOW - 30 * MIN],
    NOW,
  );
  assert.equal(out.staleCount, 2);
  assert.equal(out.maxStaleMs, 30 * MIN);
});

test('exactly on the alert line is not stale (strictly-greater)', () => {
  const out = staleCyclesSummary([NOW - STALE_ENDED_CYCLE_ALERT_MINUTES * MIN], NOW);
  assert.equal(out.staleCount, 0);
  assert.equal(out.maxStaleMs, STALE_ENDED_CYCLE_ALERT_MINUTES * MIN);
});

test('future end-times (clock skew) never count', () => {
  const out = staleCyclesSummary([NOW + MIN], NOW);
  assert.deepEqual(out, { staleCount: 0, maxStaleMs: 0 });
});
