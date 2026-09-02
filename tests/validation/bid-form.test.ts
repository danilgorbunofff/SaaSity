/**
 * Phase 2.1 — validation contract tests. These run against the SAME module
 * the client modal and server routes import, proving one-contract behavior.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateBidForm,
  minimumBidCents,
  normalizeTwitterHandle,
  normalizeTargetUrl,
  type BidFormInput,
} from '../../src/lib/validation/bid-form';

function input(overrides: Partial<BidFormInput> = {}): BidFormInput {
  return {
    plotId: 'mid-01',
    companyName: 'CodeShip',
    tagline: 'Ship faster',
    targetUrl: 'https://codeship.dev',
    twitterHandle: '@codeship',
    mrrText: '$12k MRR',
    maxBidCents: 500,
    ...overrides,
  };
}

const claimCtx = { mode: 'claim' as const, tier: 'MID' as const };

test('valid claim passes and normalizes handle + url', () => {
  const r = validateBidForm(input(), claimCtx);
  assert.equal(r.ok, true);
  assert.ok(r.values);
  assert.equal(r.values.twitterHandle, 'codeship');
  assert.equal(r.values.targetUrl, 'https://codeship.dev');
  assert.equal(r.values.companyName, 'CodeShip');
  assert.equal(r.values.maxBidCents, 500);});

test('contextual minimums: claim = floor, bid = price + increment, prebid = floor', () => {
  assert.equal(minimumBidCents('claim', 'OUTER'), 100);
  assert.equal(minimumBidCents('prebid', 'CORE'), 2500);
  assert.equal(minimumBidCents('bid', 'MID', 700), 800);
  // bid with no price known falls back to floor + increment
  assert.equal(minimumBidCents('bid', 'MID'), 600);
});

test('maxBidCents below contextual minimum is rejected with the minimum echoed', () => {
  const r = validateBidForm(input({ maxBidCents: 499 }), {
    mode: 'bid',
    tier: 'MID',
    currentPriceCents: 500,
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.maxBidCents ?? '', /6\.00/);
});

test('prebid minimum is the tier floor, not last cycle price', () => {
  const r = validateBidForm(input({ maxBidCents: 500 }), {
    mode: 'prebid',
    tier: 'MID',
    currentPriceCents: 99999,
  });
  assert.equal(r.ok, true);
});

test('companyName bounds: empty, whitespace, 49 chars', () => {
  assert.equal(validateBidForm(input({ companyName: '' }), claimCtx).ok, false);
  assert.equal(validateBidForm(input({ companyName: '   ' }), claimCtx).ok, false);
  assert.equal(validateBidForm(input({ companyName: 'a'.repeat(49) }), claimCtx).ok, false);
  assert.equal(validateBidForm(input({ companyName: 'a'.repeat(48) }), claimCtx).ok, true);
});

test('tagline max 80, mrrText max 20, both optional', () => {
  assert.equal(validateBidForm(input({ tagline: 't'.repeat(81) }), claimCtx).ok, false);
  assert.equal(validateBidForm(input({ mrrText: 'm'.repeat(21) }), claimCtx).ok, false);
  const r = validateBidForm(input({ tagline: undefined, mrrText: undefined }), claimCtx);
  assert.equal(r.ok, true);
});

test('twitter: strips @, rejects long, punctuation, and spaces', () => {
  assert.equal(normalizeTwitterHandle('@@acme_1'), 'acme_1');
  assert.equal(normalizeTwitterHandle('a'.repeat(16)), null);
  assert.equal(normalizeTwitterHandle('not ok'), null);
  assert.equal(normalizeTwitterHandle('dr.Strange'), null);
});

test('hostile targetUrls are rejected', () => {
  for (const bad of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
  ]) {
    const r = normalizeTargetUrl(bad);
    assert.equal(r.ok, false, `must reject ${bad}`);
  }
});

test('localhost / private / stripe / self hosts rejected', () => {
  assert.equal(normalizeTargetUrl('http://localhost:3000/x').ok, false);
  assert.equal(normalizeTargetUrl('https://127.0.0.1').ok, false);
  assert.equal(normalizeTargetUrl('https://app.internal').ok, false);
  assert.equal(normalizeTargetUrl('https://dashboard.stripe.com').ok, false);
  assert.equal(normalizeTargetUrl('https://saasity.example', ['saasity.example']).ok, false);
  assert.equal(normalizeTargetUrl('https://x.saasity.example', ['saasity.example']).ok, false);
});

test('targetUrl normalization: scheme added, http upgraded, hash dropped, slash trimmed', () => {
  const r = normalizeTargetUrl('codeship.dev/pricing/#seg');
  assert.equal(r.ok, true);
  assert.equal(r.value, 'https://codeship.dev/pricing');
  const http = normalizeTargetUrl('http://codeship.dev');
  assert.equal(http.value, 'https://codeship.dev');
  const root = normalizeTargetUrl('https://codeship.dev/');
  assert.equal(root.value, 'https://codeship.dev');
});

test('maxBidCents must be a positive integer', () => {
  assert.equal(validateBidForm(input({ maxBidCents: 0 }), claimCtx).ok, false);
  assert.equal(validateBidForm(input({ maxBidCents: -5 }), claimCtx).ok, false);
  assert.equal(validateBidForm(input({ maxBidCents: 1.5 }), claimCtx).ok, false);
});

test('plotId required', () => {
  assert.equal(validateBidForm(input({ plotId: '  ' }), claimCtx).ok, false);
});

test('multiple bad fields report all errors at once', () => {
  const r = validateBidForm(
    input({ companyName: '', twitterHandle: '!!', targetUrl: 'javascript:x', maxBidCents: 1 }),
    claimCtx,
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.companyName);
  assert.ok(r.errors.twitterHandle);
  assert.ok(r.errors.targetUrl);
  assert.ok(r.errors.maxBidCents);
});