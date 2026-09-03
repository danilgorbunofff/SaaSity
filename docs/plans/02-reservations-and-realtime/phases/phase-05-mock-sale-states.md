# Phase 2.5 — Mock Cycle Resolution & Full Loop

**Milestone:** [2 · Auctions & Realtime](../PLAN.md) · **Prev:** [2.4 Realtime Feed](phase-04-realtime-feed.md) · **Next:** [Milestone 3](../../03-stripe-payments/PLAN.md)
**Status:** 🟡 In progress (full loop implemented + locally verified; preview rehearsal pending — see Verification) · **Estimate:** ~1 day

**Evidence (verified 2026-09-02, LOCAL-ONLY):** unit suite 52/52 (incl. `tests/auction/mock-payments.test.ts`
+ `capture-cascade.test.ts`), `tsc --noEmit` clean, `next build` clean with
`ƒ /api/mock-resolve/[cycleId]`. Full-loop E2E (`scripts/e2e-full-loop.ts`) against a
prod server (`MOCK_PAYMENTS=1`): 38 assertions green — claim → LIVE + countdown →
three concurrent SSE sessions see every leader change <1s → soft-close extension
via `shorten` mode → `mock-resolve` runs the real worker → `cycle:resolved` reaches
all sessions → queued pre-bid opens the next cycle immediately → second resolve
leaves the plot IDLE with the standing tenant. Browser pass (no reloads): modal
success view countdown, outbid banner, live 3D billboard swap on leader change
(Acme → Beta), `⏩ Fast-forward resolution` button resolves the plot in-page, real
cron expiry rotated the plot back to IDLE with zero console errors. Kill switch:
without `MOCK_PAYMENTS`, `/api/mock-resolve/*` returns 404, payment stubs throw
(`MockPaymentsDisabledError`), and `/api/plots` reports `mockResolveEnabled: false`
so the dev buttons never render.

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
   - > **Correction (Part 1 lifecycle fix, M2):** this line contradicted step 4 below (which already correctly says "mock-resolve → both browsers show the new **tenant**") and described the exact bug Part 1 fixed. Shipped behavior: the billboard/card show the standing **tenant's** brand (last paid, activated winner), which does **not** change while an auction is merely in progress — only a successful, paid resolution rotates it. The in-progress leader is surfaced separately (price/countdown/opaque `preBidId`), never as a brand swap mid-auction. See `docs/reviews/m0-m2-remediation/part-01-product-lifecycle.md`.
4. **E2E milestone scenario test**
   - Scripted walk (manual checklist + optional Playwright smoke): browse → claim an `IDLE` plot → second browser sees it go `LIVE` with a countdown → third "browser" places a higher bid → both other viewers see the leader/price update live → a bid within 3 min of close → countdown visibly extends → mock-resolve → both browsers show the new tenant → a queued pre-bid on that same plot causes an immediate next cycle to start
5. **M3 seam review**
   - List exactly which calls the mock stub replaces with real Stripe pre-auth/capture/release; write it as a note at the bottom of this file for phase 3.1

## Verification

- The E2E scenario passes on a production preview URL, not just localhost — PENDING (Part 7 `preview-proof-overclaim`): passed on a local prod-mode server (`MOCK_PAYMENTS=1`, 38-assertion script + real-browser pass, zero console errors). localhost is not preview evidence; re-run the release rehearsal on the preview deployment and record URL + SHA + date + result here

## Exit criteria

- [x] Full `IDLE` → `LIVE` (claim/bid/soft-close) → `RESOLVED` → (next `LIVE` cycle | back to `IDLE`) loop visible live in two-plus sessions
- [x] Mock payment seam documented so M3 is a swap, not a redesign
- [x] Flag/env control verified (no mock path exploitable in prod)

## Out of scope / notes

- Refunds, receipts, emails — none; M5's runbook covers manual fixes

## M3 seam review — exactly what phase 3.1 swaps (step 5)

All money-shaped behavior lives behind three stubs in
`src/server/auction/finalize.ts`, each gated by
`requireMockPayments()` (`src/server/mock-payments.ts`, `MOCK_PAYMENTS=1`).
3.1 replaces the bodies only — the worker/cascade call sites, ordering, and
error contracts stay untouched:

| Stub | Real Stripe call | Call sites (unchanged) |
| --- | --- | --- |
| `authorizePreBidAtAttach(preBid)` | `PaymentIntent.create` (`capture_method: manual`, amount = `maxBidCents`); store `stripePaymentIntentId` on the PreBid row | worker next-cycle attach (`resolveOneCycle`) — thrown errors already mark the pre-bid `EXPIRED` |
| `capturePreBidAuthorization(preBid, amountCents)` | `PaymentIntent.capture(pi, { amount_to_capture: amountCents })` | `runCaptureCascade` via worker — throw already cascades to the next candidate (`capture_failed`) |
| `cancelPreBidAuthorization(preBid)` | `PaymentIntent.cancel(pi)` (must stay idempotent) | cascade release loop for losers + (M3) pre-bid cancel/expiry sweeps |

Also in 3.1's blast radius, all removable without touching 2.3 orchestration:

- `src/app/api/mock-resolve/[cycleId]/route.ts` — **delete** (dev fast-forward).
- `MOCK_PAYMENTS` in `.env` and `isMockPaymentsEnabled()` — the `/api/plots`
  `mockResolveEnabled` flag and the UI's countdown dev buttons (`DevFastForward`
  in `DetailCard.tsx`, success-view button in `BidModal.tsx`) render off it;
  flag off = no UI, route gone = 404.
- Payment fieldset in `BidModal.tsx` (`STUB · Card on file — connects in phase
  3.1`) becomes the real Stripe Elements card entry.
- 2.5 found and fixed one real gap on the way: `cycle:resolved` was emitted by
  the cron loop, not by `resolveOneCycle` — the mock trigger resolved silently.
  The emit now lives inside `resolveOneCycle` itself, so cron and fast-forward
  are byte-identical (which is the whole premise of this phase).
