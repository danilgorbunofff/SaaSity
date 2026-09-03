# Phase 0.3 — Seed & Read API

**Milestone:** [0 · Scaffold & Data Layer](../PLAN.md) · **Prev:** [0.2 Database & Prisma](phase-02-database-and-prisma.md) · **Next:** [Milestone 1](../../01-3d-city/PLAN.md)
**Status:** 🟡 In progress (seed + read API + privacy tests done; "deployed" box open — no deployment exists) · **Estimate:** ~1 day

## Goal

The 49-plot grid exists in the database, provably covers the 10x10 plane without gaps/overlaps, every plot starts `IDLE`, and the whole auction-state surface (current price, leader, countdown, recent bid ticks) is served by a public read API.

## Prerequisites

- Phase 0.2 complete

## Steps

1. **Grid generator (spatial layout unchanged from spec — pricing removed)**
   - Implement `generateInitialGrid()`: CORE at (3,3) 4x4; 12 MID origins at the listed coords, 2x2; OUTER ring walk producing 36 cells, 1x1; ids `core-01`, `mid-01..12`, `outer-01..36` — **identical geometry to the original one-time-sale spec**, only `priceCents` is gone (pricing now lives in `lib/tiers.ts` by tier, not per-plot; see 0.2 step 3)
   - Keep the function pure/exported so tests can call it without touching the DB
2. **Integrity checker**
   - 49 plots; total area = 100 cells; every cell (0..9, 0..9) covered exactly once; tiers/spans consistent (OUTER=1x1, MID=2x2, CORE=4x4)
   - Seed **fails loudly** if any check breaks
3. **Seed script**
   - `prisma/seed.ts` wired via `package.json#prisma`; upsert-friendly; every plot seeded `status = IDLE`, no `AuctionCycle`/`PreBid`/`Bid` rows created — a freshly seeded city is genuinely empty, matching real launch conditions. Auction states are only ever created through the phase 2.x endpoints, never baked into seed data
   - Run against dev DB, inspect rows via `prisma studio` once
4. **Read API**
   - `GET /api/plots`: all plots ordered deterministically (tier then id). For each: id/tier/origin/span/status always; if `LIVE` also `currentPriceCents`, `endAt`, and the current leader's public brand snapshot (companyName/tagline/twitterHandle/logoUrl/mrrText, `logoHidden`-filtered) taken from the plot's denormalized display fields
   - `GET /api/plots/:id/bids`: recent `Bid` ledger for a plot's current cycle (amountCents, isProxy, createdAt — **never** `PreBid.maxBidCents` or any non-leading bidder's identity), paginated/capped (e.g. last 50) — powers the detail card's activity feed
   - **Privacy invariant, binding everywhere this data is read (M2's realtime feed included):** `maxBidCents` and every non-leading bidder's brand/identity are **never** present in any public payload, ever — not gated by status, just structurally absent from every serializer. Only the current leader's public brand + the public price/ticks are ever exposed. Implement as one shared serializer so 2.4's SSE payload reuses it instead of drifting
   - > **Correction (Part 1 lifecycle fix, M2):** "if `LIVE`, show the leader's brand" was the actual root cause of the core lifecycle bug — it exposed an unpaid, still-bidding leader's brand as if they'd won, and hid a real (paid) winner the instant their plot cycled back to `IDLE`. Shipped behavior: `tenant` (a paid, activated winner's brand) is present whenever `plot.tenantPreBidId` is set, independent of `status`; the in-progress auction's leader (`currentLeaderPreBidId`) is exposed only as an opaque id pointer while `LIVE`, never as a brand snapshot. See `docs/reviews/m0-m2-remediation/part-01-product-lifecycle.md`.
   - Add `Cache-Control` (short, e.g. `s-maxage=5, stale-while-revalidate` — shorter than a flat-sale model would need, since auction prices move faster than a 15-minute reservation ever did)
   - Shared TypeScript types for both payloads in `types/`
5. **Prove it end to end**
   - Temporary placeholder page fetches `/api/plots` and renders counts per tier/status (removed in M1)
   - Deploy to production; confirm prod DB seeded (one-off manual seed step documented for prod)

## Verification

- Checker output in CI/seed log: `49 plots, 100/100 cells, 0 overlaps`
- `curl` prod `/api/plots` returns 49 JSON plots, all `IDLE`, zero cycle/price fields present (nothing to show yet)
- Manually flip one plot LIVE via `prisma studio` + a hand-inserted cycle/pre-bid; re-`curl` confirms the current-price/leader/endAt fields appear correctly and no `maxBidCents` leaks

## Exit criteria

- [x] Fresh `migrate + seed` reproduces the exact grid anywhere, every plot `IDLE` — CI runs `migrate deploy` + `db:seed` on a fresh database every push; `tests/city/seed-check.test.ts` pins the shape
- [x] Integrity check committed and part of the seed run — `checkGridIntegrity` in `src/lib/grid-integrity.ts` aborts `prisma/seed.ts` on failure, not a side script
- [ ] Public plots + bid-ledger APIs deployed and consumed by the placeholder page — consumed by the city page locally, but "deployed" is still open (no deployment exists — Part 7 `preview-proof-overclaim`)
- [x] `maxBidCents` and non-leader bidder data confirmed structurally absent from every response (asserted by a test, not just documented) — `tests/server/serializers.test.ts` (REST shapes) + `tests/realtime/bus.test.ts` (event payloads), both in CI
- [x] Realtime transport decision from phase 0.2 carried forward unchanged — not re-litigated here or in M2 — SSE + shared serializer, implemented in 2.4 per 0.2's binding decision

## Out of scope / notes

- No write endpoints — claim/bid/pre-bid writes are M2 by design
- No historical "past leaseholders" archive endpoint yet — cycles are marked RESOLVED in place; a dedicated history/archive view is a nice-to-have, not scoped to any milestone currently (flag for a future backlog item if the founder wants a "hall of fame")
