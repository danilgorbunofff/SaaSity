/**
 * PreBid.stripePaymentIntentId is unique at the database layer (migration
 * add_prebid_payment_intent_unique) so one Stripe PaymentIntent can never
 * settle two PreBids. This module is the ONLY sanctioned way to write that
 * column: every writer — including the future M3 real implementation of
 * `authorizePreBidAtAttach` (src/server/auction/finalize.ts) — must go
 * through `attachStripePaymentIntentId` instead of a bare
 * `prisma.preBid.update`, so a retried attach (e.g. the write actually
 * landed but the caller's response timed out and it retries) is treated as
 * an idempotent no-op rather than a generic failure, while a genuine
 * conflict (the same PaymentIntent id already owned by a DIFFERENT PreBid —
 * which should never happen, but would indicate a serious bug or a
 * replayed webhook) is surfaced as a distinct, catchable error instead of
 * an opaque Prisma P2002.
 */

import { Prisma } from '@/generated/prisma/client';

export class PaymentIntentConflictError extends Error {
  constructor(
    public readonly preBidId: string,
    public readonly stripePaymentIntentId: string,
    public readonly conflictingPreBidId: string,
  ) {
    super(
      `PaymentIntent ${stripePaymentIntentId} is already attached to preBid ` +
        `${conflictingPreBidId}, cannot attach it to preBid ${preBidId}`,
    );
    this.name = 'PaymentIntentConflictError';
  }
}

interface PreBidWriter {
  preBid: {
    update: (args: {
      where: { id: string };
      data: { stripePaymentIntentId: string };
    }) => Promise<unknown>;
    findUnique: (args: {
      where: { stripePaymentIntentId: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
}

function isUniqueConstraintViolationOn(err: unknown, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;

  // Classic query-engine shape: meta.target is the field name (or an array
  // containing it).
  const target = err.meta?.['target'];
  if (Array.isArray(target) && target.includes(field)) return true;
  if (typeof target === 'string' && target === field) return true;

  // Driver-adapters shape (@prisma/adapter-pg): the field name isn't
  // introspected — instead meta.driverAdapterError.cause.constraint.index
  // holds the raw Postgres index name, which Prisma's naming convention
  // always embeds the column name into (e.g. "PreBid_stripePaymentIntentId_key").
  const driverAdapterError = err.meta?.['driverAdapterError'];
  if (driverAdapterError && typeof driverAdapterError === 'object') {
    const cause = (driverAdapterError as Record<string, unknown>)['cause'];
    if (cause && typeof cause === 'object') {
      const kind = (cause as Record<string, unknown>)['kind'];
      const constraint = (cause as Record<string, unknown>)['constraint'];
      const index =
        constraint && typeof constraint === 'object'
          ? (constraint as Record<string, unknown>)['index']
          : undefined;
      if (
        kind === 'UniqueConstraintViolation' &&
        typeof index === 'string' &&
        index.includes(field)
      )
        return true;
    }
  }

  return false;
}

/**
 * Attaches a Stripe PaymentIntent id to a PreBid, tolerating retries.
 *
 * - Same preBid + same id, attempted twice (retry): second call is a no-op
 *   success.
 * - Same id attached to a DIFFERENT preBid than the one that already owns
 *   it: throws `PaymentIntentConflictError` (never a raw Prisma error).
 */
export async function attachStripePaymentIntentId(
  prisma: PreBidWriter,
  preBidId: string,
  stripePaymentIntentId: string,
): Promise<void> {
  try {
    await prisma.preBid.update({
      where: { id: preBidId },
      data: { stripePaymentIntentId },
    });
  } catch (err) {
    if (!isUniqueConstraintViolationOn(err, 'stripePaymentIntentId')) throw err;

    const owner = await prisma.preBid.findUnique({
      where: { stripePaymentIntentId },
      select: { id: true },
    });
    if (owner?.id === preBidId) return; // idempotent retry — already attached to this row

    throw new PaymentIntentConflictError(preBidId, stripePaymentIntentId, owner?.id ?? '(unknown)');
  }
}
