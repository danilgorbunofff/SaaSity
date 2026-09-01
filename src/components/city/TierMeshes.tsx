'use client';

/**
 * Tier mesh components (phase 1.2). Decorative material detail is kept
 * deliberately light for now — polish (env maps, emissive lighting) is the
 * M4 art pass per phase-02 doc.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { HILL } from '@/lib/city/config';
import { seededRange } from '@/lib/city/seeded';

/** Footprints and height ranges per tier (phase-02 spec). */
export const TIER_MESH = {
  OUTER: { size: 0.9, minH: 1.5, maxH: 2.5 },
  MID: { size: 1.85, minH: 4.0, maxH: 6.0 },
  CORE: { size: 3.8, minH: 10.0, maxH: 14.0 },
} as const;

const NEON = { cyan: '#00f0ff', magenta: '#ff0055', amber: '#ffb400' } as const;

export interface PlotMeshData {
  id: string;
  tier: 'OUTER' | 'MID' | 'CORE';
  originX: number;
  originY: number;
  spanX: number;
  spanY: number;
}

export function plotHeight(id: string, tier: PlotMeshData['tier']): number {
  const r = TIER_MESH[tier];
  return seededRange(id, 'height', r.minH, r.maxH);
}

/** Dark metallic tower with subtle neon edge strips. */
function OuterTower({ height }: { height: number }) {
  return (
    <group>
      <mesh castShadow position={[0, height / 2, 0]}>
        <boxGeometry args={[TIER_MESH.OUTER.size, height, TIER_MESH.OUTER.size]} />
        <meshStandardMaterial color="#1a2030" metalness={0.85} roughness={0.35} />
      </mesh>
      {/* vertical neon edge strips on the two front corners */}
      {[
        [0.45, 0.45],
        [-0.45, -0.45],
      ].map(([hx, hz], i) => (
        <mesh key={i} position={[hx, height / 2, hz]}>
          <boxGeometry args={[0.04, height * 0.92, 0.04]} />
          <meshBasicMaterial color={NEON.cyan} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Glass slab with cyan edge trim and an empty billboard frame. */
function MidTower({ height, id }: { height: number; id: string }) {
  const size = TIER_MESH.MID.size;
  const frameY = useMemo(() => seededRange(id, 'billboardY', 0.62, 0.85) * height, [id, height]);
  return (
    <group>
      <mesh castShadow position={[0, height / 2, 0]}>
        <boxGeometry args={[size, height, size]} />
        <meshPhysicalMaterial
          color="#0e2431"
          metalness={0.1}
          roughness={0.15}
          transmission={0.55}
          thickness={1.2}
          transparent
          opacity={0.92}
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
  return (
    <group>
      {/* stacked setback boxes */}
      <mesh castShadow position={[0, 3.0, 0]}>
        <boxGeometry args={[size, 6.0, size]} />
        <meshStandardMaterial color="#161a2b" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh castShadow position={[0, 7.5, 0]}>
        <boxGeometry args={[size * 0.78, 3.0, size * 0.78]} />
        <meshStandardMaterial color="#1c2137" metalness={0.75} roughness={0.35} />
      </mesh>
      <mesh castShadow position={[0, 10.25, 0]}>
        <boxGeometry args={[size * 0.55, 2.5, size * 0.55]} />
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

/** Blinking tip driven by a shared clock so all tips stay in sync. */
function AntennaTip({ y }: { y: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const mat = ref.current.material as { opacity?: number };
      if (mat) mat.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 4));
    }
  });
  return (
    <mesh ref={ref} position={[0, y, 0]}>
      <sphereGeometry args={[0.09, 8, 8]} />
      <meshBasicMaterial color={NEON.magenta} transparent toneMapped={false} />
    </mesh>
  );
}

export function Plot({ plot }: { plot: PlotMeshData }) {
  const height = plotHeight(plot.id, plot.tier);
  const px = plot.originX + plot.spanX / 2 - 5;
  const pz = plot.originY + plot.spanY / 2 - 5;
  // Terrace plinth top: 0.0 / 2.0 / 5.0 (HILL constants).
  const baseY = plot.tier === 'OUTER' ? HILL.outerY : plot.tier === 'MID' ? HILL.midY : HILL.coreY;

  // Hover/select wiring lands in phase 1.4.
  const onPointerOver = () => {};
  const onPointerOut = () => {};
  const onClick = () => {};

  return (
    <group
      position={[px, baseY, pz]}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onClick={onClick}
    >
      {plot.tier === 'OUTER' && <OuterTower height={height} />}
      {plot.tier === 'MID' && <MidTower id={plot.id} height={height} />}
      {plot.tier === 'CORE' && <CoreSpire height={height} />}
    </group>
  );
}
