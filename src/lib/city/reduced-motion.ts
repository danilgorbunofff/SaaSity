/**
 * Centralized reduced-motion preference (Part 5 `reduced-motion` fix).
 *
 * Before: outbid flashes, beacons, aura rings, antenna pulses, selection
 * pulses, camera tweens, and CSS keyframe animations all ran unconditionally.
 *
 * Now: every animated surface reads this module. On the client it tracks the
 * `(prefers-reduced-motion: reduce)` media query (live — OS setting flips
 * apply without reload); in node/tests or pre-hydration it falls back to a
 * test override (default: motion allowed).
 *
 * Reduced-motion contract for animated surfaces:
 * - useFrame pulses -> render ONE static frame (mid-phase values, full
 *   opacity where the state must stay legible).
 * - CSS keyframe flashes -> not applied (static high-contrast colors stay).
 * - camera fly-to tween -> instant jump to the same end state.
 * - rotational motion (aura ring spin) -> removed entirely.
 * No information may depend on motion alone: every pulsing state also has a
 * distinct static color/shape treatment (cyan vs amber, ring vs no ring).
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

let override: boolean | null = null;
let mql: MediaQueryList | null = null;
const listeners = new Set<() => void>();

function queryMatches(): boolean {
  if (override !== null) return override;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  if (!mql) {
    mql = window.matchMedia(QUERY);
    mql.addEventListener('change', () => {
      listeners.forEach((fn) => fn());
    });
  }
  return mql.matches;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // Lazily bind the MediaQueryList so the OS-live update path exists even
  // when the first read happened pre-hydration.
  queryMatches();
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): boolean {
  return queryMatches();
}

/** Test-only escape hatch (node has no matchMedia). */
export function setReducedMotionOverride(value: boolean | null): void {
  override = value;
  listeners.forEach((fn) => fn());
}

/** Synchronous read for non-React code (camera-rig fly-to, canvas setup). */
export function isReducedMotion(): boolean {
  return queryMatches();
}

/** Reactive hook for components (HUD + R3F skins). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Decorative pulse phase in [0, 1]. Reduced motion pins the phase so the
 * surface renders one representative static frame instead of oscillating.
 */
export function pulsePhase(timeSeconds: number, speed: number): number {
  if (queryMatches()) return 0.5;
  return 0.5 + 0.5 * Math.sin(timeSeconds * speed);
}

/**
 * App-side animation clock (seconds). PlotSkins/TierMeshes drive decorative
 * pulses from here instead of the R3F `clock`, which three r183 deprecated
 * (THREE.Clock -> THREE.Timer; the remaining console warning comes from
 * R3F 9.7 internals constructing the state clock — see part-05 doc).
 */
export function animNow(): number {
  return performance.now() / 1000;
}

/** Camera tween duration in ms — instant jump under reduced motion. */
export function cameraTweenMs(fullMs: number): number {
  return queryMatches() ? 0 : fullMs;
}
