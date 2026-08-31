# Phase 1.5 — Performance Pass

**Milestone:** [1 · 3D City](../PLAN.md) · **Prev:** [1.4 Interaction & HUD](phase-04-interaction-hud.md) · **Next:** [Milestone 2](../../02-reservations-and-realtime/PLAN.md)
**Status:** ⚪ Not started · **Estimate:** ~1 day

## Goal

Lock in frame budget on desktop and mid-tier mobile **before** M2 adds realtime churn on top of the scene.

## Prerequisites

- Phases 1.1–1.4 complete (optimize the real thing, not a prototype)

## Steps

1. **Measure**
   - Profile with devtools performance panel + `r3f` perf tools; record baseline: FPS desktop / phone, draw calls, triangle count, JS heap during 60s orbit
   - Additionally simulate a "busy launch" scenario: several plots `LIVE` simultaneously with frequent price ticks (via 2.5's mock trigger or a synthetic stress fixture) — a materially different load pattern than a mostly-static grid, worth its own baseline since price/leader updates are far more frequent than the old one-time-sale model's rare state flips
2. **Geometry & material budget**
   - Confirm primitive reuse (shared geometries/materials across plots; no per-instance material clones except where status demands)
   - Reduce/replace the costliest effects found — typical suspects: `MeshTransmissionMaterial` on 12 MID towers, animated beam shader on CORE, drei environment resolution
   - Consider instancing the 36 OUTER slabs (they differ only by height/color) via `Instances`/`Merged`
3. **Scene-level levers**
   - Frustum/off-screen: not much to cull at 49 objects, verify shadows are OFF or single cheap contact shadow only
   - `dpr` cap revisit (2.0 desktop → 1.5 mobile via media query), antialias per device class
   - Pause render loop on idle if drei `frameloop` demand mode is compatible with damping/animation needs (decide: if it fights OrbitControls, leave always-on)
   - Confirm 1.3's per-second-tick scoping is actually implemented as designed: only the selected/hovered plot ticks every second; every other `LIVE` plot's "closing soon" escalation runs off the shared low-frequency timer — verify under the busy-launch simulation from step 1, not just a quiet grid
4. **Asset & bundle hygiene**
   - Chunk the three/drei payload (dynamic import already from 1.3); check bundle report; nothing over the wire that the scene doesn't use
5. **Re-verify**
   - Repeat step 1 measurements; diff documented in this file's follow-ups section

## Verification

- Target gates: ~60 FPS desktop integrated-GPU laptop OK; ~30 FPS stable on a real mid-range phone; tab memory growth < 50MB over 2 min idle

## Exit criteria

- [ ] Before/after perf numbers written here (evidence, not vibes), including the busy-launch simulation
- [ ] No single effect that can't be explained/removed cheaply if it regresses later
- [ ] M2/M3 realtime-driven re-renders estimated safe: price/leader ticks and soft-close pulses touch material/text props only (no remounts); per-second countdown work is confirmed bounded to the selected/hovered plot, never all `LIVE` plots at once

## Out of scope / notes

- The cut-line for M4 scope creep lives here: anything added later must justify its frame cost
