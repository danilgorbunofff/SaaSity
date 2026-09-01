import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Anonymous bidder identity — HMAC-signed httpOnly cookie, NO Bidder table.
 * Payload: { bidderId, stripeCustomerId?, issuedAt }, ~1 year TTL.
 * Reused by every later milestone (M2 claim/bid/prebid, M3 Stripe pre-auth).
 */

const COOKIE_NAME = "saasity_bidder";
const TTL_SECONDS = 60 * 60 * 24 * 365; // ~1 year
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
    throw new Error(
      "BIDDER_COOKIE_SECRET must be set to a random 32+ byte hex string",
    );
  }
  return secret;
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function serializeBidderCookie(payload: BidderPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function parseBidderCookie(raw: string | undefined): BidderPayload | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as BidderPayload;
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

/**
 * Read-or-create (route handlers / server actions only — it may set the
 * cookie). Returns the existing payload when valid, otherwise mints a fresh
 * anonymous bidder and sets a signed httpOnly cookie.
 */
export async function getOrCreateBidderPayload(): Promise<BidderPayload> {
  const store = await cookies();
  const existing = parseBidderCookie(store.get(COOKIE_NAME)?.value);
  if (existing) return existing;

  const fresh: BidderPayload = {
    v: VERSION,
    bidderId: crypto.randomUUID(),
    issuedAt: Date.now(),
  };
  store.set({
    name: COOKIE_NAME,
    value: serializeBidderCookie(fresh),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TTL_SECONDS,
    path: "/",
  });
  return fresh;
}

export const BIDDER_COOKIE_NAME = COOKIE_NAME;
