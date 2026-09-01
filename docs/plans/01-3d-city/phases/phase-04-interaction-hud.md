# Phase 1.4 — Interaction, HUD & Navigation

**Milestone:** [1 · 3D City](../PLAN.md) · **Prev:** [1.3 Data Binding](phase-03-data-binding-states.md) · **Next:** [1.5 Performance Pass](phase-05-performance-pass.md)
**Status:** ⚪ Not started · **Estimate:** ~2 days

## Goal

Pointer interaction (hover, click, select) plus the **full identification HUD**: 2D radar minimap, My Leases switcher, outbid contested toast, detail card with claim CTA stub — all wired to fly-to without manual hunting.

## Prerequisites

- Phase 1.3 (real data + `ownedLeading` derivation + personal identity beacons rendered); camera controls expose a programmatic fly-to API (from 1.1)

## Steps

1. **Hover**
   - Pointer-over raises emissive highlight + cursor change; out clears it; guard against hover thrash while orbiting (ignore during drag)
   - Hover on a beacon/aura-owned plot shows the same highlight — beacons themselves are not separate raycast targets
2. **Selection**
   - Click selects a plot (single source of truth in the store); clicking empty space clears; selected plot gets a stronger outline/ring than hover
   - Replace the old "optional gentle ease" with a real **fly-to helper**: `flyToPlot(plotId)` computes the target world position via tier-aware `gridToWorld`, then calls `cameraControls.setLookAt()` (or `OrbitControls` equivalent) to animate the camera in front of that building at close-up inspect distance. This is the single navigation primitive reused by the minimap, My Leases switcher, and contested toast — implement once, call everywhere
3. **Detail card**
   - Floating panel (screen-space, anchored bottom/side — not a 3D sprite) showing: tier, grid footprint, status, plus personal context when `ownedLeading` or outbid
   - `LIVE` plots: current price, current leader's company name/tagline/handle/`mrrText` badge (if present), and an enabled "Visit site →" link to targetUrl (new tab, `rel="noopener"`) — leader data is public per 0.3 privacy invariant. A real second-by-second **countdown to `endAt`** renders here — the one place per-plot per-second ticking happens, scoped to selected plot only, per 1.3 — plus a disabled "Place a bid" CTA stub with tooltip "Bidding opens soon" (M2 integration point). If the selected plot is an **outbid** one (you have a PreBid on its cycle but no longer lead), show the amber `⚠️ OUTBID: +$X to retain` variant with an enabled "Jump & outbid" CTA that opens the M2 bid modal when it exists
   - `IDLE` plots: tier floor price + disabled "Claim this plot" CTA with tooltip "Bidding opens soon" — the M2 integration point
4. **City HUD — activity + navigation (the identification system)**
   - **Top strip (existing, unchanged):** counts (idle/live per tier), a **live activity meter** — sum of `currentPriceCents` across every currently-`LIVE` plot — tiny brand mark, legend chip for the two status skins + personal colors (cyan = yours, amber = outbid)
   - **My Leases quick-switcher (new):** header pill `🏢 My Leases (N) ▾` where `N` = count of plots where `ownedLeading` is true (derived from 1.3's `/api/me/bids` + plots join, no new endpoint). Clicking opens a dropdown listing each owned plot as `Sector {id} — {companyName}` (e.g. "Sector B2 — CodeShip"), sorted by soonest `endAt`. Clicking an entry calls `flyToPlot(plotId)` → close-up inspect mode. Empty state: pill shows `(0)` and dropdown says "No active leases — claim an IDLE plot to start" with a CTA to highlight IDLE plots
   - **2D radar minimap (new, bottom-right HUD):** flat **10×10** grid overlay mapping **1:1** to the 3D world grid (cell `(x, y)` in minimap = `originX/Y` in world). Visual encoding:
     - **Cyan star `★`:** your active winning plots (`ownedLeading`)
     - **Flashing amber `⚠️`:** plots where you were just outbid (you have a PreBid on the cycle but `currentLeaderBidId !== yours` and cycle still `OPEN`)
     - **Dark blue `■`:** other occupied (`LIVE` but not yours)
     - **Dark grey outline `□`:** vacant `IDLE` (base-price) plots
     - Legend row beneath the grid explains the four symbols
   - Minimap is **pure 2D DOM/SVG** (not a second WebGL canvas) — grid of divs or SVG rects, ~200×200px, negligible perf. Clicking any dot calls `flyToPlot(plotId)` to fly and rotate the camera directly in front of that building. Hovering a dot shows a tooltip with plot id + status + price
   - Minimap + My Leases share the same derived ownership data from 1.3 — no extra fetches, they re-derive on every plots/me-bids refetch
5. **Outbid contested toast (new, global notification)**
   - When `ownedLeading` flips to false for any plot (detected on realtime `bid:placed` from 2.4, or on next poll before realtime lands), show a transient toast: `"Sector B2 contested — [Click to Jump & Outbid]"` — clicking it calls `flyToPlot(plotId)` and, when M2's modal exists, opens the bid form pre-filled. Toast auto-dismisses after ~8s, queue if multiple flips at once (FIFO, max 1 visible)
   - This is the only *push* affordance for outbid — the badge/aura flip (1.3) is the *ambient* one; the toast is the *interrupt* that guarantees you notice even when looking elsewhere
6. **Keyboard/accessibility seed**
   - Tab-reachable fallback list of plots (visually hidden) so selection isn't pointer-only — expanded in 4.4
   - Minimap and My Leases dropdown are keyboard-navigable (arrow keys + Enter to fly-to); contested toast has a keyboard-dismiss and is announced via `aria-live="polite"` with throttling (not per-second, only on the flip event)

## Verification

- Click through several plots per tier/status; card content always matches selection; no stuck highlight after fast orbits
- With 2 owned plots: minimap shows 2 cyan `★`, My Leases pill shows `(2)` and both entries fly to correct buildings at inspect distance
- Simulate outbid on one owned plot → badge flips to amber, minimap dot flips to `⚠️`, contested toast appears and its click flies to that plot
- Keyboard-only: Tab to minimap dots, Enter flies to plot; open My Leases dropdown, arrow-key + Enter flies to entry

## Exit criteria

- [x] Hover/select/deselect loop is crisp with zero stale visual state
- [x] Detail card ships all fields for both `IDLE` and `LIVE` plots incl. disabled claim/bid CTA hook point and the selected-plot-only live countdown; outbid variant shows `⚠️ OUTBID: +$X to retain` with correct tier increment
- [x] HUD counts derived from data (survive DB edits) and the live activity meter sums only currently-`LIVE` plots' current prices (recomputed on every fetch, never a stale one-time figure)
- [ ] Minimap renders 10×10 correctly, four symbol states accurate, click flies to building at close-up inspect distance
- [x] My Leases switcher count + dropdown accurate, each entry flies to its plot; empty state handled
- [x] Outbid contested toast appears on flip and its click flies to the contested plot
- [x] No new API endpoints — minimap + switcher derive purely from plots + `/api/me/bids` already in 1.3/M3 3.2

## Out of scope / notes

- Claim/bid modal itself is M2 phase 2.1 — here we only reserve its trigger + data contract
