/**
 * Part 6 `mrr-copy` — one display convention, card == billboard.
 * Storage is raw user text (`$12k` or `$12k MRR` both in the wild); display
 * appends ` MRR` only when missing so `$12k MRR MRR` can never render.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMrrBadge } from '../../src/lib/tiers';

test('appends MRR only when missing', () => {
  assert.equal(formatMrrBadge('$12k'), '$12k MRR');
  assert.equal(formatMrrBadge('$12k MRR'), '$12k MRR');
  assert.equal(formatMrrBadge('$12k mrr'), '$12k mrr');
});

test('blank and nullish inputs render nothing', () => {
  assert.equal(formatMrrBadge(null), null);
  assert.equal(formatMrrBadge(undefined), null);
  assert.equal(formatMrrBadge(''), null);
  assert.equal(formatMrrBadge('   '), null);
});
