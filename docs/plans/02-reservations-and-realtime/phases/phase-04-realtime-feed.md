# Phase 2.4 — Realtime Feed

**Milestone:** [2 · Auctions & Realtime](../PLAN.md) · **Prev:** [2.3 Cycle Resolution Worker](phase-03-expiry-sweep.md) · **Next:** [2.5 Mock Cycle Resolution & Full Loop](phase-05-mock-sale-states.md)
**Status:** 🟡 In progress (feed implemented + locally verified; preview box reopened — see Exit criteria) · **Estimate:** ~1.5–2 days

> **Transport decision (reference only — decided in phase 0.2, implemented here):**
> 0.2 chose the default: **Neon Postgres + SSE with an in-process event bus**
> (`src/server/realtime/bus.ts` → `GET /api/events`). Supabase Realtime was
> rejected per 0.2's guidance — 49 plots don't need managed fan-out. See
> [phase 0.2, step 1](../../00-scaffold-and-data-layer/phases/phase-02-database-and-prisma.md).

**Evidence (verified 2026-09-02, LOCAL-ONLY):** bus unit tests 5/5 (`tests/realtime/bus.test.ts`),
full suite 49/49, `next build` clean. E2E against a local prod-mode server on :3457 —
`bid:placed` (cross-client, <1s), `cycle:extended` (soft-close fired by a real
second-bidder bid), `cycle:resolved` (winner brand + clearing price via worker
run), all frames observed on a live `/api/events` stream with correct `id: N`
seq lines; payload shape checked against the 0.3 privacy rule (`maxBidCents`
absent, leader-only brand). 15 rapid reconnects left zero leaked TCP
connections; server seq resets on reconnect and the client re-anchors from the
snapshot (design behavior, documented in `src/lib/city/realtime.ts`).
No Vercel preview or production evidence exists yet — see the reopened exit
box below (Part 7 `preview-proof-overclaim`).

## Goal

Every open browser reflects price ticks, leader changes, soft-close extensions, and cycle resolutions in ~1 second — the social proof engine of the product, and the mechanism that makes proxy bidding feel alive rather than mysterious.

## Prerequisites

- Phases 2.2–2.3 (all mutations flow through known seams)

## Steps

1. **Decision: implement per the phase 0.2 decision — this is not a new decision**
   - The SSE-vs-Supabase call was made once, back in phase 0.2, before the database existed. This phase implements it; it does not re-open it. Write which one was chosen at the top of this file for reference
   - If 0.2 chose SSE (the default): build an in-process event bus (49 plots, bursty-not-huge launch traffic, a single region is enough)
   - If 0.2 chose Supabase: subscribe to Postgres change events on the `Plot`/`AuctionCycle`/`Bid` tables instead of steps 2–3 below; skip the custom SSE route entirely
2. **Event bus + route**
   - `GET /api/events` SSE: send `hello`, plot snapshot seq, then typed events:
     - `bid:placed` — cycleId, plotId, new `currentPriceCents`, new leader's public brand snapshot, `isProxy`
     - `cycle:extended` — cycleId, plotId, new `endAt` (soft-close fired)
     - `cycle:resolved` — plotId, winner's public brand snapshot (or `null` if the plot went `IDLE`), and the next cycle's opening state if one started
   - > **Correction (Part 1 lifecycle fix, M2):** `bid:placed` carries no brand at all — only `currentPriceCents`/`endAt`/`isProxy` and the leader's opaque `preBidId` (an unpaid, still-live leader must never get public brand exposure). `cycle:resolved`'s `winner` is `null` exactly when nobody won this cycle (no bidders, or every capture failed) — **not** "whenever the plot goes `IDLE`": a winner who has no follow-up bidder queued still resolves to `IDLE` while `winner` carries their `{ preBidId, brand }`, since that brand becomes (or remains) the plot's standing `tenant`. See `docs/reviews/m0-m2-remediation/part-01-product-lifecycle.md`.
   - Every payload built from the **same serializer as 0.3's `/api/plots`** — `maxBidCents` and non-leader bidder data are never present, structurally, in any of these events either. This is not re-decided here; it's the identical privacy rule from 0.3, reused
   - Heartbeat comments every ~15s to keep proxies from closing; handle client `AbortSignal` cleanup
3. **Publish points**
   - 2.2's claim/bid/`resolveCycle` calls, and 2.3's worker resolution, all publish through one `emitPlotUpdate` family of helpers (`emitBidPlaced`, `emitCycleExtended`, `emitCycleResolved`) so M3's Stripe flow gets realtime updates for free once it starts calling the same 2.2/2.3 code paths
4. **Client integration**
   - EventSource in the store layer with `visibilitychange` resync; on `bid:placed`/`cycle:extended`: patch the specific plot's price/leader/countdown in place (no full refetch); on `cycle:resolved`: patch tenant display + countdown reset
   - Reconnect/backoff + full refetch on gap (event carries a monotonically increasing seq; mismatch → refetch)
5. **Deploy reality check** *(local prod verified; Vercel preview pending until M2 deploy)*
   - Verify SSE streams on Vercel preview+prod (buffering config in `export const` route segment config); if it fails, fallback plan: polling every 2–3s (auctions move faster than the old reservation model, so any polling fallback needs a tighter interval than before)

## Verification

- Two browsers side by side: bid in A → B shows the new price/leader in < 1s; soft-close fires in A → B's countdown visibly jumps in sync; cycle resolves → both browsers show the new tenant (or `IDLE`) and, if applicable, the next cycle's opening price already ticking

## Exit criteria

- [x] Note at top of this file records which transport 0.2 chose (SSE or Supabase) — reference, not a new decision
- [ ] All three event types (`bid:placed`, `cycle:extended`, `cycle:resolved`) demonstrated sub-second in prod preview — REOPENED (Part 7 `preview-proof-overclaim`): demonstrated on a local prod-mode server only; localhost timing must not be reused as serverless proof. Re-verify on the preview deployment across separate function instances and record URL + commit SHA + date + scenario + result here
- [x] No memory/listener leaks across 15 rapid reconnect cycles (matches the evidence block above; corrected from "10" during the Part 7 strict re-verification)

## Out of scope / notes

- Auth/authorized sockets are not needed (public grid state only) — revisit only if scraping/bid-sniping bots become a problem (5.2)
