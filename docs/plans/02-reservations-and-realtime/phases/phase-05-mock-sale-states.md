# Phase 2.5 — Mock Cycle Resolution & Full Loop

**Milestone:** [2 · Auctions & Realtime](../PLAN.md) · **Prev:** [2.4 Realtime Feed](phase-04-realtime-feed.md) · **Next:** [Milestone 3](../../03-stripe-payments/PLAN.md)
**Status:** ⚪ Not started · **Estimate:** ~1 day

## Goal

Close the loop without real Stripe money: a manual "resolve now" trigger runs the exact same resolution/rotation logic 2.3's cron will run automatically, so the full claim → bid → soft-close → resolve → next-cycle lifecycle is testable end-to-end before M3 wires in real pre-auth/capture. Then M3 only swaps the payment stub for Stripe.

## Prerequisites

- Phases 2.1–2.4 complete

## Steps

1. **Mock trigger endpoint**
   - `POST /api/mock-resolve/:cycleId` (dev-only): forces a cycle's `endAt` to `now` and immediately invokes 2.3's worker resolution path (same function, not a parallel implementation) — this phase does not reimplement resolution, it just gives dev/test a way to fast-forward time
   - Mock payment stand-in: since real Stripe isn't wired until 3.1, `finalizeCycle`'s capture/cancel calls are stubbed to always "succeed" in this phase (gated behind `MOCK_PAYMENTS=1`); 3.1 swaps the stub for real Stripe calls without touching 2.3's orchestration
   - Prominently marked dev-only; removed or flag-disabled in production once 3.1 lands
2. **Bidding UI countdown + mock fast-forward**
   - After a claim/bid succeeds, the modal/detail-card shows a live countdown to `endAt` and, in dev only, a "fast-forward to resolution" button calling the mock trigger; expiring for real reverts/rotates the plot per the worker's normal logic
3. **LIVE rendering payoff**
   - Confirm the 1.3 skin + 1.4 card show the current leader's company name/tagline/handle/site link/`mrrText` from real claim→bid→resolve data; billboard frame on MID towers gets the current leader's company name (simple text plane or drei Text — cheap version; art polish is 4.3); confirm the visual updates the instant the leader changes mid-auction, not just at resolution
4. **E2E milestone scenario test**
   - Scripted walk (manual checklist + optional Playwright smoke): browse → claim an `IDLE` plot → second browser sees it go `LIVE` with a countdown → third "browser" places a higher bid → both other viewers see the leader/price update live → a bid within 3 min of close → countdown visibly extends → mock-resolve → both browsers show the new tenant → a queued pre-bid on that same plot causes an immediate next cycle to start
5. **M3 seam review**
   - List exactly which calls the mock stub replaces with real Stripe pre-auth/capture/release; write it as a note at the bottom of this file for phase 3.1

## Verification

- The E2E scenario passes on a production preview URL, not just localhost

## Exit criteria

- [ ] Full `IDLE` → `LIVE` (claim/bid/soft-close) → `RESOLVED` → (next `LIVE` cycle | back to `IDLE`) loop visible live in two-plus sessions
- [ ] Mock payment seam documented so M3 is a swap, not a redesign
- [ ] Flag/env control verified (no mock path exploitable in prod)

## Out of scope / notes

- Refunds, receipts, emails — none; M5's runbook covers manual fixes
