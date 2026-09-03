/**
 * Per-plot skin overlay mapping (Part 5 `outer-skins-regression` fix).
 *
 * The OUTER tower BODIES stay instanced (OuterTowerField), but every plot —
 * OUTER included — needs its state skin (status edge, hover/selection rings,
 * idle pulse, owned beacon/aura/badge). This module computes the overlay
 * datum for every seed plot from the SAME constants the renderer uses, so a
 * unit test can pin "36 OUTER + 12 MID + 1 CORE overlays" without mounting
 * a WebGL canvas.
 *
 * Pure + node-safe: no React, no three, no R3F.
 */

import { plinthY } from '@/lib/city/grid-to-world';
import { TIER_MESH, plotHeight, type PlotTierName } from '@/lib/city/tier-geometry';

export interface SeedPlot {
  id: string;
  tier: PlotTierName;
  originX: number;
  originY: number;
  spanX: number;
  spanY: number;
}

export interface SkinOverlayDatum {
  id: string;
  tier: PlotTierName;
  /** Absolute world X of the plot center (grid centered at origin). */
  x: number;
  /** Absolute world Z of the plot center. */
  z: number;
  /** Terrace surface Y for this tier. */
  baseY: number;
  /** Deterministic building height (same value the tower meshes use). */
  height: number;
  /** Building footprint size for this tier. */
  size: number;
}

export function skinOverlayFor(seed: SeedPlot): SkinOverlayDatum {
  return {
    id: seed.id,
    tier: seed.tier,
    x: seed.originX + seed.spanX / 2 - 5,
    z: seed.originY + seed.spanY / 2 - 5,
    baseY: plinthY(seed.tier),
    height: plotHeight(seed.id, seed.tier),
    size: TIER_MESH[seed.tier].size,
  };
}

/**
 * Overlay data for the whole grid. Callers render tower bodies separately
 * (instanced OUTER field + MID/CORE Plot meshes) and mount ONE <PlotSkins>
 * per datum returned here — for ALL tiers, not just tall plots. The DTO map
 * is intentionally NOT an input: overlays are positional (seed-driven) and
 * the caller pairs each datum with its live DTO, exactly like the tall-plot
 * path always did.
 */
export function buildSkinOverlays(seed: SeedPlot[]): SkinOverlayDatum[] {
  return seed.map(skinOverlayFor);
}

/** Test helper: count overlays per tier (regression pins 36/12/1). */
export function countOverlaysByTier(overlays: SkinOverlayDatum[]): Record<PlotTierName, number> {
  const counts: Record<PlotTierName, number> = { OUTER: 0, MID: 0, CORE: 0 };
  for (const o of overlays) counts[o.tier] += 1;
  return counts;
}
