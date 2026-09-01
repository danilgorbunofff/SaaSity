# Phase 1.2 — Tier Meshes (Terraced Hill)

**Milestone:** [1 · 3D City](../PLAN.md) · **Prev:** [1.1 Scene & Camera](phase-01-scene-camera-controls.md) · **Next:** [1.3 Data Binding & States](phase-03-data-binding-states.md)
**Status:** ✅ Complete (2025 — ortho fix + 49 seeded skyline) · **Estimate:** ~1.5–2 days

## Goal

Three procedural, distinct-looking plot types built from primitives only (no downloaded assets), authored as data-driven components **sitting on their terrace step** — no floating buildings.

## Prerequisites

- Phase 1.1 (stage + config module exist, plinth Y values + hill target in `lib/city/config.ts`)

## Steps

1. **Coordinate helper — tier-aware**
   - Pure function `gridToWorld(originX, originY, spanX, spanY, tier)` returning `{ x, y, z }` where:
     - `x = originX + spanX/2 − 5`, `z = originY + spanY/2 − 5` (unchanged horizontal math)
     - `y = plinthY(tier) + height/2` — **plinthY:** `OUTER→0.0`, `MID→2.0`, `CORE→5.0` from 1.1's config; `height` is tier-range random (see below), so building center sits half its height above its terrace
   - Keep legacy `gridToWorld(originX, originY, spanX, spanY, height)` overload or wrapper for tests that pass explicit height
   - Unit-test: corners (0,0 OUTER → −4.5, `0+height/2`, −4.5), mid (1,1 MID → −3, `2+height/2`, −3), core center (3,3 CORE → 0, `5+height/2`, 0)
2. **OUTER — 1x1 slab tower (on Y=0.0 plinth)**
   - Box footprint 0.9×0.9, height randomized **1.5–2.5** (updated per stepped-hill spec; old 0.8–1.2 too short to read behind mid platform), seeded per plot id so skyline stable
   - Dark metallic material; neon edge treatment (thin emissive frame/lines around top border)
3. **MID — 2x2 glass tower (on Y=+2.0 platform)**
   - Footprint 1.85×1.85, height **4.0–6.0** seeded (updated per spec; old 3.5–5.0 short-shifted on the platform), transmissive/reflective panel material (tune transmission cost — fallback to glossy + envmap if too heavy, finalized in 1.5)
   - Cyan neon edge highlights; billboard frame element on one face (empty glowing rectangle — real text content arrives with M2 2.5's live rendering payoff as a cheap text plane; visual art polish is M4 4.3)
4. **CORE — 4x4 megastructure (on Y=+5.0 summit)**
   - Footprint 3.8×3.8, height **10.0–14.0** (updated per spec; old 12.0 fixed height now a range for skyline variance), layered composition (stacked boxes/setbacks) so it reads as architecture not a brick
   - Glowing vertical light beam (emissive cylinder + additive material, optionally animated slow pulse) and apex antenna with blinking tip — **do not** confuse with the personal *sky beacon* (1.3's cyan laser for owned plots, per-plot conditional; this beam is the CORE's permanent architectural fixture, always on)
5. **Shared plot shell**
   - One `Plot` 3D component switching on tier; all visuals parameterized by plot data + tier plinth Y + state (state skins wired in 1.3)
   - Hover/select hooks stubbed (no-op props) for 1.4; pass through `tier` so 1.3 can derive plinth context without recomputing

## Verification

- Dev scene renders one of each tier side by side, then all 49 mock-placed **on correct terrace** — OUTER at 0, MID at +2, CORE at +5, no z-fighting with plinth top
- Orbit around the hill confirms no occlusion: outer ring always visible behind mid platform, mid visible behind core summit
- FPS with 49 meshes on integrated GPU noted (baseline for 1.5)

## Exit criteria

- [ ] All three tiers visually distinct at default zoom **and** when zoomed to minZoom 20
- [ ] Heights/positions fully deterministic per plot id
- [ ] Coordinate helper covered by unit tests

## Out of scope / notes

- Real data + status colors are 1.3; interaction is 1.4. Art direction iteration continues informally through the milestone
