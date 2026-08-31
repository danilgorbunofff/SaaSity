# Phase 1.3 — Data Binding & Status States

**Milestone:** [1 · 3D City](../PLAN.md) · **Prev:** [1.2 Tier Meshes](phase-02-tier-meshes.md) · **Next:** [1.4 Interaction & HUD](phase-04-interaction-hud.md)
**Status:** ⚪ Not started · **Estimate:** ~1.5 days

## Goal

The real 49-plot grid from `/api/plots` replaces mock data, and each plot renders with its status identity (`IDLE` / `LIVE`) — `LIVE` plots additionally carrying a current-price/leader readout, without turning every one of up to 49 simultaneously-live plots into an independent per-second timer.

## Prerequisites

- Phase 1.2 (tier components exist); M0 API deployed

## Steps

1. **Fetch & hydrate**
   - Load plots via the shared types from 0.3; client store (Zustand) holds `plots by id` + loading/error states — the per-plot shape now includes the richer `LIVE` fields (`currentPriceCents`, `endAt`, leader's public brand snapshot) alongside the always-present tier/origin/span/status
   - Handle the fetch lifecycle: skeleton (ground plate + "syncing city…" chip) → populated; refetch on window focus (staleTime strategy documented)
2. **Status skins**
   - `IDLE`: base look, soft inviting emissive edge — genuinely empty (no leader data to show), matches "cheap and available right now"
   - `LIVE`: a brighter, "contested" identity, clearly distinct from `IDLE` at a glance — but **does not** drive a per-second-ticking countdown on every `LIVE` plot simultaneously; that would mean up to 49 independent per-second re-renders for numbers nobody's currently looking at. Instead: every `LIVE` plot shows a static "LIVE" pulse/badge, and a coarse "closing soon" visual escalation (faster pulse / red-shift) triggers grid-wide once `endAt - now < 3min` (the soft-close window) off one **shared, low-frequency timer tick** (e.g. every 5s) — never independent per-plot per-second state. The real second-by-second ticking countdown is reserved for the selected/hovered plot only, rendered in 1.4's detail card
   - No third "sold/owned" skin exists — the product has no permanently-owned state; a plot is always either `IDLE` or `LIVE`, forever cycling
3. **World assembly**
   - Map every API plot through `gridToWorld`; full city composed from data only — no hardcoded positions anywhere
4. **Sanity overlay**
   - Dev toggle: show plot ids as HTML labels (drei `Html`) to verify mapping visually against the cell grid from 1.1
5. **SSR/CSR notes**
   - Canvas is client-only (`dynamic import, ssr:false`); confirm no hydration mismatch; first paint strategy for SEO stays a shell + copy (M4 handles narrative)

## Verification

- Overlay check: mid ring occupies expected 2x2 blocks, core dead center, outer ring borders the edge
- Dev-only: manually creating/backdating an `AuctionCycle` row flips its plot between `IDLE`/`LIVE` skins on refresh
- Simulate 10+ simultaneously `LIVE` plots (dev fixture) and confirm no per-plot per-second re-render occurs outside the selected/hovered one

## Exit criteria

- [ ] City is 100% data-driven from the deployed API
- [ ] Both status skins (`IDLE`/`LIVE`) readable at default zoom, plus the shared-tick "closing soon" escalation visible near `endAt`
- [ ] Loading and error states ship (never a black screen)
- [ ] No plot drives an independent per-second re-render in the base grid view — confirmed by profiling with several `LIVE` plots at once

## Out of scope / notes

- No realtime yet (M2) — price/leader/countdown shown as of last fetch, refreshed on refetch/focus; live sub-second ticking arrives with 2.4's feed. Selection UI and the real ticking countdown are 1.4
