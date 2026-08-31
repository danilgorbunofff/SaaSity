# Phase 1.2 — Tier Meshes

**Milestone:** [1 · 3D City](../PLAN.md) · **Prev:** [1.1 Scene & Camera](phase-01-scene-camera-controls.md) · **Next:** [1.3 Data Binding & States](phase-03-data-binding-states.md)
**Status:** ⚪ Not started · **Estimate:** ~1.5–2 days

## Goal

Three procedural, distinct-looking plot types built from primitives only (no downloaded assets), authored as data-driven components.

## Prerequisites

- Phase 1.1 (stage + config module exist)

## Steps

1. **Coordinate helper first**
   - Pure function `gridToWorld(originX, originY, spanX, spanY, height)` implementing spec math: `worldX = originX + spanX/2 − 5`, `worldZ = originY + spanY/2 − 5`, `worldY = height/2`
   - Unit-test the corners (0,0 → −4.5,−4.5) and core center (3,3,4,4 → 0,0)
2. **OUTER — 1x1 slab tower**
   - Box footprint 0.9x0.9, height randomized 0.8–1.2 (seeded per plot id so skyline is stable across reloads)
   - Dark metallic material; neon edge treatment (thin emissive frame/lines around top border)
3. **MID — 2x2 glass tower**
   - Footprint 1.85x1.85, height 3.5–5.0 seeded; transmissive/reflective panel material (tune transmission cost — fallback to glossy + envmap if too heavy, finalized in 1.5)
   - Cyan neon edge highlights; billboard frame element on one face (empty glowing rectangle — real text content arrives with M2 2.5's live rendering payoff as a cheap text plane; visual art polish is M4 4.3)
4. **CORE — 4x4 megastructure**
   - Footprint 3.8x3.8, height 12.0; layered composition (stacked boxes/setbacks) so it reads as architecture, not a brick
   - Glowing vertical light beam (emissive cylinder + additive material, optionally animated slow pulse) and apex antenna with blinking tip
5. **Shared plot shell**
   - One `Plot` 3D component switching on tier; all visuals parameterized by plot data + state (state skins wired in 1.3)
   - Hover/select hooks stubbed (no-op props) for 1.4

## Verification

- Dev scene renders one of each tier side by side, then all 49 mock-placed
- FPS with 49 meshes on integrated GPU noted (baseline for 1.5)

## Exit criteria

- [ ] All three tiers visually distinct at default zoom **and** when zoomed to minZoom 20
- [ ] Heights/positions fully deterministic per plot id
- [ ] Coordinate helper covered by unit tests

## Out of scope / notes

- Real data + status colors are 1.3; interaction is 1.4. Art direction iteration continues informally through the milestone
