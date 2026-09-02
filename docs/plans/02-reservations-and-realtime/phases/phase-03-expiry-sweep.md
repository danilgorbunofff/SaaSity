# Phase 2.3 — Cycle Resolution Worker

**Milestone:** [2 · Auctions & Realtime](../PLAN.md) · **Prev:** [2.2 Claim, Bid & Proxy Engine API](phase-02-atomic-reserve-api.md) · **Next:** [2.4 Realtime Feed](phase-04-realtime-feed.md)
**Status:** ✅ Complete · **Estimate:** ~2 days

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
   - > **Correction (Part 1 lifecycle fix, M2):** "clear the display fields entirely" only ever applied — and only ever should apply — when the plot had **no prior standing tenant** to begin with. If this cycle was a *re-claim* of a plot that already has a paid tenant from an earlier lease, a total capture-failure cascade on the *new* cycle must leave that existing tenant's fields completely untouched; there is nothing to "clear" because this step never had a tenant to lose in the first place. Shipped as: tenant fields are written only by `activateTenant()` on success, never touched on failure — so a pre-existing tenant is structurally unreachable by this failure path, not merely "not cleared by convention." See `docs/reviews/m0-m2-remediation/part-01-product-lifecycle.md`.
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

- [x] Ended cycles never linger beyond ~1 worker interval in any environment (incl. local without cron — documented limitation)
- [x] `RESOLVING` intermediate status prevents any double-processing under overlapping worker runs
- [x] Capture-failure cascade tested and correct, including the all-bidders-fail → `IDLE` case
- [x] Next-cycle rotation from queued pre-bids works, including partial exclusion of pre-bids that fail authorization at attach time
- [x] Resolution events reach the realtime seam

## Evidence & implementation notes

- **Artifacts:** `src/server/auction/worker.ts` (sweep + `resolveOneCycle`), `src/server/auction/finalize.ts` (capture cascade + M3 stubs), `src/app/api/cron/resolve/route.ts` (`WORKER_SECRET`-guarded GET/POST), inline 30s singleton sweep in `src/app/api/plots/route.ts`, `scripts/resolve-worker-proof.ts` (6 DB scenarios), `tests/auction/capture-cascade.test.ts` (6 unit tests). Migrations: `add_prebid_lost_reason`, `add_prebid_brand_fields` (backfill from 2.2's schema-only change), `add_bid_triggered_extension` (same).
- **Proof (`npx tsx scripts/resolve-worker-proof.ts`):** PASS — A basic resolution (winner rotated, standing display kept on IDLE plot, losers `LOST`); B queued pre-bids with partial attach-auth failure (`EXPIRED`/`expired`, survivors open next `OPEN` cycle at floor, plot `LIVE`); C all queued fail auth → shell cycle `CANCELLED`, plot `IDLE` (winner display kept); D all captures fail → no winner, display wiped, every candidate `LOST`/`capture_failed`; E five concurrent sweeps → exactly one resolution; F stuck-`RESOLVING` recovery and same-sweep re-resolution.
  - > **Correction (Part 1 lifecycle fix, M2):** this evidence line described pre-fix behavior and is now stale on three points. **B** originally asserted the *new* cycle's bidding leader (e.g. "Gamma") rotates onto the plot's public display the moment the next `OPEN` cycle starts — that was precisely the core lifecycle bug (unpaid exposure); the proof now asserts the opposite: the *prior* cycle's paid winner stays the displayed tenant, and the new cycle's leader is only ever a `currentLeaderPreBidId` pointer, never a brand swap. **C** originally expected `currentLeaderPreBidId` to survive an `IDLE` transition ("stale leader"); the worker now unconditionally clears it on every `IDLE` transition, so the proof asserts `null`. **D** ("all captures fail → display wiped") was only ever true for a plot with *no* prior tenant — it was silently unsound for a plot that already had one, since a fully-failed *next* auction must never evict a *standing* tenant from a *prior*, already-paid lease. The proof now seeds a pre-existing "PriorCo" tenant before running D and asserts they survive the all-captures-fail cascade untouched — this is one of Part 1's explicit required invariants. See `docs/reviews/m0-m2-remediation/part-01-product-lifecycle.md`.
- **Race guard:** claim is a conditional `OPEN → RESOLVING` `updateMany`; the bid route already 409s bids on ended cycles inside the `lockPlot` transaction, so late-arriving bids can't interleave with resolution.
- **Doc-code interpretation (steps 4/5):** when a winner exists and no queued pre-bids follow, the plot goes `IDLE` + `currentCycleId = null` (claimable again) but the winner's rotated brand **stays** as the standing display — only the no-winner / all-bidders-fail case wipes the display fields. When queued pre-bids all fail attach auth, the empty shell cycle is `CANCELLED` and the plot goes `IDLE` rather than sitting `OPEN` with a stale leader.
  - > **Correction (Part 1 lifecycle fix, M2):** "only the no-winner / all-bidders-fail case wipes the display fields" was incomplete/wrong for a plot with a *pre-existing* standing tenant — see the D correction above. Shipped rule: tenant fields (`Plot.tenant*`) are only ever written by `activateTenant()` on a successful paid resolution, and are **never** wiped by a subsequent cycle's failure. An all-fail cascade with no prior tenant simply leaves those fields at their existing `null`, which reads the same as "wiped" but is not an active clear — the distinction matters because it means an existing tenant is structurally safe from this path, not safe "by coincidence of current call order."
- **M3 seam:** `finalize.ts` stubs (`capturePreBidAuthorization` / `cancelPreBidAuthorization` / `authorizePreBidAtAttach`) always succeed; `injectCaptureFailure` / `injectAttachAuthFailure` sets exist solely for the proof script. 3.3 swaps the stub bodies; the worker contract is unchanged. Strict-review constraints on 3.3: (a) `authorizePreBidAtAttach` is invoked inside tx2 under `lockPlot` — its real body must not do network I/O there (pre-validate out of tx, or treat in-tx attach auth as an optimistic hold settled after commit); (b) crash between capture and settlement replays the cascade on recovery — the real capture must be idempotent (Stripe captures of an already-captured PaymentIntent are safe to retry).
- **Second-price single source:** `secondPriceFor` in `engine.ts` is shared by `computeResolution` and the worker's cascade `computeRemainingPrice`, so cascade pricing cannot drift from engine pricing (unit-tested in `capture-cascade.test.ts`).
- **Limitations:** local dev has no cron — the inline plots-read sweep (30s singleton) is the self-heal path; deployment must set `WORKER_SECRET` or the cron route 401s. `publish()` is the 2.4 stub (console log in non-prod); events are verified at the seam, not on a socket.

## Out of scope / notes

- The actual Stripe API calls inside `finalizeCycle` are M3 phase 3.3's body — this phase owns *when* and *in what order* they're invoked, not the Stripe SDK specifics
- If M0 chose Supabase, the cron trigger can later collapse into a scheduled DB job — note, don't build, unless trivial
