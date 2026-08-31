# Milestone 3 — Stripe Pre-Auth & Capture

**Prev:** [02 · Auctions & Realtime](../02-reservations-and-realtime/PLAN.md) · **Next:** [04 · Landing & Polish](../04-landing-and-polish/PLAN.md)
**Status:** ⚪ Not started

> Folder kept as `03-stripe-payments` to avoid renumbering every cross-file link — read this milestone as **"Stripe Pre-Auth & Capture"** throughout.

## Objective

Replace the mock payment stub with real money, using a hold-now/capture-later flow that actually matches the auction model. Stripe's hosted-redirect **Checkout Session cannot express "authorize a ceiling now, decide the exact amount later"** — so this milestone never uses it. Instead: in-page Stripe Elements collect a card once (SetupIntent), a manual-capture PaymentIntent authorizes each bidder's `maxBidCents` only once their PreBid attaches to a real, started cycle, and **M2 2.3's worker** — not the webhook — captures the winner's clearing price and releases every loser's hold the instant a cycle ends. This milestone gates launch — correctness over speed.

## In scope

- `POST /api/pay/setup-intent`: zero-dollar SetupIntent to save a card (no hold) — backs pre-bid registration and any claim/bid from a bidder without a saved card yet
- `POST /api/pay/authorize`: creates the real manual-capture `PaymentIntent` for `maxBidCents` the moment a `PreBid` attaches to a started cycle (called from 2.2's claim/bid for live cycles, and from 2.3's worker at rotation time for previously-queued pre-bids)
- Stripe Elements/PaymentElement mounted in-page in the bid modal (replaces 2.1's payment-step stub) — no redirect, no leaving the SPA
- `finalizeCycle` implementation: **partial-capture** the winner's PaymentIntent for `clearingPriceCents` (Stripe auto-releases the uncaptured remainder), **cancel** every loser's PaymentIntent outright — called synchronously by M2 2.3's worker at resolution, not triggered by the webhook
- Capture-failure cascade mechanics (the Stripe calls; the retry loop itself is owned by 2.3)
- `POST /api/webhooks/stripe`: now a **secondary reconciliation listener** (`payment_intent.payment_failed`/`canceled`/`amount_capturable_updated`, later disputes) — logs and alerts on desync, never itself flips `Plot`/`AuctionCycle`/`PreBid` state
- Bid confirmation + reload-safe "you're leading / outbid / won / lost" UI, backed by the bidder cookie
- Stripe test-mode E2E rehearsal covering hold, bid, soft-close, capture, cascade, and release

## Out of scope

- Refunds/dashboard UX beyond the built-in capture-failure cascade (M5), logo uploads, marketing

## Planned phases

| Phase | File | Focus |
|-------|------|-------|
| 3.1 | [pre-authorization API](phases/phase-01-checkout-session-api.md) | SetupIntent + PaymentIntent creation, Elements mounted in-page |
| 3.2 | [bid confirmation & outbid UI](phases/phase-02-success-cancel-pages.md) | Reload-safe leading/outbid/won/lost state, "my bids" panel |
| 3.3 | [capture, release & cycle finalization](phases/phase-03-webhook-finalization.md) | `finalizeCycle` body, cascade, webhook demoted to reconciliation |
| 3.4 | [test-mode E2E](phases/phase-04-test-mode-e2e.md) | Full scripted rehearsal incl. cascade/failure cases |

## Deliverables

- A real (test-mode) card authorization → live bidding → capture-only-the-clearing-price flow working end to end, observable in the Stripe test dashboard
- Runbook doc: local webhook testing + production endpoint registration + cron/worker deployment note (cross-ref to M2 2.3 and M5)

## Definition of done

- [ ] Every authorization amount matches the bidder's submitted `maxBidCents` exactly — never client-supplied at capture time, never pre-inflated
- [ ] At resolution, exactly `clearingPriceCents` is captured for the winner; every other authorized PreBid on that cycle is canceled/released
- [ ] A card that fails at capture time cascades to the next-highest bidder automatically, never blocking the cycle from finalizing
- [ ] E2E checklist passed in test mode and signed off before M5 flips live keys

## Dependencies

- **M2** (proxy engine, cycle resolution worker, realtime feed) — hard prerequisite
- Stripe account + test API keys (environment setup in phase 3.1)

## Risks & mitigations

- **Authorization hold expiring before its cycle resolves** → bounded by 0.2/2.3's deferred-timing rule: a PaymentIntent is only ever created once a PreBid attaches to an already-started cycle, so its lifetime is always (cycle duration + capped soft-close extension), safely under Stripe's 7-day manual-capture limit regardless of how far ahead the pre-bid was scheduled
- **Double-capture / replayed webhook events** → idempotency comes from 2.3's `RESOLVING` conditional-update gate (only one worker invocation ever resolves a cycle), not from webhook-side checks — the webhook never writes auction state at all
- **Capture failure at resolution** → the cascade policy (3.3, orchestrated by 2.3) always produces a definite outcome (a lower-bidding winner, or the plot reverting to `IDLE`) — never a stuck or ambiguous cycle
