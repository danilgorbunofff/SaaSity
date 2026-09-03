/**
 * Part 5 maintainability: the shared 5s grid tick starts on first use and
 * STOPS when the last consumer unsubscribes (no page-lifetime leak), and
 * never arms on the server.
 */
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import {
  getTick,
  isTickRunning,
  subscribeTick,
  tickListenerCount,
} from '../../src/lib/city/shared-tick';

function stubWindow() {
  const g = globalThis as Record<string, unknown>;
  const prev = g['window'];
  g['window'] = {};
  return () => {
    if (prev === undefined) delete g['window'];
    else g['window'] = prev;
  };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

test('no interval on the server (no window), even with subscribers', () => {
  assert.equal(isTickRunning(), false);
  const unsub = subscribeTick(() => {});
  assert.equal(tickListenerCount(), 1);
  assert.equal(isTickRunning(), false);
  assert.equal(getTick(), 0);
  unsub();
  assert.equal(tickListenerCount(), 0);
});

test('interval arms on first client subscriber and stops on last unsubscribe', () => {
  restore = stubWindow();
  assert.equal(isTickRunning(), false);
  const a = subscribeTick(() => {});
  assert.equal(isTickRunning(), true);
  const b = subscribeTick(() => {});
  assert.equal(tickListenerCount(), 2);
  a();
  // One consumer left: interval stays.
  assert.equal(isTickRunning(), true);
  b();
  // Last consumer gone: interval cleared.
  assert.equal(isTickRunning(), false);
  assert.equal(tickListenerCount(), 0);
});
