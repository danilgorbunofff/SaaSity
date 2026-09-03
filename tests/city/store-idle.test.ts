/**
 * Part 5 maintainability: overlapping idle pulses restart the window — the
 * first timer must never clear a NEWER pulse early.
 */
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { IDLE_PULSE_MS, clearIdlePulseTimerForTests, useCityStore } from '../../src/lib/city/store';

afterEach(() => {
  clearIdlePulseTimerForTests();
  useCityStore.setState({ highlightIdle: false });
});

test('a second pulse restarts the expiry window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const s = () => useCityStore.getState();
    s().pulseIdlePlots();
    assert.equal(s().highlightIdle, true);
    t.mock.timers.tick(IDLE_PULSE_MS - 1000);
    assert.equal(s().highlightIdle, true);
    // Second pulse just before the first would have expired.
    s().pulseIdlePlots();
    t.mock.timers.tick(1500);
    // Old timer would have fired here — the newer pulse must survive.
    assert.equal(s().highlightIdle, true);
    t.mock.timers.tick(IDLE_PULSE_MS - 1500);
    assert.equal(s().highlightIdle, false);
  } finally {
    t.mock.timers.reset();
  }
});

test('single pulse expires after the window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const s = () => useCityStore.getState();
    s().pulseIdlePlots();
    assert.equal(s().highlightIdle, true);
    t.mock.timers.tick(IDLE_PULSE_MS);
    assert.equal(s().highlightIdle, false);
  } finally {
    t.mock.timers.reset();
  }
});
