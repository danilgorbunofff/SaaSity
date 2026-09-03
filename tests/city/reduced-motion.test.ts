/**
 * Part 5 `reduced-motion`: the centralized preference pins decorative
 * animation to a representative static frame and collapses camera tweens
 * to instant jumps — without changing the end state.
 */
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import {
  cameraTweenMs,
  isReducedMotion,
  pulsePhase,
  setReducedMotionOverride,
} from '../../src/lib/city/reduced-motion';

afterEach(() => {
  setReducedMotionOverride(null);
});

test('default (no override, no browser): motion allowed', () => {
  assert.equal(isReducedMotion(), false);
  assert.equal(cameraTweenMs(650), 650);
});

test('override on: pulses pin to mid-phase, tweens collapse to zero', () => {
  setReducedMotionOverride(true);
  assert.equal(isReducedMotion(), true);
  assert.equal(cameraTweenMs(650), 0);
  // Pinned regardless of time/speed — one static representative frame.
  assert.equal(pulsePhase(0, 2.4), 0.5);
  assert.equal(pulsePhase(123.456, 3.2), 0.5);
  assert.equal(pulsePhase(-7, 1.1), 0.5);
});

test('override off: pulses oscillate in [0, 1]', () => {
  setReducedMotionOverride(false);
  assert.equal(isReducedMotion(), false);
  const seen = new Set<string>();
  for (let t = 0; t < 20; t += 0.25) {
    const p = pulsePhase(t, 2.4);
    assert.ok(p >= 0 && p <= 1, `phase ${p} in range`);
    seen.add(p.toFixed(3));
  }
  // Actually varies over time (not a frozen value).
  assert.ok(seen.size > 5, `phase varies (${seen.size} distinct values)`);
});
