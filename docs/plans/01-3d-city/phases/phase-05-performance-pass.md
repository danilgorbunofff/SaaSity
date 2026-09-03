# Phase 1.5 — Performance Pass (Terraced Hill + Identification Overlays)

**Milestone:** [1 · 3D City](../PLAN.md) · **Prev:** [1.4 Interaction & HUD](phase-04-interaction-hud.md) · **Next:** [Milestone 2](../../02-reservations-and-realtime/PLAN.md)
**Status:** ✅ Done · **Estimate:** ~1 day

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

- [x] Before/after perf numbers written here (evidence, not vibes), including the busy-launch simulation and the with-vs-without hill+beacons comparison
- [x] No single effect that can't be explained/removed cheaply if it regresses later
- [x] M2/M3 realtime-driven re-renders estimated safe: price/leader ticks, soft-close pulses, and outbid badge flips touch material/text props only (no remounts); per-second countdown work is confirmed bounded to the selected/hovered plot, never all `LIVE` plots at once
- [x] Html badge count confirmed bounded by owned-plot count, not total plot count

## Out of scope / notes

- The cut-line for M4 scope creep lives here: anything added later must justify its frame cost

## Follow-ups (1.5 measurements)

**Method:** production build (`next start`, port 3457) with the busy-launch stress fixture
(10 `LIVE` plots, 3 owned by the bidder). Headless Chrome (CDP) with a WebGL ground-truth
harness (`renderer.info.render.calls` / `triangles`): per-frame values = per-second totals ÷
FPS. Headless Chrome reports FPS 30 (vsync-capped), so **per-frame values are the comparison
basis** — they are FPS-independent; absolute FPS was validated earlier in a headed run
(30 fps throttle gave the same 447–462 calls/frame as headless 60fps sampling).

**Before → after (both under the 10-LIVE/3-owned busy load):**

| Metric                      | Before          | After (levers ①+②) | Δ       |
| --------------------------- | --------------- | ------------------ | ------- |
| Draw calls / frame          | 464             | 81                 | **−83%** |
| Triangles / frame           | ~6,150          | ~1,540             | **−75%** |
| Draw calls / sec @30fps     | ~13,900         | ~2,420             | −83%    |
| Triangles / sec @30fps      | ~184,600        | ~46,200            | −75%    |
| JS heap growth (2 min idle) | —               | **+2.0 MB**        | < 50 MB gate ✓ |

**With-vs-without hill+beacons** (`?perf=minimal` strips TerracedHill + owned overlays):

- After levers: full 81 → minimal 60 calls/frame ⇒ **hill + 3 beacons + 3 badges ≈ 21
  calls/frame (~26%)**; tris 1,540 → 768 ⇒ overlays ≈ 772 tris/frame. Bounded by owned-plot
  count, so M2 lease churn won't blow the budget.
- Before levers (for reference): full 464 → minimal 437 calls/frame ⇒ same ≈ 27
  calls/frame (~6% of a much larger total); tris 6,153 → 5,307 ⇒ ≈ 846 tris.

**Levers pulled (step 2/4):**

1. **MID transmission downgrade:** `meshPhysicalMaterial transmission=0.55 thickness=1.2`
   on 12 MID towers forced three.js to run a **full extra scene pass** into the
   transmission render target every frame (the dominant cost — roughly half of all draw
   calls). Replaced with a tinted `meshStandardMaterial` (opacity 0.9); visual difference
   is negligible at city scale.
2. **OUTER instancing:** 36 towers × 3 meshes (108 draw calls) → 3 `InstancedMesh`es with
   per-instance Y scale (seeded heights preserved). Pointer handlers moved onto the
   instanced meshes using `e.instanceId` → plot id, preserving phase-1.4 hover/select +
   drag-guard.
3. **IS_LOW_POWER heuristic:** added `navigator.maxTouchPoints > 1` (coarse phone proxy) —
   low-power devices now get `dpr` capped at 1.5, antialias off, and `PERF_MINIMAL`-style
   content parity when `deviceMemory <= 4`. (Desktop `?perf=minimal` remains the A/B tool.)
4. **frameloop:** leaving `always` on — demand mode conflicts with damping, orbit
   transitions, and the per-frame beacon/aura pulses (material-mutation `useFrame`s);
   the pass sits at 81 calls/frame, so idle cost is already negligible.
5. **Tick scoping verified under busy load:** one shared 5 s grid tick
   (`useSyncExternalStore` in PlotSkins) drives LIVE badge color/countdown text; the 1 Hz
   tick is scoped to the DetailCard countdown only (`hud-hooks.ts`, comment forbids
   spreading). Per-frame `useFrame` work mutates materials only — no per-tick re-renders
   of 49 plots (countdown re-render fanout measured earlier at ≤ 6 React commits/s).

**Other step notes:** no shadow maps (Canvas `shadows` off); the inert `castShadow`
props left on OUTER/MID/CORE meshes from earlier phases were removed in the M1
review-fix pass (they were dead config); 4 lights → single forward pass; billboard
badge DOM count = owned count (3 in fixture); minimap/TopStrip re-derive off the
shared 5 s tick, not per-frame. Bundle hygiene: the dynamic three/drei chunk (944 KB)
is NOT in the initial HTML — loads only when the city canvas mounts; no other chunk
exceeds ~205 KB.

**Gates:** per-frame draw calls/tris now fit a mid-range phone comfortably; absolute FPS
untested on real hardware here (headless desktop only) — noted for first real-device run.
Heap gate passed (+2.0 MB / 2 min, limit 50 MB).

## Part 5 addendum — real-device procedure + skin/instancing tradeoff

**Reference device (selected, pending measurement): Pixel 7a-class**
(a 2023 mid-range Tensor G2 / 8 GB phone — representative of the "mid mobile"
cohort; a Galaxy A54-class Exynos device is an acceptable substitute — record
whichever was used). No absolute-FPS claim ships until this run lands; the M1
PLAN.md definition-of-done box stays explicitly open.

**Reproducible procedure (no prose-only results):**

1. Deploy the preview build, open `/?perf=stats` on the reference phone.
2. Full scene: record the `?perf=stats` readout (calls/tris/geo/tex/prog) at
   default zoom after first paint settles (~10 s).
3. Busy-launch fixture: 3 owned plots + 10+ LIVE plots, force one outbid flip;
   record the readout again plus interaction latency (tap plot → DetailCard).
4. Frame rate: overlay the OS GPU/frame-time tool (Android GPU Inspector /
   Xcode Instruments) — record FPS distribution (p50/p95), frame time,
   thermal state, and memory over a 60 s orbit session.
5. Orientation: rotate portrait ↔ landscape twice — the city must not unmount
   (Canvas resize only) and selection must survive.
6. Paste the numbers into this section with device model, OS, browser, date,
   and commit hash. If p50 < 30 FPS, pull a lever (beacon height cut, Html
   distance cull, `?perf=minimal` comparison) and record the tradeoff.

**`?perf=stats` instrument:** `PerfStatsChip` (CityScene) prints
`gl.info.render` calls/triangles plus memory geometries/textures/programs,
refreshed on the shared 5 s tick; zero production cost (never mounts without
the flag). Companion flags: `?perf=minimal` (hill + beacons off, A/B lever),
`?debug=1` (plot-id labels + force-ownedLeading skin QA).

**Part 5 draw-call tradeoff (recorded, deliberate):** fixing
`outer-skins-regression` adds one status skin group per OUTER plot (36 roof
strips + conditional rings/beacons). OUTER tower BODIES stay instanced (3 draw
calls); the +36 worst-case skin calls are one small box each — still an order
of magnitude under the pre-instancing baseline. Headless re-profile was NOT possible
in this environment (no GL-capable runner) — the gate evidence here is
`tsc` + `eslint` + 116/116 unit tests + production build; draw-call numbers
refresh on the real-device run via `?perf=stats`.
