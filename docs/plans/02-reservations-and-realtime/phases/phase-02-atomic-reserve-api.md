# Phase 2.2 — Claim, Bid & Proxy Engine API

**Milestone:** [2 · Auctions & Realtime](../PLAN.md) · **Prev:** [2.1 Bid & Pre-Bid Form](phase-01-claim-form-validation.md) · **Next:** [2.3 Cycle Resolution Worker](phase-03-expiry-sweep.md)
**Status:** ✅ Complete · **Estimate:** ~2.5 days

## Goal

One race-safe engine — backing three endpoints (instant claim, manual bid, proxy pre-bid) — that always computes exactly one leader and one current price per cycle, extends the countdown on late challenges (soft-close), and never lets two concurrent requests double-claim a plot or corrupt a cycle's state.

## Prerequisites

- Phase 2.1 (form contract = request contract)

## Steps

1. **The unifying insight: claim, bid, and pre-bid are one primitive**
   - All three write a `PreBid` row (or update the caller's own existing one) and then run the same **proxy resolution pass** over every `ACTIVE` `PreBid` on the target cycle. The only thing that differs between the three endpoints is the *precondition* on plot/cycle state and whether a new `AuctionCycle` gets created — not the resolution logic itself. Implement resolution as one shared function, `resolveCycle(cycleId)`, that all three call
2. **`POST /api/plots/:id/claim`** — precondition: `plot.status === IDLE`
   - Body: shared schema + `maxBidCents` (defaults to the tier floor if the user just wants the cheap instant grab and accepts losing it to a later challenger)
   - Atomic transition via **conditional update**: `updateMany where id AND status = IDLE` setting status `LIVE`, creating the new `AuctionCycle` with `floorPriceCents`/`incrementCents`/`durationSeconds` snapshotted fresh from `lib/tiers.ts` — the clean-slate reset, never carried over from any previous cycle on this plot — and `startAt = now`, `endAt = now + tier.durationSeconds`
   - `count === 0` → 409 "plot no longer idle" (someone else claimed it first — the loser path); `count === 1` → create the claimant's `PreBid` on the new cycle and run `resolveCycle` (with only one bidder, they lead at the floor price)
   - **Intentional deviation from spec:** the original one-time-sale spec said return 400 for an unavailable plot; this uses 409 Conflict instead (correct HTTP semantics for a state conflict). Same deviation, same rationale, carried through every endpoint in this phase and reused by 3.1
3. **`POST /api/plots/:id/bid`** — precondition: `plot.status === LIVE`, target cycle `status === OPEN`, `endAt > now`
   - Body: shared schema + `maxBidCents`, required `>= cycle.currentPriceCents + cycle.incrementCents` else 409 "bid too low, minimum is X"
   - If the caller (by bidder cookie) already has an `ACTIVE PreBid` on this cycle, this is a **top-up**: update its `maxBidCents` upward only (never down); otherwise insert a new `PreBid` row
   - Run `resolveCycle`; evaluate soft-close (step 6) **once per request**, using the time the request was received — before any auto-generated proxy counter-bids from this same pass, so a single incoming bid that also triggers an automatic counter-bid from another standing max-bid counts as **one** soft-close evaluation, never two
4. **`POST /api/plots/:id/prebid`** — precondition: `plot.status === LIVE` (targeting the *next*, not-yet-created cycle; if the plot is `IDLE`, the server 409s with guidance to call `/claim` instead)
   - Body: shared schema + `maxBidCents >= tier floor` (nobody knows the next cycle's competitive state yet, so the floor is the only meaningful minimum)
   - Stored with `cycleId = null`; **no Stripe authorization created yet** — per 0.2 step 7, only a card-saving `SetupIntent` happens now. The real hold is created by 2.3's worker when this plot's next cycle actually starts
   - No resolution pass runs yet (there's no cycle to resolve against yet) — this just queues the row
5. **Proxy resolution algorithm (`resolveCycle`) — the shared engine**
   - Given all `ACTIVE` PreBids on a cycle: sort by `maxBidCents` desc, tie-broken by `createdAt` asc (earliest bid wins ties — standard proxy-auction rule, prevents same-max-bid gaming)
   - Leader = top of the sorted list. If exactly one PreBid exists: `currentPriceCents = floorPriceCents` (nobody to challenge them — proxy bidding means you never pay your own ceiling unless someone pushes you there)
   - If ≥ 2 PreBids exist: `currentPriceCents = min(leader.maxBidCents, secondHighest.maxBidCents + incrementCents)`, floored at `floorPriceCents`
   - If the computed price or leader changed from the cycle's stored state: append one `Bid` row (`amountCents` = the new current price, `isProxy = true` unless this tick *is* the human's own just-submitted amount, `preBidId` = the leader's PreBid), update `cycle.currentPriceCents` / `currentLeaderBidId`
   - This same function runs identically for: a live bid (step 3), a claim's first resolution (step 2), and 2.3's next-cycle rotation (attaching queued pre-bids to a freshly created cycle) — one engine, three callers
6. **Soft-close (anti-sniping)**
   - If a bid (manual, or the proxy engine's own resulting counter-bid, evaluated once per request per step 3) lands with `cycle.endAt - now < 3 minutes`: set `endAt = max(endAt, now + 3 minutes)` — a **reset to 3 minutes remaining**, not a blind `endAt += 3min`. Chosen deliberately over flat addition: a flat add compounds with every rapid-fire proxy tick in a bidding war and can extend a cycle indefinitely from a burst of automated counter-bids; a reset-based extension still fully achieves the anti-snipe goal (a human always gets ≥ 3 minutes to react to the last real move) without that runaway risk
   - Guardrail: cap total accumulated extension per cycle at **+2 hours** (safety valve against pathological bidding wars; expected organic use is 1–3 extensions). Once the cap is hit, further late bids still win normally — they just stop pushing `endAt` further out
   - Mark the triggering `Bid.triggeredExtension = true`; 2.4 broadcasts a distinct `cycle:extended` event so every viewer's countdown visibly jumps
7. **Bidder identity, reused not reinvented**
   - Every one of these three endpoints reads/mints the bidder cookie from 0.2 step 6 (`bidderId`, `stripeCustomerId`) — this phase does not create its own identity mechanism, it's the first *consumer* of the one defined in 0.2
8. **Response codes**
   - 200 (claim/bid/prebid accepted, body: cycle + leader status for the caller), 400 validation, 404 unknown plot, 409 (wrong plot/cycle state, bid too low, or a claim/bid/prebid precondition mismatch as described above)
9. **Basic guard**
   - Per-IP and per-bidder-cookie rate limit on all three routes (small, e.g. 10/min) — bids are still free until Stripe attaches in 3.1, so this remains the spam surface; formal hardening revisited in 5.2

## Verification

- **Concurrency proof:** script firing N parallel claims at one `IDLE` plot → exactly one 200, rest 409 (run against dev DB, keep script in repo)
- **Concurrency proof #2:** script firing N parallel bids at one `LIVE` cycle with varying max-bids → resolves to the mathematically correct leader/price every time, never a torn/partial state
- **Soft-close proof:** a bid at `endAt - 90s` extends to `endAt = now + 3min`; ten rapid-fire proxy ticks from one simulated bidding war extend the cycle by no more than the +2h cap in total

## Exit criteria

- [x] No interleaving of reads/writes can double-claim an `IDLE` plot or corrupt a cycle's leader/price under concurrent load
- [x] `resolveCycle` is the single implementation used by claim, bid, and 2.3's rotation — no duplicated resolution logic anywhere
- [x] Soft-close extension is reset-based, capped, and never double-applied when one request triggers multiple `Bid` rows
- [x] Bidder cookie reused (never re-minted) from 0.2 across all three endpoints

## Out of scope / notes

- Stripe not involved yet; the mock "resolve now" trigger (2.5) exercises the same resolution/rotation logic 2.3's real worker will run on a timer
- `/prebid`'s Stripe `SetupIntent` (card-saving only, no hold) is described in 0.2 step 7 and implemented for real in 3.1 — this phase only creates the DB row
