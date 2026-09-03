# Phase 0.2 — Database & Prisma

**Milestone:** [0 · Scaffold & Data Layer](../PLAN.md) · **Prev:** [0.1 Repo & Tooling](phase-01-repo-and-tooling.md) · **Next:** [0.3 Seed & Read API](phase-03-seed-and-read-api.md)
**Status:** 🟡 In progress (schema + identity + realtime decision done; prod-database box open) · **Estimate:** ~1 day

## Goal

A provisioned Postgres instance with the **auction/lease** schema applied via Prisma migrations — locally and in production, sharing one migration history. This phase locks in every core data-model decision the whole product depends on: cycle lifecycle, the proxy-bid ledger, and Stripe pre-auth references. Everything downstream (M2's engine, M3's Stripe flow) implements this; nothing downstream re-designs it.

## Prerequisites

- Phase 0.1 complete (repo + Vercel project exist)

## Steps

1. **Provision Postgres — and settle the realtime transport now, once**
   - This is the single decision point for both the DB host and M2's realtime approach. Phase 0.3 and M2 phase 2.4 implement whatever is decided here; neither re-opens it later
   - Default (recommended): **Neon** for Postgres + **SSE with an in-process event bus** for realtime (2.4 implements this) — 49 plots don't need managed fan-out, even with per-second bid ticks on a handful of live cycles at once
   - Only choose **Supabase** (Postgres + Supabase Realtime) if there's a concrete reason to prefer managed DB-change fan-out over SSE — decide before creating any database, not after seeing how SSE feels
   - Create dev database + a separate production database (never share)
   - Record the choice + one-line rationale in this file (bottom of Verification section) before moving to phase 0.3
2. **Prisma setup**
   - Install `prisma` + `@prisma/client`; init config; point `DATABASE_URL` via `.env` (dev) and Vercel env (prod)
   - Add `postinstall: prisma generate` so Vercel builds always have the client
3. **Schema — auction/lease model (replaces the original one-time-sale schema entirely)**
   - `Plot`: id (slug, e.g. `core-01`), `tier` (`PlotTier {OUTER MID CORE}` — OUTER=1x1, MID=2x2, CORE=4x4; **grid geometry is unchanged from the original spec**, only pricing/lifecycle changed), originX/Y, spanX/Y, `status` (`PlotStatus {IDLE LIVE}` — IDLE = no active cycle, instantly claimable at the tier floor; LIVE = an open `AuctionCycle` exists). Denormalized **current-display fields**, refreshed only by the 2.3 worker at cycle resolution: companyName, tagline, targetUrl, twitterHandle, logoUrl, mrrText, `logoHidden Boolean @default(false)` (moderation flag, mechanism from M4 4.3), `currentCycleId String? @unique`
   - `AuctionCycle`: one row per plot per time window. id (cuid), plotId, `tier`/`floorPriceCents`/`incrementCents`/`durationSeconds` **snapshotted from the tier constants at creation** — this snapshot is what makes the clean-slate reset real: nothing is ever copied forward from the previous cycle. startAt, `endAt` (**mutable** — soft-close extends it, see 2.2), `status` (`CycleStatus {OPEN RESOLVING RESOLVED CANCELLED}`), `currentPriceCents` (starts = floorPriceCents, ticks up as the proxy engine resolves challenges), `currentLeaderBidId`, `clearingPriceCents` (set at resolution), `winningBidId`, `resolvedAt`
   - `PreBid`: the standing max-bid, brand assets, and payment hold — one row per bidder per cycle they're targeting. id (cuid), plotId, **`cycleId` nullable** (null = "targets this plot's *next* cycle, which doesn't exist as a row yet" — how pre-registration for a future slot works before the cycle object is created), `bidderRef` (opaque, from the bidder cookie — step 6), `maxBidCents`, companyName/tagline/targetUrl/twitterHandle/logoUrl/mrrText, `stripePaymentIntentId` (`@unique`, nullable until authorized — see step 7 for *when*), `paymentIntentStatus` (mirrors Stripe), `status` (`PreBidStatus {ACTIVE WON LOST CANCELLED EXPIRED}` — deliberately **no separate OUTBID status**: "currently outbid but still active" is a derived UI condition (compare against `cycle.currentLeaderBidId`'s owning PreBid), not a stored state, so a price tick never requires a write to every other bidder's row)
   - `Bid`: append-only audit ledger of every price movement. id (cuid), cycleId, `preBidId` (which standing max-bid caused this tick), `amountCents` (the actual tick — **never** a maxBid), `isProxy` (true = system-generated counter-bid, false = a human's own directly-submitted amount), `triggeredExtension` (bool, true if this tick caused a soft-close extension), createdAt. This is what the realtime feed and the detail card's activity feed read from — `PreBid.maxBidCents` itself is never exposed anywhere public (2.2's privacy rule)
   - Indexes: `Plot @@index([status])`, `@@index([originX, originY])` (unchanged); `AuctionCycle @@index([plotId])`, `@@index([status, endAt])` (the worker's "find cycles due for resolution" query — runs every ~30–60s, must be indexed); `PreBid @@index([plotId, cycleId])`, `@@index([cycleId, status])`; `Bid @@index([cycleId, createdAt])`
   - **Tier economics live in code, not the database** (`lib/tiers.ts`), same pattern as the original spec's pure `generateInitialGrid()`: OUTER 6h duration / $1.00 floor / $0.50 increment; MID 12h / $5.00 / $1.00; CORE 24h / $25.00 / $5.00. `AuctionCycle` snapshots these three numbers at creation so a future tier-pricing change never silently reprices a cycle that's already running
4. **Migration discipline**
   - Create the initial migration; run it against dev DB
   - Document the workflow: `migrate dev` locally, `migrate deploy` in CI/prod — never `db push` against production
5. **Sanity access layer**
   - Create `server/db.ts` with a singleton Prisma client (standard Next.js pattern to avoid connection pooling issues on serverless)
6. **Bidder identity — evolves the single-plot session token into a site-wide identity; still no user accounts**
   - The product still has no login (unchanged product-wide stance), but proxy bidding needs one stable identity across *multiple plots and multiple cycles* — unlike a one-shot 15-minute hold, a standing max-bid can span days before its cycle even starts
   - One long-lived, `httpOnly`, `sameSite=lax`, HMAC-signed cookie minted on a bidder's first-ever claim/bid/pre-bid: payload `{ bidderId (uuid), stripeCustomerId (nullable until their first pre-auth), issuedAt }`, ~1 year TTL with sliding refresh
   - **No new `Bidder` table** — the signed cookie *is* the identity record. Trade-off, stated plainly: clearing cookies or switching devices loses the ability to see/manage/top-up prior pre-bids and forfeits the saved card; it does **not** corrupt auction correctness — every `PreBid` row is self-contained and resolves normally regardless of whether its owner can still prove ownership later. Acceptable given the product's explicit no-accounts scope
   - `PreBid.bidderRef` stores `bidderId`; any ownership check is `preBid.bidderRef === cookie.bidderId`
   - This is the **single home** for bidder identity. Every later phase (2.2's endpoints, 3.1's pre-auth, 3.2's confirmation UI) reuses this cookie — none of them mint their own
7. **Stripe Customer + deferred authorization timing (correctness-critical — decide here, not improvised later)**
   - A card authorization hold is only guaranteed valid for **7 days** (Stripe's platform limit on manual-capture PaymentIntents). A CORE cycle alone runs 24h, and a *future* pre-bid can be registered days before its cycle even starts — naively authorizing the full `maxBidCents` at registration time risks the hold lapsing before resolution
   - Decision: **registration always uses a zero-dollar `SetupIntent`** to save the card (`stripeCustomerId` created lazily on first-ever pre-auth, cached in the bidder cookie for reuse) — no funds held yet. The real `maxBidCents` authorization (`PaymentIntent`, `capture_method: manual`, `confirm: true`, off the saved payment method) is created only when a `PreBid` is **attached to a real, started cycle**: immediately for a live claim/bid (2.2), or at rotation time for a queued future pre-bid (2.3's worker). This keeps every hold's lifetime bounded by (cycle duration + capped soft-close extension) — always safely inside 7 days, no matter how far ahead the pre-bid was scheduled
   - If authorization fails at attach time (declined/expired card): exclude that `PreBid` from the cycle (`status = EXPIRED`, reason logged), never block the other bidders

## Verification

- Migration applies cleanly to an empty database twice in a row (drop + re-migrate)
- A trivial query (`prisma.plot.count()`) executes from a Next.js server component/route reading env-configured DB
- Manually create a Plot + AuctionCycle + two PreBids + a Bid row via `prisma studio`; confirm relations resolve both directions

## Exit criteria

- [ ] Dev + prod databases exist, schema identical via same migration
- [x] `prisma generate` runs on install/build everywhere — `postinstall: prisma generate` in `package.json`; CI runs `npm ci` (never a committed client) and Vercel uses the same hook (`docs/deployment.md`)
- [x] Singleton client exported and used by all future server code — `src/server/prisma.ts`, imported by all 11 server consumers (auction engine/worker/finalize, outbox, every API route)
- [x] DB host + realtime transport decision recorded with a one-line rationale — binding for phase 0.3 and M2 phase 2.4, neither of which re-decides it — step 1 of this file (Neon Postgres + SSE); reused verbatim at the top of 2.4
- [x] Schema supports the full cycle lifecycle (IDLE → LIVE → RESOLVED → next cycle or back to IDLE) with nothing left over from the old one-time-sale model — `Plot`/`AuctionCycle`/`PreBid`/`Bid` + statuses; Part 1–3 remediation kept it current
- [x] Bidder cookie mechanism decided and documented here as the single home for identity — step 6 of this file (HMAC httpOnly cookie, `bidderRef` ownership checks); implemented in `src/server/bidder-cookie.ts`, tested in `tests/server/bidder-cookie.test.ts`. Limitations (cookie-bound identity, rotation logs out) in README "Bidder identity"

## Out of scope / notes

- Seed + read API are 0.3. Tier economics constants live in `lib/tiers.ts`, not migrated as DB rows (3 fixed tiers, per spec) — same pattern as the original `generateInitialGrid()`
- No user accounts, no admin auth here — unchanged product-wide stance
