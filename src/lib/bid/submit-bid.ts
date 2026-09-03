/**
 * Phase 2.5 — the modal's single submit path to the real 2.2 engine.
 * (2.1's `/api/mock/bids` is gone: the client now writes real cycles.)
 *
 * One function, three modes → three endpoints, and a discriminated result
 * the modal can render without guessing at status codes. Server truth wins
 * everywhere: 422 field errors replace the local ones verbatim, 409s carry
 * a `code` the modal maps to copy instead of a generic failure.
 */

import type { BidFormInput, BidMode, FieldErrors } from '@/lib/validation/bid-form';

export type SubmitResult =
  | {
      kind: 'ok';
      mode: BidMode;
      cycleId: string | null;
      endAt: string | null;
      currentPriceCents: number | null;
      youAreLeader: boolean;
      minimumNextBidCents: number | null;
      /** /bid only — soft-close pushed endAt out on this request. */
      softCloseExtended: boolean;
    }
  | { kind: 'outbid'; message: string; minimumNextBidCents?: number }
  | { kind: 'claim-first'; message: string }
  | { kind: 'fieldErrors'; fieldErrors: FieldErrors }
  | { kind: 'error'; message: string; retryAfterSeconds?: number };

const ENDPOINT: Record<BidMode, (plotId: string) => string> = {
  claim: (plotId) => `/api/plots/${encodeURIComponent(plotId)}/claim`,
  bid: (plotId) => `/api/plots/${encodeURIComponent(plotId)}/bid`,
  prebid: (plotId) => `/api/plots/${encodeURIComponent(plotId)}/prebid`,
};

interface ErrorBody {
  error?: string;
  code?: string;
  fieldErrors?: FieldErrors;
  minimumNextBidCents?: number;
  currentPriceCents?: number;
  yourMaxBidCents?: number;
  retryAfterSeconds?: number;
}

export async function submitBid(args: {
  plotId: string;
  mode: BidMode;
  values: BidFormInput;
}): Promise<SubmitResult> {
  const { plotId, mode, values } = args;

  let res: Response;
  try {
    res = await fetch(ENDPOINT[mode](plotId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, plotId }),
    });
  } catch {
    return { kind: 'error', message: 'Network error — the bid was NOT submitted.' };
  }

  const body = (await res.json().catch(() => ({}))) as ErrorBody & Record<string, unknown>;

  if (res.ok) {
    // /prebid has no live cycle yet: nothing to count down to.
    if (mode === 'prebid') {
      return {
        kind: 'ok',
        mode,
        cycleId: null,
        endAt: null,
        currentPriceCents: null,
        youAreLeader: false,
        minimumNextBidCents: null,
        softCloseExtended: false,
      };
    }
    return {
      kind: 'ok',
      mode,
      cycleId: (body.cycleId as string | undefined) ?? null,
      endAt: (body.endAt as string | undefined) ?? null,
      currentPriceCents: (body.currentPriceCents as number | undefined) ?? null,
      youAreLeader: body.youAreLeader === true,
      minimumNextBidCents: (body.minimumNextBidCents as number | undefined) ?? null,
      softCloseExtended: body.softCloseExtended === true,
    };
  }

  if (res.status === 422 && body.fieldErrors) {
    return { kind: 'fieldErrors', fieldErrors: body.fieldErrors };
  }

  if (res.status === 429) {
    return {
      kind: 'error',
      message: body.error ?? 'Too many requests — wait a moment and try again.',
      ...(typeof body.retryAfterSeconds === 'number'
        ? { retryAfterSeconds: body.retryAfterSeconds }
        : {}),
    };
  }

  if (res.status === 409 && body.code === 'outbid') {
    return {
      kind: 'outbid',
      message:
        mode === 'claim'
          ? 'Someone claimed this plot a moment before you.'
          : 'A rival bid landed first — someone else now leads.',
      ...(typeof body.minimumNextBidCents === 'number'
        ? { minimumNextBidCents: body.minimumNextBidCents }
        : {}),
    };
  }

  if (res.status === 409 && body.code === 'claim-first') {
    // Stale pre-bid tab: the auction closed (or never opened) while the
    // form was up. The modal flips into claim mode on this kind.
    return {
      kind: 'claim-first',
      message: body.error ?? 'This plot has no active auction yet — claim it to open the bidding.',
    };
  }

  return {
    kind: 'error',
    message: body.error ?? 'Something went wrong — try again.',
  };
}
