# Phase 3.4 — Test-Mode End-to-End Rehearsal

**Milestone:** [3 · Stripe Pre-Auth & Capture](../PLAN.md) · **Prev:** [3.3 Capture, Release & Cycle Finalization](phase-03-webhook-finalization.md) · **Next:** [Milestone 4](../../04-landing-and-polish/PLAN.md)
**Status:** ⚪ Not started · **Estimate:** ~1.5 days

## Goal

A scripted, repeatable dress rehearsal of money changing hands in Stripe test mode — now covering the whole hold → bid → soft-close → capture/cascade → release lifecycle. The sign-off gate that unlocks M4 and eventually live keys in M5.

## Prerequisites

- Phases 3.1–3.3 complete; test cards working locally

## Steps

1. **Write the script** (this file's table becomes the checklist; keep it in repo as a doc, optionally Playwright later)
   | # | Scenario | Expected |
   |---|----------|----------|
   | 1 | Happy path: claim a $1.00 outer plot, save card via SetupIntent | Cycle goes LIVE, PaymentIntent authorized for $1.00 |
   | 2 | Second bidder outbids within the cycle | Both authorized at their own maxBid; current price reflects the proxy formula; first bidder's UI shows "outbid" |
   | 3 | Cycle resolves (worker fast-forwarded via 2.5's mock trigger) with two bidders | Winner captured at exactly the clearing price; loser's hold canceled/released in the Stripe dashboard |
   | 4 | Bid placed inside the last 3 minutes | Countdown resets to 3:00 remaining, capped at +2h total across a rapid-fire burst |
   | 5 | Two bidders claim the same IDLE plot concurrently | One gets 200 + a new cycle, one gets 409 |
   | 6 | Pre-bid registered for a plot's next cycle, days ahead | SetupIntent only, no PaymentIntent, until that plot's current cycle actually resolves and rotates |
   | 7 | Declined card at authorize-time (test card `4000000000000002`) | That PreBid marked EXPIRED, excluded, rest of cycle unaffected |
   | 8 | Declined card at capture-time (test card `4000000000341019`) | Cascade to the next-highest bidder, correct re-priced capture |
   | 9 | All bidders' cards fail at capture | Cycle resolves with no winner, plot reverts to IDLE, denormalized display cleared |
   | 10 | Webhook replayed via Stripe CLI for a captured PaymentIntent | No auction-state change results; handler only logs |
   | 11 | Worker and webhook race (manually delay webhook delivery) | Worker's resolution is authoritative; the webhook's later arrival changes nothing |
2. **Run on production-equivalent env** — preview deploy with test keys and the real cron/worker trigger, not just localhost
3. **Evidence capture** — screenshots/short clips of scenarios 1, 3, 8, 9 linked from this file; they double as M4 launch-recording raw material
4. **Fix-forward rule** — any scenario failure blocks milestone exit; fixes land with a regression test, re-run the whole table (not just the failed row)

## Verification

- Full table green twice in a row (no flakes)

## Exit criteria

- [ ] Signed-off checklist committed with evidence links
- [ ] Known accepted risks written down (e.g., no receipts, no automated support for Stripe-initiated dispute events) for M5's launch decision
- [ ] `MOCK_PAYMENTS` confirmed off everywhere except explicit demo mode

## Out of scope / notes

- Load/perf at payment scale is a non-issue for 49 plots; real-card live smoke happens once in 5.1
