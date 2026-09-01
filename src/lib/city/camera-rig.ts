import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

/**
 * Registry for the scene's OrbitControls instance + the single fly-to
 * navigation primitive (reused by minimap, My Leases switcher and contested
 * toast in phase 1.4).
 */

let controls: OrbitControlsImpl | null = null;

export function registerCameraControls(instance: OrbitControlsImpl | null): void {
  controls = instance;
}

export function getCameraControls(): OrbitControlsImpl | null {
  return controls;
}

/** Fly the camera to a close-up inspect view in front of a plot. Phase 1.4. */
export function flyToPlot(plotId: string): void {
  // Phase 1.4: resolve tier-aware gridToWorld position, then animate
  // setLookAt() to the plot's close-up inspect distance.
  void plotId;
}
