/**
 * Part 2 remediation — `cookie-no-sliding-refresh`. Covers the anonymous
 * bidder-identity cookie's signing/parsing contract and its bounded sliding
 * refresh: expired, tampered, old-key (rotated secret), and
 * refresh-threshold cases.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  serializeBidderCookie,
  parseBidderCookie,
  payloadAgeSeconds,
  needsRefresh,
  refreshPayload,
  BIDDER_COOKIE_TTL_SECONDS,
  BIDDER_COOKIE_REFRESH_THRESHOLD_SECONDS,
  type BidderPayload,
} from '../../src/server/bidder-cookie';

function withSecret<T>(secret: string, fn: () => T): T {
  const previous = process.env.BIDDER_COOKIE_SECRET;
  process.env.BIDDER_COOKIE_SECRET = secret;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.BIDDER_COOKIE_SECRET;
    else process.env.BIDDER_COOKIE_SECRET = previous;
  }
}

const SECRET_A = 'a'.repeat(32);
const SECRET_B = 'b'.repeat(32);

function payload(overrides: Partial<BidderPayload> = {}): BidderPayload {
  return { v: 1, bidderId: 'bidder-123', issuedAt: Date.now(), ...overrides };
}

test('valid round trip: serialize then parse returns the same payload', () => {
  withSecret(SECRET_A, () => {
    const original = payload({ stripeCustomerId: 'cus_abc' });
    const raw = serializeBidderCookie(original);
    const parsed = parseBidderCookie(raw);
    assert.deepEqual(parsed, original);
  });
});

test('tampered: flipping a byte in the signed body is rejected', () => {
  withSecret(SECRET_A, () => {
    const raw = serializeBidderCookie(payload());
    const dot = raw.lastIndexOf('.');
    const body = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    // Flip the body's last base64url character without touching the signature.
    const lastChar = body.at(-1);
    const swapped = lastChar === 'A' ? 'B' : 'A';
    const tamperedBody = body.slice(0, -1) + swapped;
    assert.equal(parseBidderCookie(`${tamperedBody}.${sig}`), null);
  });
});

test('tampered: missing signature separator is rejected', () => {
  withSecret(SECRET_A, () => {
    assert.equal(parseBidderCookie('not-a-valid-cookie'), null);
  });
});

test('tampered: empty/undefined cookie is rejected', () => {
  withSecret(SECRET_A, () => {
    assert.equal(parseBidderCookie(undefined), null);
    assert.equal(parseBidderCookie(''), null);
  });
});

test('expired: a payload older than the TTL is rejected even with a valid signature', () => {
  withSecret(SECRET_A, () => {
    const stale = payload({ issuedAt: Date.now() - (BIDDER_COOKIE_TTL_SECONDS + 60) * 1000 });
    const raw = serializeBidderCookie(stale);
    assert.equal(parseBidderCookie(raw), null);
  });
});

test('expired: a payload one second inside the TTL still parses', () => {
  withSecret(SECRET_A, () => {
    const almostStale = payload({
      issuedAt: Date.now() - (BIDDER_COOKIE_TTL_SECONDS - 1) * 1000,
    });
    const raw = serializeBidderCookie(almostStale);
    assert.notEqual(parseBidderCookie(raw), null);
  });
});

test('old-key: a cookie signed under a rotated-away secret is rejected, not silently accepted', () => {
  const raw = withSecret(SECRET_A, () => serializeBidderCookie(payload()));
  withSecret(SECRET_B, () => {
    assert.equal(parseBidderCookie(raw), null);
  });
});

test('old-key: the same cookie still parses under the key it was signed with', () => {
  const raw = withSecret(SECRET_A, () => serializeBidderCookie(payload()));
  withSecret(SECRET_A, () => {
    assert.notEqual(parseBidderCookie(raw), null);
  });
});

test('refresh-threshold: a freshly issued payload does not need a refresh', () => {
  assert.equal(needsRefresh(payload({ issuedAt: Date.now() })), false);
});

test('refresh-threshold: a payload just inside the threshold does not need a refresh', () => {
  const now = Date.now();
  const justInside = now - (BIDDER_COOKIE_REFRESH_THRESHOLD_SECONDS - 1) * 1000;
  assert.equal(needsRefresh(payload({ issuedAt: justInside }), now), false);
});

test('refresh-threshold: a payload just past the threshold needs a refresh', () => {
  const now = Date.now();
  const justPast = now - (BIDDER_COOKIE_REFRESH_THRESHOLD_SECONDS + 1) * 1000;
  assert.equal(needsRefresh(payload({ issuedAt: justPast }), now), true);
});

test('refresh-threshold: threshold is half the TTL (bounded, not unbounded)', () => {
  assert.equal(BIDDER_COOKIE_REFRESH_THRESHOLD_SECONDS, BIDDER_COOKIE_TTL_SECONDS / 2);
});

test('refreshPayload rotates issuedAt but keeps bidderId/stripeCustomerId identical', () => {
  const now = Date.now();
  const original = payload({
    bidderId: 'bidder-keep-me',
    stripeCustomerId: 'cus_keep_me',
    issuedAt: now - 1000,
  });
  const refreshed = refreshPayload(original, now);
  assert.equal(refreshed.bidderId, original.bidderId);
  assert.equal(refreshed.stripeCustomerId, original.stripeCustomerId);
  assert.equal(refreshed.v, original.v);
  assert.equal(refreshed.issuedAt, now);
  assert.notEqual(refreshed.issuedAt, original.issuedAt);
});

test('refreshPayload produces a payload that re-signs with a fresh signature', () => {
  withSecret(SECRET_A, () => {
    const original = payload({ issuedAt: Date.now() - 1000 });
    const refreshed = refreshPayload(original, Date.now());
    const rawOriginal = serializeBidderCookie(original);
    const rawRefreshed = serializeBidderCookie(refreshed);
    assert.notEqual(rawOriginal, rawRefreshed, 'signature must change when issuedAt changes');
    const parsedRefreshed = parseBidderCookie(rawRefreshed);
    assert.equal(parsedRefreshed?.bidderId, original.bidderId, 'identity survives the refresh');
  });
});

test('payloadAgeSeconds computes elapsed time from issuedAt', () => {
  const now = Date.now();
  assert.equal(payloadAgeSeconds(payload({ issuedAt: now - 5000 }), now), 5);
});
