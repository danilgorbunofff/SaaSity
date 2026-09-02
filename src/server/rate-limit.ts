/**
 * Phase 2.2 — in-memory fixed-window rate limit for mutating auction
 * endpoints. Two stacked guards, both in-memory fixed windows:
 *  - per (IP + bidder): 10 mutating requests / minute (documented limit);
 *  - per IP only: 30 mutating requests / minute — a cookie-less client mints
 *    a fresh bidderId per request, so the combined key alone would never trip
 *    for it. The IP bucket closes that rotation hole while leaving a shared
 *    NAT/office IP room for several legitimate bidders.
 * Single-node dev guard. Multi-node production would swap this for Redis —
 * the call sites only depend on `checkMutationRateLimit` returning
 * allowed/denied.
 */

interface Bucket {
  windowStart: number;
  count: number;
}

const WINDOW_MS = 60_000;

/** Limit for the combined ip:bidderId key. */
const MAX_PER_IDENTITY = 10;

/** Limit for the ip-only key (rotation guard). */
const MAX_PER_IP = 30;

const buckets = new Map<string, Bucket>();

// Periodically drop stale buckets so the map cannot grow unbounded.
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function consume(key: string, max: number, now: number): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function checkRateLimit(key: string, now: number = Date.now()): RateLimitResult {
  return consume(key, MAX_PER_IDENTITY, now);
}

/**
 * Stacked guard for mutating endpoints: consumes both the identity bucket
 * and the IP bucket. A denial from either denies the request (already-
 * consumed counts on the other bucket are fine — denied attempts counting
 * toward the limit is desirable for an abuse guard).
 */
export function checkMutationRateLimit(ip: string, bidderId: string): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const identity = consume(`${ip}:${bidderId}`, MAX_PER_IDENTITY, now);
  if (!identity.allowed) return identity;

  const perIp = consume(`ip:${ip}`, MAX_PER_IP, now);
  if (!perIp.allowed) return perIp;

  return identity;
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
