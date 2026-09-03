/**
 * City tuning constants — the single place for hill geometry, neon palette,
 * camera clamps and atmosphere knobs (phase 1.1 exit criterion).
 *
 * Camera note: the spec's position [20, 20, 20] looks at (0, 2.5, 0) from a
 * ~31.7° elevation, which violates the locked 45°–50° pitch window. We keep
 * the spec's camera distance and azimuth but re-derive the position at the
 * midpoint of the pitch clamp so OrbitControls never snaps on first update.
 */

import type { Vector3Tuple } from 'three';

/** Terraced hill (ziggurat) geometry. Top surfaces: outer 0.0, mid +2.0, core +5.0. */
export const HILL = {
  /** Outer plate is slightly larger than the 10x10 grid so the edge reads. */
  groundSize: 10.8,
  plinthThickness: 0.4,
  outerY: 0.0,
  midY: 2.0,
  coreY: 5.0,
  /** Spans the full MID ring: 1.85-wide towers centered at ±3 reach ±3.925. */
  midSize: 8,
  coreSize: 4,
  /** Tiny sink between stacked terraces — kills coplanar z-fighting. */
  overlap: 0.01,
  /** Depth offset for decals laid on terrace tops (grid helper, trims). */
  decalLift: 0.01,
  gridDivisions: 10,
} as const;

/** Neon trim + identity palette (brand cyan/magenta from globals.css). */
export const NEON = {
  cyan: '#00f0ff',
  magenta: '#ff0055',
  amber: '#ffb400',
} as const;

const CAMERA_DISTANCE = Math.sqrt(20 * 20 + 20 * 20 + 17.5 * 17.5); // |[20,20,20] - [0,2.5,0]| ~ 33.26
/** 42.5 deg polar = 47.5 deg elevation — midpoint of the locked window. */
const CAMERA_POLAR = 0.742;
const CAMERA_AZIMUTH = Math.PI / 4;

export const CAMERA = {
  zoom: 40,
  minZoom: 20,
  maxZoom: 80,
  /** Polar angles clamping elevation to 45 deg (0.785) - 50 deg (0.698). */
  minPolarAngle: 0.698,
  maxPolarAngle: 0.785,
  /** Hill vertical center-of-mass, not the ground plane. */
  target: [0, 2.5, 0] as Vector3Tuple,
  distance: CAMERA_DISTANCE,
  position: [
    CAMERA_DISTANCE * Math.sin(CAMERA_POLAR) * Math.cos(CAMERA_AZIMUTH),
    CAMERA_DISTANCE * Math.cos(CAMERA_POLAR),
    CAMERA_DISTANCE * Math.sin(CAMERA_POLAR) * Math.sin(CAMERA_AZIMUTH),
  ] as Vector3Tuple,
} as const;

export const CONTROLS = {
  dampingFactor: 0.08,
  azimuthFree: { min: -Infinity, max: Infinity },
} as const;

export const SCENE = {
  background: '#050508',
  groundColor: '#04060a',
  fogNear: 45,
  fogFar: 160,
} as const;

export const LIGHTS = {
  ambient: 0.35,
  key: { position: [12, 20, 8] as Vector3Tuple, intensity: 1.1, color: '#cfe8ff' },
  rimCyan: { position: [-14, 8, -10] as Vector3Tuple, intensity: 0.7, color: NEON.cyan },
  rimMagenta: { position: [14, 6, -12] as Vector3Tuple, intensity: 0.55, color: NEON.magenta },
} as const;

/**
 * Low-power device heuristic (tuned in phase 1.5, corrected in Part 5):
 * fewer cores or low device memory -> skip MSAA and cap dpr at 1.5.
 * Touch capability is deliberately NOT a signal — every modern laptop and
 * flagship phone has a touchscreen, so it misclassified fast devices.
 */
export const IS_LOW_POWER =
  typeof navigator !== 'undefined' &&
  ((navigator.hardwareConcurrency ?? 8) <= 4 ||
    ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4);

/** Debug/perf-comparison flag (?perf=minimal): renders hill + beacons off. */
export const PERF_MINIMAL =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('perf') === 'minimal';

/** QA overlay flag (?debug=1): plot-id labels + force-ownedLeading toggle. */
export const DEBUG_OVERLAY =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === '1';

/**
 * Perf overlay flag (?perf=stats): renderer draw-call/triangle readout for
 * reproducible real-device measurement (Part 5 mobile-perf procedure).
 */
export const PERF_STATS =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('perf') === 'stats';
