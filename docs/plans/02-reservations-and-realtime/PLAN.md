# Milestone 2 — Auctions & Realtime

**Prev:** [01 · 3D City](../01-3d-city/PLAN.md) · **Next:** [03 · Stripe Pre-Auth & Capture](../03-stripe-payments/PLAN.md)
**Status:** ⚪ Not started

> Folder kept as `02-reservations-and-realtime` to avoid renumbering every cross-file link — read this milestone as **"Auctions & Realtime"** throughout.

## Objective

Make the city feel alive: visitors can instantly claim an idle plot at the tier floor price, challenge a live auction with a manual bid, or schedule a proxy pre-bid for a future cycle — and every open browser reflects price/leader changes in near-real-time. Soft-close prevents last-second sniping across time zones. No real money moves yet — a mock resolution trigger completes each cycle so the full claim → bid → resolve → next-cycle loop is testable end-to-end; M3 swaps the mock for real Stripe pre-auth/capture.

## In scope

- Claim/bid/pre-bid modal: company name, tagline, target URL, Twitter/X handle, `mrrText` badge, `maxBidCents` (validated; `logoUrl` deferred decision to M4)
- **Instant claim** on `IDLE` plots — atomic conditional update (prevents double-claim races) creates a new `AuctionCycle` at the tier floor price (clean-slate: never carries over a prior cycle's price)
- **Manual bid** on `LIVE` plots — must beat `currentPriceCents + incrementCents`
- **Proxy pre-bid** for a plot's *next* (not-yet-created) cycle — timezone fairness, eBay-style: the system auto-bids on the bidder's behalf up to their `maxBidCents`, only when challenged
- One shared proxy-resolution engine (`resolveCycle`) used identically by claim, bid, and cycle rotation — never three divergent implementations
- **Soft-close**: any bid within the last 3 minutes of `endAt` extends the countdown (reset-to-3-minutes-remaining, capped total extension — see 2.2 for why not a flat additive extension)
- **Cycle resolution worker**: finds ended cycles, determines the winner, rotates tenant display data, starts the next cycle from queued pre-bids or reverts the plot to `IDLE`
- Realtime layer for live grid updates, implemented per the phase 0.2 decision (SSE + in-process bus by default, or Supabase Realtime if 0.2 chose that DB) — 2.4 implements, it does not re-decide. Now carries price-tick, leader-change, extension, and resolution events, not just coarse status flips
- Client store (Zustand) syncing optimistic UI with the realtime feed

## Out of scope

- Stripe pre-auth/capture (M3 — mocked here), landing/marketing polish (M4)

## Planned phases

| Phase | File | Focus |
|-------|------|-------|
| 2.1 | [bid & pre-bid form validation](phases/phase-01-claim-form-validation.md) | Modal UX (claim/bid/prebid modes), form fields incl. `maxBidCents`, client/server validation |
| 2.2 | [claim, bid & proxy engine API](phases/phase-02-atomic-reserve-api.md) | Three endpoints, one shared `resolveCycle` engine, soft-close |
| 2.3 | [cycle resolution worker](phases/phase-03-expiry-sweep.md) | Finds ended cycles, rotates tenant data, starts next cycle or goes idle |
| 2.4 | [realtime feed](phases/phase-04-realtime-feed.md) | SSE vs Supabase decision + bid/extension/resolution event plumbing |
| 2.5 | [mock cycle resolution & full loop](phases/phase-05-mock-sale-states.md) | Mock capture/release stub, full lifecycle E2E rehearsal |

## Deliverables

- Working claim → live-bidding → soft-close → resolution → next-cycle lifecycle observable from two browsers simultaneously
- Realtime updates (price ticks, leader changes, extensions, resolutions) arriving in under ~1 second across sessions
- Race-condition test evidence (concurrent claims/bids, exactly one leader/price at any instant; overlapping worker runs never double-resolve)

## Definition of done

- [ ] Two simultaneous claims of the same idle plot result in exactly one new cycle
- [ ] A live auction always resolves to the proxy-computed clearing price — never a bidder's full `maxBidCents` unless a competing bid actually forces it there
- [ ] A bid within the last 3 minutes of close always extends the countdown; the extension is capped and never double-applied from a single request
- [ ] Mock resolution rotates the plot's display data at cycle end, starting a new cycle from queued pre-bids or reverting the plot to `IDLE`

## Dependencies

- **M0** (schema, seed), **M1** (scene to attach interaction and states to)

## Risks & mitigations

- **Realtime on serverless hosting** (Vercel timeouts for long-lived SSE) → evaluate managed alternative or heartbeat strategy; the SSE-vs-Supabase choice itself was already locked in by phase 0.2, so 2.4 only needs an implementation fallback, not a fresh decision
- **Optimistic UI desync** → make the realtime feed the single source of truth; optimistic state only for form input
- **Proxy bidding wars causing runaway soft-close extensions** → reset-based (not additive) extension plus a hard +2h total cap, decided in 2.2
- **Worker double-processing the same ended cycle** on overlapping cron invocations → `RESOLVING` intermediate status via the same conditional-update atomicity pattern used everywhere else in this project
