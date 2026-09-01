/**
 * Grid generator — spatial layout identical to the original one-time-sale
 * spec; pricing is NOT seeded per plot (tier economics live in lib/tiers.ts).
 * Pure and exported so tests / the integrity checker can run without a DB.
 */

export interface PlotSeed {
  id: string;
  tier: "CORE" | "MID" | "OUTER";
  originX: number;
  originY: number;
  spanX: number;
  spanY: number;
}

export function generateInitialGrid(): PlotSeed[] {
  const plots: PlotSeed[] = [];

  // 1. Center Core (4x4) — 1 plot
  plots.push({
    id: "core-01",
    tier: "CORE",
    originX: 3,
    originY: 3,
    spanX: 4,
    spanY: 4,
  });

  // 2. Middle Ring (2x2) — 12 plots
  const midOrigins = [
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 5, y: 1 },
    { x: 7, y: 1 },
    { x: 1, y: 3 },
    { x: 7, y: 3 },
    { x: 1, y: 5 },
    { x: 7, y: 5 },
    { x: 1, y: 7 },
    { x: 3, y: 7 },
    { x: 5, y: 7 },
    { x: 7, y: 7 },
  ];
  midOrigins.forEach((pos, i) => {
    plots.push({
      id: `mid-${String(i + 1).padStart(2, "0")}`,
      tier: "MID",
      originX: pos.x,
      originY: pos.y,
      spanX: 2,
      spanY: 2,
    });
  });

  // 3. Outer Ring (1x1) — 36 plots
  let outerCount = 1;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      if (x === 0 || x === 9 || y === 0 || y === 9) {
        plots.push({
          id: `outer-${String(outerCount++).padStart(2, "0")}`,
          tier: "OUTER",
          originX: x,
          originY: y,
          spanX: 1,
          spanY: 1,
        });
      }
    }
  }

  return plots;
}
