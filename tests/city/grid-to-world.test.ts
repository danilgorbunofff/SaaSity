import { generateInitialGrid } from '@/lib/grid';
import { gridToWorld } from '@/lib/city/grid-to-world';
import { HILL } from '@/lib/city/config';
import { seededRange, hashPlotId } from '@/lib/city/seeded';
import assert from 'node:assert/strict';
import test from 'node:test';

const RANGES: Record<string, [number, number]> = {
  OUTER: [1.5, 2.5],
  MID: [4.0, 6.0],
  CORE: [10.0, 14.0],
};

test('gridToWorld tier-aware corners and centers', () => {
  // OUTER corner (0,0): x/z = -4.5, base = plinthY 0 + h/2
  const h1 = seededRange('outer-01', 'height', ...RANGES.OUTER);
  const p1 = gridToWorld(0, 0, 1, 1, 'OUTER', h1);
  assert.strictEqual(p1.x, -4.5);
  assert.strictEqual(p1.z, -4.5);
  assert.strictEqual(p1.y, HILL.outerY + h1 / 2);

  // MID corner (1,1): x/z = -3, base = plinthY 2 + h/2
  const h2 = 5.0;
  const p2 = gridToWorld(1, 1, 2, 2, 'MID', h2);
  assert.strictEqual(p2.x, -3);
  assert.strictEqual(p2.z, -3);
  assert.strictEqual(p2.y, HILL.midY + h2 / 2);

  // CORE center (3,3, span 4): x/z = 0, base = plinthY 5 + h/2
  const h3 = 12.0;
  const p3 = gridToWorld(3, 3, 4, 4, 'CORE', h3);
  assert.strictEqual(p3.x, 0);
  assert.strictEqual(p3.z, 0);
  assert.strictEqual(p3.y, HILL.coreY + h3 / 2);
});

test('gridToWorld legacy overload: explicit height from ground', () => {
  const p = gridToWorld(0, 0, 1, 1, 1.5);
  assert.strictEqual(p.x, -4.5);
  assert.strictEqual(p.z, -4.5);
  assert.strictEqual(p.y, 0.75);
});

test('all 49 plots map onto their correct terrace step', () => {
  const plots = generateInitialGrid();
  assert.strictEqual(plots.length, 49);
  for (const plot of plots) {
    const expectedBase =
      plot.tier === 'OUTER' ? HILL.outerY : plot.tier === 'MID' ? HILL.midY : HILL.coreY;
    const h = seededRange(plot.id, 'height', ...RANGES[plot.tier]);
    const pos = gridToWorld(plot.originX, plot.originY, plot.spanX, plot.spanY, plot.tier, h);
    assert.ok(
      Math.abs(pos.y - (expectedBase + h / 2)) < 1e-9,
      `${plot.id}: y ${pos.y} != base ${expectedBase} + h/2`,
    );
  }
});

test('seeded heights are deterministic and inside tier range', () => {
  const plots = generateInitialGrid();
  for (const plot of plots) {
    const [min, max] = RANGES[plot.tier];
    const a = seededRange(plot.id, 'height', min, max);
    const b = seededRange(plot.id, 'height', min, max);
    assert.strictEqual(a, b, `${plot.id} height not deterministic`);
    assert.ok(a >= min && a < max, `${plot.id} height ${a} out of [${min},${max})`);
  }
  const heights = new Set(plots.map((p) => seededRange(p.id, 'height', ...RANGES[p.tier])));
  assert.ok(heights.size > 40, `expected varied skyline, got ${heights.size} unique`);
});

test('hashPlotId is stable 32-bit unsigned', () => {
  const h = hashPlotId('core-01');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  assert.strictEqual(h, hashPlotId('core-01'));
  assert.notStrictEqual(hashPlotId('core-01'), hashPlotId('core-02'));
});
