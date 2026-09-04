/**
 * Phase 2.1 — ONE shared bid/claim/pre-bid field contract.
 * Used verbatim by the client modal and the server routes so validation
 * can never drift between the two sides (exit criterion of phase 2.1).
 */

import { z } from 'zod';
import { TIERS, type PlotTier } from '@/lib/tiers';

export type BidMode = 'claim' | 'bid' | 'prebid';

/**
 * Part 6 `amount-parser`: the ONLY dollars→cents conversion the UI may use.
 * Strict by construction — `Number.parseFloat` accepted prefixes like `5junk`
 * and float math blurred cent boundaries. This parser:
 *  - allows only digits with an optional `.` + 1-2 fractional digits,
 *  - rejects separators, locale formats, signs, exponents, trailing chars,
 *  - rejects zero/empty (a bid must be an explicit positive amount),
 *  - caps at MAX_BID_CENTS so absurd values fail fast client-side,
 *  - computes integer cents from the string parts (no float ambiguity).
 */
export const MAX_BID_CENTS = 10_000_000; // $100,000 — well above any tier floor

export type ParseAmountResult = { ok: true; cents: number } | { ok: false; error: string };

export function parseDollarsToCents(raw: string): ParseAmountResult {
  const text = raw.trim().replace(/,/g, '');
  if (raw.includes(','))
    return {
      ok: false,
      error: 'Commas/thousands separators are not allowed — type digits only (e.g. 12.50)',
    };
  if (text === '') return { ok: false, error: 'Enter an amount in USD' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return {
      ok: false,
      error: 'Use digits with up to 2 decimals (e.g. 12.50) — no letters, symbols, or exponents',
    };
  }
  const [dollars, fraction = ''] = text.split('.');
  const cents = Number(dollars) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    return { ok: false, error: 'Amount must be more than $0.00' };
  }
  if (cents > MAX_BID_CENTS) {
    return {
      ok: false,
      error: `Amount exceeds the $${(MAX_BID_CENTS / 100).toLocaleString('en-US')} maximum`,
    };
  }
  return { ok: true, cents };
}

export const bidFormSchema = z.object({
  plotId: z.string().trim().min(1, 'Plot is required').max(64),
  companyName: z.string().trim().min(1, 'Company name is required').max(48, 'Max 48 characters'),
  tagline: z.string().trim().max(80, 'Max 80 characters').optional(),
  targetUrl: z.string().trim().min(1, 'Target URL is required').max(2000),
  twitterHandle: z.string().trim().min(1, 'X handle is required').max(32),
  mrrText: z.string().trim().max(20, 'Max 20 characters').optional(),
  maxBidCents: z
    .number()
    .int('Whole cents only')
    .positive('Must be a positive amount')
    .max(MAX_BID_CENTS, 'Amount exceeds the $100,000 maximum'),
});

export type BidFormInput = z.input<typeof bidFormSchema>;
export type BidFormValues = z.output<typeof bidFormSchema>;

/**
 * Contextual minimum for maxBidCents — never a fixed number:
 *  - claim  (IDLE plot)      -> tier floor (clean-slate cycle open)
 *  - bid    (LIVE cycle)     -> current price + tier increment
 *  - prebid (next cycle)     -> tier floor (next cycle state is unknown)
 */
export function minimumBidCents(mode: BidMode, tier: PlotTier, currentPriceCents?: number): number {
  const cfg = TIERS[tier];
  if (mode === 'bid') {
    return (currentPriceCents ?? cfg.floorCents) + cfg.incrementCents;
  }
  return cfg.floorCents;
}

/** Normalize "@acme" -> "acme"; returns null when structurally invalid. */
export function normalizeTwitterHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@+/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

export interface UrlResult {
  ok: boolean;
  value?: string;
  error?: string;
}

/**
 * https-only, normalized target URL. Rejects hostile schemes
 * (javascript:, data:, vbscript:, file:), localhost/private hosts,
 * Stripe domains and the app host itself ("self").
 * http:// is upgraded to https://; anything unparseable is rejected.
 */
export function normalizeTargetUrl(raw: string, selfHostnames: string[] = []): UrlResult {
  let candidate = raw.trim();
  if (!candidate) return { ok: false, error: 'Target URL is required' };
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) candidate = 'https://' + candidate;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: 'Not a valid URL' };
  }

  const scheme = url.protocol.toLowerCase();
  if (scheme !== 'https:' && scheme !== 'http:') {
    return { ok: false, error: 'Only http(s) URLs are allowed' };
  }

  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host.startsWith('127.') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return { ok: false, error: 'Local/private addresses are not allowed' };
  }
  if (host === 'stripe.com' || host.endsWith('.stripe.com')) {
    return { ok: false, error: 'Stripe domains are not allowed' };
  }
  for (const self of selfHostnames) {
    const s = self.toLowerCase();
    if (s && (host === s || host.endsWith('.' + s))) {
      return { ok: false, error: 'Cannot point at this site itself' };
    }
  }

  url.hash = '';
  if (url.protocol === 'http:') url.protocol = 'https:';
  // Trim trailing slashes (incl. bare root) for tidy billboards.
  let value = url.toString();
  if (value.endsWith('/')) value = value.slice(0, -1);
  return { ok: true, value };
}

export type FieldErrors = Partial<Record<keyof BidFormInput, string>>;

export type BidFormValidation =
  | { ok: true; errors: FieldErrors; values: BidFormValues }
  | { ok: false; errors: FieldErrors; values?: undefined };

/**
 * The single entry point both sides call: structural schema +
 * twitter/URL normalization + contextual maxBidCents minimum.
 */
export function validateBidForm(
  input: BidFormInput,
  ctx: { mode: BidMode; tier: PlotTier; currentPriceCents?: number; selfHostnames?: string[] },
): BidFormValidation {
  const parsed = bidFormSchema.safeParse(input);
  const errors: FieldErrors = {};

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof BidFormInput;
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }

  // Contextual checks run even when the schema already flagged other
  // fields, so the user sees EVERY problem in one pass, not one per edit.
  const rawHandle = parsed.success ? parsed.data.twitterHandle : input.twitterHandle;
  let handle: string | null = null;
  if (typeof rawHandle === 'string' && !errors.twitterHandle) {
    handle = normalizeTwitterHandle(rawHandle);
    if (!handle) errors.twitterHandle = 'Use 1-15 letters, numbers or _ (no @ needed)';
  }

  const rawUrl = parsed.success ? parsed.data.targetUrl : input.targetUrl;
  let url: UrlResult = { ok: false };
  if (typeof rawUrl === 'string' && !errors.targetUrl) {
    url = normalizeTargetUrl(rawUrl, ctx.selfHostnames ?? []);
    if (!url.ok) errors.targetUrl = url.error ?? 'Invalid URL';
  }

  const rawMax = parsed.success ? parsed.data.maxBidCents : input.maxBidCents;
  if (typeof rawMax === 'number' && Number.isInteger(rawMax) && !errors.maxBidCents) {
    if (rawMax > MAX_BID_CENTS) {
      errors.maxBidCents = 'Amount exceeds the $100,000 maximum';
    } else {
      const min = minimumBidCents(ctx.mode, ctx.tier, ctx.currentPriceCents);
      if (rawMax < min) {
        errors.maxBidCents = 'Must be at least $' + (min / 100).toFixed(2) + ' for this action';
      }
    }
  }

  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  const cleanHandle = handle ?? normalizeTwitterHandle(parsed.data.twitterHandle);
  const cleanUrl =
    url.value ?? normalizeTargetUrl(parsed.data.targetUrl, ctx.selfHostnames ?? []).value;
  return {
    ok: true,
    errors,
    values: {
      ...parsed.data,
      twitterHandle: cleanHandle ?? parsed.data.twitterHandle,
      targetUrl: cleanUrl ?? parsed.data.targetUrl,
    },
  };
}
