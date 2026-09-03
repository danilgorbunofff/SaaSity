/**
 * Phase 2.4 — GET /api/events (SSE), hardened by Part 4.
 *
 * Transport: SSE + outbox-backed fan-out (see src/server/realtime/outbox.ts).
 * One stream per browser: `hello` → full 49-plot snapshot → typed events,
 * each stamped with a per-connection monotonically increasing seq. A seq gap
 * on the client (reconnect, dropped frame) triggers a full refetch, and
 * every reconnect delivers a fresh snapshot that re-anchors state (no
 * Last-Event-ID resume — the snapshot IS the resume).
 *
 * Part 4 `sse-snapshot-race` fix: the local subscription is attached BEFORE
 * the snapshot read and inbound events are buffered until the snapshot has
 * been flushed; buffered events then replay in arrival order. An event
 * committed inside the window is therefore delivered exactly once by key
 * (buffer) or twice idempotently (snapshot + buffer overlap — every client
 * patch is a field-level overwrite, so overlap is a no-op). Cross-instance
 * events from the same window arrive via the outbox poll loop and dedupe by
 * the same key.
 *
 * Part 4 `sse-abort-leak` fix: the abort handler is attached before the
 * first async operation, `signal.aborted` is checked after every await, any
 * failed write cleans up and RETURNS (no listener/timer is ever created
 * after a failure), and one idempotent `cleanup` owns the listener,
 * heartbeat, poll timer, and controller close.
 *
 * Every plot payload goes through serializePlot — the SAME serializer as
 * /api/plots (privacy invariant is inherited, not re-decided). Heartbeat
 * comments every ~15s keep proxies from buffering the stream closed.
 */

import { prisma } from '@/server/prisma';
import { serializePlot } from '@/server/serializers';
import { subscribe, eventKeyOf, type RealtimeEvent } from '@/server/realtime/bus';
import { readOutboxSince, readOutboxHighWatermark, OUTBOX_POLL_MS } from '@/server/realtime/outbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 15_000;
// Cap the dedup set: keys only matter for the snapshot-overlap window and
// the local/outbox double-delivery window. Clearing is safe — a re-delivery
// past the cap applies an idempotent patch (see module doc).
const MAX_DELIVERED_KEYS = 2_000;

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const signal = request.signal;
  if (signal.aborted) {
    return new Response(null, { status: 204 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let seq = 0;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      // False until the snapshot flushes — inbound local events buffer.
      let live = false;
      const buffer: RealtimeEvent[] = [];
      const deliveredKeys = new Set<string>();
      let outboxCursor = BigInt(0);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        live = false;
        if (heartbeat !== null) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (pollTimer !== null) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        buffer.length = 0;
        deliveredKeys.clear();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      // Abort FIRST — before any async work or listener creation, so a
      // disconnect at any point funnels into the single cleanup above.
      signal.addEventListener('abort', cleanup, { once: true });

      // Returns false when the stream is dead — callers must stop init.
      const write = (chunk: string): boolean => {
        if (closed || signal.aborted) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      const deliver = (event: RealtimeEvent): void => {
        const key = eventKeyOf(event);
        if (deliveredKeys.has(key)) return;
        deliveredKeys.add(key);
        if (deliveredKeys.size > MAX_DELIVERED_KEYS) deliveredKeys.clear();
        seq += 1;
        if (!write(`id: ${seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) {
          return;
        }
      };

      // 1. Subscribe BEFORE the snapshot read (race fix) — arrivals buffer.
      unsubscribe = subscribe((event: RealtimeEvent) => {
        if (closed) return;
        if (!live) {
          buffer.push(event);
          return;
        }
        deliver(event);
      });

      // 2. Snapshot + outbox high-watermark. The watermark is read BEFORE
      // the plot query so any event persisted in the window has
      // seq > watermark and is picked up by the replay/poll below; events
      // committed before the plot query started are already IN the snapshot
      // (read-committed) and dedupe by key if they also arrive via buffer.
      let snapshot: ReturnType<typeof serializePlot>[];
      try {
        outboxCursor = await readOutboxHighWatermark();
        if (closed || signal.aborted) {
          cleanup();
          return;
        }
        const plots = await prisma.plot.findMany({
          include: { currentCycle: true },
        });
        if (closed || signal.aborted) {
          cleanup();
          return;
        }
        snapshot = plots.map(serializePlot);
      } catch {
        cleanup();
        return;
      }

      // 3. Flush hello + snapshot. ANY failure stops init here — no
      // heartbeat, no poll timer, nothing leaks (leak fix).
      if (!write(`event: hello\ndata: {}\n\n`)) return;
      seq += 1;
      if (!write(`id: ${seq}\nevent: snapshot\ndata: ${JSON.stringify({ plots: snapshot })}\n\n`)) {
        return;
      }

      // 4. Replay the race-window buffer in arrival order, then go live.
      // Patches are idempotent field overwrites, so snapshot∩buffer overlap
      // converges instead of corrupting.
      for (const event of buffer) deliver(event);
      buffer.length = 0;
      live = true;

      // 5. Cross-instance fan-out: poll rows newer than the cursor, dedupe
      // by key (a same-process event arrives via BOTH paths), advance the
      // cursor past everything read — including malformed rows (the reader
      // reports highSeq separately so the cursor never wedges).
      const pollOutbox = async () => {
        if (closed || signal.aborted) {
          cleanup();
          return;
        }
        try {
          const { entries, highSeq } = await readOutboxSince(outboxCursor);
          if (closed || signal.aborted) {
            cleanup();
            return;
          }
          for (const { event } of entries) deliver(event);
          if (highSeq !== null) outboxCursor = highSeq;
        } catch (err) {
          // Transient DB failure: keep the cursor, retry next tick. Local
          // bus delivery is unaffected, so same-process clients never gap.
          console.error('[realtime:sse] outbox poll failed, retrying next tick', err);
        }
      };

      heartbeat = setInterval(() => {
        write(`: ping ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);
      // Offset the first poll so a brand-new connection doesn't query twice
      // in the same instant it snapshotted (the watermark already covers it).
      pollTimer = setInterval(() => {
        void pollOutbox();
      }, OUTBOX_POLL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
