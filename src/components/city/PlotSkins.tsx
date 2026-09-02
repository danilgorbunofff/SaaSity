'use client';

/**
 * Status skins + shared tick infrastructure (phase 1.3).
 *
 * Skins are driven by plot.status:
 *   IDLE - dim inviting emissive roof edge
 *   LIVE - brighter contested identity, red-shifted when "closing soon"
 *          (endAt - now < 3min) via ONE shared 5s grid-wide tick
 *
 * Personal identity layer (beacon / aura ring / roof badge) renders ONLY on
 * owned-leading plots. The outbid flip (cyan -> flashing amber) is passed in
 * by the parent as `outbid`; PlotSkins never derives ownership itself.
 *
 * Performance invariant: no per-plot timers, no per-frame React state. The
 * only per-frame work is material mutation inside useFrame (no re-renders);
 * countdown text updates at most every 5s via the shared tick.
 */

import { useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { AdditiveBlending, type Mesh, type MeshStandardMaterial } from 'three';
import { TIERS, formatPrice } from '@/lib/tiers';
import { TIER_MESH } from '@/components/city/TierMeshes';
import { NEON, PERF_MINIMAL } from '@/lib/city/config';
import { isClosingSoon } from '@/lib/city/ownership';
import type { PlotDto } from '@/types/api';

const TICK_MS = 5000;

/* ------------------------------------------------------------------ */
/* Shared low-frequency tick - one interval for the entire grid        */
/* ------------------------------------------------------------------ */

let tickValue = 0;
/** Wall-clock snapshot taken ON the interval - never Date.now() in render. */
let nowValue = Date.now();
const tickListeners = new Set<() => void>();
let tickStarted = false;

function startTick() {
  if (tickStarted) return;
  tickStarted = true;
  setInterval(() => {
    tickValue += 1;
    nowValue = Date.now();
    tickListeners.forEach((fn) => fn());
  }, TICK_MS);
}

export function subscribeTick(fn: () => void): () => void {
  startTick();
  tickListeners.add(fn);
  return () => {
    tickListeners.delete(fn);
  };
}

export function getTick(): number {
  startTick();
  return tickValue;
}

/** Re-renders the caller at most every 5s (grid-wide, not per-plot). */
export function useTick(): number {
  return useSyncExternalStore(subscribeTick, getTick, getTick);
}

/**
 * Pure wall-clock read for render: a snapshot taken on the shared interval,
 * so components stay pure (react-hooks/purity) while still refreshing every
 * 5s grid-wide. Resolution is coarse by design - precise countdowns live in
 * the phase 1.4 detail card, not here.
 */
export function useNow(): number {
  useTick();
  return nowValue;
}

/** Coarse mm:ss countdown for badges - updated on the shared tick only. */
export function useCoarseCountdown(endAt: string | undefined): string | null {
  const now = useNow();
  if (!endAt) return null;
  const ms = new Date(endAt).getTime() - now;
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Grid-wide closing-soon check - re-evaluated on the shared tick only. */
export function useClosingSoon(endAt: string | undefined): boolean {
  const now = useNow();
  return isClosingSoon(endAt, now);
}

/** Tier increment for the OUTBID badge (+$0.50 / +$1.00 / +$5.00). */
export function tierIncrementCents(tier: PlotDto['tier']): number {
  return TIERS[tier].incrementCents;
}

/* ------------------------------------------------------------------ */
/* Status skin: emissive roof edge + contested corner strips           */
/* ------------------------------------------------------------------ */

export function SkinEdgeGlow({
  tier,
  status,
  closingSoon,
  height,
}: {
  tier: PlotDto['tier'];
  status: PlotDto['status'];
  closingSoon: boolean;
  height: number;
}) {
  const matRef = useRef<MeshStandardMaterial>(null);
  const size = TIER_MESH[tier].size;

  const isLive = status === 'LIVE';
  const color = isLive ? (closingSoon ? NEON.magenta : NEON.cyan) : NEON.cyan;
  const intensity = isLive ? (closingSoon ? 1.7 : 1.0) : 0.35;
  const pulseSpeed = isLive ? 2.4 : 1.0;

  useFrame(({ clock }) => {
    if (matRef.current) {
      const phase = 0.5 + 0.5 * Math.sin(clock.elapsedTime * pulseSpeed);
      matRef.current.emissiveIntensity = intensity * (0.65 + 0.35 * phase);
    }
  });

  return (
    <group>
      {/* roof-edge strip */}
      <mesh position={[0, height - 0.02, 0]}>
        <boxGeometry args={[size + 0.03, 0.04, size + 0.03]} />
        <meshStandardMaterial
          ref={matRef}
          color="#0a1418"
          emissive={color}
          emissiveIntensity={intensity}
          toneMapped={false}
        />
      </mesh>
      {isLive &&
        ([
          [size / 2, size / 2],
          [-size / 2, -size / 2],
        ] as const).map(([hx, hz], i) => (
          <mesh key={i} position={[hx, height / 2, hz]}>
            <boxGeometry args={[0.035, height * 0.9, 0.035]} />
            <meshStandardMaterial
              color="#0a1418"
              emissive={color}
              emissiveIntensity={1.1}
              toneMapped={false}
            />
          </mesh>
        ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Interaction rings (phase 1.4): hover < selected                     */
/* ------------------------------------------------------------------ */

/**
 * Ring radii must not bleed into neighboring plots. MID plots are packed on
 * a 2.0-unit grid (half-span 1.0) and the CORE summit is a 4x4 terrace
 * (half-span 2.0); OUTER plots sit on a 1.0 grid but their rings never
 * exceed it, so no clamp is needed there.
 */
const RING_CLAMP: Record<'OUTER' | 'MID' | 'CORE', number> = {
  OUTER: Infinity,
  MID: 1.0,
  CORE: 2.0,
};

function clampRingRadius(tier: 'OUTER' | 'MID' | 'CORE', r: number, width: number): number {
  const max = RING_CLAMP[tier] - width;
  return Math.min(r, max);
}

/** Flat ground ring: hover = faint white, selected = bright cyan. */
export function SelectionRing({
  size,
  y,
  selected,
  tier,
}: {
  size: number;
  y: number;
  selected: boolean;
  tier: 'OUTER' | 'MID' | 'CORE';
}) {
  const ref = useRef<Mesh>(null);
  const r = clampRingRadius(tier, size / 2 + 0.12, selected ? 0.09 : 0.05);

  useFrame(({ clock }) => {
    if (ref.current) {
      const mat = ref.current.material as MeshStandardMaterial;
      if (selected) {
        const phase = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.2);
        mat.emissiveIntensity = 1.6 + 0.9 * phase;
      } else {
        mat.emissiveIntensity = 0.55;
      }
    }
  });

  return (
    <mesh ref={ref} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r, r + (selected ? 0.09 : 0.05), 48]} />
      <meshStandardMaterial
        color="#04121a"
        emissive={selected ? NEON.cyan : '#ffffff'}
        emissiveIntensity={selected ? 1.6 : 0.55}
        transparent
        opacity={selected ? 0.95 : 0.45}
        side={2}
        toneMapped={false}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Personal identity layer - owned-leading (or outbid) plots only      */
/* ------------------------------------------------------------------ */

/** Amber call-to-action ring for IDLE plots during the pulse CTA window. */
export function IdlePulseRing({
  size,
  y,
  tier,
}: {
  size: number;
  y: number;
  tier: 'OUTER' | 'MID' | 'CORE';
}) {
  const ref = useRef<Mesh>(null);
  const r = clampRingRadius(tier, size / 2 + 0.12, 0.09);

  useFrame(({ clock }) => {
    if (ref.current) {
      const mat = ref.current.material as MeshStandardMaterial;
      const phase = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.8);
      mat.emissiveIntensity = 1.2 + 1.1 * phase;
      mat.opacity = 0.5 + 0.45 * phase;
    }
  });

  return (
    <mesh ref={ref} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r, r + 0.09, 48]} />
      <meshStandardMaterial
        color="#04121a"
        emissive={NEON.amber}
        emissiveIntensity={1.2}
        transparent
        opacity={0.7}
        side={2}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Skyward light beacon: additive cyan (amber when outbid) roof -> sky. */
function Beacon({ baseY, height, outbid }: { baseY: number; height: number; outbid: boolean }) {
  const matRef = useRef<MeshBasicMaterialImpl>(null);
  const beamH = 10;
  const speed = outbid ? 3.2 : 1.1;

  useFrame(({ clock }) => {
    if (matRef.current) {
      const phase = 0.5 + 0.5 * Math.sin(clock.elapsedTime * speed);
      matRef.current.opacity = (outbid ? 0.28 : 0.45) * (0.55 + 0.45 * phase);
    }
  });

  return (
    <mesh position={[0, baseY + height + beamH / 2, 0]}>
      <cylinderGeometry args={[0.06, 0.12, beamH, 8, 1, true]} />
      <meshBasicMaterial
        ref={matRef}
        color={outbid ? NEON.amber : NEON.cyan}
        transparent
        opacity={0.4}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

type MeshBasicMaterialImpl = import('three').MeshBasicMaterial;

/** Ground aura ring pulsing on the terrace surface (plinth Y, not world 0). */
function AuraRing({ size, y, tier, outbid }: { size: number; y: number; tier: 'OUTER' | 'MID' | 'CORE'; outbid: boolean }) {
  const ref = useRef<Mesh>(null);
  const r = clampRingRadius(tier, size / 2 + 0.18, 0.1);
  const speed = outbid ? 3.0 : 1.4;

  useFrame(({ clock }) => {
    if (ref.current) {
      const phase = 0.5 + 0.5 * Math.sin(clock.elapsedTime * speed);
      const s = 1 + 0.06 * phase;
      ref.current.scale.set(s, s, 1);
      const mat = ref.current.material as MeshStandardMaterial;
      mat.emissiveIntensity = (outbid ? 1.8 : 1.2) * (0.6 + 0.4 * phase);
      ref.current.rotation.z += 0.004;
    }
  });

  return (
    <mesh ref={ref} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r, r + 0.1, 48]} />
      <meshStandardMaterial
        color="#04121a"
        emissive={outbid ? NEON.amber : NEON.cyan}
        emissiveIntensity={1.2}
        transparent
        opacity={0.85}
        side={2}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * Persistent billboard badge (drei Html transform):
 *   owned:  [★ YOUR HQ: {name} • mm:ss left]
 *   outbid: [⚠️ OUTBID: +$X to retain]  (flashing amber)
 */
function RoofBadge({
  label,
  tier,
  endAt,
  outbid,
  y,
}: {
  label: string;
  tier: PlotDto['tier'];
  endAt: string | undefined;
  outbid: boolean;
  y: number;
}) {
  const countdown = useCoarseCountdown(endAt);

  const text = outbid
    ? `⚠️ OUTBID: +${formatPrice(tierIncrementCents(tier))} to retain`
    : `★ YOUR HQ: ${label}${countdown ? ` • ${countdown} left` : ''}`;

  return (
    <Html center transform position={[0, y, 0]} zIndexRange={[20, 0]}>
      <div
        style={{
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          padding: '4px 12px',
          borderRadius: 999,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.5,
          color: outbid ? '#1a1000' : '#001318',
          background: outbid ? NEON.amber : NEON.cyan,
          boxShadow: `0 0 12px ${outbid ? NEON.amber : NEON.cyan}`,
          animation: outbid ? 'city-outbid-flash 0.8s steps(2, jump-none) infinite' : undefined,
        }}
      >
        {text}
      </div>
      <style>{`@keyframes city-outbid-flash { 50% { opacity: 0.25; } }`}</style>
    </Html>
  );
}

/* ------------------------------------------------------------------ */
/* Wrapper consumed by CityPlots / Plot                                */
/* ------------------------------------------------------------------ */

export interface PlotSkinsProps {
  plot: PlotDto;
  /** Seeded building height (plotHeight from TierMeshes). */
  height: number;
  /** Terrace surface Y for this tier (plinthY from grid-to-world). */
  baseY: number;
  /** Caller is the current winning leader of a LIVE cycle. */
  ownedLeading: boolean;
  /** Was leading earlier this cycle but has been outbid. */
  outbid: boolean;
  /** Phase 1.4 hover highlight. */
  hovered?: boolean;
  /** Phase 1.4 selection highlight (stronger than hover). */
  selected?: boolean;
  /** Amber pulse on IDLE plots (My Leases empty-state CTA). */
  idlePulse?: boolean;
}

export function PlotSkins({ plot, height, baseY, ownedLeading, outbid, hovered, selected, idlePulse }: PlotSkinsProps) {
  const closingSoon = useClosingSoon(plot.endAt);
  const showPersonal = ownedLeading || outbid;
  const badgeY = baseY + height + (plot.tier === 'CORE' ? 2.6 : 1.0);
  const label = plot.leader?.companyName ?? plot.id;

  return (
    <group>
      <SkinEdgeGlow
        tier={plot.tier}
        status={plot.status}
        closingSoon={closingSoon || outbid}
        height={height}
      />
      {(hovered || selected) && (
        <SelectionRing
          size={TIER_MESH[plot.tier].size}
          y={baseY + 0.05}
          selected={!!selected}
          tier={plot.tier}
        />
      )}
      {idlePulse && plot.status === 'IDLE' && (
        <IdlePulseRing size={TIER_MESH[plot.tier].size} y={baseY + 0.07} tier={plot.tier} />
      )}
      {showPersonal && !PERF_MINIMAL && (
        <group>
          <Beacon baseY={baseY} height={height} outbid={outbid} />
          <AuraRing size={TIER_MESH[plot.tier].size} y={baseY + 0.03} tier={plot.tier} outbid={outbid} />
          <RoofBadge label={label} tier={plot.tier} endAt={plot.endAt} outbid={outbid} y={badgeY} />
        </group>
      )}
    </group>
  );
}