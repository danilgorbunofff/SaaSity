/**
 * Part 5 `outer-skins-regression` regression test.
 *
 * Pins the exact mapping CityScene consumes: ONE skin overlay per seed plot
 * across ALL tiers (36 OUTER + 12 MID + 1 CORE). The bug was structural —
 * PlotSkins mounted only inside the tall-plot branch — so this test fails
 * if any tier is ever excluded from buildSkinOverlays again. No WebGL
 * needed: the mapping shares the renderer's constants (tier-geometry).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateInitialGrid } from '../../src/lib/grid';
import { plinthY } from '../../src/lib/city/grid-to-world';
import { TIER_MESH, plotHeight } from '../../src/lib/city/tier-geometry';
import {
  buildSkinOverlays,
  countOverlaysByTier,
  skinOverlayFor,
} from '../../src/lib/city/skin-overlays';

test('skin overlays cover all 49 plots: 36 OUTER, 12 MID, 1 CORE', () => {
  const seed = generateInitialGrid();
  assert.equal(seed.length, 49);
  const overlays = buildSkinOverlays(seed);
  assert.equal(overlays.length, 49);
  assert.deepEqual(countOverlaysByTier(overlays), { OUTER: 36, MID: 12, CORE: 1 });
});

test('every overlay id matches its seed plot exactly once', () => {
  const seed = generateInitialGrid();
  const overlays = buildSkinOverlays(seed);
  const seedIds = new Set(seed.map((p) => p.id));
  const overlayIds = overlays.map((o) => o.id);
  assert.equal(new Set(overlayIds).size, 49);
  for (const id of overlayIds) assert.ok(seedIds.has(id), `unknown overlay id ${id}`);
});

test('overlay geometry matches the tower-body math (same constants)', () => {
  const seed = generateInitialGrid();
  for (const p of seed) {
    const o = skinOverlayFor(p);
    assert.equal(o.x, p.originX + p.spanX / 2 - 5);
    assert.equal(o.z, p.originY + p.spanY / 2 - 5);
    assert.equal(o.baseY, plinthY(p.tier));
    assert.equal(o.height, plotHeight(p.id, p.tier));
    assert.equal(o.size, TIER_MESH[p.tier].size);
    const r = TIER_MESH[p.tier];
    assert.ok(o.height >= r.minH && o.height < r.maxH, `${p.id} height in tier range`);
  }
});

test('OUTER overlays sit on the ground terrace with 1x1 footprint math', () => {
  const seed = generateInitialGrid().filter((p) => p.tier === 'OUTER');
  const overlays = buildSkinOverlays(seed);
  assert.equal(overlays.length, 36);
  for (const o of overlays) {
    assert.equal(o.baseY, 0);
    assert.equal(o.size, 0.9);
  }
});
