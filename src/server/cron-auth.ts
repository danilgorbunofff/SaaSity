/**
 * Shared-secret gate for the external settlement trigger
 * (`GET/POST /api/cron/resolve`).
 *
 * Pure function of the request headers + `WORKER_SECRET` so the authorization
 * rule itself is unit-testable without touching the database (the route
 * handler behind it runs the worker and is covered by proof scripts instead).
 * External cron callers have no Origin header and no bidder cookie, so this
 * deliberately bypasses the cookie-based bidder guards.
 */
import { timingSafeEqual } from 'node:crypto';

function secretEquals(provided: string | null, secret: string): boolean {
  if (provided == null) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isCronRequestAuthorized(req: Request): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;
  if (secretEquals(req.headers.get('authorization'), 'Bearer ' + secret)) return true;
  return secretEquals(req.headers.get('x-worker-secret'), secret);
}
