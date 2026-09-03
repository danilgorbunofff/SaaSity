/**
 * Seed/DTO geometry invariant (Part 5 maintainability fix).
 *
 * The 3D layout is built from the STATIC seed (`generateInitialGrid`) while
 * per-plot STATE arrives from the API. Geometry is intentionally fixed — the
 * 10x10 product grid does not change shape — but if the seed and the API
 * ever disagreed on a plot's origin/span, 3D positions would silently lie.
 *
 * Before, this was a console-only loop inside CityScene. The comparison is
 * now a pure, unit-tested function; the component only reports violations.
 */

export interface SeedGeometry {
  id: string;
  originX: number;
  originY: number;
  spanX: number;
  spanY: number;
}

export interface DtoGeometry {
  originX: number;
  originY: number;
  spanX: number;
  spanY: number;
}

export interface SeedDivergence {
  id: string;
  /** 'missing' = seed plot absent from the snapshot; 'moved' = geometry differs. */
  kind: 'missing' | 'moved';
  seed: SeedGeometry;
  dto: DtoGeometry | null;
}

/**
 * Returns one entry per seed plot whose snapshot DTO is missing or whose
 * grid geometry differs. Empty = the 3D layout matches server truth.
 */
export function findSeedDtoDivergence(
  seed: SeedGeometry[],
  dtos: Map<string, DtoGeometry>,
): SeedDivergence[] {
  const out: SeedDivergence[] = [];
  for (const p of seed) {
    const dto = dtos.get(p.id);
    if (!dto) {
      out.push({ id: p.id, kind: 'missing', seed: p, dto: null });
      continue;
    }
    if (
      dto.originX !== p.originX ||
      dto.originY !== p.originY ||
      dto.spanX !== p.spanX ||
      dto.spanY !== p.spanY
    ) {
      out.push({ id: p.id, kind: 'moved', seed: p, dto });
    }
  }
  return out;
}
