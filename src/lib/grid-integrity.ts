import { generateInitialGrid, type PlotSeed } from './grid';

export interface GridIntegrityResult {
  ok: boolean;
  plotCount: number;
  coveredCells: number;
  overlaps: number;
  errors: string[];
}

/**
 * Fails loudly on any deviation: 49 plots, 100/100 cells covered exactly
 * once, tier/span consistency, unique ids. Part of the seed run.
 */
export function checkGridIntegrity(plots: PlotSeed[] = generateInitialGrid()): GridIntegrityResult {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  let coveredCells = 0;
  let overlaps = 0;

  const expectedSpan = { OUTER: 1, MID: 2, CORE: 4 } as const;
  const counts = { OUTER: 0, MID: 0, CORE: 0 };

  for (const p of plots) {
    if (p.spanX !== expectedSpan[p.tier] || p.spanY !== expectedSpan[p.tier]) {
      errors.push(
        `${p.id}: ${p.tier} span ${p.spanX}x${p.spanY}, expected ${expectedSpan[p.tier]}x${expectedSpan[p.tier]}`,
      );
    }
    if (seen.has(p.id)) errors.push(`duplicate id: ${p.id}`);
    seen.set(p.id, p.id);
    counts[p.tier]++;

    for (let dy = 0; dy < p.spanY; dy++) {
      for (let dx = 0; dx < p.spanX; dx++) {
        const cell = `${p.originX + dx},${p.originY + dy}`;
        if (seen.has(cell)) {
          overlaps++;
          if (overlaps <= 5) errors.push(`cell ${cell} claimed by ${seen.get(cell)} and ${p.id}`);
        } else {
          seen.set(cell, p.id);
          coveredCells++;
        }
        if (p.originX + dx < 0 || p.originX + dx > 9 || p.originY + dy < 0 || p.originY + dy > 9) {
          errors.push(`${p.id}: cell ${cell} outside 10x10 plane`);
        }
      }
    }
  }

  if (plots.length !== 49) errors.push(`expected 49 plots, got ${plots.length}`);
  if (counts.OUTER !== 36) errors.push(`expected 36 OUTER, got ${counts.OUTER}`);
  if (counts.MID !== 12) errors.push(`expected 12 MID, got ${counts.MID}`);
  if (counts.CORE !== 1) errors.push(`expected 1 CORE, got ${counts.CORE}`);
  if (coveredCells !== 100) errors.push(`expected 100 covered cells, got ${coveredCells}`);

  return { ok: errors.length === 0, plotCount: plots.length, coveredCells, overlaps, errors };
}
