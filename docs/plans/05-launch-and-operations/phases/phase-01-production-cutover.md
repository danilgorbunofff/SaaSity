# Phase 5.1 — Production Cutover

**Milestone:** [5 · Launch & Operations](../PLAN.md) · **Prev:** [Milestone 4](../../04-landing-and-polish/PLAN.md) · **Next:** [5.2 Hardening & Rate Limits](phase-02-hardening-ratelimits.md)
**Status:** ⚪ Not started · **Estimate:** ~0.5 day

## Goal

Flip the whole stack to production-grade: live Stripe, real domain, backups on, worker/cron actually scheduled — with a real-dollar smoke test proving the full claim→bid→resolve→capture path. Gate: M3's 3.4 table and M4's exit criteria must be green before starting.

## Prerequisites

- 3.4 signed off; 4.4 completed or explicitly waived item-by-item

## Steps

1. **Env & secrets audit**
   - Walk `.env.example` line by line against Vercel prod/preview/dev values: nothing missing, nothing test-keyed in prod, `MOCK_PAYMENTS` absent (2.5's mock-resolve endpoint must be unreachable in prod per its own exit criteria — verify, don't just trust the flag)
   - Rotate any credential that ever lived in a shared terminal history
2. **Stripe live mode**
   - Live keys; register the reconciliation webhook endpoint for the **reactive-only** event set from 3.3: `payment_intent.payment_failed`, `payment_intent.canceled`, `payment_intent.amount_capturable_updated`, `charge.dispute.created` — this webhook still never mutates Plot/AuctionCycle/PreBid state itself (worker's record wins per 3.3); it logs/alerts
   - Enable Stripe's standard receipt emails on capture → record verdict here (recommend: on, zero-effort receipts for the winning capture only — losers are never charged, so no receipt-suppression logic needed)
3. **Database hardening**
   - Prod DB: backups/PITR enabled, connection pooling configured for serverless (PgBouncer/Neon pooler), migration deploy wired to release gate
4. **Worker/cron verified live** (new, launch-critical — this didn't exist under the old model)
   - Confirm 2.3's Vercel Cron schedule (~30–60s) is actually registered and firing in production, not just locally; confirm the endpoint is protected (5.2 covers the mechanism) so only the scheduler can trigger it
   - Deliberately backdate one real cycle's `endAt` in prod and confirm the very next cron tick resolves it correctly end-to-end (mirrors 2.3's own verification step, re-run here against real infra)
5. **Domain & TLS**
   - Final domain on Vercel (www/apex redirects), canonical URL env used everywhere it's referenced (OG routes, share links) — verify no `vercel.app` leaks into Stripe or share links
6. **Live smoke test (claim → bid → resolve → capture)**
   - There is no more instant "buy" — a real cycle runs for hours (6h/12h/24h by tier) — so waiting for natural resolution isn't practical for a smoke test. **Do not reuse 2.5's `/api/mock-resolve/:cycleId`** — that path stubs payments and must stay unreachable in prod. Instead, write a small one-off protected script (same pattern as 4.3's `logoHidden` stopgap) that calls the *real* `resolveCycle`/`finalizeCycle` functions directly against one real, real-money cycle: claim a cheap outer plot for real money → confirm the SetupIntent/PaymentIntent pre-auth hold appears on the card → run the script to force resolution immediately instead of waiting 6h → confirm the real capture lands for the clearing price → refund via Stripe dashboard as a documented test-purchase cleanup
   - This same script is what 5.3 later wraps in the admin console's "force-resolve" action — this phase proves the underlying capability works against real Stripe before it gets a UI
   - Verify 3.3's reconciliation webhook logs the real events cleanly for this test cycle
7. **Rollback plan**
   - Document: revert = Vercel rollback + Stripe webhook endpoint disabled + **worker/cron paused** (a rolled-back schema with a still-running cron is a real corruption risk, unlike the old checkout-only model which had no scheduled job at all) + DB restore point referenced; rehearse the rollback button once on preview

## Verification

- Smoke-test checklist from 3.4 scenarios re-run in live mode (condensed), plus this phase's own step 6 real-money cycle

## Exit criteria

- [ ] Production URL + one real-money lease claimed, bid on, force-resolved, and captured correctly (refunded as test cleanup)
- [ ] Worker/cron confirmed firing on schedule in production, protected from public triggering
- [ ] Secrets audit signed with date; rotation notes recorded
- [ ] Backup restore path verified (point-in-time test or hosted snapshot documented)

## Out of scope / notes

- Marketing push is 5.4 — traffic before this phase completes must be treated as an incident
- The full admin UI around force-resolve is 5.3's job; this phase only needs the underlying script to work
