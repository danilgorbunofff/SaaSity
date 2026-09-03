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
import { getTick, getTickNow, subscribeTick } from '@/lib/city/shared-tick';
import { animNow, isReducedMotion, pulsePhase, useReducedMotion } from '@/lib/city/reduced-motion';
import { isClosingSoon } from '@/lib/city/ownership';
import type { PlotDto } from '@/types/api';

/* ------------------------------------------------------------------ */
/* Shared low-frequency tick - re-exported (logic in lib/city/shared-tick) */
/* ------------------------------------------------------------------ */

export { getTick, subscribeTick } from '@/lib/city/shared-tick';

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
  return getTickNow();
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

  useFrame(() => {
    if (matRef.current) {
      const phase = pulsePhase(animNow(), pulseSpeed);
      matRef.current.emissiveIntensity = intensity * (0.65 + 0.35 * phase);
    }
  });

  return (
    <group>
      {/* roof-edge strip: sits proud of the tower trim (+0.05 wider, top face
          above the trim plane) so no two faces are coplanar (Part 5
          selection-feedback z-fighting fix). */}
      <mesh position={[0, height + 0.005, 0]}>
        <boxGeometry args={[size + 0.06, 0.04, size + 0.06]} />
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
          // Offset 0.025 outward so the strip faces are never coplanar with
          // the tower sides (Part 5 z-fighting fix — same class as the roof).
          <mesh key={i} position={[hx + Math.sign(hx) * 0.025, height / 2, hz + Math.sign(hz) * 0.025]}>
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

/** Flat ground ring: hover = faint white, selected = bright cyan, wide, opaque. */
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
  // Selected reads at a glance: double the hover width, full opacity, and a
  // hot pulse band — distinct from hover (thin/faint) and ownership (beacon/
  // aura/badge layer, never a ground ring). (Part 5 selection-feedback.)
  const selectedWidth = 0.12;
  const r = clampRingRadius(tier, size / 2 + 0.12, selected ? selectedWidth : 0.05);

  useFrame(() => {
    if (ref.current) {
      const mat = ref.current.material as MeshStandardMaterial;
      if (selected) {
        const phase = pulsePhase(animNow(), 2.2);
        mat.emissiveIntensity = 2.0 + 1.2 * phase;
      } else {
        mat.emissiveIntensity = 0.55;
      }
    }
  });

  return (
    <mesh ref={ref} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r, r + (selected ? selectedWidth : 0.05), 48]} />
      <meshStandardMaterial
        color="#04121a"
        emissive={selected ? NEON.cyan : '#ffffff'}
        emissiveIntensity={selected ? 2.0 : 0.55}
        transparent
        opacity={selected ? 1 : 0.45}
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

  useFrame(() => {
    if (ref.current) {
      const mat = ref.current.material as MeshStandardMaterial;
      const phase = pulsePhase(animNow(), 2.8);
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

  useFrame(() => {
    if (matRef.current) {
      const phase = pulsePhase(animNow(), speed);
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

  useFrame(() => {
    if (ref.current) {
      const phase = pulsePhase(animNow(), speed);
      const s = 1 + 0.06 * phase;
      ref.current.scale.set(s, s, 1);
      const mat = ref.current.material as MeshStandardMaterial;
      mat.emissiveIntensity = (outbid ? 1.8 : 1.2) * (0.6 + 0.4 * phase);
      // Rotational motion is decorative-only and removed under reduced
      // motion (pulsePhase pins the phase AND the spin stops).
      if (!isReducedMotion()) ref.current.rotation.z += 0.004;
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
 *   owned:  [★ LEADING • mm:ss left]
 *   outbid: [⚠️ OUTBID: +$X to retain]  (flashing amber)
 * Deliberately carries no brand/company name — it reflects the VIEWER's own
 * bid-leading status on an OPEN auction, not a confirmed tenancy, and the
 * provisional leader's brand is never public (Part 1 lifecycle fix).
 */
function RoofBadge({
  tier,
  endAt,
  outbid,
  y,
}: {
  tier: PlotDto['tier'];
  endAt: string | undefined;
  outbid: boolean;
  y: number;
}) {
  const countdown = useCoarseCountdown(endAt);
  // Flashing is motion: under reduced motion the outbid state keeps its
  // high-contrast amber treatment statically (color carries the meaning).
  const reduceMotion = useReducedMotion();

  const text = outbid
    ? `⚠️ OUTBID: +${formatPrice(tierIncrementCents(tier))} to retain`
    : `★ LEADING${countdown ? ` • ${countdown} left` : ''}`;

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
          animation: outbid && !reduceMotion ? 'city-outbid-flash 0.8s steps(2, jump-none) infinite' : undefined,
        }}
      >
        {text}
      </div>
      <style>{`@keyframes city-outbid-flash { 50% { opacity: 0.25; } }`}</style>
    </Html>
  );
}

/* ------------------------------------------------------------------ */
/* Tenant billboard on the MID tower faces — independent of auction     */
/* LIVE/IDLE state (Part 1 Model A: a lease persists through IDLE).     */
/* ------------------------------------------------------------------ */

/**
 * Cheap text-plane billboard (drei Html, same trick as RoofBadge — no font
 * fetch, no troika). Shows the CURRENT TENANT's company name and updates
 * the instant the store patches a new tenant at cycle:resolved — never the
 * provisional leader of an open auction. Art polish (real signage, logos)
 * is phase 4.3.
 */
function TenantBillboard({
  name,
  mrrText,
  size,
  y,
}: {
  name: string;
  mrrText: string | null;
  size: number;
  y: number;
}) {
  return (
    <Html center transform position={[0, y, size / 2 + 0.04]} zIndexRange={[18, 0]}>
      <div
        data-testid="tenant-billboard"
        style={{
          pointerEvents: 'none',
          width: 132,
          padding: '3px 6px',
          borderRadius: 3,
          border: `1px solid ${NEON.cyan}`,
          background: 'rgba(4, 12, 20, 0.82)',
          boxShadow: `0 0 10px ${NEON.cyan}`,
          fontFamily: 'ui-monospace, monospace',
          textAlign: 'center',
          color: '#e8f6ff',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {name}
        </div>
        {mrrText ? (
          <div style={{ marginTop: 1, fontSize: 8, color: NEON.amber, whiteSpace: 'nowrap' }}>
            {mrrText}
          </div>
        ) : null}
      </div>
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
  // The tenant's name on the tower face. MID only (CORE's summit is the 4.3
  // art-pass surface); skipped in perf-minimal mode. Independent of
  // plot.status — a lease persists through IDLE (Part 1 Model A), so the
  // tenant billboard must never be gated on an auction being open.
  const showBillboard = plot.tier === 'MID' && !!plot.tenant?.companyName && !PERF_MINIMAL;

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
      {showBillboard && (
        <TenantBillboard
          name={plot.tenant?.companyName ?? ''}
          mrrText={plot.tenant?.mrrText ?? null}
          size={TIER_MESH[plot.tier].size}
          y={height * 0.62}
        />
      )}
      {showPersonal && !PERF_MINIMAL && (
        <group>
          <Beacon baseY={baseY} height={height} outbid={outbid} />
          <AuraRing size={TIER_MESH[plot.tier].size} y={baseY + 0.03} tier={plot.tier} outbid={outbid} />
          <RoofBadge tier={plot.tier} endAt={plot.endAt} outbid={outbid} y={badgeY} />
        </group>
      )}
    </group>
  );
}