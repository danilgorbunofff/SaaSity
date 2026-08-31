# Phase 2.3 — Cycle Resolution Worker

**Milestone:** [2 · Auctions & Realtime](../PLAN.md) · **Prev:** [2.2 Claim, Bid & Proxy Engine API](phase-02-atomic-reserve-api.md) · **Next:** [2.4 Realtime Feed](phase-04-realtime-feed.md)
**Status:** ⚪ Not started · **Estimate:** ~2 days

## Goal

Ended auctions actually resolve — winner determined, tenant data rotated onto the plot, and the next cycle started (from queued pre-bids) or the plot returned to `IDLE` — on a reliable schedule, not just "as-if resolved on read."

## Prerequisites

- Phase 2.2 (claim/bid mechanics + `resolveCycle` exist)

## Steps

1. **Worker job**
   - Server function/route: find `AuctionCycle` where `status = OPEN AND endAt <= now()` (the `[status, endAt]` index from 0.2 makes this cheap)
   - For each: atomic conditional update `updateMany where id = cycleId AND status = OPEN` → set `RESOLVING` — the same conditional-update-as-atomicity-primitive pattern used everywhere else in this project, so two overlapping worker runs (e.g. a slow invocation plus its own retry) can never both process the same cycle
2. **Determine the winner**
   - The cycle's already-maintained `currentPriceCents` / `currentLeaderBidId` (kept live by every `resolveCycle` call in 2.2) **is** the clearing price and winner — no need to recompute from scratch. Defensively re-run `resolveCycle` once as a sanity check anyway; log + alert if it disagrees with the stored values (it never should, but this is a launch-critical path worth a belt-and-suspenders check)
   - Winner = the `PreBid` behind `currentLeaderBidId`; every other `ACTIVE` PreBid on this cycle is a loser
3. **Execute capture / release (mechanics owned by M3, triggered here)**
   - Call a shared `finalizeCycle(cycle, winnerPreBid, loserPreBids)` helper (M3 phase 3.3 implements its body): capture `clearingPriceCents` on the winner's PaymentIntent (a **partial** capture — Stripe auto-releases the untaken remainder of the authorization), cancel every loser's PaymentIntent outright
   - **Capture-failure cascade:** if the winner's capture fails at this moment (expired/declined card since authorization — rare but real), mark their PreBid `LOST` (reason: `capture_failed`), fall back to the next-highest remaining `ACTIVE` PreBid, recompute the clearing price against the remaining set, and retry capture; repeat until one succeeds or none remain (→ plot reverts to `IDLE` for this cycle, nobody wins it). Same "automatic, no human in the loop, audit trail after the fact" pattern this project already uses for the M2.2 claim-collision case — 5.3's admin console surfaces the cascade, it doesn't trigger it
4. **Rotate tenant data**
   - On a successful capture: copy the winning PreBid's brand fields onto the `Plot`'s denormalized display fields; mark the cycle `RESOLVED`, `resolvedAt = now`, `clearingPriceCents` + `winningBidId` set; winner's PreBid → `WON`, every other `ACTIVE` PreBid on this cycle → `LOST`
   - If capture cascades all the way to zero remaining bidders: clear the `Plot`'s denormalized display fields entirely (an `IDLE` plot shows as a genuinely empty lot, not a stale former tenant — matches "empty lots stay cheap and inviting") and set `plot.status = IDLE`
5. **Start the next cycle, or go idle**
   - Look for `PreBid` rows with this `plotId` and `cycleId = null` (pre-registered for "whatever comes next")
   - If any exist: create a new `AuctionCycle` (floor/increment/duration snapshotted fresh from `lib/tiers.ts` — clean-slate, per spec section 2), attach those PreBids (`cycleId` set), **now** create their real Stripe pre-auth PaymentIntents (per 0.2 step 7's deferred-timing rule — this is the moment their hold finally starts, keeping it safely inside the 7-day window regardless of how long they'd been queued), excluding any that fail authorization (`EXPIRED`, reason logged, doesn't block the rest); run `resolveCycle` once over the attached set so the opening leader/price already reflects any queued competition; `plot.status` stays/returns to `LIVE`
   - If none exist: `plot.status = IDLE`, `currentCycleId = null` — the plot is instantly claimable again at the tier floor
6. **Trigger strategy** (pick both, cheap)
   - Vercel Cron every ~30–60s (auctions ending is more time-sensitive than the old reservation-expiry case, hence a tighter interval than a flat sweep would use) — document choice per hosting from M0's decision
   - Inline opportunistic check on the plots read path (at most once per short interval, singleton-guarded) so even cron-less previews self-heal
7. **Emit hooks**
   - Publish `cycle:resolved` (winner or idle) and, if a new cycle started, its opening state — into the 2.4 bus (interface stubbed now if 2.4 lands later — order is flexible, but the seam must exist)

## Verification

- Manually backdate a cycle's `endAt` → within one worker interval it resolves correctly, tenant data rotates, and either a new cycle starts from queued pre-bids or the plot goes `IDLE`
- Race test: worker + a late-arriving bid interleaving leaves exactly one final state, no phantom double-resolution
- Capture-cascade test: simulate the leading bidder's authorization failing at resolution time → next-highest bidder wins instead, correctly re-priced

## Exit criteria

- [ ] Ended cycles never linger beyond ~1 worker interval in any environment (incl. local without cron — documented limitation)
- [ ] `RESOLVING` intermediate status prevents any double-processing under overlapping worker runs
- [ ] Capture-failure cascade tested and correct, including the all-bidders-fail → `IDLE` case
- [ ] Next-cycle rotation from queued pre-bids works, including partial exclusion of pre-bids that fail authorization at attach time
- [ ] Resolution events reach the realtime seam

## Out of scope / notes

- The actual Stripe API calls inside `finalizeCycle` are M3 phase 3.3's body — this phase owns *when* and *in what order* they're invoked, not the Stripe SDK specifics
- If M0 chose Supabase, the cron trigger can later collapse into a scheduled DB job — note, don't build, unless trivial
