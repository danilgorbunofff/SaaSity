'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { CAMERA, CONTROLS, IS_LOW_POWER, LIGHTS, SCENE } from '@/lib/city/config';
import { registerCameraControls } from '@/lib/city/camera-rig';
import { generateInitialGrid } from '@/lib/grid';
import { fetchCitySnapshot } from '@/lib/city/fetch-city';
import { useCityStore, isOwnedLeading } from '@/lib/city/store';
import { TerracedHill } from './TerracedHill';
import { Plot, plotHeight } from './TierMeshes';
import { plinthY } from '@/lib/city/grid-to-world';
import { PlotSkins } from './PlotSkins';
import { TopStrip } from './hud/TopStrip';
import { DetailCard } from './hud/DetailCard';
import { MyLeasesPill } from './hud/MyLeasesPill';
import { Minimap } from './hud/Minimap';
import { OutbidToast } from './hud/OutbidToast';
import { PlotA11yList } from './hud/PlotA11yList';
import type { PlotDto } from '@/types/api';

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
    />
  );
}

const REFETCH_EVENT = 'city-refetch';

/**
 * One-shot + focus-refetch binder. Scheduled polling arrives in phase 2;
 * here: mount fetch, window-focus refetch, and manual retry via ErrorChip.
 */
function DataBinder() {
  const setLoading = useCityStore((s) => s.setLoading);
  const setError = useCityStore((s) => s.setError);
  const setPlots = useCityStore((s) => s.setPlots);
  const setMyPreBids = useCityStore((s) => s.setMyPreBids);
  const markFetched = useCityStore((s) => s.markFetched);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await fetchCitySnapshot();
      setPlots(snap.plots);
      setMyPreBids(snap.myPreBidIds);
      markFetched();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown fetch error');
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError, setPlots, setMyPreBids, markFetched]);

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
 */
function CityPlots() {
  const plotsMap = useCityStore((s) => s.plots);
  const myPreBidIds = useCityStore((s) => s.myPreBidIds);
  const outbidPlotIds = useCityStore((s) => s.outbidPlotIds);
  const hoveredPlotId = useCityStore((s) => s.hoveredPlotId);
  const selectedPlotId = useCityStore((s) => s.selectedPlotId);
  const seed = useMemo(() => generateInitialGrid(), []);
  const hasData = plotsMap.size > 0;

  return (
    <group>
      {seed.map((p) => {
        const dto: PlotDto | undefined = hasData ? plotsMap.get(p.id) : undefined;
        const px = p.originX + p.spanX / 2 - 5;
        const pz = p.originY + p.spanY / 2 - 5;
        const baseY = plinthY(p.tier);
        const height = plotHeight(p.id, p.tier);
        const owned = !!dto && isOwnedLeading(dto, myPreBidIds, dto.currentLeaderPreBidId);
        const outbid = outbidPlotIds.has(p.id) && !owned;
        return (
          <group key={p.id}>
            <Plot plot={p} />
            {dto && (
              <group position={[px, baseY, pz]}>
                <PlotSkins
                  plot={dto}
                  height={height}
                  baseY={0}
                  ownedLeading={owned}
                  outbid={outbid}
                  hovered={hoveredPlotId === p.id}
                  selected={selectedPlotId === p.id}
                />
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}

export function CityScene() {
  const clearSelection = useCityStore((s) => s.setSelectedPlotId);
  return (
    <div className="absolute inset-0">
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

      <TerracedHill showGrid />
      <CityPlots />

      <DataBinder />
      <LoadingChip />
      <ErrorChip />
      <ControlsRig />
      </Canvas>

      {/* Phase 1.4 DOM HUD — siblings of the WebGL canvas */}
      <TopStrip />
      <DetailCard />
      <MyLeasesPill />
      <Minimap />
      <OutbidToast />
      <PlotA11yList />
    </div>
  );
}