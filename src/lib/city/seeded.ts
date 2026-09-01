/**
 * Deterministic seeded RNG (mulberry32) + plot-id hashing so skylines are
 * stable across reloads (phase 1.2 exit criterion: heights fully
 * deterministic per plot id).
 */

/** FNV-1a 32-bit hash — stable, tiny, well-distributed for short strings. */
export function hashPlotId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — returns a function producing floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic float in [min, max) for a plot id + key. */
export function seededRange(id: string, key: string, min: number, max: number): number {
  const rand = mulberry32(hashPlotId(`${id}:${key}`));
  return min + rand() * (max - min);
}
