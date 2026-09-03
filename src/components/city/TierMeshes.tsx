'use client';

/**
 * Tier mesh components (phase 1.2). Decorative material detail is kept
 * deliberately light for now — polish (env maps, emissive lighting) is the
 * M4 art pass per phase-02 doc.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Matrix4 } from 'three';
import type { InstancedMesh, Mesh } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { plinthY } from '@/lib/city/grid-to-world';
import { seededRange } from '@/lib/city/seeded';
import { TIER_MESH, plotHeight } from '@/lib/city/tier-geometry';
import { NEON } from '@/lib/city/config';
import { animNow, pulsePhase } from '@/lib/city/reduced-motion';
import { useCityStore } from '@/lib/city/store';

/** Re-exported from the node-safe tier-geometry module (Part 5). */
export { TIER_MESH, plotHeight };

/** Footprints and height ranges per tier — see lib/city/tier-geometry. */
const OUTER_SIZE = TIER_MESH.OUTER.size;
/** Releasing a stuck pointer cursor if the canvas unmounts mid-hover. */
function useCursorCleanup() {
  useEffect(
    () => () => {
      document.body.style.cursor = 'auto';
    },
    [],
  );
}

export interface PlotMeshData {
  id: string;
  tier: 'OUTER' | 'MID' | 'CORE';
  originX: number;
  originY: number;
  spanX: number;
  spanY: number;
}

const OUTER_STRIP_OFFSET = OUTER_SIZE / 2;
/** Scratch matrix reused across instance writes (module-level: never per-frame). */
const tmpMatrix = new Matrix4();

/**
 * The 36 OUTER towers differ only by height, so each of their 3 meshes
 * becomes a single InstancedMesh (36x fewer draw calls). Heights are baked
 * into per-instance Y scales; the strip pair keeps the corner offsets via
 * per-instance translations. Instanced raycast surfaces `instanceId`, so
 * phase-1.4 pointer handling (hover/select, drag guard) is preserved here
 * instead of on 36 individual <Plot> groups.
 */
export function OuterTowerField({ plots }: { plots: PlotMeshData[] }) {
  const bodyRef = useRef<InstancedMesh>(null);
  const stripARef = useRef<InstancedMesh>(null);
  const stripBRef = useRef<InstancedMesh>(null);
  const setHoveredPlotId = useCityStore((s) => s.setHoveredPlotId);
  const setSelectedPlotId = useCityStore((s) => s.setSelectedPlotId);
  const downPos = useRef<{ x: number; y: number } | null>(null);
  useCursorCleanup();

  const instances = useMemo(
    () =>
      plots.map((p) => {
        const height = plotHeight(p.id, p.tier);
        const x = p.originX + p.spanX / 2 - 5;
        const z = p.originY + p.spanY / 2 - 5;
        const y = plinthY('OUTER') + height / 2;
        return { id: p.id, height, x, y, z };
      }),
    [plots],
  );

  useLayoutEffect(() => {
    const apply = (mesh: InstancedMesh | null, scaleY: number, corner: 0 | 1 | -1) => {
      if (!mesh) return;
      instances.forEach((it, i) => {
        tmpMatrix.makeScale(1, scaleY * it.height, 1);
        tmpMatrix.setPosition(
          it.x + corner * OUTER_STRIP_OFFSET,
          it.y,
          it.z + corner * OUTER_STRIP_OFFSET,
        );
        mesh.setMatrixAt(i, tmpMatrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    apply(bodyRef.current, 1, 0);
    apply(stripARef.current, 0.92, 1);
    apply(stripBRef.current, 0.92, -1);
  }, [instances]);

  const plotIdAt = (e: ThreeEvent<PointerEvent>) =>
    e.instanceId != null ? instances[e.instanceId]?.id : undefined;

  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const id = plotIdAt(e);
    if (id) {
      setHoveredPlotId(id);
      document.body.style.cursor = 'pointer';
    }
  };
  const onPointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHoveredPlotId(null);
    document.body.style.cursor = 'auto';
  };
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    downPos.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = downPos.current;
    downPos.current = null;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_GUARD_PX) {
      e.stopPropagation();
      const id = plotIdAt(e);
      if (id) setSelectedPlotId(id);
    }
  };

  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        args={[undefined, undefined, instances.length]}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <boxGeometry args={[OUTER_SIZE, 1, OUTER_SIZE]} />
        <meshStandardMaterial color="#1a2030" metalness={0.85} roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={stripARef} args={[undefined, undefined, instances.length]}>
        <boxGeometry args={[0.04, 1, 0.04]} />
        <meshBasicMaterial color={NEON.cyan} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={stripBRef} args={[undefined, undefined, instances.length]}>
        <boxGeometry args={[0.04, 1, 0.04]} />
        <meshBasicMaterial color={NEON.cyan} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/** Glass slab with cyan edge trim and an empty billboard frame. */
function MidTower({ height, id }: { height: number; id: string }) {
  const size = TIER_MESH.MID.size;
  const frameY = useMemo(() => seededRange(id, 'billboardY', 0.62, 0.85) * height, [id, height]);
  return (
    <group>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[size, height, size]} />
        {/* transmission runs a full extra scene pass each frame; the tinted
            slab look is replicated cheaply with opacity instead. */}
        <meshStandardMaterial
          color="#0e2431"
          metalness={0.6}
          roughness={0.25}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* cyan edge trim ring at top */}
      <mesh position={[0, height - 0.06, 0]}>
        <boxGeometry args={[size + 0.03, 0.05, size + 0.03]} />
        <meshBasicMaterial color={NEON.cyan} toneMapped={false} />
      </mesh>
      {/* billboard frame — text content arrives in M2 */}
      <mesh position={[0, frameY, size / 2 + 0.02]}>
        <boxGeometry args={[size * 0.7, size * 0.42, 0.04]} />
        <meshBasicMaterial color={NEON.magenta} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Layered cyberpunk megastructure with architectural light beam + antenna. */
function CoreSpire({ height }: { height: number }) {
  const size = TIER_MESH.CORE.size;
  // Stack proportions scale with the seeded height so the roof always lands
  // at `height` (a 10-unit spire must not carry 14-unit geometry).
  const seg1 = height * 0.45;
  const seg2 = height * 0.27;
  const seg3 = height * 0.28;
  const y1 = seg1 / 2;
  const y2 = seg1 + seg2 / 2;
  const y3 = seg1 + seg2 + seg3 / 2;
  return (
    <group>
      {/* stacked setback boxes */}
      <mesh position={[0, y1, 0]}>
        <boxGeometry args={[size, seg1, size]} />
        <meshStandardMaterial color="#161a2b" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0, y2, 0]}>
        <boxGeometry args={[size * 0.78, seg2, size * 0.78]} />
        <meshStandardMaterial color="#1c2137" metalness={0.75} roughness={0.35} />
      </mesh>
      <mesh position={[0, y3, 0]}>
        <boxGeometry args={[size * 0.55, seg3, size * 0.55]} />
        <meshStandardMaterial color="#232a45" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* permanent architectural light beam through the core */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.12, 0.12, height, 12]} />
        <meshBasicMaterial color={NEON.cyan} transparent opacity={0.5} toneMapped={false} />
      </mesh>
      {/* apex antenna with blinking tip */}
      <mesh position={[0, height + 1.0, 0]}>
        <cylinderGeometry args={[0.03, 0.05, 2.0, 6]} />
        <meshStandardMaterial color="#0c0f1a" metalness={0.9} roughness={0.3} />
      </mesh>
      <AntennaTip y={height + 2.0} />
    </group>
  );
}

/** Blinking tip driven by the app animation clock (static under reduced motion). */
function AntennaTip({ y }: { y: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    if (ref.current) {
      const mat = ref.current.material as { opacity?: number };
      if (mat) mat.opacity = 0.35 + 0.65 * pulsePhase(animNow(), 4);
    }
  });
  return (
    <mesh ref={ref} position={[0, y, 0]}>
      <sphereGeometry args={[0.09, 8, 8]} />
      <meshBasicMaterial color={NEON.magenta} transparent toneMapped={false} />
    </mesh>
  );
}

/** Max pointer travel (px) between down and up that still counts as a click. */
const DRAG_GUARD_PX = 5;

export function PlotImpl({ plot }: { plot: PlotMeshData }) {
  const height = plotHeight(plot.id, plot.tier);
  const px = plot.originX + plot.spanX / 2 - 5;
  const pz = plot.originY + plot.spanY / 2 - 5;
  const baseY = plinthY(plot.tier);

  // Phase 1.4 interaction. Pointer handlers live here; the visual hover/
  // selection ring is wired in CityScene -> PlotSkins via store selectors,
  // so re-rendering is limited to plots whose derived ring inputs change.
  const setHoveredPlotId = useCityStore((s) => s.setHoveredPlotId);
  const setSelectedPlotId = useCityStore((s) => s.setSelectedPlotId);
  const downPos = useRef<{ x: number; y: number } | null>(null);
  useCursorCleanup();

  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHoveredPlotId(plot.id);
    document.body.style.cursor = 'pointer';
  };
  const onPointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHoveredPlotId(null);
    document.body.style.cursor = 'auto';
  };
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    downPos.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = downPos.current;
    downPos.current = null;
    if (!d) return;
    // Orbit drag must not select: require near-stationary press.
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_GUARD_PX) {
      e.stopPropagation();
      setSelectedPlotId(plot.id);
    }
  };

  return (
    <group
      position={[px, baseY, pz]}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {plot.tier === 'MID' && <MidTower id={plot.id} height={height} />}
      {plot.tier === 'CORE' && <CoreSpire height={height} />}
    </group>
  );
}

/**
 * Memoized: `plot` objects come from a stable useMemo'd seed array, so this
 * only re-renders if the plot data identity actually changes.
 */
export const Plot = memo(PlotImpl);
