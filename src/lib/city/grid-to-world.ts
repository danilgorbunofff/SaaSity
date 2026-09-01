/**
 * Tier-aware grid-to-world conversion (phase 1.2).
 *
 * Horizontal math is unchanged from the original spec: the 10x10 plane is
 * centered at the world origin, so a plot's center is
 *   x = originX + spanX/2 - 5,  z = originY + spanY/2 - 5.
 *
 * Vertical placement comes from the terraced hill: the building's center sits
 * half its height above its terrace top (plinth Y from lib/city/config HILL).
 */

import { HILL } from '@/lib/city/config';
import type { PlotTier } from '@/lib/tiers';

export interface WorldPos {
  x: number;
  y: number;
  z: number;
}

export function plinthY(tier: PlotTier): number {
  switch (tier) {
    case 'OUTER':
      return HILL.outerY;
    case 'MID':
      return HILL.midY;
    case 'CORE':
      return HILL.coreY;
  }
}

/** Tier-aware placement: building center at plinthY(tier) + height/2. */
export function gridToWorld(
  originX: number,
  originY: number,
  spanX: number,
  spanY: number,
  tier: PlotTier,
  height: number,
): WorldPos;

/** Legacy overload for tests/callers with an explicit elevation. */
export function gridToWorld(
  originX: number,
  originY: number,
  spanX: number,
  spanY: number,
  height: number,
): WorldPos;

export function gridToWorld(
  originX: number,
  originY: number,
  spanX: number,
  spanY: number,
  tierOrHeight: PlotTier | number,
  maybeHeight?: number,
): WorldPos {
  const x = originX + spanX / 2 - 5;
  const z = originY + spanY / 2 - 5;
  let baseY: number;
  let height: number;
  if (typeof tierOrHeight === 'number') {
    baseY = 0;
    height = tierOrHeight;
  } else {
    baseY = plinthY(tierOrHeight);
    height = maybeHeight ?? 0;
  }
  return { x, y: baseY + height / 2, z };
}
