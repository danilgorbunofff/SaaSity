# Phase 1.5 — Performance Pass (Terraced Hill + Identification Overlays)

**Milestone:** [1 · 3D City](../PLAN.md) · **Prev:** [1.4 Interaction & HUD](phase-04-interaction-hud.md) · **Next:** [Milestone 2](../../02-reservations-and-realtime/PLAN.md)
**Status:** ⚪ Not started · **Estimate:** ~1 day

## Goal

Lock in frame budget on desktop and mid-tier mobile **before** M2 adds realtime churn — now including the terraced hill, beacons/aura/badges, minimap, and switcher.

## Prerequisites

- Phases 1.1–1.4 complete (optimize the real thing, not a prototype)

## Steps

1. **Measure**
   - Profile with devtools performance panel + `r3f` perf tools; record baseline: FPS desktop / phone, draw calls, triangle count, JS heap during 60s orbit
   - Additionally simulate a "busy launch" scenario: several plots `LIVE` simultaneously with frequent price ticks (via 2.5's mock trigger or a synthetic stress fixture) — a materially different load pattern than a mostly-static grid; also simulate 3 owned plots (3 beacons + 3 Html badges + 3 aura rings) to capture the new overlay budget
2. **Geometry & material budget**
   - Confirm primitive reuse (shared geometries/materials across plots; no per-instance material clones except where status demands)
   - Reduce/replace the costliest effects found — typical suspects: `MeshTransmissionMaterial` on 12 MID towers, animated beam shader on CORE, drei environment resolution, **beacon cylinders** (cap height/segments, cheap additive material)
   - **Hill cost:** retaining walls are 3 meshes max (one band per step), not per-cell — verify they don't dominate draw calls; neon trims are thin planes, not extra lights
   - Consider instancing the 36 OUTER slabs (they differ only by height/color) via `Instances`/`Merged`
3. **Html / overlay budget (new)**
   - Billboard badges are DOM nodes via `drei <Html>` — count stays bounded by owned-plot count (1–3 typical, not 49). Profile DOM node count and layout thrash on mobile; if needed, hide badges beyond a distance threshold or when zoomed out past a cutoff
   - Minimap + My Leases are 2D DOM (SVG/divs) — negligible WebGL cost, but verify no layout-forced reflow on every price tick (they should only re-derive on data refetch, not per-frame)
4. **Scene-level levers**
   - Frustum/off-screen: not much to cull at 49 objects, verify shadows are OFF or single cheap contact shadow only
   - `dpr` cap revisit (2.0 desktop → 1.5 mobile via media query), antialias per device class
   - Pause render loop on idle if drei `frameloop` demand mode is compatible with damping/animation/beacon pulse needs (decide: if it fights OrbitControls or freezes beacon pulse, leave always-on)
   - Confirm 1.3's per-second-tick scoping is actually implemented as designed: only the selected/hovered plot ticks every second; every other `LIVE` plot's "closing soon" escalation runs off the shared low-frequency timer — verify under the busy-launch simulation from step 1, not just a quiet grid
5. **Asset & bundle hygiene**
   - Chunk the three/drei payload (dynamic import already from 1.3); check bundle report; nothing over the wire that the scene doesn't use
6. **Re-verify**
   - Repeat step 1 measurements; diff documented in this file's follow-ups section, **including a with-vs-without hill+beacons comparison** so the cost of the identification system is explicit

## Verification

- Target gates: ~60 FPS desktop integrated-GPU laptop OK; ~30 FPS stable on a real mid-range phone; tab memory growth < 50MB over 2 min idle
- Hill + 3 beacons + minimap still pass gates on mid-range phone — if not, document which lever was pulled (beacon height cut, Html distance cull, transmission downgrade) and record the tradeoff

## Exit criteria

- [ ] Before/after perf numbers written here (evidence, not vibes), including the busy-launch simulation and the with-vs-without hill+beacons comparison
- [ ] No single effect that can't be explained/removed cheaply if it regresses later
- [ ] M2/M3 realtime-driven re-renders estimated safe: price/leader ticks, soft-close pulses, and outbid badge flips touch material/text props only (no remounts); per-second countdown work is confirmed bounded to the selected/hovered plot, never all `LIVE` plots at once
- [ ] Html badge count confirmed bounded by owned-plot count, not total plot count

## Out of scope / notes

- The cut-line for M4 scope creep lives here: anything added later must justify its frame cost
