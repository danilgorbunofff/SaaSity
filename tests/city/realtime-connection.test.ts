/**
 * Part 4 `realtime-harden`: connection-state machine and online/offline
 * transitions. Browser globals are stubbed (node has no window/document/
 * EventSource/navigator); fetch is stubbed to count snapshot refetches.
 */

import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import { useCityStore } from '../../src/lib/city/store';
import { startRealtime, stopRealtime } from '../../src/lib/city/realtime';

type Handler = () => void;
const winListeners = new Map<string, Set<Handler>>();
const docListeners = new Map<string, Set<Handler>>();

function track(map: Map<string, Set<Handler>>, type: string, h: Handler): void {
  let set = map.get(type);
  if (!set) {
    set = new Set();
    map.set(type, set);
  }
  set.add(h);
}
function untrack(map: Map<string, Set<Handler>>, type: string, h: Handler): void {
  map.get(type)?.delete(h);
}
function fire(map: Map<string, Set<Handler>>, type: string): void {
  [...(map.get(type) ?? [])].forEach((h) => h());
}

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly readyState = FakeEventSource.CONNECTING;
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(): void {}
  close(): void {
    this.closed = true;
  }
}

let plotsFetchCount = 0;
const g = globalThis as unknown as Record<string, unknown>;

g.window = {
  addEventListener: (t: string, h: Handler) => track(winListeners, t, h),
  removeEventListener: (t: string, h: Handler) => untrack(winListeners, t, h),
};
g.document = {
  visibilityState: 'visible',
  addEventListener: (t: string, h: Handler) => track(docListeners, t, h),
  removeEventListener: (t: string, h: Handler) => untrack(docListeners, t, h),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
  writable: true,
});
g.EventSource = FakeEventSource;
g.fetch = async (url: string) => {
  if (String(url).includes('/api/plots')) {
    plotsFetchCount += 1;
    return { ok: true, json: async () => ({ plots: [], mockResolveEnabled: false }) };
  }
  if (String(url).includes('/api/me/bids')) {
    return { ok: true, json: async () => ({ preBidIds: [], positions: [] }) };
  }
  throw new Error(`unexpected fetch in test: ${url}`);
};

after(() => {
  stopRealtime();
  delete g.window;
  delete g.document;
  delete g.navigator;
  delete g.EventSource;
});

beforeEach(() => {
  plotsFetchCount = 0;
  useCityStore.setState({ connection: 'connecting', lastSyncAt: null, error: null });
});

test('start connects the stream; offline badges; online re-anchors', async () => {
  startRealtime();
  assert.equal(useCityStore.getState().connection, 'connecting');

  fire(winListeners, 'offline');
  assert.equal(useCityStore.getState().connection, 'offline');

  fire(winListeners, 'online');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(plotsFetchCount, 1);
  assert.equal(useCityStore.getState().connection, 'connecting');
});

test('tab wake-up re-anchors via visibilitychange', async () => {
  startRealtime();
  fire(docListeners, 'visibilitychange');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(plotsFetchCount, 1);
});

test('stop removes every listener (no work after unmount)', async () => {
  startRealtime();
  stopRealtime();
  fire(winListeners, 'online');
  fire(docListeners, 'visibilitychange');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(plotsFetchCount, 0);
});
