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
 */

import type { PreBid } from '@/generated/prisma/client';
import { requireMockPayments } from '@/server/mock-payments';

/**
 * M3 STUB — real implementation captures the manual-capture PaymentIntent
 * for exactly `amountCents` (<= authorized maxBidCents).
 * Returns the captured amount on success; throws on failure.
 *
 * Phase 2.5: gated on MOCK_PAYMENTS=1 — without the flag this throws, so a
 * misconfigured deployment never crowns an unpaid winner.
 */
export async function capturePreBidAuthorization(
  preBid: Pick<PreBid, 'id' | 'stripePaymentIntentId'>,
  amountCents: number,
): Promise<number> {
  requireMockPayments('capturePreBidAuthorization');
  if (amountCents < 0) {
    throw new Error(`Invalid capture amount: ${amountCents} for preBid ${preBid.id}`);
  }
  return amountCents;
}

/**
 * M3 STUB — real implementation cancels the manual-capture PaymentIntent
 * (releases the hold). Must be idempotent.
 */
export async function cancelPreBidAuthorization(
  _preBid: Pick<PreBid, 'id' | 'stripePaymentIntentId'>,
): Promise<void> {
  requireMockPayments('cancelPreBidAuthorization');
}

// ---------------------------------------------------------------------------
// Test hooks — the proof script runs the worker in-process and flips these
// to force capture failures. No production path calls them.
// ---------------------------------------------------------------------------

const injectedFailures = new Set<string>();

export function injectCaptureFailure(preBidId: string): void {
  injectedFailures.add(preBidId);
}

export function clearCaptureFailures(): void {
  injectedFailures.clear();
}

function isCaptureFailureInjected(preBidId: string): boolean {
  return injectedFailures.has(preBidId);
}

const injectedAttachFailures = new Set<string>();

export function injectAttachAuthFailure(preBidId: string): void {
  injectedAttachFailures.add(preBidId);
}

export function clearAttachAuthFailures(): void {
  injectedAttachFailures.clear();
}

/**
 * M3 STUB — creates the manual-capture PaymentIntent pre-authorization for
 * the pre-bid's maxBidCents at next-cycle attach time (the 7-day hold
 * window starts here, per the deferred-timing rule). Throws on failure;
 * the worker excludes that pre-bid from the cycle (EXPIRED / 'expired').
 */
export async function authorizePreBidAtAttach(
  preBid: Pick<PreBid, 'id' | 'stripePaymentIntentId'>,
): Promise<void> {
  requireMockPayments('authorizePreBidAtAttach');
  if (injectedAttachFailures.has(preBid.id)) {
    throw new Error(`Injected attach-auth failure for preBid ${preBid.id}`);
  }
  // no-op in 2.3
}

// ---------------------------------------------------------------------------

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
}

/**
 * Capture cascade over resolution candidates, best-first.
 *
 * For candidate i, the capture amount is the second-price that would hold if
 * every better candidate failed: computeResolution over the remaining
 * candidates' max bids with the cycle floor/increment. The last remaining
 * candidate captures at the floor. All failures happen outside the caller's
 * flow — each failed candidate is marked LOST (lostReason 'capture_failed')
 * in its own transaction.
 *
 * `computeRemainingPrice(candidate, remaining)` returns the second-price the
 * candidate would pay if it won over exactly `remaining` (which already
 * EXCLUDES the candidate): empty remaining means the cycle floor (the last
 * candidate always wins at floor).
 */
export async function runCaptureCascade(args: {
  candidates: CandidateRow[];
  computeRemainingPrice: (candidate: CandidateRow, remaining: CandidateRow[]) => number;
  capture: (preBid: Pick<PreBid, 'id' | 'stripePaymentIntentId'>, amountCents: number) => Promise<number>;
  cancel: (preBid: Pick<PreBid, 'id' | 'stripePaymentIntentId'>) => Promise<void>;
  markLost: (preBidId: string, reason: string) => Promise<void>;
}): Promise<CascadeOutcome> {
  const { candidates, computeRemainingPrice, capture, cancel, markLost } = args;

  const outcome: CascadeOutcome = {
    winnerPreBidId: null,
    clearingPriceCents: null,
    captureFailedPreBidIds: [],
    releasedPreBidIds: [],
  };

  let remaining = [...candidates];

  for (const candidate of candidates) {
    if (isCaptureFailureInjected(candidate.id)) {
      outcome.captureFailedPreBidIds.push(candidate.id);
      remaining = remaining.filter((r) => r.id !== candidate.id);
      await markLost(candidate.id, 'capture_failed');
      continue;
    }

    const others = remaining.filter((r) => r.id !== candidate.id);
    const amountCents = computeRemainingPrice(candidate, others);

    try {
      await capture(candidate, amountCents);
      outcome.winnerPreBidId = candidate.id;
      outcome.clearingPriceCents = amountCents;
      break;
    } catch {
      outcome.captureFailedPreBidIds.push(candidate.id);
      remaining = remaining.filter((r) => r.id !== candidate.id);
      await markLost(candidate.id, 'capture_failed');
    }
  }

  // Release authorizations for every candidate that did not win.
  for (const r of remaining) {
    if (r.id === outcome.winnerPreBidId) continue;
    try {
      await cancel(r);
      outcome.releasedPreBidIds.push(r.id);
    } catch {
      // Release failure must never block resolution; M3 retries via Stripe.
    }
  }

  return outcome;
}
