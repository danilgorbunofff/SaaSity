/**
 * Part 7 `test-coverage-gap` — cron authorization tests.
 *
 * The settlement trigger must 401 for anyone without the shared secret.
 * The rule is a pure function (see src/server/cron-auth.ts), so every branch
 * is pinned here without a database.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isCronRequestAuthorized } from '../../src/server/cron-auth';

const REAL_SECRET = process.env.WORKER_SECRET;

afterEach(() => {
  process.env.WORKER_SECRET = REAL_SECRET;
});

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/resolve', { headers });
}

test('missing WORKER_SECRET denies everything (fail closed)', () => {
  delete process.env.WORKER_SECRET;
  assert.equal(isCronRequestAuthorized(req({ authorization: 'Bearer x' })), false);
  assert.equal(isCronRequestAuthorized(req({ 'x-worker-secret': 'x' })), false);
});

test('empty WORKER_SECRET denies everything (fail closed)', () => {
  process.env.WORKER_SECRET = '';
  assert.equal(isCronRequestAuthorized(req({ authorization: 'Bearer ' })), false);
});

test('correct Bearer token authorizes', () => {
  process.env.WORKER_SECRET = 's3cr3t';
  assert.equal(isCronRequestAuthorized(req({ authorization: 'Bearer s3cr3t' })), true);
});

test('correct x-worker-secret header authorizes (Vercel-cron style)', () => {
  process.env.WORKER_SECRET = 's3cr3t';
  assert.equal(isCronRequestAuthorized(req({ 'x-worker-secret': 's3cr3t' })), true);
});

test('wrong secret, no headers, or malformed Bearer all deny', () => {
  process.env.WORKER_SECRET = 's3cr3t';
  assert.equal(isCronRequestAuthorized(req({ authorization: 'Bearer wrong' })), false);
  assert.equal(isCronRequestAuthorized(req({ 'x-worker-secret': 'wrong' })), false);
  assert.equal(isCronRequestAuthorized(req()), false);
  assert.equal(isCronRequestAuthorized(req({ authorization: 's3cr3t' })), false);
});
