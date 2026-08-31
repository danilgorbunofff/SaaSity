# Milestone 1 — 3D City

**Prev:** [00 · Scaffold & Data Layer](../00-scaffold-and-data-layer/PLAN.md) · **Next:** [02 · Reservations & Realtime](../02-reservations-and-realtime/PLAN.md)
**Status:** ⚪ Not started

## Objective

Render the full 10x10 isometric cyberpunk city from live plot data — the "wow" demo of the product — with hover/click interaction. Read-only: no claim/bid flow yet.

## In scope

- React Three Fiber scene with orthographic camera (zoom 40, position [20, 20, 20]) and damped OrbitControls (minZoom 20, maxZoom 80, maxPolarAngle PI/2.5)
- Grid-to-world coordinate conversion centered at origin, per the spec formula
- Three procedural mesh tiers (no downloaded 3D assets):
  - **OUTER** — 0.9x0.9 footprint, 0.8–1.2 height, dark metallic base, subtle neon border
  - **MID** — 1.85x1.85 footprint, 3.5–5.0 height, glass panels, cyan neon edges, billboard frame
  - **CORE** — 3.8x3.8 footprint, 12.0 height, megastructure with light beam and apex antenna
- Plot state visuals (`IDLE` / `LIVE`, with a live current-price/leader/countdown readout for `LIVE` plots) and subtle per-plot height variation for skyline feel
- Hover highlight + click selection with a detail card (tier, size, current price or tier floor, leader's company + countdown once live)
- Performance pass: instancing/batching where sensible, capped pixel ratio, graceful mobile framerate

## Out of scope

- Bid/claim forms, auction writes, Stripe, realtime subscriptions (M2), marketing sections (M4)

## Planned phases

| Phase | File | Focus |
|-------|------|-------|
| 1.1 | [scene, camera & controls](phases/phase-01-scene-camera-controls.md) | R3F canvas, ortho camera, orbit clamps, lighting/atmosphere |
| 1.2 | [tier meshes](phases/phase-02-tier-meshes.md) | Procedural geometry + materials for all three tiers |
| 1.3 | [data binding & states](phases/phase-03-data-binding-states.md) | Bind real plots API, world-coord mapping, status coloring |
| 1.4 | [interaction & HUD](phases/phase-04-interaction-hud.md) | Hover/click, detail card, city HUD (counts, price legend) |
| 1.5 | [performance pass](phases/phase-05-performance-pass.md) | Profiling, instancing, mobile tuning |

## Deliverables

- Interactive city view fed by the production plots API
- Selection detail card with a disabled "claim" CTA (hook for M2)
- Lighthouse/devtools perf notes documenting achieved FPS targets

## Definition of done

- [ ] All 49 plots render at correct positions/sizes per spec math
- [ ] Camera cannot flip under the grid or zoom out of framing
- [ ] ~60 FPS on desktop, acceptable (~30) on mid mobile; memory stable during long orbit sessions
- [ ] Clicking a plot shows its data; clicking empty space deselects

## Dependencies

- **M0**: plots API + schema must exist (state visuals assume the status enum)

## Risks & mitigations

- **Ortho + drei quirks on resize** → lock camera/resize handling early in phase 1.1
- **Neon/glass shaders tanking mobile GPUs** → tier down materials by device capability in phase 1.5
- **Auction-driven updates (price ticks, soft-close pulses) causing excess re-renders at scale** → per-second countdown work is scoped to the selected/hovered plot only (decided in 1.3, verified in 1.5); every other `LIVE` plot uses a shared low-frequency tick, not independent per-plot timers
