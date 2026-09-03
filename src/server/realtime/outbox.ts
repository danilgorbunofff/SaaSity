/**
 * Part 4 `serverless-local-bus` — the durable half of realtime fan-out.
 *
 * Importing this module (side effect at the bottom) registers the DB-outbox
 * sink on the in-process bus AND makes the poll/prune helpers available to
 * the SSE route and the cron route. Every server process that can PRODUCE
 * events imports it (bid/claim routes, worker); the SSE consumer imports it
 * for `readOutboxSince`. Unit tests import `bus.ts` directly and never this
 * module, so `publish` stays pure and DB-free under test.
 *
 * Ordering / retry / dedup / retention contract:
 *   - ordering: `RealtimeOutbox.seq` (bigserial) is the canonical global
 *     order; the poll loop reads strictly newer-than-cursor, ascending.
 *   - retry: the sink is fire-and-forget — a failed persist is logged, never
 *     thrown (it must not break the request path). The local loop already
 *     delivered same-process clients; cross-instance delivery of THAT event
 *     is lost, which the SSE snapshot + seq-gap refetch recovers from.
 *   - dedup: consumers key off `eventKeyOf` (see bus.ts); local + outbox
 *     copies of one logical occurrence share the key.
 *   - retention: `pruneOutbox` drops rows older than OUTBOX_RETENTION_HOURS;
 *     the cron resolve route calls it fire-and-forget on every tick.
 *
 * Documented latency: cross-instance delivery lands within OUTBOX_POLL_MS
 * (plus one indexed range query) — currently ~1s worst case.
 */

import { prisma } from '@/server/prisma';
import { setRealtimeSink, type RealtimeEvent } from './bus';

export const OUTBOX_POLL_MS = 1_000;
export const OUTBOX_RETENTION_HOURS = 24;
const OUTBOX_READ_LIMIT = 200;

/** Fire-and-forget persist — never rejects (the caller logs, never throws). */
async function persistEvent(event: RealtimeEvent): Promise<void> {
  // JSON round-trip strips undefined so the stored payload is exact JSON —
  // and satisfies Prisma's Json input type without a generated-client import.
  const payload = JSON.parse(JSON.stringify(event)) as unknown as object;
  await prisma.realtimeOutbox.create({
    data: {
      type: event.type,
      plotId: event.plotId,
      payload,
    },
  });
}

function sink(event: RealtimeEvent): void {
  void persistEvent(event).catch((err) => {
    console.error(
      '[realtime:outbox] persist failed; local clients delivered, cross-instance copy lost',
      err,
    );
  });
}

// Register on import — see the module doc above for why this is explicit
// per-route instead of ambient.
setRealtimeSink(sink);

export interface OutboxEntry {
  seq: bigint;
  event: RealtimeEvent;
}

function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.type === 'bid:placed' || v.type === 'cycle:extended' || v.type === 'cycle:resolved') &&
    typeof v.plotId === 'string'
  );
}

/**
 * Rows newer than `cursor` (exclusive), ascending, capped at
 * OUTBOX_READ_LIMIT. Malformed payloads are skipped (logged) so one bad
 * write can never poison a consumer — `highSeq` still advances past them so
 * the cursor never wedges on the same row twice.
 */
export async function readOutboxSince(
  cursor: bigint,
): Promise<{ entries: OutboxEntry[]; highSeq: bigint | null }> {
  const rows = await prisma.realtimeOutbox.findMany({
    where: { seq: { gt: cursor } },
    orderBy: { seq: 'asc' },
    take: OUTBOX_READ_LIMIT,
  });
  const entries: OutboxEntry[] = [];
  let highSeq: bigint | null = null;
  for (const row of rows) {
    highSeq = row.seq;
    if (isRealtimeEvent(row.payload)) {
      entries.push({ seq: row.seq, event: row.payload });
    } else {
      console.error(`[realtime:outbox] skipping malformed payload at seq ${row.seq}`);
    }
  }
  return { entries, highSeq };
}

/** Highest persisted seq, or zero when the table is empty. */
export async function readOutboxHighWatermark(): Promise<bigint> {
  const last = await prisma.realtimeOutbox.findFirst({
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });
  return last?.seq ?? BigInt(0);
}

/** Drop rows older than the retention window. Returns the pruned count. */
export async function pruneOutbox(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - OUTBOX_RETENTION_HOURS * 3_600_000);
  const res = await prisma.realtimeOutbox.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return res.count;
}
