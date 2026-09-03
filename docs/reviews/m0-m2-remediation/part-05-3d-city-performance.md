# Part 5 - 3D City and Performance

**Depends on:** Stable lifecycle and client DTOs from Parts 1 and 4  
**Affected phases:** M1 1.1-1.5 and M2 live-state rendering

## [High] `outer-skins-regression`

After OUTER tower instancing, `PlotSkins` is mounted only inside `tallPlots`
(MID/CORE). All 36 OUTER plots lost visible status, hover, selection, ownership,
outbid, closing-soon, and idle-highlight behavior.

- [x] Render one skin/interaction overlay per OUTER plot without undoing tower
      body instancing. (`CityPlots` builds one overlay datum per seed plot via
      `buildSkinOverlays`; `OuterTowerField` bodies untouched — still 3
      `InstancedMesh`es.)
- [x] Keep OUTER body draw calls instanced while allowing per-plot state.
- [x] Verify owned beacon, outbid aura, closing-soon edge, hover, selection, and
      idle highlight on OUTER plots. (Code-level: all tiers share the same
      `PlotSkins`; headed visual pass still pending — no browser in this env.)
- [x] Add a render-level regression test asserting 36 OUTER skin instances.
      (`tests/city/outer-skins.test.ts` pins the exact mapping the render
      consumes: 36/12/1 with tower-identical geometry. No R3F test renderer
      in the repo; canvas-mount coverage pending.)
- [ ] Re-profile after the fix. (Blocked: no headed/headless-GL tooling here.
      `?perf=stats` instrument + procedure shipped for the real-device run.)

## [High] `selection-feedback`

Selection is weak in 3D, absent from the minimap, and the camera has no reset
after orbit/fly-to.

- [x] Add a strong selected state distinct from hover and ownership.
      (`SelectionRing`: selected = 0.12-wide full-opacity cyan pulse @2.0+1.2
      vs hover = 0.05 faint white; ownership never uses a ground ring.)
- [x] Render the selection indicator at the visible plot/platform level rather
      than under the tower. (Ring at terrace level `baseY+0.05`; preserved for
      OUTER overlays too.)
- [x] Add selected state to the minimap and keep it synchronized.
      (Store-driven `selectedPlotId` → white outline + `data-selected` + aria;
      `minimapCellKind` unit-tested in `tests/city/minimap-cells.test.ts`.)
- [x] Add a keyboard- and touch-accessible reset-view control.
      (`⌂ reset` in minimap header: native button, focus-visible outline,
      32px touch target → `resetView()` canonical framing.)
- [x] Make fly-to interruptible and honor reduced motion.
      (`cancelFlyTo` on OrbitControls `start`; instant jump when reduced.)
- [x] Resolve observed roof/platform z-fighting.
      (Skin roof strip proud of MID trim: +0.06 wider, top above trim plane;
      LIVE corner strips offset 0.025 outward. Headed zoom check pending.)

## [High] `reduced-motion`

Outbid flashes, beacons, aura rings, antenna pulses, selection pulses, camera
tweens, and loading animations run without reduced-motion behavior.

- [x] Centralize a reduced-motion preference.
      (`src/lib/city/reduced-motion.ts`: media-query + override + hook.)
- [x] Disable flashing and rotational motion when requested.
      (All `useFrame` pulses via pinned `pulsePhase`; aura spin skipped;
      RoofBadge + minimap CSS flashes conditional.)
- [x] Replace essential state animation with static high-contrast treatments.
      (Amber/cyan static colors carry outbid/leading; countdown text static.)
- [x] Shorten or remove camera tweening under reduced motion.
      (`flyToPlot`/`resetView` jump to the identical end state.)
- [x] Ensure no information depends on motion alone.
      (Every pulsing state has a distinct static color/shape treatment.)
- [ ] Add browser coverage with `prefers-reduced-motion: reduce`.
      (Gating unit-tested via override in `tests/city/reduced-motion.test.ts`;
      headed DevTools-emulation pass pending — no browser in this env.)

## [High] `mobile-perf-overclaim`

The M1 definition of done claims approximately 30 FPS on a mid-range phone, but
the performance document explicitly states that absolute FPS was not tested on
real hardware.

- [x] Select and document a representative real phone model.
      (Pixel 7a-class, Galaxy A54-class substitute — phase-05 addendum.)
- [ ] Measure full and busy-launch scenes on that device.
- [ ] Record FPS distribution, frame time, thermal behavior, memory, draw calls,
      and interaction latency.
- [ ] Repeat with three owned plots and multiple realtime updates.
- [x] Correct the milestone status if the target is not met.
      (M1 PLAN.md: desktop line kept, `~30 FPS on mid mobile` box OPENED as
      UNVERIFIED pending the run above — corrected, not deleted.)

## [Medium] `three-clock-warning`

The browser reports that `THREE.Clock` is deprecated in favor of `THREE.Timer`.

- [x] Identify whether the warning originates in application code, R3F, or drei.
      (R3F 9.7.0 internals: `clock: new THREE.Clock()` in the events bundle;
      three r183 deprecates `Clock` → `Timer`. No app-code construction —
      verified by grep; only `elapsedTime` reads.)
- [x] Upgrade or replace the relevant usage without breaking frame callbacks.
      (No stable R3F upgrade — 9.7.0 is latest; app usage replaced with the
      `animNow`/`pulsePhase` clock, `useFrame` callbacks intact.)
- [x] Keep the console free of actionable warnings in production mode.
      (No app-actionable warning remains; the one R3F-internal deprecation is
      upstream with no stable fix — recorded here, revisit on R3F update.)

## Additional 3D correctness and maintainability

- [x] Decide whether geometry is truly API-driven or intentionally fixed from
      `generateInitialGrid`; update the 1.3 claim and implementation accordingly.
      (Fixed-by-design; phase-03 claim corrected to state-driven + invariant.)
- [x] Replace console-only seed/DTO divergence with a testable invariant.
      (`src/lib/city/seed-check.ts` + `tests/city/seed-check.test.ts`.)
- [x] Stop module-level clock intervals when no consumers remain or document why
      their lifetime is intentionally page-wide.
      (Shared tick extracted to `src/lib/city/shared-tick.ts`: stops on last
      unsubscribe, never starts on server; `tests/city/shared-tick.test.ts`.)
- [x] Prevent overlapping idle-highlight timers from clearing a newer pulse.
      (Store clears the pending timer on re-pulse; `tests/city/store-idle.test.ts`
      with mock timers.)
- [x] Revisit the low-power heuristic so every touch-capable device is not
      automatically treated as low power.
      (`maxTouchPoints` clause removed from `IS_LOW_POWER`.)
- [x] Capture reproducible performance tooling/scripts, not only prose results.
      (`?perf=stats` overlay + phase-05 real-device procedure.)

## Acceptance matrix

- [x] 36 OUTER, 12 MID, and 1 CORE plot all expose equivalent state semantics.
      (Mapping test + shared `PlotSkins`; headed visual pending.)
- [ ] Desktop default/min/max zoom keeps all tiers readable.
- [ ] Mobile orientation changes do not lose the city.
- [x] Selection remains visible after orbit, fly-to, and realtime updates.
      (Store-driven ring + minimap sync; realtime patches never clear selection.)
- [ ] No z-fighting is visible at tested zooms.
- [x] Reduced-motion mode contains no repeated flashing or continuous decorative
      motion. (Unit-pinned; headed emulation pending.)
- [ ] Real-device performance evidence matches the milestone claim.

## Implementation record (Part 5 workstream)

**New modules:** `lib/city/tier-geometry.ts` (node-safe constants/heights),
`lib/city/skin-overlays.ts` (per-plot overlay mapping), `lib/city/seed-check.ts`
(invariant), `lib/city/shared-tick.ts` (refcounted 5s tick),
`lib/city/reduced-motion.ts` (central preference + `pulsePhase`/`animNow`).

**Changed:** `CityScene` (all-tier overlays, `cancelFlyTo` on orbit start,
`PerfStatsChip`), `PlotSkins` (app-clock pulses, z-fight geometry, stronger
selected ring, RM-gated badge), `TierMeshes` (re-export geometry, antenna via
app clock), `Minimap` (selected state, `⌂ reset`, RM-gated flash),
`camera-rig` (`cancelFlyTo`, `resetView`, instant-on-RM),
`store` (restartable idle timer), `config` (touch ≠ low-power, `?perf=stats`).

**Proofs (this env — Windows, node 24, no browser/device):**
`tsc --noEmit` clean, `eslint` clean, unit suite 116/116 green (19 new:
outer-skins, seed-check, reduced-motion, shared-tick, store-idle,
minimap-cells). Headed legs (re-profile, browser RM, real-device FPS,
zoom/orientation/z-fighting visuals) stay OPEN above with instrument +
procedure ready.

**Draw-call tradeoff (deliberate):** +36 worst-case OUTER skin calls (one small
box each) against the phase-1.5 −83% win; bodies stay instanced (3 calls).

