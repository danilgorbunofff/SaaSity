import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * Anonymous bidder identity — HMAC-signed httpOnly cookie, NO Bidder table.
 * Payload: { bidderId, stripeCustomerId?, issuedAt }, ~1 year TTL with
 * bounded sliding refresh (re-issued once the cookie is more than half its
 * TTL old, keeping the same bidderId/stripeCustomerId — see
 * `getOrCreateBidderPayload`). Reused by every later milestone (M2
 * claim/bid/prebid, M3 Stripe pre-auth).
 */

const COOKIE_NAME = 'saasity_bidder';
const TTL_SECONDS = 60 * 60 * 24 * 365; // ~1 year
// Refresh once a cookie is more than half-way to expiry, so an active
// bidder is re-issued a fresh ~1 year window well before the old one runs
// out, while a rewrite doesn't happen on literally every single request.
const REFRESH_THRESHOLD_SECONDS = TTL_SECONDS / 2;
const VERSION = 1;

export interface BidderPayload {
  v: number;
  bidderId: string;
  stripeCustomerId?: string;
  issuedAt: number;
}

function getSecret(): string {
  const secret = process.env.BIDDER_COOKIE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('BIDDER_COOKIE_SECRET must be set to a random 32+ byte hex string');
  }
  return secret;
}

function sign(data: string): string {
  return createHmac('sha256', getSecret()).update(data).digest('base64url');
}

export function serializeBidderCookie(payload: BidderPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function parseBidderCookie(raw: string | undefined): BidderPayload | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as BidderPayload;
    if (payload.v !== VERSION || !payload.bidderId) return null;
    const age = (Date.now() - payload.issuedAt) / 1000;
    if (age > TTL_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Read-only lookup (safe in Server Components). */
export async function getBidderPayload(): Promise<BidderPayload | null> {
  const store = await cookies();
  return parseBidderCookie(store.get(COOKIE_NAME)?.value);
}

/** Seconds since a payload was (last) issued/refreshed. Exported for tests. */
export function payloadAgeSeconds(payload: BidderPayload, now = Date.now()): number {
  return (now - payload.issuedAt) / 1000;
}

/** Pure decision: does this still-valid payload need a sliding refresh now? */
export function needsRefresh(payload: BidderPayload, now = Date.now()): boolean {
  return payloadAgeSeconds(payload, now) > REFRESH_THRESHOLD_SECONDS;
}

/**
 * Re-issues a payload with a fresh `issuedAt` (and, once re-serialized, a
 * fresh HMAC signature) while keeping `bidderId`/`stripeCustomerId`
 * identical — "rotate the signature without changing the identity".
 */
export function refreshPayload(payload: BidderPayload, now = Date.now()): BidderPayload {
  return { ...payload, issuedAt: now };
}

function setBidderCookie(store: Awaited<ReturnType<typeof cookies>>, payload: BidderPayload): void {
  store.set({
    name: COOKIE_NAME,
    value: serializeBidderCookie(payload),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: TTL_SECONDS,
    path: '/',
  });
}

/**
 * Read-or-create (route handlers / server actions only — it may set the
 * cookie). Returns the existing payload when valid, otherwise mints a fresh
 * anonymous bidder and sets a signed httpOnly cookie.
 *
 * Bounded sliding refresh: a still-valid payload older than
 * `REFRESH_THRESHOLD_SECONDS` is re-issued with the same `bidderId` /
 * `stripeCustomerId` but a new `issuedAt` (and therefore a new signature —
 * "rotate the signature without changing the identity"), extending the
 * cookie's life by another full TTL from now. An active bidder is never
 * logged out mid-use; a truly inactive one still hard-expires at the
 * original TTL because nothing refreshes a payload no request ever reads.
 */
export async function getOrCreateBidderPayload(): Promise<BidderPayload> {
  const store = await cookies();
  const existing = parseBidderCookie(store.get(COOKIE_NAME)?.value);
  if (existing) {
    if (needsRefresh(existing)) {
      const refreshed = refreshPayload(existing);
      setBidderCookie(store, refreshed);
      return refreshed;
    }
    return existing;
  }

  const fresh: BidderPayload = {
    v: VERSION,
    bidderId: crypto.randomUUID(),
    issuedAt: Date.now(),
  };
  setBidderCookie(store, fresh);
  return fresh;
}

export const BIDDER_COOKIE_NAME = COOKIE_NAME;
export const BIDDER_COOKIE_TTL_SECONDS = TTL_SECONDS;
export const BIDDER_COOKIE_REFRESH_THRESHOLD_SECONDS = REFRESH_THRESHOLD_SECONDS;
