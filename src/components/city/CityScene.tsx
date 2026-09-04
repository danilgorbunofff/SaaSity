'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Environment, Html, Lightformer, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  CAMERA,
  CONTROLS,
  DEBUG_OVERLAY,
  IS_LOW_POWER,
  LIGHTS,
  NEON,
  PERF_MINIMAL,
  PERF_STATS,
  SCENE,
} from '@/lib/city/config';
import { registerCameraControls, cancelFlyTo } from '@/lib/city/camera-rig';
import { generateInitialGrid } from '@/lib/grid';
import { buildSkinOverlays } from '@/lib/city/skin-overlays';
import { findSeedDtoDivergence } from '@/lib/city/seed-check';
import { fetchCitySnapshot } from '@/lib/city/fetch-city';
import { startRealtime, stopRealtime } from '@/lib/city/realtime';
import { useCityStore, isOwnedLeading } from '@/lib/city/store';
import { TerracedHill } from './TerracedHill';
import { Plot, OuterTowerField, plotHeight, type PlotMeshData } from './TierMeshes';
import { plinthY } from '@/lib/city/grid-to-world';
import { PlotSkins, useTick } from './PlotSkins';
import { TopStrip } from './hud/TopStrip';
import { DetailCard } from './hud/DetailCard';
import { BidModal } from './hud/BidModal';
import { MyLeasesPill } from './hud/MyLeasesPill';
import { AuctionList } from './hud/AuctionList';
import { HelpCard } from './hud/HelpCard';
import { Minimap } from './hud/Minimap';
import { OutbidToast } from './hud/OutbidToast';
import { PlotA11yList } from './hud/PlotA11yList';

function ControlsRig() {
  // controlsRef is registered via camera-rig; fly-to arrives in phase 1.4.
  const controlsRef = useRef<OrbitControlsImpl>(null);
  useEffect(() => {
    registerCameraControls(controlsRef.current);
    return () => registerCameraControls(null);
  }, []);
  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={CONTROLS.dampingFactor}
      target={CAMERA.target}
      minZoom={CAMERA.minZoom}
      maxZoom={CAMERA.maxZoom}
      minPolarAngle={CAMERA.minPolarAngle}
      maxPolarAngle={CAMERA.maxPolarAngle}
      enablePan={false}
      // User grab interrupts any in-flight fly-to/reset tween (Part 5:
      // fly-to is interruptible; the camera never fights the pointer).
      onStart={() => cancelFlyTo()}
    />
  );
}

const REFETCH_EVENT = 'city-refetch';

/**
 * One-shot + focus-refetch binder. Scheduled polling arrives in phase 2;
 * here: mount fetch, window-focus refetch, and manual retry via ErrorChip.
 *
 * Part 4 handler-ownership split (deliberate, not duplication): THIS binder
 * owns DATA (full snapshot including the private owner projection, which
 * the stream never carries); lib/city/realtime owns the STREAM
 * (visibilitychange → re-anchor). Focus fires on tab return even when the
 * stream looks alive but the projection went stale (e.g. outbid in another
 * tab — same cookie, no cross-tab channel by design).
 */
function DataBinder() {
  const setLoading = useCityStore((s) => s.setLoading);
  const setError = useCityStore((s) => s.setError);
  const setPlots = useCityStore((s) => s.setPlots);
  const setMyPositions = useCityStore((s) => s.setMyPositions);
  const setMockResolveEnabled = useCityStore((s) => s.setMockResolveEnabled);
  const markFetched = useCityStore((s) => s.markFetched);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await fetchCitySnapshot();
      // Positions BEFORE plots: setPlots derives snapshot outbid from the
      // current projection, and setMyPositions re-derives the sticky set —
      // either order converges, but projection-first avoids one transient.
      setMyPositions(snap.myPositions);
      setPlots(snap.plots);
      setMockResolveEnabled(snap.mockResolveEnabled);
      markFetched();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown fetch error');
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError, setPlots, setMyPositions, setMockResolveEnabled, markFetched]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    window.addEventListener(REFETCH_EVENT, onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(REFETCH_EVENT, onFocus);
    };
  }, [load]);

  return null;
}

/** Phase 2.4 — SSE lifecycle binder: connect on mount, clean teardown. */
function RealtimeBinder() {
  useEffect(() => {
    startRealtime();
    return () => stopRealtime();
  }, []);
  return null;
}

function LoadingChip() {
  const loading = useCityStore((s) => s.loading);
  const hasData = useCityStore((s) => s.plots.size > 0);
  if (!loading || hasData) return null;
  return (
    <Html center position={[0, 6, 0]} zIndexRange={[10, 0]}>
      <div className="rounded-full border border-cyan-400/40 bg-[#04121a]/80 px-4 py-1 font-mono text-xs tracking-widest text-cyan-300">
        SYNCING CITY…
      </div>
    </Html>
  );
}

/**
 * ?debug=1 QA overlay: floating plot-id labels + a force-ownedLeading
 * toggle that renders the personal skin layer (beacon/aura/badge) on every
 * plot without staging data. Never mounts without the flag.
 */
function DebugOverlay({ seed }: { seed: PlotMeshData[] }) {
  const debugForceOwned = useCityStore((s) => s.debugForceOwned);
  const setDebugForceOwned = useCityStore((s) => s.setDebugForceOwned);
  const plotsMap = useCityStore((s) => s.plots);
  return (
    <group>
      {seed.map((p) => {
        const px = p.originX + p.spanX / 2 - 5;
        const pz = p.originY + p.spanY / 2 - 5;
        const y = plinthY(p.tier) + plotHeight(p.id, p.tier) + (p.tier === 'CORE' ? 3.2 : 1.6);
        return (
          <Html key={`dbg-${p.id}`} center position={[px, y, pz]} zIndexRange={[5, 0]}>
            <span
              className={`rounded px-1 font-mono text-[8px] leading-tight ${
                plotsMap.has(p.id) ? 'text-[#00f0ff]' : 'text-[#6b7a8c]'
              }`}
              style={{ textShadow: '0 0 4px #000' }}
            >
              {p.id}
            </span>
          </Html>
        );
      })}
      <Html center position={[0, 16, 0]} zIndexRange={[6, 0]}>
        <label className="flex cursor-pointer items-center gap-2 rounded border border-[#12303a] bg-[#050508]/90 px-2 py-1 font-mono text-[10px] text-[#e8f6ff]">
          <input
            type="checkbox"
            checked={debugForceOwned}
            onChange={(e) => setDebugForceOwned(e.target.checked)}
          />
          debug: force ownedLeading
        </label>
      </Html>
    </group>
  );
}

function ErrorChip() {
  const error = useCityStore((s) => s.error);
  const hasData = useCityStore((s) => s.plots.size > 0);
  if (!error) return null;
  return (
    <Html center position={[0, 5, 0]} zIndexRange={[12, 0]}>
      <button
        onClick={() => window.dispatchEvent(new Event(REFETCH_EVENT))}
        className="rounded-full border border-amber-400/60 bg-[#1a1000]/85 px-4 py-1 font-mono text-xs tracking-widest text-amber-300 hover:bg-[#2a1c00]"
      >
        {hasData ? 'STALE DATA - RETRY' : 'CITY OFFLINE - RETRY'}
      </button>
    </Html>
  );
}

/**
 * Live-data plot grid over the static seed layout. Before the first
 * snapshot lands, towers render bare so the hill is never an empty plateau.
 * Plot self-positions at its absolute world coords; skins mount in a
 * sibling group at the plot's terrace origin (relative space).
 *
 * ?debug=1 mounts a QA overlay: per-plot id labels + a force-ownedLeading
 * toggle to exercise the personal skin layer without staging data.
 */
function CityPlots() {
  const plotsMap = useCityStore((s) => s.plots);
  const myPreBidIds = useCityStore((s) => s.myPreBidIds);
  const outbidPlotIds = useCityStore((s) => s.outbidPlotIds);
  const hoveredPlotId = useCityStore((s) => s.hoveredPlotId);
  const selectedPlotId = useCityStore((s) => s.selectedPlotId);
  const highlightIdle = useCityStore((s) => s.highlightIdle);
  const debugForceOwned = useCityStore((s) => s.debugForceOwned);
  const seed = useMemo(() => generateInitialGrid(), []);
  const hasData = plotsMap.size > 0;

  // Dev-time invariant: the 3D layout is built from the static seed, so the
  // snapshot DTOs must agree on every plot's grid origin/span. A mismatch
  // means the seed and API have diverged — 3D positions would silently lie.
  // The comparison is the unit-tested findSeedDtoDivergence (Part 5); the
  // component only reports violations.
  useEffect(() => {
    if (!hasData) return;
    for (const d of findSeedDtoDivergence(seed, plotsMap)) {
      if (d.kind === 'missing') {
        console.error(`[city] seed plot ${d.id} missing from snapshot DTOs`);
      } else {
        const s = d.seed;
        const dto = d.dto!;
        console.error(
          `[city] seed/DTO divergence for ${d.id}: seed=(${s.originX},${s.originY} ${s.spanX}x${s.spanY}) dto=(${dto.originX},${dto.originY} ${dto.spanX}x${dto.spanY})`,
        );
      }
    }
  }, [hasData, seed, plotsMap]);

  // One InstancedMesh per OUTER part replaces 36 towers x 3 meshes. Skins are
  // NOT instanced: every seed plot (OUTER included) gets its own overlay
  // datum below, so status/hover/selection/ownership/outbid/closing-soon
  // semantics are identical across tiers (Part 5 outer-skins-regression fix).
  // The tier split only moves the tower BODY.
  const outerPlots = useMemo(() => seed.filter((p) => p.tier === 'OUTER'), [seed]);
  const tallPlots = useMemo(() => seed.filter((p) => p.tier !== 'OUTER'), [seed]);
  const overlays = useMemo(() => buildSkinOverlays(seed), [seed]);

  return (
    <group>
      <OuterTowerField plots={outerPlots} />
      {tallPlots.map((p) => (
        <Plot key={p.id} plot={p} />
      ))}
      {hasData &&
        overlays.map((o) => {
          const dto = plotsMap.get(o.id);
          if (!dto) return null;
          const owned = isOwnedLeading(dto, myPreBidIds, dto.currentLeaderPreBidId);
          const outbid = outbidPlotIds.has(o.id) && !owned;
          const forceOwned = DEBUG_OVERLAY && debugForceOwned;
          return (
            <group key={`skin-${o.id}`} position={[o.x, o.baseY, o.z]}>
              <PlotSkins
                plot={dto}
                height={o.height}
                baseY={0}
                ownedLeading={owned || forceOwned}
                outbid={outbid && !forceOwned}
                hovered={hoveredPlotId === o.id}
                selected={selectedPlotId === o.id}
                idlePulse={highlightIdle}
              />
            </group>
          );
        })}
      {DEBUG_OVERLAY && <DebugOverlay seed={seed} />}
    </group>
  );
}

/**
 * ?perf=stats readout (Part 5 mobile-perf tooling): renderer draw calls,
 * triangles, geometries, textures, and programs, refreshed on the shared 5s
 * tick. Zero production cost (never mounts without the flag). This is the
 * instrument for the documented real-device procedure — screenshot it next
 * to the OS frame-time overlay.
 */
function PerfStatsChip() {
  const gl = useThree((s) => s.gl);
  useTick();
  if (!PERF_STATS) return null;
  const info = gl.info.render;
  const mem = gl.info.memory;
  return (
    <Html center position={[0, 14, 0]} zIndexRange={[6, 0]}>
      <div
        data-testid="perf-stats"
        className="rounded border border-[#12303a] bg-[#050508]/90 px-2 py-1 font-mono text-[10px] leading-tight text-[#9fd8e6]"
      >
        calls {info.calls} · tris {info.triangles} · geo {mem.geometries} · tex {mem.textures} ·
        prog {gl.info.programs ? gl.info.programs.length : 0}
      </div>
    </Html>
  );
}

export function CityScene() {
  const clearSelection = useCityStore((s) => s.setSelectedPlotId);
  const selectedPlotId = useCityStore((s) => s.selectedPlotId);

  // Part 6 checklist (URL state): selection deep-links via ?plot=. Refresh,
  // back/forward, and shared links restore the detail card; replaceState
  // keeps history clean while orbiting between plots.
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('plot');
      if (id) useCityStore.getState().setSelectedPlotId(id);
    } catch {
      // Non-browser or malformed URL: scene works unlinked.
    }
  }, []);
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (selectedPlotId) url.searchParams.set('plot', selectedPlotId);
      else url.searchParams.delete('plot');
      window.history.replaceState(null, '', url);
    } catch {
      // History unavailable (tests/SSR edge): selection still works in-memory.
    }
  }, [selectedPlotId]);
  // NOTE: <BidModal /> renders OUTSIDE #city-root on purpose — the dialog
  // inerts #city-root on mount (background inert + scroll lock), so mounting
  // the dialog inside that subtree would inert itself: every control dead,
  // Escape never firing, an unclosable frozen modal.
  return (
    <>
      <div id="city-root" className="absolute inset-0">
        <a href="#city-main" className="skip-link">
          Skip to city controls
        </a>
        {/* Canvas name (a11y-structure): the WebGL scene is decorative for
          assistive tech — the minimap, auction list, and detail card are the
          operable equivalents. */}
        <div
          role="img"
          aria-label="Isometric neon city of 49 billboard towers. Use the RADAR minimap, the Auctions list, or the help panel to navigate and bid."
          className="absolute inset-0"
        >
          <Canvas
            dpr={IS_LOW_POWER ? [1, 1.5] : [1, 2]}
            gl={{ antialias: !IS_LOW_POWER, powerPreference: 'high-performance' }}
            camera={{
              // Explicit ortho — R3F defaults to a PerspectiveCamera, which
              // ignores `zoom` entirely (phase-01 latent bug, fixed in 1.2).
              zoom: CAMERA.zoom,
              position: [...CAMERA.position] as [number, number, number],
              near: 0.1,
              far: 400,
            }}
            orthographic
            style={{ background: SCENE.background }}
            onPointerMissed={() => clearSelection(null)}
          >
            <color attach="background" args={[SCENE.background]} />
            <fog attach="fog" args={[SCENE.background, SCENE.fogNear, SCENE.fogFar]} />

            <ambientLight intensity={LIGHTS.ambient} />
            <directionalLight
              position={LIGHTS.key.position}
              intensity={LIGHTS.key.intensity}
              color={LIGHTS.key.color}
            />
            <directionalLight
              position={LIGHTS.rimCyan.position}
              intensity={LIGHTS.rimCyan.intensity}
              color={LIGHTS.rimCyan.color}
            />
            <directionalLight
              position={LIGHTS.rimMagenta.position}
              intensity={LIGHTS.rimMagenta.intensity}
              color={LIGHTS.rimMagenta.color}
            />

            {/* Metals (metalness 0.6-0.85) need an env map to be visible from all
          angles — directional lights alone only show specular glints. This is
          a procedural in-scene env (no network fetch), baked once. */}
            <Environment resolution={IS_LOW_POWER ? 64 : 128} frames={1}>
              <color attach="background" args={['#05070d']} />
              <Lightformer
                form="rect"
                intensity={2.4}
                color={LIGHTS.key.color}
                position={[6, 9, 4]}
                scale={[10, 6, 1]}
                target={[0, 0, 0]}
              />
              <Lightformer
                form="rect"
                intensity={1.6}
                color={NEON.cyan}
                position={[-8, 4, -6]}
                scale={[8, 4, 1]}
                target={[0, 0, 0]}
              />
              <Lightformer
                form="rect"
                intensity={1.1}
                color={NEON.magenta}
                position={[8, 3, -7]}
                scale={[7, 3, 1]}
                target={[0, 0, 0]}
              />
              <Lightformer
                form="ring"
                intensity={1.2}
                color="#8fa8c8"
                position={[0, -6, 0]}
                scale={12}
                target={[0, 0, 0]}
              />
            </Environment>

            {!PERF_MINIMAL && <TerracedHill showGrid />}
            <CityPlots />

            <DataBinder />
            <RealtimeBinder />
            <LoadingChip />
            <ErrorChip />
            <PerfStatsChip />
            <ControlsRig />
          </Canvas>
        </div>

        {/* Phase 1.4 DOM HUD — siblings of the WebGL canvas */}
        <main id="city-main" aria-label="City controls">
          <h1 className="sr-only">SaaSity — bid for billboard leases in a cyber city</h1>
          <TopStrip />
          <DetailCard />
          <MyLeasesPill />
          <AuctionList />
          <HelpCard />
          <Minimap />
          <OutbidToast />
          <PlotA11yList />
        </main>
      </div>
      <BidModal />
    </>
  );
}
