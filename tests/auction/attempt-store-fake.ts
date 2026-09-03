/**
 * In-memory AttemptStore for cascade unit tests — the cascade writes every
 * money intent to its store, so DB-less tests inject this instead of the
 * prisma-backed store. Crash-point behavior against the real ledger is
 * covered by scripts/settlement-crash-proof.ts.
 */

import type { AttemptStore, SettlementAttemptRecord } from '../../src/server/auction/finalize';

export function makeMemoryAttemptStore(): AttemptStore & { rows: SettlementAttemptRecord[] } {
  const rows: SettlementAttemptRecord[] = [];
  let n = 0;
  return {
    rows,
    async findCapturedByKey(idempotencyKey) {
      return rows.find((r) => r.idempotencyKey === idempotencyKey && r.status === 'CAPTURED') ?? null;
    },
    async findReleasedByKey(idempotencyKey) {
      return rows.find((r) => r.idempotencyKey === idempotencyKey && r.status === 'RELEASED') ?? null;
    },
    async createPending(args) {
      const attemptNo = rows.filter(
        (r) => r.preBidId === args.preBidId && r.kind === args.kind,
      ).length + 1;
      const row: SettlementAttemptRecord = {
        id: `attempt-${(n += 1)}`,
        preBidId: args.preBidId,
        kind: args.kind,
        attemptNo,
        amountCents: args.amountCents,
        idempotencyKey: args.idempotencyKey,
        status: 'PENDING',
        stripePaymentIntentId: null,
      };
      rows.push(row);
      return row;
    },
    async markAttempt(id, data) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`attempt ${id} not found`);
      row.status = data.status;
    },
  };
}
