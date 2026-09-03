/**
 * Tier geometry constants + deterministic heights (Part 5 extraction).
 *
 * TIER_MESH and plotHeight used to live in the TierMeshes component module,
 * which imports React/R3F — unusable from node-side code and unit tests.
 * This module is pure (no React, no three) so the skin-overlay mapping and
 * regression tests can share the exact constants the renderer uses.
 */

import { seededRange } from '@/lib/city/seeded';

export type PlotTierName = 'OUTER' | 'MID' | 'CORE';

/** Footprints and height ranges per tier (phase-02 spec). */
export const TIER_MESH = {
  OUTER: { size: 0.9, minH: 1.5, maxH: 2.5 },
  MID: { size: 1.85, minH: 4.0, maxH: 6.0 },
  CORE: { size: 3.8, minH: 10.0, maxH: 14.0 },
} as const;

export function plotHeight(id: string, tier: PlotTierName): number {
  const r = TIER_MESH[tier];
  return seededRange(id, 'height', r.minH, r.maxH);
}
