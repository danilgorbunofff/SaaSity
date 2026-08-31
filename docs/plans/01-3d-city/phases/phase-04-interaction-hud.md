# Phase 1.4 — Interaction & HUD

**Milestone:** [1 · 3D City](../PLAN.md) · **Prev:** [1.3 Data Binding](phase-03-data-binding-states.md) · **Next:** [1.5 Performance Pass](phase-05-performance-pass.md)
**Status:** ⚪ Not started · **Estimate:** ~1 day

## Goal

Pointer interaction (hover, click, select) plus the city HUD: legend, counters, and the plot detail card with the claim CTA stub.

## Prerequisites

- Phase 1.3 (real data rendered)

## Steps

1. **Hover**
   - Pointer-over raises emissive highlight + cursor change; out clears it; guard against hover thrash while orbiting (ignore during drag)
2. **Selection**
   - Click selects a plot (single source of truth in the store); clicking empty space clears; selected plot gets a stronger outline/ring than hover
   - Optional gentle camera ease to keep selection centered (skip if >30 min of fiddling — nice-to-have)
3. **Detail card**
   - Floating panel (screen-space, anchored bottom/side — not a 3D sprite) showing: tier, grid footprint, status
   - `LIVE` plots: current price, current leader's company name/tagline/handle/`mrrText` badge (if present), and an enabled "Visit site →" link to targetUrl (new tab, `rel="noopener"`) — the current leader's data is deliberately public and live, not gated behind any "sold" state (this plot never reaches a permanent-ownership state; reuses the 0.3 privacy invariant that leader data is always public). A real second-by-second **countdown to `endAt`** renders here — this is the one place per-plot per-second ticking actually happens, scoped to the selected plot only, per 1.3's performance decision — plus a disabled "Place a bid" CTA stub with tooltip "Bidding opens soon" (the M2 integration point)
   - `IDLE` plots: tier floor price + disabled "Claim this plot" CTA with tooltip "Bidding opens soon" — the M2 integration point
4. **City HUD**
   - Top strip: counts (idle/live per tier), a **live activity meter** — sum of `currentPriceCents` across every currently-`LIVE` plot right now — tiny brand mark
   - This replaces the old one-time "revenue meter / fixed cap" concept entirely: a recurring auction model has no fixed total to divide by, so a live, ever-changing activity figure is the correct analog here, not a static progress bar
   - Legend chip explaining the two status skins
5. **Keyboard/accessibility seed**
   - Tab-reachable fallback list of plots (visually hidden) so selection isn't pointer-only — expanded in 4.4

## Verification

- Click through several plots per tier/status; card content always matches selection; no stuck highlight after fast orbits

## Exit criteria

- [ ] Hover/select/deselect loop is crisp with zero stale visual state
- [ ] Detail card ships all fields for both `IDLE` and `LIVE` plots incl. disabled claim/bid CTA hook point and the selected-plot-only live countdown
- [ ] HUD counts derived from data (survive DB edits) and the live activity meter sums only currently-`LIVE` plots' current prices (recomputed on every fetch, never a stale one-time figure)

## Out of scope / notes

- Claim/bid modal itself is M2 phase 2.1 — here we only reserve its trigger + data contract
