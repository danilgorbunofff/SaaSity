# Phase 1.1 — Scene, Camera & Controls

**Milestone:** [1 · 3D City](../PLAN.md) · **Prev:** [Milestone 0](../../00-scaffold-and-data-layer/PLAN.md) · **Next:** [1.2 Tier Meshes](phase-02-tier-meshes.md)
**Status:** ⚪ Not started · **Estimate:** ~1 day

## Goal

An empty but correctly-framed isometric stage: orthographic camera per spec, damped orbit with clamps, atmosphere (grid floor, fog, lights) ready for buildings.

## Prerequisites

- M0 done (deployed app, plots API available for later phases)

## Steps

1. **Canvas mount**
   - Client component hosting R3F `<Canvas>`; full-bleed layout slot reserved for M4's landing sections
   - Set `dpr={[1, 2]}` cap and `gl` defaults (antialias on desktop tier, off for low-power — flag now, tune in 1.5)
2. **Camera per spec**
   - Orthographic camera, `zoom: 40`, position `[20, 20, 20]`, looking at origin
   - Verify the classic 2:1-ish isometric framing; screenshot-compare at a few viewport sizes
3. **Controls**
   - `OrbitControls`: `enableDamping`, `minZoom: 20`, `maxZoom: 80`, `maxPolarAngle: Math.PI / 2.5`
   - Disable pan (or bound it) so the city can't be lost off-screen; set `target` to origin
4. **Stage & atmosphere**
   - Ground plate slightly larger than 10x10, dark matte material; faint grid lines marking the 10x10 cells (dev helper, toggleable)
   - Lighting kit: ambient + one directional key + colored rim lights (cyan/magenta) for the cyberpunk read
   - Optional: subtle fog and a starfield/environment for depth
5. **Resize/stability**
   - Handle viewport resize without camera framing jumps; confirm no console warnings from drei on hot reload

## Verification

- Dev-only debug overlay toggling the cell grid ON/OFF to eyeball alignment (kept for 1.3)
- Orbit gestures behave: no under-floor camera, zoom stops at clamps, damping feels smooth at 60Hz

## Exit criteria

- [ ] Camera + controls match spec constants exactly
- [ ] Empty stage renders deployed-previewable with atmosphere (not a black box)
- [ ] All tuning constants centralized in one config module (`lib/city/config.ts` or similar)

## Out of scope / notes

- No plot meshes yet; no data binding — keep this phase geometry-free
