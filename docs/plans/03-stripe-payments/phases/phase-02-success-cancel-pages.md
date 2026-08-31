# Phase 3.2 — Bid Confirmation & Outbid UI

**Milestone:** [3 · Stripe Pre-Auth & Capture](../PLAN.md) · **Prev:** [3.1 Pre-Authorization API](phase-01-checkout-session-api.md) · **Next:** [3.3 Capture, Release & Cycle Finalization](phase-03-webhook-finalization.md)
**Status:** ⚪ Not started · **Estimate:** ~1 day

## Goal

After a bidder submits, they need durable, reload-safe visibility into "am I still leading, was I outbid, did I win" — without a login, purely from the bidder cookie.

## Prerequisites

- Phase 3.1 (PaymentIntent/SetupIntent flows exist), M2 2.4 (realtime feed)

## Steps

1. **`GET /api/me/bids`**
   - Using the bidder cookie (0.2 step 6, reused not re-minted), return every `PreBid` belonging to this `bidderRef` across all plots: plotId, cycleId (nullable), `maxBidCents` (**visible to its own owner only** — this is the one deliberate exception to the 0.3/2.4 privacy invariant, since this endpoint is scoped to the caller's own identity and never public), current leader status (leading / outbid / won / lost / expired), `paymentIntentStatus`
2. **Post-submit confirmation state**
   - Right after a successful claim/bid/pre-bid (2.1's modal), show a persistent-until-dismissed confirmation: "You're leading at $X" or "Pre-bid scheduled for the next cycle" — pulls from this endpoint, not just optimistic local state, so a page reload shows the same truth
3. **Outbid notification**
   - Subscribe to M2 2.4's realtime feed `bid:placed` events client-side; if the event's new leader isn't the current viewer (compared via the bidder cookie) and the viewer has an `ACTIVE` PreBid on that cycle, surface a toast: "You've been outbid on {plotId} — new price $X" with a one-click "raise your bid" shortcut back into 2.1's modal
   - This is a **client-side derivation**, never a stored `OUTBID` status (per 0.2's schema decision) — computed live by comparing the event's leader to the viewer's own bidder cookie
4. **"My bids" panel**
   - A small persistent UI surface (header icon + count, or slide-over panel) listing the bidder's own active/won/lost pre-bids across the whole grid, backed by step 1's endpoint — lets a founder who placed pre-bids on several plots see all of them at a glance without hunting across the city
5. **Won/lost resolution copy**
   - When a cycle resolves (2.4's `cycle:resolved` event) and the viewer had a PreBid on it: won → "You're live! Your brand is now showing on {plotId} for the next {durationSeconds/3600}h"; lost → "Outbid — final price was $X" with a one-click re-bid-for-next-cycle shortcut (pre-fills 2.1's modal in `prebid` mode)

## Verification

- Place a bid, reload the page cold → "you're leading" state is intact (server-derived, not localStorage)
- Get outbid in a second browser while the first is idle → toast appears within the realtime feed's normal sub-second latency
- Win a cycle → resolution copy appears exactly once, not repeated on every reconnect

## Exit criteria

- [ ] `maxBidCents` is returned by `/api/me/bids` to its own owner only — confirmed absent from every other endpoint (cross-checked against the 0.3/2.4 privacy invariant, which this endpoint is the sole, explicit exception to)
- [ ] Outbid/won/lost states are all reload-safe (server-derived), never solely client-memory
- [ ] Re-bid and re-prebid shortcuts correctly pre-fill 2.1's modal in the right mode

## Out of scope / notes

- Email/push notifications for outbid events — none at launch; in-app/realtime only, matches the product's no-accounts stance. Revisit only if retention data demands it post-launch
