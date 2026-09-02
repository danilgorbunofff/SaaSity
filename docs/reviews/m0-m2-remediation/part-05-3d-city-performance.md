# Part 5 - 3D City and Performance

**Depends on:** Stable lifecycle and client DTOs from Parts 1 and 4  
**Affected phases:** M1 1.1-1.5 and M2 live-state rendering

## [High] `outer-skins-regression`

After OUTER tower instancing, `PlotSkins` is mounted only inside `tallPlots`
(MID/CORE). All 36 OUTER plots lost visible status, hover, selection, ownership,
outbid, closing-soon, and idle-highlight behavior.

- [ ] Render one skin/interaction overlay per OUTER plot without undoing tower
      body instancing.
- [ ] Keep OUTER body draw calls instanced while allowing per-plot state.
- [ ] Verify owned beacon, outbid aura, closing-soon edge, hover, selection, and
      idle highlight on OUTER plots.
- [ ] Add a render-level regression test asserting 36 OUTER skin instances.
- [ ] Re-profile after the fix.

## [High] `selection-feedback`

Selection is weak in 3D, absent from the minimap, and the camera has no reset
after orbit/fly-to.

- [ ] Add a strong selected state distinct from hover and ownership.
- [ ] Render the selection indicator at the visible plot/platform level rather
      than under the tower.
- [ ] Add selected state to the minimap and keep it synchronized.
- [ ] Add a keyboard- and touch-accessible reset-view control.
- [ ] Make fly-to interruptible and honor reduced motion.
- [ ] Resolve observed roof/platform z-fighting.

## [High] `reduced-motion`

Outbid flashes, beacons, aura rings, antenna pulses, selection pulses, camera
tweens, and loading animations run without reduced-motion behavior.

- [ ] Centralize a reduced-motion preference.
- [ ] Disable flashing and rotational motion when requested.
- [ ] Replace essential state animation with static high-contrast treatments.
- [ ] Shorten or remove camera tweening under reduced motion.
- [ ] Ensure no information depends on motion alone.
- [ ] Add browser coverage with `prefers-reduced-motion: reduce`.

## [High] `mobile-perf-overclaim`

The M1 definition of done claims approximately 30 FPS on a mid-range phone, but
the performance document explicitly states that absolute FPS was not tested on
real hardware.

- [ ] Select and document a representative real phone model.
- [ ] Measure full and busy-launch scenes on that device.
- [ ] Record FPS distribution, frame time, thermal behavior, memory, draw calls,
      and interaction latency.
- [ ] Repeat with three owned plots and multiple realtime updates.
- [ ] Correct the milestone status if the target is not met.

## [Medium] `three-clock-warning`

The browser reports that `THREE.Clock` is deprecated in favor of `THREE.Timer`.

- [ ] Identify whether the warning originates in application code, R3F, or drei.
- [ ] Upgrade or replace the relevant usage without breaking frame callbacks.
- [ ] Keep the console free of actionable warnings in production mode.

## Additional 3D correctness and maintainability

- [ ] Decide whether geometry is truly API-driven or intentionally fixed from
      `generateInitialGrid`; update the 1.3 claim and implementation accordingly.
- [ ] Replace console-only seed/DTO divergence with a testable invariant.
- [ ] Stop module-level clock intervals when no consumers remain or document why
      their lifetime is intentionally page-wide.
- [ ] Prevent overlapping idle-highlight timers from clearing a newer pulse.
- [ ] Revisit the low-power heuristic so every touch-capable device is not
      automatically treated as low power.
- [ ] Capture reproducible performance tooling/scripts, not only prose results.

## Acceptance matrix

- [ ] 36 OUTER, 12 MID, and 1 CORE plot all expose equivalent state semantics.
- [ ] Desktop default/min/max zoom keeps all tiers readable.
- [ ] Mobile orientation changes do not lose the city.
- [ ] Selection remains visible after orbit, fly-to, and realtime updates.
- [ ] No z-fighting is visible at tested zooms.
- [ ] Reduced-motion mode contains no repeated flashing or continuous decorative
      motion.
- [ ] Real-device performance evidence matches the milestone claim.

