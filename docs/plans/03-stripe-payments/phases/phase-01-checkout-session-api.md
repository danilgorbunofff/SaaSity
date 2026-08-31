# Phase 3.1 — Pre-Authorization API

**Milestone:** [3 · Stripe Pre-Auth & Capture](../PLAN.md) · **Prev:** [Milestone 2](../../02-reservations-and-realtime/PLAN.md) · **Next:** [3.2 Bid Confirmation & Outbid UI](phase-02-success-cancel-pages.md)
**Status:** ⚪ Not started · **Estimate:** ~1.5 days

## Goal

Two Stripe primitives, wired to the exact timing rule already decided in 0.2/2.3: a zero-dollar `SetupIntent` at registration (save the card only, no hold), and a real manual-capture `PaymentIntent` created only once a `PreBid` attaches to an actually-started cycle.

## Prerequisites

- M2 complete incl. the 2.5 seam note (what the mock payment stub replaces)
- Stripe account, **test** keys in dev env; Stripe CLI installed locally

## Steps

1. **Stripe plumbing**
   - Server-only Stripe client (`lib/stripe.ts`), secret from env; `stripeCustomerId` created lazily on a bidder's first-ever pre-auth interaction, cached on the bidder cookie (0.2 step 6) — never re-created for the same bidder
2. **`POST /api/pay/setup-intent`**
   - Precondition: caller has a bidder cookie (minted if absent, per 0.2 step 6); creates a Stripe Customer the first time only, then a `SetupIntent` (no amount, `usage: on_session` since the bidder is present), returns `client_secret` for the client to confirm via Elements
   - Called by 2.2's `/prebid` flow, and by claim/bid whenever the bidder has no saved card yet — this endpoint never authorizes money, it only saves a payment method
3. **`POST /api/pay/authorize`**
   - Precondition: a specific `PreBid` row exists, is `ACTIVE`, has no `stripePaymentIntentId` yet, and its `cycleId` is now non-null (i.e. it has just attached to a real, started cycle) — called from exactly two places: 2.2's claim/bid (immediately, for a live cycle) and 2.3's worker (at rotation time, for previously-queued pre-bids)
   - Creates a `PaymentIntent`: `amount = maxBidCents`, `capture_method: manual`, `confirm: true`, off the bidder's saved payment method, `customer = stripeCustomerId`; stores `stripePaymentIntentId` + `paymentIntentStatus` on the `PreBid`
   - **This is the moment the 7-day hold clock starts** (per 0.2 step 7) — never called at pre-bid registration time, only at attach time. That's what keeps every hold's lifetime bounded by (cycle duration + capped soft-close extension) regardless of how far in advance the pre-bid was scheduled
   - Auth failure (card declined/expired) → catch, mark `PreBid.status = EXPIRED` (reason logged), return a structured error; the caller (2.2 or 2.3) excludes this PreBid from the cycle and continues with the rest — one bad card never blocks other bidders
4. **Elements mounted client-side**
   - The bid modal's payment step (visually stubbed in 2.1) now mounts a real Stripe `PaymentElement` / SetupIntent confirmation flow using the `client_secret` from step 2 or 3 — this replaces the old "redirect to Checkout" concept entirely. Checkout Sessions cannot express hold-now/decide-amount-later, so this project never uses them, at any tier
   - Submit sequence: the client confirms the SetupIntent/PaymentIntent via Stripe.js (`stripe.confirmSetup`/`confirmCardPayment`) in-page — no redirect, no leaving the SPA
5. **Failure matrix**
   - 400 invalid, 404 unknown plot/PreBid, 409 (wrong plot/cycle state — inherited from 2.2), 402 Stripe card error (surfaced verbatim from Stripe's decline code where safe), 502 Stripe down

## Verification

- Test-mode: register a pre-bid with a test card → SetupIntent confirms, no hold appears in the Stripe dashboard; once that plot's cycle actually starts → the dashboard now shows an uncaptured authorization for exactly `maxBidCents`
- Declined-card test (`4000000000000002`): authorize step fails → PreBid excluded, cycle continues to resolve among the remaining bidders

## Exit criteria

- [ ] No `PaymentIntent` is ever created before a `PreBid` has a non-null `cycleId` (i.e. before its cycle actually exists/starts)
- [ ] Authorization amount always equals `maxBidCents`, never client-supplied at confirm time
- [ ] A failed authorization excludes exactly one PreBid and never blocks cycle resolution for the rest
- [ ] 2.5's mock-payment seam list fully replaced by these two endpoints + 3.3's capture/release

## Out of scope / notes

- Capture/cancel is 3.3 — an authorized-but-uncaptured PaymentIntent does nothing on its own until the worker (2.3) resolves the cycle
