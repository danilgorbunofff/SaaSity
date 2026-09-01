# Phase 1.1 — Scene, Camera & Controls (Terraced Hill)

**Milestone:** [1 · 3D City](../PLAN.md) · **Prev:** [Milestone 0](../../00-scaffold-and-data-layer/PLAN.md) · **Next:** [1.2 Tier Meshes](phase-02-tier-meshes.md)
**Status:** ⚪ Not started · **Estimate:** ~1–1.5 days

## Goal

An empty but correctly-framed **terraced hill** stage: ziggurat elevation, retaining walls, ortho camera locked to 45°–50° pitch with hill-centered target, atmosphere ready for buildings.

## Prerequisites

- M0 done (deployed app, plots API available for later phases)

## Steps

1. **Canvas mount**
   - Client component hosting R3F `<Canvas>`; full-bleed layout slot reserved for M4's landing sections
   - Set `dpr={[1, 2]}` cap and `gl` defaults (antialias on desktop tier, off for low-power — flag now, tune in 1.5)
2. **Camera — stepped-hill spec**
   - Orthographic camera, `zoom: 40`, position `[20, 20, 20]`, looking at **`(0, 2.5, 0)`** (hill center-of-mass, not origin)
   - Verify isometric framing still reads correctly with hill offset; screenshot-compare at a few viewport sizes
3. **Controls — locked isometric pitch**
   - `OrbitControls`: `enableDamping`, `minZoom: 20`, `maxZoom: 80`
   - **Pitch lock:** `minPolarAngle ≈ 40° (0.698 rad)`, `maxPolarAngle ≈ 45° (≈ 0.785 rad)` — clamps pitch between **45°–50°** per spec (measured from Y-up). Old `Math.PI / 2.5` (~72°) is too permissive and lets the hill flatten-read fail
   - Azimuth unlimited (`minAzimuthAngle = -Infinity`, `maxAzimuthAngle = Infinity`) so full 360° orbit around the hill still works
   - Disable pan (or bound it) so the city can't be lost off-screen; set `target` to `(0, 2.5, 0)` — every orbit pivots around the hill's vertical center, not the ground plane
4. **Terraced hill — plinths + retaining walls**
   - Three stepped elevation tiers (constants in `lib/city/config.ts`):
     - **Outer plinth** `Y=0.0` — footprint spans the full 10×10 ground rect (thin box ~0.4 units thick so the step reads)
     - **Mid platform** `Y=+2.0` — inset rect covering the ~6×6 mid district (from world coords −3..+3), thickness ~0.4
     - **Core summit** `Y=+5.0` — 4×4 mesa (world coords −2..+2), thickness ~0.4
   - **Retaining walls:** vertical cliff faces on each step edge (BoxGeometry walls hugging the platform perimeters) with **horizontal neon strip trims** — thin emissive planes/lines running the wall length in `#00f0ff` (outer→mid step) and `#ff0055` (mid→core step) so the terraces read as intentional architecture, not floating plates
   - Ground plate slightly larger than 10×10, dark matte, faint 10×10 cell grid lines (dev helper, toggleable) drawn on the *outer* plinth top surface
5. **Stage & atmosphere**
   - Lighting kit: ambient + one directional key + colored rim lights (cyan/magenta) for the cyberpunk read
   - Optional: subtle fog and a starfield/environment for depth — fog `near/far` must account for hill height (top ~17–19 units including tallest building, not just ~12)
6. **Resize/stability**
   - Handle viewport resize without camera framing jumps; confirm no console warnings from drei on hot reload; verify retaining walls don't z-fight at any zoom

## Verification

- Dev-only debug overlay toggling the cell grid ON/OFF to eyeball alignment on the outer plinth (kept for 1.3)
- Orbit: pitch cannot leave 45°–50°, azimuth 360°, zoom stops at clamps, damping smooth at 60Hz, hill never leaves frame
- Visual: terraces read as a coherent ziggurat from default camera — not three floating slabs (neon trims must be visible)

## Exit criteria

- [ ] Camera + controls match stepped-hill constants exactly (pitch lock, target `(0, 2.5, 0)`, zoom 40/20/80)
- [ ] Three terrace steps render with retaining walls + neon trims, deployed-previewable with atmosphere
- [ ] All tuning constants centralized in one config module (`lib/city/config.ts` or similar) including plinth Y values + neon colors

## Out of scope / notes

- No plot meshes yet; no data binding — keep this phase geometry-free (buildings come in 1.2, just set their plinth Y there via `gridToWorld` tier offset)
- Hill geometry must not add more than 3 extra meshes before 1.5's budget pass — keep walls to one mesh per step edge band, not per cell
