/**
 * Phase 2.4 — GET /api/events (SSE).
 *
 * Transport: SSE + in-process bus, per the phase 0.2 decision (single
 * decision point; 2.4 implements it). One stream per browser:
 *   `hello` → full 49-plot snapshot with a starting seq → typed events,
 * each stamped with a per-connection monotonically increasing seq. A seq
 * gap on the client (reconnect, dropped frame) triggers a full refetch.
 *
 * Every plot payload goes through serializePlot — the SAME serializer as
 * /api/plots (privacy invariant is inherited, not re-decided). Heartbeat
 * comments every ~15s keep proxies from buffering the stream closed.
 */

import { prisma } from '@/server/prisma';
import { serializePlot } from '@/server/serializers';
import { subscribe, type RealtimeEvent } from '@/server/realtime/bus';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 15_000;

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let seq = 0;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const send = (event: string, data: unknown) => {
        seq += 1;
        write(`id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat !== null) clearInterval(heartbeat);
        if (unsubscribe) unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      try {
        // `hello` — confirms the stream is live before the snapshot work.
        write(`event: hello\ndata: {}\n\n`);

        const plots = await prisma.plot.findMany({
          include: { currentCycle: true },
        });
        const snapshot = plots.map(serializePlot);
        send('snapshot', { plots: snapshot });

        unsubscribe = subscribe((event: RealtimeEvent) => {
          send(event.type, event);
        });

        heartbeat = setInterval(() => {
          // SSE comment frame — invisible to EventSource consumers.
          write(`: ping ${Date.now()}\n\n`);
        }, HEARTBEAT_MS);
      } catch {
        cleanup();
        return;
      }

      request.signal.addEventListener('abort', cleanup);
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