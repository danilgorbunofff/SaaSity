/**
 * Shared low-frequency grid tick (Part 5 extraction from PlotSkins).
 *
 * One 5s interval for the entire grid: closing-soon checks and coarse
 * countdowns re-render at most every 5s (grid-wide, never per-plot).
 * Pure logic lives here (node-safe) so the lifecycle — start on first
 * subscriber, stop when the last one leaves, never on the server — is
 * unit-testable without mounting WebGL/drei.
 */

export const TICK_MS = 5000;

let tickValue = 0;
/** Wall-clock snapshot taken ON the interval - never Date.now() in render. */
let nowValue = Date.now();
const tickListeners = new Set<() => void>();
let tickHandle: ReturnType<typeof setInterval> | null = null;

function startTick() {
  // Never start the page-wide interval on the server (getServerSnapshot
  // runs there) — and stop it when the last consumer unmounts instead of
  // leaking it for the page lifetime (Part 5 maintainability fix).
  if (typeof window === 'undefined' || tickHandle !== null) return;
  tickHandle = setInterval(() => {
    tickValue += 1;
    nowValue = Date.now();
    tickListeners.forEach((fn) => fn());
  }, TICK_MS);
}

function stopTickIfIdle() {
  if (tickListeners.size === 0 && tickHandle !== null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

export function subscribeTick(fn: () => void): () => void {
  startTick();
  tickListeners.add(fn);
  return () => {
    tickListeners.delete(fn);
    stopTickIfIdle();
  };
}

export function getTick(): number {
  startTick();
  return tickValue;
}

/** Snapshot read for render (pure — never Date.now() in render). */
export function getTickNow(): number {
  return nowValue;
}

/** Test visibility: is the page-wide interval currently armed? */
export function isTickRunning(): boolean {
  return tickHandle !== null;
}

/** Test visibility: how many consumers are subscribed? */
export function tickListenerCount(): number {
  return tickListeners.size;
}
