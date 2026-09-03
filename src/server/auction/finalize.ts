/**
 * Phase 2.3 — capture cascade (final step of cycle resolution).
 *
 * The cascade runs OUTSIDE the main resolution transaction: a Stripe
 * capture failure must never poison the resolution transaction, so
 * pre-authorized funds are collected in independent transactions. LOST
 * transitions for candidates whose capture failed happen in their own
 * small transactions as well.
 *
 * M3 (Stripe) replaces the unconditional-success stubs below with real
 * PaymentIntent capture/cancel calls; the worker contract stays the same.
 *
 * Part 3 authorization seam — EVERY transition that assigns a pre-bid into
 * a cycle (null -> cycleId, or creation directly inside a cycle) funnels
 * through `authorizeAttachedRows`:
 *
 *   T1 claim route: claimer's row is created directly in the fresh cycle;
 *      authorized post-commit, compensated (EXPIRED + re-resolve, 402) on
 *      failure. Queued rows are authorized BEFORE the claim tx and attached
 *      by id, so only survivors enter the cycle.
 *   T2 bid route: bidder's row is created/raised directly in the live
 *      cycle; authorized post-commit, compensated the same way.
 *   T3 pre-bid route: rows stay queued (cycleId null) — NOT an attach, so
 *      no authorization; the hold starts at attach, not at queue time.
 *   T4 worker rotation: queued rows are authorized between the settle tx
 *      and the rotation tx; failures expire while still queued and only
 *      survivor ids are attached. Proxy resolution runs after, over
 *      survivors only.
 *   T5 capture cascade: unchanged — capture/cancel I/O already runs
 *      outside every transaction.
 *
 * IRON RULE: Stripe network I/O never runs inside a transaction. The
 * authorize loop always sits between two short txs (or after commit);
 * per-row outcomes land in their own small txs. A crash between authorize
 * and outcome-persist is M3's reconciliation concern (see
 * payment-intent.ts); pre-M3 the stub authorizes nothing, so the window is
 * empty — the SHAPE is what this seam guarantees.
 */

import type { PreBid } from '@/generated/prisma/client';
import { prisma } from '@/server/prisma';
import { requireMockPayments } from '@/server/mock-payments';
import { attachStripePaymentIntentId } from '@/server/auction/payment-intent';

/**
 * Part 3 capture-replay: every capture failure is classified at the point
 * of failure, because the two classes demand opposite handling — a
 * definitive card decline selects the next fallback candidate, while a
 * retryable transport failure (including UNKNOWN errors, which may hide a
 * successful charge) aborts the pass with no fallback and retries under the
 * same idempotency key. M3 maps Stripe error types onto this taxonomy.
 */
export class CaptureFailureError extends Error {
  readonly retryable: boolean;
  readonly code: string;
  constructor(preBidId: string, code: string, retryable: boolean, message?: string) {
    super(message ?? `Capture ${retryable ? 'retryable' : 'definitive'} failure for preBid ${preBidId}: ${code}`);
    this.name = 'CaptureFailureError';
    this.retryable = retryable;
    this.code = code;
  }
}

/**
 * M3 STUB — real implementation captures the manual-capture PaymentIntent
 * for exactly `amountCents` (<= authorized maxBidCents).
 * Returns the captured amount on success; throws CaptureFailureError on
 * failure (retryable transport vs definitive card — see the taxonomy
 * above). `idempotencyKey` is the stable key for this intended settlement;
 * M3 passes it to Stripe so a retried pass reports "already captured"
 * instead of double-charging.
 *
 * Phase 2.5: gated on MOCK_PAYMENTS=1 — without the flag this throws, so a
 * misconfigured deployment never crowns an unpaid winner.
 */
export async function capturePreBidAuthorization(
  preBid: Pick<PreBid, 'id' | 'stripePaymentIntentId'>,
  amountCents: number,
  // Pre-M3 the stub authorizes nothing, so the key is unused — M3 passes it
  // to Stripe as the idempotency key (see the crash-point contract above).
  _idempotencyKey?: string,
): Promise<number> {
  requireMockPayments('capturePreBidAuthorization');
  captureCallLog.push(preBid.id);
  if (amountCents < 0) {
    throw new CaptureFailureError(preBid.id, 'invalid-amount', false);
  }
  const injected = injectedCaptureFailures.get(preBid.id);
  if (injected !== undefined) {
    throw new CaptureFailureError(
      preBid.id,
      injected.retryable ? 'injected-transport' : 'injected-decline',
      injected.retryable,
    );
  }
  return amountCents;
}

/**
 * M3 STUB — real implementation cancels the manual-capture PaymentIntent
 * (releases the hold). Must be idempotent. `idempotencyKey` is the stable
 * release key; M3 passes it through so retried releases are safe.
 */
export async function cancelPreBidAuthorization(
  _preBid: Pick<PreBid, 'id' | 'stripePaymentIntentId'>,
  _idempotencyKey?: string,
): Promise<void> {
  requireMockPayments('cancelPreBidAuthorization');
  if (injectedCancelFailures.has(_preBid.id)) {
    throw new Error(`Injected cancel failure for preBid ${_preBid.id}`);
  }
}

// ---------------------------------------------------------------------------
// Test hooks — the proof scripts run the worker in-process and flip these
// to force capture failures. No production path calls them.
// ---------------------------------------------------------------------------

const injectedCaptureFailures = new Map<string, { retryable: boolean }>();

export function injectCaptureFailure(preBidId: string, retryable = false): void {
  injectedCaptureFailures.set(preBidId, { retryable });
}

export function clearCaptureFailures(): void {
  injectedCaptureFailures.clear();
}

const injectedCancelFailures = new Set<string>();

export function injectCancelFailure(preBidId: string): void {
  injectedCancelFailures.add(preBidId);
}

export function clearCancelFailures(): void {
  injectedCancelFailures.clear();
}

// Capture call log — crash-point tests assert the stub ran exactly once per
// intended settlement (no double charge across retries/reconciliations).
const captureCallLog: string[] = [];

export function resetCaptureCallLog(): void {
  captureCallLog.length = 0;
}

export function getCaptureCallCount(preBidId?: string): number {
  if (preBidId === undefined) return captureCallLog.length;
  return captureCallLog.filter((id) => id === preBidId).length;
}

const injectedAttachFailures = new Set<string>();

export function injectAttachAuthFailure(preBidId: string): void {
  injectedAttachFailures.add(preBidId);
}

export function clearAttachAuthFailures(): void {
  injectedAttachFailures.clear();
}

// Test hook — makes the stub return a synthetic PaymentIntent id so the
// persist path (attachStripePaymentIntentId) is exercisable without Stripe.
const injectedAttachPiIds = new Map<string, string>();

export function injectAttachAuthPiId(preBidId: string, stripePaymentIntentId: string): void {
  injectedAttachPiIds.set(preBidId, stripePaymentIntentId);
}

export function clearAttachAuthPiIds(): void {
  injectedAttachPiIds.clear();
}

/**
 * M3 STUB — creates the manual-capture PaymentIntent pre-authorization for
 * the pre-bid's maxBidCents at attach time (the 7-day hold window starts
 * here, per the deferred-timing rule). Throws on failure; the caller
 * excludes that pre-bid from the cycle (EXPIRED / 'expired').
 *
 * Returns the created PaymentIntent id, or null when no real intent exists
 * (pre-M3 stub success). The caller — always `authorizeAttachedRows` below,
 * never a route directly — persists a non-null id via
 * `attachStripePaymentIntentId` (src/server/auction/payment-intent.ts),
 * never a bare `prisma.preBid.update`, so a retried attach is idempotent
 * instead of a generic failure. See that module's doc comment for the full
 * contract.
 *
 * Deliberately NOT gated on MOCK_PAYMENTS (unlike capture/cancel below):
 * this stub performs no financial fiction — it authorizes nothing and
 * returns no intent — so gating it would brick every claim/bid on a
 * server run without the flag while changing nothing about money safety.
 * The flag guards financial fiction (capture/cancel/release); M3's real
 * implementation calls actual Stripe here and drops the stub.
 */
export async function authorizePreBidAtAttach(
  preBid: Pick<PreBid, 'id' | 'stripePaymentIntentId'>,
): Promise<string | null> {
  if (injectedAttachFailures.has(preBid.id)) {
    throw new Error(`Injected attach-auth failure for preBid ${preBid.id}`);
  }
  const injectedPiId = injectedAttachPiIds.get(preBid.id);
  if (injectedPiId !== undefined) return injectedPiId;
  // no-op in pre-M3: authorized, but no real intent to persist.
  return null;
}

/**
 * THE authorization seam (Part 3): authorize a batch of pre-bids that are
 * about to be (worker/claim pre-attach) or have just been (claim/bid
 * post-commit) assigned into a cycle.
 *
 * For each id: non-ACTIVE rows are skipped (settled or expired elsewhere —
 * not ours to judge); rows already carrying a PaymentIntent id are
 * reported authorized WITHOUT re-authorizing (idempotent retry — M3 must
 * never double-hold); otherwise the authorizer runs OUTSIDE any
 * transaction and its outcome lands in its own small tx — a returned id is
 * persisted via the sanctioned `attachStripePaymentIntentId` writer, any
 * failure (authorization OR intent-id conflict) expires the row
 * (EXPIRED / 'expired') so proxy resolution, which always runs after this
 * helper returns, can never price a dead authorization.
 *
 * Returns the partition; callers attach/resolve survivors only.
 */
export async function authorizeAttachedRows(
  preBidIds: string[],
): Promise<{ authorizedIds: string[]; expiredIds: string[] }> {
  const authorizedIds: string[] = [];
  const expiredIds: string[] = [];

  for (const id of preBidIds) {
    const row = await prisma.preBid.findUnique({
      where: { id },
      select: { id: true, status: true, stripePaymentIntentId: true },
    });
    if (!row || row.status !== 'ACTIVE') continue;
    if (row.stripePaymentIntentId) {
      authorizedIds.push(id);
      continue;
    }

    let paymentIntentId: string | null;
    try {
      // NETWORK I/O — must never run inside a transaction.
      paymentIntentId = await authorizePreBidAtAttach(row);
    } catch {
      await prisma.preBid.update({
        where: { id },
        data: { status: 'EXPIRED', lostReason: 'expired' },
      });
      expiredIds.push(id);
      continue;
    }

    if (paymentIntentId) {
      try {
        await attachStripePaymentIntentId(prisma, id, paymentIntentId);
      } catch {
        // Same intent already owned by another row (should never happen):
        // not attached — fail the authorization, don't poison the cycle.
        await prisma.preBid.update({
          where: { id },
          data: { status: 'EXPIRED', lostReason: 'expired' },
        });
        expiredIds.push(id);
        continue;
      }
    }
    authorizedIds.push(id);
  }

  return { authorizedIds, expiredIds };
}

// ---------------------------------------------------------------------------

/**
 * Stable idempotency key for one intended settlement (Part 3
 * capture-replay). Retries of the same intent — same cycle, bidder, kind,
 * and (for captures) amount — share the key, so Stripe reports "already
 * captured" instead of double-charging. A different amount is a different
 * settlement and keys differently. M3 passes this straight to Stripe.
 */
export function settlementIdempotencyKey(
  cycleId: string,
  preBidId: string,
  kind: 'CAPTURE' | 'RELEASE',
  amountCents: number | null,
): string {
  return kind === 'CAPTURE'
    ? `saasity:v1:capture:${cycleId}:${preBidId}:${amountCents ?? 0}`
    : `saasity:v1:release:${cycleId}:${preBidId}`;
}

// ---------------------------------------------------------------------------
// Settlement-attempt store. Default implementation is the prisma singleton;
// tests inject an in-memory fake. Kept behind this interface so the cascade
// never touches tables directly and the crash-point contract is explicit.
// ---------------------------------------------------------------------------

export interface SettlementAttemptRecord {
  id: string;
  preBidId: string;
  kind: 'CAPTURE' | 'RELEASE';
  attemptNo: number;
  amountCents: number | null;
  idempotencyKey: string;
  status:
    | 'PENDING'
    | 'CAPTURED'
    | 'FAILED_RETRYABLE'
    | 'FAILED_DEFINITIVE'
    | 'RELEASED'
    | 'RELEASE_FAILED';
  stripePaymentIntentId: string | null;
}

export interface AttemptStore {
  findCapturedByKey(idempotencyKey: string): Promise<SettlementAttemptRecord | null>;
  findReleasedByKey(idempotencyKey: string): Promise<SettlementAttemptRecord | null>;
  createPending(args: {
    cycleId: string;
    preBidId: string;
    kind: 'CAPTURE' | 'RELEASE';
    amountCents: number | null;
    idempotencyKey: string;
  }): Promise<SettlementAttemptRecord>;
  markAttempt(
    id: string,
    data: {
      status: SettlementAttemptRecord['status'];
      stripePaymentIntentId?: string | null;
      stripeResult?: string | null;
      failureKind?: string | null;
    },
  ): Promise<void>;
}

export const prismaAttemptStore: AttemptStore = {
  async findCapturedByKey(idempotencyKey) {
    const row = await prisma.settlementAttempt.findFirst({
      where: { idempotencyKey, status: 'CAPTURED' },
    });
    return row as SettlementAttemptRecord | null;
  },
  async findReleasedByKey(idempotencyKey) {
    const row = await prisma.settlementAttempt.findFirst({
      where: { idempotencyKey, status: 'RELEASED' },
    });
    return row as SettlementAttemptRecord | null;
  },
  async createPending(args) {
    const last = await prisma.settlementAttempt.findFirst({
      where: { cycleId: args.cycleId, preBidId: args.preBidId, kind: args.kind },
      orderBy: { attemptNo: 'desc' },
      select: { attemptNo: true },
    });
    const row = await prisma.settlementAttempt.create({
      data: { ...args, attemptNo: (last?.attemptNo ?? 0) + 1, status: 'PENDING' },
    });
    return row as SettlementAttemptRecord;
  },
  async markAttempt(id, data) {
    await prisma.settlementAttempt.update({ where: { id }, data });
  },
};

/**
 * Ledger row the cascade works on — never serialized (includes the payment
 * intent ref). Exported because it is part of `runCaptureCascade`'s public
 * signature.
 */
export type CandidateRow = Pick<
  PreBid,
  | 'id'
  | 'bidderId'
  | 'maxBidCents'
  | 'companyName'
  | 'tagline'
  | 'targetUrl'
  | 'twitterHandle'
  | 'mrrText'
  | 'stripePaymentIntentId'
>;

export interface CascadeOutcome {
  winnerPreBidId: string | null;
  clearingPriceCents: number | null;
  /** Pre-bid ids that failed capture (marked LOST / capture_failed). */
  captureFailedPreBidIds: string[];
  /** Pre-bid ids whose authorization was released (losers of the cascade). */
  releasedPreBidIds: string[];
  /** Pre-bid ids whose hold release failed — persisted as RELEASE_FAILED for sweep retry. */
  releaseFailedPreBidIds: string[];
  /**
   * True when a retryable (or unknown) failure aborted the pass BEFORE any
   * fallback was selected. No winner, no loser marks, no releases — the
   * cycle stays RESOLVING and the next sweep retries under the same
   * idempotency keys. The caller must NOT settle from this outcome.
   */
  aborted: boolean;
}

/**
 * Capture cascade over resolution candidates, best-first — with every money
 * intent persisted BEFORE the Stripe call (Part 3 capture-replay).
 *
 * For candidate i, the capture amount is the second-price that would hold if
 * every better candidate failed: computeResolution over the remaining
 * candidates' max bids with the cycle floor/increment. The last remaining
 * candidate captures at the floor.
 *
 * Idempotency (the crash-point contract):
 *   - an attempt row is recorded PENDING before each capture; success marks
 *     it CAPTURED (with intent id / result), failure marks it
 *     FAILED_DEFINITIVE (card decline — select the next fallback) or
 *     FAILED_RETRYABLE (transport/unknown — ABORT the pass, no fallback;
 *     the recorded idempotency key makes the retry safe);
 *   - a CAPTURED row already on record for the same key is success WITHOUT
 *     a new Stripe call ("already captured" — the lost-response case);
 *   - loser releases are recorded the same way; RELEASE_FAILED rows persist
 *     for sweep retry and never block settlement.
 *
 * All failures happen outside the caller's flow — each failed candidate is
 * marked LOST (lostReason 'capture_failed') via markLost.
 *
 * `computeRemainingPrice(candidate, remaining)` returns the second-price the
 * candidate would pay if it won over exactly `remaining` (which already
 * EXCLUDES the candidate): empty remaining means the cycle floor (the last
 * candidate always wins at floor).
 */
export async function runCaptureCascade(args: {
  cycleId: string;
  candidates: CandidateRow[];
  computeRemainingPrice: (candidate: CandidateRow, remaining: CandidateRow[]) => number;
  capture?: (
    preBid: Pick<PreBid, 'id' | 'stripePaymentIntentId'>,
    amountCents: number,
    idempotencyKey: string,
  ) => Promise<number>;
  cancel?: (
    preBid: Pick<PreBid, 'id' | 'stripePaymentIntentId'>,
    idempotencyKey: string,
  ) => Promise<void>;
  markLost: (preBidId: string, reason: string) => Promise<void>;
  store?: AttemptStore;
}): Promise<CascadeOutcome> {
  const {
    cycleId,
    candidates,
    computeRemainingPrice,
    capture = capturePreBidAuthorization,
    cancel = cancelPreBidAuthorization,
    markLost,
    store = prismaAttemptStore,
  } = args;

  const outcome: CascadeOutcome = {
    winnerPreBidId: null,
    clearingPriceCents: null,
    captureFailedPreBidIds: [],
    releasedPreBidIds: [],
    releaseFailedPreBidIds: [],
    aborted: false,
  };

  let remaining = [...candidates];

  for (const candidate of candidates) {
    const others = remaining.filter((r) => r.id !== candidate.id);
    const amountCents = computeRemainingPrice(candidate, others);
    const idempotencyKey = settlementIdempotencyKey(cycleId, candidate.id, 'CAPTURE', amountCents);

    // Already captured under this key (a previous pass charged but crashed
    // before recording the win): success without a new Stripe call.
    const alreadyCaptured = await store.findCapturedByKey(idempotencyKey);
    if (alreadyCaptured) {
      outcome.winnerPreBidId = candidate.id;
      outcome.clearingPriceCents = alreadyCaptured.amountCents ?? amountCents;
      break;
    }

    // Persist the intent BEFORE the Stripe call — a crash from here on
    // resumes from this row.
    const attempt = await store.createPending({
      cycleId,
      preBidId: candidate.id,
      kind: 'CAPTURE',
      amountCents,
      idempotencyKey,
    });

    try {
      await capture(candidate, amountCents, idempotencyKey);
      await store.markAttempt(attempt.id, {
        status: 'CAPTURED',
        stripePaymentIntentId: candidate.stripePaymentIntentId,
        stripeResult: JSON.stringify({ amountCents, idempotencyKey }),
      });
      outcome.winnerPreBidId = candidate.id;
      outcome.clearingPriceCents = amountCents;
      break;
    } catch (err) {
      // Unknown errors are retryable: they may hide a successful charge,
      // so falling through to a fallback could double-charge. Abort instead.
      const retryable = err instanceof CaptureFailureError ? err.retryable : true;
      await store.markAttempt(attempt.id, {
        status: retryable ? 'FAILED_RETRYABLE' : 'FAILED_DEFINITIVE',
        stripeResult: err instanceof Error ? err.message : String(err),
        failureKind: retryable ? 'transport' : 'card',
      });
      if (retryable) {
        outcome.aborted = true;
        break;
      }
      outcome.captureFailedPreBidIds.push(candidate.id);
      remaining = remaining.filter((r) => r.id !== candidate.id);
      await markLost(candidate.id, 'capture_failed');
    }
  }

  if (outcome.aborted) return outcome;

  // Release authorizations for every candidate that did not win. Recorded
  // per loser; a failed release persists as RELEASE_FAILED for sweep retry
  // and never blocks the settlement.
  for (const r of remaining) {
    if (r.id === outcome.winnerPreBidId) continue;
    const idempotencyKey = settlementIdempotencyKey(cycleId, r.id, 'RELEASE', null);
    if (await store.findReleasedByKey(idempotencyKey)) {
      outcome.releasedPreBidIds.push(r.id);
      continue;
    }
    const attempt = await store.createPending({
      cycleId,
      preBidId: r.id,
      kind: 'RELEASE',
      amountCents: null,
      idempotencyKey,
    });
    try {
      await cancel(r, idempotencyKey);
      await store.markAttempt(attempt.id, {
        status: 'RELEASED',
        stripeResult: JSON.stringify({ idempotencyKey }),
      });
      outcome.releasedPreBidIds.push(r.id);
    } catch (err) {
      await store.markAttempt(attempt.id, {
        status: 'RELEASE_FAILED',
        stripeResult: err instanceof Error ? err.message : String(err),
        failureKind: 'release',
      });
      outcome.releaseFailedPreBidIds.push(r.id);
    }
  }

  return outcome;
}
