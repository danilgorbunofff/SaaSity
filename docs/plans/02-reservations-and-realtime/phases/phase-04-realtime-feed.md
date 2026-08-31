# Phase 2.4 — Realtime Feed

**Milestone:** [2 · Auctions & Realtime](../PLAN.md) · **Prev:** [2.3 Cycle Resolution Worker](phase-03-expiry-sweep.md) · **Next:** [2.5 Mock Cycle Resolution & Full Loop](phase-05-mock-sale-states.md)
**Status:** ⚪ Not started · **Estimate:** ~1.5–2 days

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
   - Every payload built from the **same serializer as 0.3's `/api/plots`** — `maxBidCents` and non-leader bidder data are never present, structurally, in any of these events either. This is not re-decided here; it's the identical privacy rule from 0.3, reused
   - Heartbeat comments every ~15s to keep proxies from closing; handle client `AbortSignal` cleanup
3. **Publish points**
   - 2.2's claim/bid/`resolveCycle` calls, and 2.3's worker resolution, all publish through one `emitPlotUpdate` family of helpers (`emitBidPlaced`, `emitCycleExtended`, `emitCycleResolved`) so M3's Stripe flow gets realtime updates for free once it starts calling the same 2.2/2.3 code paths
4. **Client integration**
   - EventSource in the store layer with `visibilitychange` resync; on `bid:placed`/`cycle:extended`: patch the specific plot's price/leader/countdown in place (no full refetch); on `cycle:resolved`: patch tenant display + countdown reset
   - Reconnect/backoff + full refetch on gap (event carries a monotonically increasing seq; mismatch → refetch)
5. **Deploy reality check**
   - Verify SSE streams on Vercel preview+prod (buffering config in `export const` route segment config); if it fails, fallback plan: polling every 2–3s (auctions move faster than the old reservation model, so any polling fallback needs a tighter interval than before)

## Verification

- Two browsers side by side: bid in A → B shows the new price/leader in < 1s; soft-close fires in A → B's countdown visibly jumps in sync; cycle resolves → both browsers show the new tenant (or `IDLE`) and, if applicable, the next cycle's opening price already ticking

## Exit criteria

- [ ] Note at top of this file records which transport 0.2 chose (SSE or Supabase) — reference, not a new decision
- [ ] All three event types (`bid:placed`, `cycle:extended`, `cycle:resolved`) demonstrated sub-second in prod preview
- [ ] No memory/listener leaks across 10 reconnect cycles

## Out of scope / notes

- Auth/authorized sockets are not needed (public grid state only) — revisit only if scraping/bid-sniping bots become a problem (5.2)
