# Phase 5.2 — Hardening & Rate Limits

**Milestone:** [5 · Launch & Operations](../PLAN.md) · **Prev:** [5.1 Production Cutover](phase-01-production-cutover.md) · **Next:** [5.3 Observability & Admin](phase-03-observability-admin.md)
**Status:** ⚪ Not started · **Estimate:** ~0.5–1 day

## Goal

Launch-day strangers cannot break the grid, spam claims/bids, use it for card-testing, or burn money/DB with request storms.

## Prerequisites

- 5.1 (prod-shaped system to attack)

## Steps

1. **Abuse surface inventory** (write results at bottom of this file)
   - `POST` claim/bid/pre-bid endpoints (M2 2.2) — the *real* abuse risk under this model isn't free griefing (claiming now requires a valid card passing Stripe pre-auth), it's **carding**: using SetupIntent/PaymentIntent creation to mass-validate stolen card numbers. This is a materially different, more serious threat than the old model's "lock all 36 outer plots for 15 min" griefing case
   - Worker/cron endpoint (2.3) — new surface that didn't exist pre-pivot; must reject any caller that isn't the scheduler
   - Reconciliation webhook — must reject forged traffic; SSE — cheap to open, bound connections; both OG image routes (4.3: revalidating generic + immutable per-cycle) — edge CPU
2. **Rate limiting**
   - Route-level limits per IP + per-bidder-cookie: claim/bid/pre-bid strictest (these are the ones touching Stripe card operations); use Vercel/WAF or an in-app limiter (Upstash/in-memory per instance, documented as approximate on serverless)
   - Per-bidder cooldown on manual bids specifically (e.g. no more than 1 submission per few seconds) — separate from the general rate limit, aimed at preventing a single actor from soft-close-extending a cycle solo; the +2h extension cap (M2 2.3) already bounds the worst case, this just makes hitting that cap harder to do cheaply
   - 429 responses with `Retry-After`; modal shows calm "slow down" copy, not a crash
3. **Worker/cron endpoint protection**
   - Shared-secret header or Vercel Cron's built-in signed-request verification — this endpoint executes real Stripe captures, so an unauthenticated public trigger is a launch-blocking risk, not just a nuisance
4. **Card-testing / fraud policy decision (document verdict)**
   - Options: rely on Stripe Radar's default rules (recommended baseline — enable and review the risk-score dashboard before launch), add CAPTCHA (hCaptcha, invisible) on first-time SetupIntent creation specifically (registration, not every bid), and/or cap active PreBids per bidder cookie
   - Recommendation: Radar on by default + bidder-cookie cap (e.g. max N pending pre-bids) + CAPTCHA held in reserve as a flag, flipped on **only if** launch traffic shows carding attempts — bidder cookie already exists from M2 2.1
5. **Input walls**
   - Body size caps on all routes; text fields re-clamped server-side (length, control chars); URL fields re-validated at worker-write time too (defense in depth on stored `targetUrl` — relink uses `rel="nofollow noopener"`, rendered with `http(s)`-only sanitizer at read)
6. **Dependency & header hygiene**
   - `npm audit` triaged; security headers (CSP where feasible without breaking three.js/Stripe Elements/SSE — document the relaxations), HSTS, frame protections

## Verification

- Scripted: 100 rapid claim/bid attempts → clean 429s, no 5xx, no card operation succeeds past the limit; forged webhook storm → all 400s, alert noise checked; unauthenticated worker-endpoint call → rejected

## Exit criteria

- [ ] Abuse inventory table filled with per-route decisions
- [ ] Card-testing/fraud policy written down with its kill-switch ready (env flag for CAPTCHA)
- [ ] Worker/cron endpoint confirmed unreachable without the shared secret
- [ ] Load sanity: `/api/plots` + SSE hold up to launch-order concurrency (verify cache headers actually work)

## Out of scope / notes

- Legal/DDoS-grade protection: CDN defaults are the ceiling at this project size
