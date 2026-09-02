# Milestone 1 — 3D City

**Prev:** [00 · Scaffold & Data Layer](../00-scaffold-and-data-layer/PLAN.md) · **Next:** [02 · Reservations & Realtime](../02-reservations-and-realtime/PLAN.md)
**Status:** ✅ Complete (M1 phases 1.1–1.5 shipped; M2 reservations & realtime pending)

## Objective

Render the full 10x10 isometric **terraced-hill** cyberpunk city from live plot data — the "wow" demo — with hover/click interaction and **instant plot identification** (your HQs findable without hunting 49 plots). Read-only: no claim/bid flow yet.

## In scope

- React Three Fiber scene with orthographic camera (zoom 40, position [23.5, 24.6, 23.5] — derived from the 45° azimuth + 47.5° elevation constraints, ~33.26 units out from target `(0, 2.5, 0)`) and damped OrbitControls (minZoom 20, maxZoom 80, pitch locked 45°–50°, target `(0, 2.5, 0)` anchored to hill center-of-mass)
- **Terraced hill grid architecture (ziggurat):** three stepped elevation tiers preventing isometric occlusion — Outer plinth `Y=0.0` (1.5–2.5m), Mid platform `Y=+2.0` (4.0–6.0m), Core summit `Y=+5.0` (10–14m) — with retaining cliff walls + horizontal neon trims (#00f0ff / #ff0055)
- Grid-to-world conversion centered at origin, now with tier plinth Y baked in
- Three procedural mesh tiers (no downloaded 3D assets):
  - **OUTER** — 0.9×0.9 footprint, 1.5–2.5 height on `Y=0.0` plinth, dark metallic base, neon border
  - **MID** — 1.85×1.85 footprint, 4.0–6.0 height on `Y=+2.0` platform, glass panels, cyan neon edges, billboard frame
  - **CORE** — 3.8×3.8 footprint, 10–14 height on `Y=+5.0` summit, megastructure with light beam and apex antenna
- Plot state visuals (`IDLE` / `LIVE`) plus **personal identity layer** — sky beacon, ground aura ring, floating `LEADING` badge (bidding-leader position, distinct from a paid tenant — see [Part 1 lifecycle fix](/docs/reviews/m0-m2-remediation/part-01-product-lifecycle.md)), and outbid flashing amber transition
- **HUD identification system:** 2D radar minimap (10×10, 1:1 grid, fly-to on click) + top `My Leases` quick-switcher dropdown (counts paid, activated tenancies, not merely leading bids)
- Hover highlight + click selection with detail card (tier, size, current price or tier floor, standing tenant's company + countdown while live)
- Performance pass: instancing/batching where sensible, capped pixel ratio, graceful mobile framerate with Html-overlay budget checked

## Out of scope

- Bid/claim forms, auction writes, Stripe, realtime subscriptions (M2), marketing sections (M4)

## Planned phases

| Phase | File | Focus |
|-------|------|-------|
| 1.1 | [scene, camera & controls](phases/phase-01-scene-camera-controls.md) | R3F canvas, terraced hill, ortho camera (45°–50° pitch, target 0/2.5/0), orbit clamps, lighting |
| 1.2 | [tier meshes](phases/phase-02-tier-meshes.md) | Procedural geometry + materials for all three tiers on stepped plinths, retaining walls |
| 1.3 | [data binding & states](phases/phase-03-data-binding-states.md) | Bind real plots API, tier-aware world coords, status + personal-identity skins (beacon/aura) |
| 1.4 | [interaction & HUD](phases/phase-04-interaction-hud.md) | Hover/click, detail card, minimap + My Leases switcher, outbid transition, city HUD |
| 1.5 | [performance pass](phases/phase-05-performance-pass.md) | Profiling, instancing, Html/beacon/mobile tuning |

## Deliverables

- Interactive city view fed by the production plots API
- Selection detail card with a disabled "claim" CTA (hook for M2)
- Lighthouse/devtools perf notes documenting achieved FPS targets

## Definition of done

- [x] All 49 plots render at correct positions/sizes on correct terrace step, no center-hidden occlusion at default zoom
- [x] Camera cannot flip under the grid or zoom out of framing; pitch stays in 45°–50°, orbit pivots around hill center `(0, 2.5, 0)`
- [x] Your `LIVE` plots identifiable without orbit-hunting: beacon visible at any angle/zoom, minimap + My Leases switcher both fly to the building
- [x] Outbid transition unmistakable within one glance (badge flip, amber pulse, contested toast)
- [x] ~60 FPS on desktop, acceptable (~30) on mid mobile; memory stable during long orbit sessions; Html-overlay count stays bounded

## Dependencies

- **M0**: plots API + schema must exist (state visuals assume the status enum)

## Risks & mitigations

- **Ortho + drei quirks on resize** → lock camera/resize handling early in phase 1.1
- **Neon/glass shaders + Html overlays + beacons tanking mobile GPUs** → tier down materials/beacon count by device capability in phase 1.5; cap Html badge instances (1 per owned plot, not 49)
- **Auction-driven updates (price ticks, soft-close pulses) causing excess re-renders at scale** → per-second countdown work is scoped to the selected/hovered plot only (decided in 1.3, verified in 1.5); every other `LIVE` plot uses a shared low-frequency tick, not independent per-plot timers
- **Terraced hill misreads as floating buildings** → retaining walls with strong neon horizontal trims make steps read as architecture, not gaps; verified in 1.1/1.5 visually
