/**
 * Part 5 maintainability: the seed/DTO geometry invariant as a pure,
 * unit-tested function (replaces the old console-only loop in CityScene).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateInitialGrid } from '../../src/lib/grid';
import { findSeedDtoDivergence } from '../../src/lib/city/seed-check';

test('clean snapshot matching the seed reports zero divergence', () => {
  const seed = generateInitialGrid();
  const dtos = new Map(
    seed.map((p) => [
      p.id,
      { originX: p.originX, originY: p.originY, spanX: p.spanX, spanY: p.spanY },
    ]),
  );
  assert.deepEqual(findSeedDtoDivergence(seed, dtos), []);
});

test('a seed plot missing from the snapshot is reported as missing', () => {
  const seed = generateInitialGrid();
  const dtos = new Map(
    seed.slice(1).map((p) => [
      p.id,
      { originX: p.originX, originY: p.originY, spanX: p.spanX, spanY: p.spanY },
    ]),
  );
  const out = findSeedDtoDivergence(seed, dtos);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, seed[0].id);
  assert.equal(out[0].kind, 'missing');
  assert.equal(out[0].dto, null);
});

test('a moved plot is reported with both geometries attached', () => {
  const seed = generateInitialGrid();
  const victim = seed[0];
  const dtos = new Map(
    seed.map((p) => [
      p.id,
      p.id === victim.id
        ? { originX: p.originX + 1, originY: p.originY, spanX: p.spanX, spanY: p.spanY }
        : { originX: p.originX, originY: p.originY, spanX: p.spanX, spanY: p.spanY },
    ]),
  );
  const out = findSeedDtoDivergence(seed, dtos);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'moved');
  assert.equal(out[0].dto?.originX, victim.originX + 1);
});

test('span-only drift is also caught', () => {
  const seed = generateInitialGrid();
  const victim = seed.find((p) => p.tier === 'MID')!;
  const dtos = new Map(
    seed.map((p) => [
      p.id,
      p.id === victim.id
        ? { originX: p.originX, originY: p.originY, spanX: 1, spanY: 1 }
        : { originX: p.originX, originY: p.originY, spanX: p.spanX, spanY: p.spanY },
    ]),
  );
  const out = findSeedDtoDivergence(seed, dtos);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, victim.id);
});
