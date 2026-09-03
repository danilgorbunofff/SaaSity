/** Shared plumbing for the mutating auction routes (phase 2.2). */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  MAX_BID_CENTS,
  validateBidForm,
  type BidMode,
  type FieldErrors,
} from '@/lib/validation/bid-form';
import type { PlotTier } from '@/lib/tiers';

/**
 * Route-body shape: the shared 2.1 form contract is the validator; the
 * maxBidCents contextual minimum is enforced against SERVER truth
 * (cycle current price / tier floor) inside each route, so the client hint
 * is intentionally absent from the wire contract.
 */
export const auctionBodySchema = z.object({
  plotId: z.string().trim().min(1).max(64),
  companyName: z.string().trim().min(1).max(48),
  tagline: z.string().trim().max(80).optional(),
  targetUrl: z.string().trim().min(1).max(2000),
  twitterHandle: z.string().trim().min(1).max(32),
  mrrText: z.string().trim().max(20).optional(),
  maxBidCents: z.number().int().positive().max(MAX_BID_CENTS),
});

export type AuctionBody = z.infer<typeof auctionBodySchema>;

export function errorJson(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

export function fieldErrorsJson(fieldErrors: FieldErrors) {
  return NextResponse.json({ error: 'Invalid submission', fieldErrors }, { status: 422 });
}

/**
 * Server-side structural parse + normalize + twitter/url validation via the
 * ONE shared contract. Contextual maxBid minimum is checked separately
 * per-mode against server state (not the client hint).
 */
export function parseBody(
  body: unknown,
  ctx: { mode: BidMode; tier: PlotTier; selfHostnames?: string[] },
):
  | { ok: true; values: AuctionBody & { tagline?: string; mrrText?: string } }
  | { ok: false; response: NextResponse } {
  const parsed = auctionBodySchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof AuctionBody;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, response: fieldErrorsJson(fieldErrors) };
  }

  // Full shared-contract pass (twitter/url/normalize + min only as fallback).
  // We deliberately ignore its maxBidCents minimum (client-hint based) and
  // re-check contextually with server truth in the routes.
  const validation = validateBidForm(parsed.data, {
    mode: ctx.mode,
    tier: ctx.tier,
    selfHostnames: ctx.selfHostnames,
  });
  if (!validation.ok) {
    return { ok: false, response: fieldErrorsJson(validation.errors) };
  }

  return { ok: true, values: validation.values };
}

/** Standard same-origin guard for mutating endpoints. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // non-browser clients (curl, scripts) allowed
  try {
    const host = request.headers.get('host');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
