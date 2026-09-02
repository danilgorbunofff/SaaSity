# Phase 1.3 — Data Binding, Status & Personal Identity

**Milestone:** [1 · 3D City](../PLAN.md) · **Prev:** [1.2 Tier Meshes](phase-02-tier-meshes.md) · **Next:** [1.4 Interaction & HUD](phase-04-interaction-hud.md)
**Status:** ✅ Complete · **Estimate:** ~2 days

## Goal

The real 49-plot grid from `/api/plots` replaces mock data; each plot renders with its status identity (`IDLE` / `LIVE`) **and** a personal-identity layer (beacon/aura/badge) that lets you spot *your* plots without hunting. Still no per-plot per-second timers.

## Prerequisites

- Phase 1.2 (tier components exist, tier-aware `gridToWorld`); M0 API deployed; bidder identity cookie from M0 0.2 exists but personal data here is *derived*, not fetched (ownership determined by matching)

## Steps

1. **Fetch & hydrate**
   - Load plots via the shared types from 0.3; client store (Zustand) holds `plots by id` + loading/error states — the per-plot shape now includes the richer `LIVE` fields (`currentPriceCents`, `endAt`, leader's public brand snapshot, plus `currentLeaderBidId` for ownership check) alongside the always-present tier/origin/span/status
   - Also fetch `/api/me/bids` (M3 3.2's endpoint) once on mount and cache the caller's `PreBid[]` set — needed to know *which* plots are yours without exposing `maxBidCents`; this endpoint already exists as the single private owner view, no new API here
   - Derive `ownedLeading: boolean` per plot as `plot.status === LIVE && myPreBids.some(pb => pb.cycleId === plot.currentCycleId && pb.id === plot.currentLeaderBidId)` — never trust a client-side flag from the public plots API alone
   - Handle fetch lifecycle: skeleton (terraced hill + "syncing city…" chip) → populated; refetch on window focus (staleTime strategy documented)
2. **Status skins (base layer, everyone sees)**
   - `IDLE`: base look, soft inviting emissive edge — genuinely empty (no leader data to show), matches "cheap and available right now"
   - `LIVE` (neutral): a brighter "contested" identity, clearly distinct from `IDLE` at a glance — but **does not** drive per-second-ticking countdown on every `LIVE` plot; that pattern from before still holds. Every neutral `LIVE` plot shows a static "LIVE" pulse/badge, and a coarse "closing soon" escalation (faster pulse / red-shift) triggers grid-wide once `endAt - now < 3min` off one **shared low-frequency tick** (every 5s). Real second-by-second countdown remains only in 1.4's detail card
   - No third "sold/owned" skin — product has no permanently-owned state; a plot is always either `IDLE` or `LIVE`, forever cycling
3. **Personal identity layer (only on plots you currently lead)**
   - Conditional entirely on `ownedLeading` — **never on neutral `LIVE` plots**, never on `IDLE`
   - **Skyward light beacon:** vertical cyan laser (`#00f0ff`) shooting from plot roof to well above skybox (emissive cylinder, additive material, slow pulse). Renders *above* occlusion — visible from every camera angle even when the building itself is hidden behind the CORE. One beacon per owned plot, not per building
   - **Ground aura ring:** pulsing neon cyan boundary ring on the floor grid around the plot footprint (shader ring / drei `Ring` with emissive + opacity pulse). Sits on the *terrace* surface (plinth Y), not ground-zero, so it reads correctly on the hill
   - **Persistent billboard badge:** high-contrast floating pill `★ YOUR HQ: {companyName} • {countdown}` hovering above roof at all zoom levels using `drei <Html transform>` / `<Billboard>`. Countdown is coarse here (mm:ss, updated on the shared 5s tick, not per-second) — the precise per-second countdown lives only in 1.4's card. Badge auto-hides behind occlusion is acceptable; the beacon + aura already guarantee discoverability when it is
   - **Outbid transition (state flip):** when a plot was `ownedLeading` and ceases to be (rival's `Bid` moves `currentLeaderBidId` away, observed via 2.4 realtime or next fetch), the badge **flips within one tick** from cyan `★ YOUR HQ` to **flashing amber** `⚠️ OUTBID: +$X to retain` (where `X` = tier increment: $0.50 / $1.00 / $5.00). Aura ring switches to amber pulse, beacon dims/off. No new API — derived purely from `ownedLeading` going false while the cycle is still `OPEN`
4. **World assembly — tier-aware**
   - Map every API plot through tier-aware `gridToWorld(plot, tier)` so buildings sit on their correct terrace (`OUTER@0`, `MID@+2`, `CORE@+5`). Full city composed from data only — no hardcoded positions
5. **Sanity overlay**
   - Dev toggle: show plot ids as HTML labels (drei `Html`) to verify mapping visually against the cell grid on the hill; second toggle: force `ownedLeading` on arbitrary plots to QA beacon/aura/badge without real bids
   - ✅ Shipped as `?debug=1`: mounts `DebugOverlay` in CityScene — plot-id labels for all 49 plots + a "force ownedLeading" checkbox (store slice `debugForceOwned`) that renders the personal skin layer grid-wide. Absent from the bundle path unless the URL flag is set
6. **SSR/CSR notes**
   - Canvas is client-only (`dynamic import, ssr:false`); confirm no hydration mismatch; first paint strategy for SEO stays a shell + copy (M4 handles narrative)
   - Html overlays (`<Html transform>`) billboard badges are DOM — not WebGL — so they don't add draw calls but do add DOM nodes; cap is bounded by owned-plot count (max affordable `LIVE` plots per bidder, typically 1–3, not 49) so cost is negligible. Still, 1.5 profiles them

## Verification

- Overlay check: mid ring occupies 2×2 blocks on `Y=+2.0` platform, core dead center on `Y=+5.0` summit, outer ring on `Y=0.0` plinth — no floating buildings
- Dev-only: manually creating/backdating an `AuctionCycle` row flips its plot between `IDLE`/`LIVE` skins on refresh
- Dev-only: force `ownedLeading` on 2 plots → beacon + aura + badge appear, then simulate outbid (flip `currentLeaderBidId`) → badge flips to amber `OUTBID` within one tick
- Simulate 10+ simultaneously `LIVE` plots (dev fixture) and confirm no per-plot per-second re-render outside the selected/hovered one; beacon/aura/badge only on owned plots, not neutral `LIVE`

## Exit criteria

- [x] City is 100% data-driven from the deployed API, with tier-correct plinth Y
- [x] Both status skins (`IDLE`/`LIVE`) readable at default zoom, plus the shared-tick "closing soon" escalation visible near `endAt`
- [x] Personal identity (beacon + aura + badge) visible only on owned-leading plots and correct through an outbid flip
- [x] Outbid badge shows correct tier increment (+$0.50 / +$1.00 / +$5.00) per plot tier
- [x] Loading and error states ship (never a black screen)
- [x] No plot drives an independent per-second re-render in the base grid view — confirmed by profiling with several `LIVE` plots at once

## Out of scope / notes

- No realtime yet (M2) — price/leader/countdown shown as of last fetch, refreshed on refetch/focus; live sub-second ticking arrives with 2.4's feed. Selection UI and the real ticking countdown are 1.4
