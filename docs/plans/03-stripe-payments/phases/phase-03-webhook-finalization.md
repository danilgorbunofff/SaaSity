# Phase 3.3 — Capture, Release & Cycle Finalization

**Milestone:** [3 · Stripe Pre-Auth & Capture](../PLAN.md) · **Prev:** [3.2 Bid Confirmation & Outbid UI](phase-02-success-cancel-pages.md) · **Next:** [3.4 Test-Mode E2E](phase-04-test-mode-e2e.md)
**Status:** ⚪ Not started · **Estimate:** ~1.5 days

## Goal

The actual Stripe mechanics behind M2 2.3's `finalizeCycle` call: partial-capture the winner, cancel every loser, cascade automatically if the winner's card fails at the last moment — and demote the webhook from sole finalization authority to a reconciliation safety net.

## Prerequisites

- Phase 3.1 (PaymentIntents exist to act on), M2 2.3 (calls this phase's `finalizeCycle` body)

## Steps

1. **Authority shift, stated explicitly: the worker is primary, the webhook is secondary**
   - Previously (pre-pivot, one-time-sale model), the webhook was the sole finalization authority — that matched Stripe Checkout, where Stripe's redirect-back/webhook is the only reliable signal a payment completed. It does **not** fit this model: **the worker (2.3) already knows the winner and the exact clearing price** the instant a cycle's `endAt` passes — it doesn't need to wait for Stripe to tell it anything. So the worker calls Stripe's capture/cancel APIs **directly and synchronously** as part of its own resolution pass; the webhook becomes a **secondary reconciliation listener** for asynchronous signals Stripe can only push after the fact (a capture that later reverses, a card getting flagged, a dispute). This inversion is deliberate — the single most important behavioral difference from the pre-pivot doc, restated here so it's never mistaken for a leftover of the old model
2. **`finalizeCycle(cycle, winnerPreBid, loserPreBids)` — called by 2.3, implemented here**
   - Loser pass first: for each loser `PreBid`, `stripe.paymentIntents.cancel(loser.stripePaymentIntentId)` — releases their full hold immediately; on error (already canceled/expired — benign) log and continue, never let one loser's cancel failure block the winner's capture
   - Winner: `stripe.paymentIntents.capture(winner.stripePaymentIntentId, { amount_to_capture: clearingPriceCents })` — a **partial** capture whenever `clearingPriceCents < maxBidCents` (the common case). Stripe automatically releases the uncaptured remainder of the authorization on capture — this is exactly the spec's "capture only the final winning amount and release remaining holds" requirement, satisfied by Stripe's own capture semantics, not custom release logic
   - Returns a result to 2.3: success (`capturedAmount`, `chargeId`) or failure (declined/expired reason) — 2.3 owns what happens next (the cascade); this function does not loop/retry itself. Keeping the retry/cascade *orchestration* in 2.3 and the *Stripe mechanics* here keeps each phase's responsibility singular
3. **Capture-failure signal, precisely**
   - If `capture()` throws (card expired/declined between authorization and resolution — the known rare case 0.2/2.3 already designed for): this function returns a typed failure result; 2.3's cascade loop calls `finalizeCycle` again with the next-highest remaining bidder as the new candidate winner and a recomputed `clearingPriceCents` — this phase does not need its own cascade loop, it's a pure function of (candidate winner, price) → (captured | failed)
4. **Webhook as reconciliation, not primary path**
   - `POST /api/webhooks/stripe` still exists: raw-body signature verification with `STRIPE_WEBHOOK_SECRET`, verified before any DB work
   - Subscribed events, all *reactive* rather than *authoritative*: `payment_intent.payment_failed` (log + alert if it's for a PreBid the worker believes is still fine — signals a desync worth investigating), `payment_intent.canceled` (confirms a loser's release actually landed; mismatch → alert), `payment_intent.amount_capturable_updated` (informational), and a stub for future dispute handling (`charge.dispute.created` → log + alert only, no automated response — a human process, out of scope per M5)
   - Every handler here is **idempotent and non-authoritative**: it never flips `PreBid`/`AuctionCycle`/`Plot` state on its own — it only logs, alerts, or (for the rare desync case) triggers a reconciliation re-check against what the worker already recorded. If the webhook and the worker ever disagree, **the worker's record wins** and the mismatch is logged for human review (5.3's admin console surfaces it)
5. **Idempotency, restated for the new shape**
   - The worker's own atomicity (2.3's `RESOLVING` conditional-update gate) is what prevents double-capture — not a webhook-side check. `finalizeCycle` is safe to call at most once per cycle by construction, because only one worker invocation ever successfully transitions a cycle into `RESOLVING`
6. **Adversarial cases, each with a test**
   - Winner's card declined at capture → cascades to next bidder (2.3's loop, exercised here via the typed failure return)
   - All bidders' cards fail → cycle resolves with no winner, plot goes `IDLE` (2.3's already-designed terminal case)
   - Webhook replayed for the same PaymentIntent event → no DB writes result (per step 4, the webhook never writes auction state)
   - Bad webhook signature → 400, no DB touch, no Stripe call

## Verification

- Stripe CLI-triggered replay/failure events confirm the webhook never mutates auction state, only logs/alerts
- A simulated capture failure (Stripe test card `4000000000341019`: attach then fail) correctly cascades to the next bidder with the recomputed price
- A normal two-bidder cycle captures exactly `clearingPriceCents` for the winner and shows the loser's hold released in the Stripe test dashboard

## Exit criteria

- [ ] Worker-triggered capture/cancel is provably the sole path that changes `Plot`/`AuctionCycle`/`PreBid` state — webhook handlers touch none of them directly (code review + a test asserts this)
- [ ] Partial capture + auto-release verified in the Stripe test dashboard for a real multi-bidder cycle
- [ ] Capture-failure cascade produces the correct final winner and price, tested at least two levels deep (winner fails, runner-up also fails, third bidder succeeds)
- [ ] Company data (incl. `mrrText`) renders in the city purely from worker-driven writes (2.5's mock path disabled)

## Out of scope / notes

- Refunds triggered by a support agent or a Stripe-side dispute (`charge.dispute.created`) — logged/alerted only, per step 4; manual process documented in 5.3's runbook. This is different from the capture-failure cascade, which is this service automatically routing around a failed card as the only safe response to keep the auction resolving — not reacting to a completed charge being reversed after the fact
