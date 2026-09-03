import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { gridToWorld, plinthY } from './grid-to-world';
import { plotHeight } from '@/lib/city/tier-geometry';
import { generateInitialGrid } from '@/lib/grid';
import { useCityStore } from './store';
import { cameraTweenMs, isReducedMotion } from './reduced-motion';
import { CAMERA } from './config';

/**
 * Registry for the scene's OrbitControls instance + the single fly-to
 * navigation primitive (reused by minimap, My Leases switcher, contested
 * toast and the a11y list in phase 1.4).
 */

/**
 * Part 6 checklist (gesture alternatives): the wheel/pinch zoom gesture gets
 * tap + keyboard equivalents — clamped to the same CAMERA min/max the
 * controls enforce. No-op before the scene mounts.
 */
export function zoomBy(factor: number): void {
  const c = controls;
  if (!c) return;
  const cam = c.object as THREE.OrthographicCamera;
  cancelFlyTo();
  cam.zoom = Math.min(CAMERA.maxZoom, Math.max(CAMERA.minZoom, cam.zoom * factor));
  cam.updateProjectionMatrix();
  c.update();
}

let controls: OrbitControlsImpl | null = null;

export function registerCameraControls(instance: OrbitControlsImpl | null): void {
  controls = instance;
}

export function getCameraControls(): OrbitControlsImpl | null {
  return controls;
}

/* ------------------------------------------------------------------ */
/* Plot resolution (store snapshot first, seed layout fallback)        */
/* ------------------------------------------------------------------ */

interface ResolvedPlot {
  x: number;
  z: number;
  tier: 'OUTER' | 'MID' | 'CORE';
}

let seedById: Map<
  string,
  { originX: number; originY: number; spanX: number; spanY: number; tier: ResolvedPlot['tier'] }
> | null = null;

function getSeedById() {
  if (!seedById) {
    seedById = new Map(generateInitialGrid().map((p) => [p.id, p]));
  }
  return seedById;
}

function resolvePlot(plotId: string): ResolvedPlot | null {
  const dto = useCityStore.getState().plots.get(plotId);
  if (dto) {
    const w = gridToWorld(dto.originX, dto.originY, dto.spanX, dto.spanY, dto.tier, 0);
    return { x: w.x, z: w.z, tier: dto.tier };
  }
  const seed = getSeedById().get(plotId);
  if (!seed) return null;
  const w = gridToWorld(seed.originX, seed.originY, seed.spanX, seed.spanY, seed.tier, 0);
  return { x: w.x, z: w.z, tier: seed.tier };
}

/* ------------------------------------------------------------------ */
/* Fly-to tween                                                        */
/* ------------------------------------------------------------------ */

const FLY_MS = 650;
/** Close-up inspect zoom (ortho zoom units; hard-capped by CAMERA.maxZoom). */
const FLY_ZOOM = 72;

let activeRaf: number | null = null;

/** Interrupts an in-flight fly-to (user orbit/pan takes over immediately). */
export function cancelFlyTo(): void {
  if (activeRaf !== null) {
    cancelAnimationFrame(activeRaf);
    activeRaf = null;
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Applies one tween frame (shared by the animated path and the instant jump). */
function applyView(
  c: OrbitControlsImpl,
  cam: THREE.OrthographicCamera,
  startTarget: THREE.Vector3,
  endTarget: THREE.Vector3,
  startPos: THREE.Vector3,
  endPos: THREE.Vector3,
  startZoom: number,
  endZoom: number,
  k: number,
): void {
  c.target.lerpVectors(startTarget, endTarget, k);
  cam.position.lerpVectors(startPos, endPos, k);
  cam.zoom = startZoom + (endZoom - startZoom) * k;
  cam.updateProjectionMatrix();
  c.update();
}

/**
 * Fly the camera to a close-up inspect view in front of a plot.
 * Keeps the current orbit angles (ortho: zoom is the dolly) and translates
 * camera + target together, tweening zoom up to the close-up level.
 */
export function flyToPlot(plotId: string): void {
  const c = controls;
  if (!c) return;
  const resolved = resolvePlot(plotId);
  if (!resolved) return;

  const height = plotHeight(plotId, resolved.tier);
  const targetY = plinthY(resolved.tier) + height / 2;

  const cam = c.object as THREE.OrthographicCamera;
  const startTarget = c.target.clone();
  const endTarget = new THREE.Vector3(resolved.x, targetY, resolved.z);
  const delta = endTarget.clone().sub(startTarget);
  const startPos = cam.position.clone();
  const endPos = startPos.clone().add(delta);
  const startZoom = cam.zoom;
  const endZoom = Math.min(FLY_ZOOM, CAMERA.maxZoom);

  cancelFlyTo();
  // Reduced motion: jump straight to the same end state (no tween), so the
  // destination is identical and no information is lost.
  if (isReducedMotion()) {
    applyView(c, cam, startTarget, endTarget, startPos, endPos, startZoom, endZoom, 1);
    return;
  }
  let start = -1;

  const step = (ts: number) => {
    if (start < 0) start = ts;
    const t = Math.min(1, (ts - start) / cameraTweenMs(FLY_MS));
    const k = easeInOutCubic(t);
    applyView(c, cam, startTarget, endTarget, startPos, endPos, startZoom, endZoom, k);
    if (t < 1) {
      activeRaf = requestAnimationFrame(step);
    } else {
      activeRaf = null;
    }
  };
  activeRaf = requestAnimationFrame(step);
}

/**
 * Reset-view control target (Part 5 selection-feedback): restores the
 * canonical isometric framing after orbit/fly-to. Animated unless reduced
 * motion is requested (then instant). No-op before the scene mounts.
 */
export function resetView(): void {
  const c = controls;
  if (!c) return;
  const cam = c.object as THREE.OrthographicCamera;
  const startTarget = c.target.clone();
  const endTarget = new THREE.Vector3(...CAMERA.target);
  const startPos = cam.position.clone();
  const endPos = new THREE.Vector3(...CAMERA.position);
  const startZoom = cam.zoom;

  cancelFlyTo();
  if (isReducedMotion()) {
    applyView(c, cam, startTarget, endTarget, startPos, endPos, startZoom, CAMERA.zoom, 1);
    return;
  }
  let start = -1;
  const step = (ts: number) => {
    if (start < 0) start = ts;
    const t = Math.min(1, (ts - start) / cameraTweenMs(FLY_MS));
    const k = easeInOutCubic(t);
    applyView(c, cam, startTarget, endTarget, startPos, endPos, startZoom, CAMERA.zoom, k);
    if (t < 1) {
      activeRaf = requestAnimationFrame(step);
    } else {
      activeRaf = null;
    }
  };
  activeRaf = requestAnimationFrame(step);
}
