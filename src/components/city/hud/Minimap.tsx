'use client';

/**
 * Phase 1.4 radar minimap (bottom-right): flat 10x10 SVG/DOM overlay mapping
 * 1:1 to the 3D grid. Derives cell state from the city store - zero fetches.
 * Clicking a cell flies the camera to that plot.
 */

import { useCallback, useMemo, useState } from 'react';
import { useCityStore, isOwnedLeading } from '@/lib/city/store';
import { sectorLabel } from '@/lib/city/hud-hooks';
import { flyToPlot, resetView, zoomBy } from '@/lib/city/camera-rig';
import { useReducedMotion } from '@/lib/city/reduced-motion';
import { formatPrice } from '@/lib/tiers';
import type { PlotDto } from '@/types/api';

const GRID = 10;
// Part 6 `undersized-ui`: 24px cells meet the 24x24 WCAG target minimum.
const CELL = 24; // px per cell -> 240px board inside the frame

export type CellKind = 'mine' | 'outbid' | 'taken' | 'idle';

export function baseCellKind(plot: PlotDto, myPreBidIds: Set<string>): CellKind {
  if (isOwnedLeading(plot, myPreBidIds, plot.currentLeaderPreBidId)) return 'mine';
  if (plot.status === 'LIVE') return 'taken';
  return 'idle';
}

/**
 * Testable cell resolution (Part 5 selection-feedback): outbid flips override
 * the base cell even though a rival leads (base alone would say 'taken').
 */
export function minimapCellKind(
  plot: PlotDto,
  myPreBidIds: Set<string>,
  outbidPlotIds: Set<string>,
): CellKind {
  if (outbidPlotIds.has(plot.id)) return 'outbid';
  return baseCellKind(plot, myPreBidIds);
}

const CELL_STYLES: Record<Exclude<CellKind, 'outbid'>, string> = {
  mine: 'bg-[#00f0ff] text-[#050508]',
  taken: 'bg-[#1a3a6e] text-[#9fd8e6]',
  idle: 'border border-[#3a4a56] text-[#6b7a8c]',
};

/**
 * Part 6 `keyboard-fallback`: arrow navigation skips empty cells
 * predictably — scan from the neighbor in the pressed direction to the next
 * occupied cell; null when the edge holds nothing (focus stays put).
 */
export function findNextCell(
  cells: (string | null)[][],
  x: number,
  y: number,
  dx: number,
  dy: number,
): { id: string; x: number; y: number } | null {
  let nx = x + dx;
  let ny = y + dy;
  while (ny >= 0 && ny < cells.length) {
    const row = cells[ny];
    if (nx < 0 || !row || nx >= row.length) return null;
    const id = row[nx];
    if (id) return { id, x: nx, y: ny };
    nx += dx;
    ny += dy;
  }
  return null;
}
/** Outbid cells flash amber — statically amber under reduced motion. */
function outbidCellStyle(reduceMotion: boolean): string {
  return reduceMotion
    ? 'bg-[#ffb400] text-[#050508]'
    : 'bg-[#ffb400] text-[#050508] animate-[city-outbid-flash_0.8s_ease-in-out_infinite]';
}

const GLYPHS: Record<CellKind, string> = {
  mine: '★',
  outbid: '⚠',
  taken: '■',
  idle: '□',
};

export function Minimap() {
  const plots = useCityStore((s) => s.plots);
  const myPreBidIds = useCityStore((s) => s.myPreBidIds);
  const outbidPlotIds = useCityStore((s) => s.outbidPlotIds);
  const selectedPlotId = useCityStore((s) => s.selectedPlotId);
  const reduceMotion = useReducedMotion();
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusedCell, setFocusedCell] = useState<string | null>(null);
  /**
   * Part 6 `mobile-hud-overlap`: the fixed board leaves the thumb zone on
   * small screens — collapsed by default there, one tap to expand.
   * Lazy initializer (no mount effect): client-only tree, window is safe.
   */
  const [collapsed, setCollapsed] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 640px)').matches,
  );

  const cells = useMemo(() => {
    // Row-major grid[y][x]; missing seed ids (never expected) fall back to idle.
    const grid: (string | null)[][] = Array.from({ length: GRID }, () => Array(GRID).fill(null));
    plots.forEach((p) => {
      grid[p.originY][p.originX] = p.id;
    });
    return grid;
  }, [plots]);

  // Default tab stop: the CORE summit anchor if present, else the first plot.
  // No hardcoded ids — the seed grid may change shape in later milestones.
  const defaultFocusId = useMemo(() => {
    if (plots.size === 0) return null;
    for (const p of plots.values()) {
      if (p.tier === 'CORE') return p.id;
    }
    return plots.keys().next().value ?? null;
  }, [plots]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, x: number, y: number) => {
      const deltas: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const d = deltas[e.key];
      if (!d) return;
      e.preventDefault();
      const next = findNextCell(cells, x, y, d[0], d[1]);
      if (!next) return;
      setFocusedCell(next.id);
      document.getElementById(`minimap-cell-${next.id}`)?.focus();
    },
    [cells],
  );

  const hoveredPlot = hovered ? (plots.get(hovered) ?? null) : null;

  return (
    <div
      data-testid="hud-minimap"
      role="group"
      className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-20 max-w-[calc(100vw-1.5rem)] rounded-lg border border-[#12303a] bg-[#050508]/90 p-2 backdrop-blur-sm"
      aria-label="City minimap"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-widest text-[#9fd8e6]">RADAR</span>
        <span className="flex gap-1">
          {/* Collapse control (Part 6 mobile-hud): clears the thumb zone. */}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand minimap' : 'Collapse minimap'}
            title={collapsed ? 'Expand minimap' : 'Collapse minimap'}
            className="flex min-h-11 min-w-11 items-center justify-center rounded border border-[#12303a] px-2 py-1 font-mono text-xs leading-none text-[#9fd8e6] hover:bg-[#0a2530] focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
          >
            {collapsed ? '＋' : '－'}
          </button>
          {/* Zoom controls (Part 6 gestures): tap/keyboard equivalents of
              the wheel/pinch zoom, clamped to CAMERA min/max in zoomBy. */}
          <button
            type="button"
            onClick={() => zoomBy(1.25)}
            aria-label="Zoom in"
            title="Zoom in"
            className="flex min-h-11 min-w-11 items-center justify-center rounded border border-[#12303a] px-2 py-1 font-mono text-xs leading-none text-[#9fd8e6] hover:bg-[#0a2530] focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
          >
            ＋
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.8)}
            aria-label="Zoom out"
            title="Zoom out"
            className="flex min-h-11 min-w-11 items-center justify-center rounded border border-[#12303a] px-2 py-1 font-mono text-xs leading-none text-[#9fd8e6] hover:bg-[#0a2530] focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
          >
            －
          </button>
          {/* Reset-view control (Part 5 selection-feedback): keyboard- and
              touch-accessible, restores canonical framing after orbit/fly-to. */}
          <button
            type="button"
            onClick={() => resetView()}
            aria-label="Reset camera view"
            title="Reset camera view"
            className="flex min-h-11 min-w-11 items-center justify-center rounded border border-[#12303a] px-2 py-1 font-mono text-xs leading-none text-[#9fd8e6] hover:bg-[#0a2530] focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
          >
            ⌂
          </button>
        </span>
      </div>
      {!collapsed && plots.size > 0 && (
        <div className="grid" style={{ gridTemplateColumns: `repeat(${GRID}, ${CELL}px)` }}>
          {cells.map((row, y) =>
            row.map((id, x) => {
              if (!id) {
                return <div key={`${x}-${y}`} style={{ width: CELL, height: CELL }} />;
              }
              const plot = plots.get(id)!;
              // Outbid flips override the base cell even though the rival leads
              // (baseCellKind alone would classify it as 'taken').
              const kind: CellKind = minimapCellKind(plot, myPreBidIds, outbidPlotIds);
              const isFocused = focusedCell === id;
              const isSelected = selectedPlotId === id;
              return (
                <button
                  key={id}
                  id={`minimap-cell-${id}`}
                  type="button"
                  tabIndex={
                    focusedCell === null ? (id === defaultFocusId ? 0 : -1) : isFocused ? 0 : -1
                  }
                  aria-label={`Sector ${sectorLabel(plot)} ${plot.status === 'LIVE' ? 'live' : 'idle'}${isSelected ? ' selected' : ''}${
                    plot.status === 'LIVE' ? ` ${formatPrice(plot.currentPriceCents ?? 0)}` : ''
                  }`}
                  onMouseEnter={() => setHovered(id)}
                  onMouseLeave={() => setHovered((h) => (h === id ? null : h))}
                  onFocus={() => {
                    setFocusedCell(id);
                    setHovered(id);
                  }}
                  onBlur={() => setHovered((h) => (h === id ? null : h))}
                  onKeyDown={(e) => onKeyDown(e, x, y)}
                  onClick={() => flyToPlot(id)}
                  style={{ width: CELL, height: CELL }}
                  data-selected={isSelected || undefined}
                  className={`flex items-center justify-center rounded-[2px] font-mono text-[10px] leading-none hover:brightness-125 active:brightness-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#00f0ff] ${kind === 'outbid' ? outbidCellStyle(reduceMotion) : CELL_STYLES[kind]}${isSelected ? ' outline-2 outline-offset-[-2px] outline-[#ffffff]' : ''}`}
                >
                  {GLYPHS[kind]}
                </button>
              );
            }),
          )}
        </div>
      )}
      {!collapsed && (
        <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-[#9fd8e6]">
          <span className="text-[#00f0ff]">★ you</span>
          <span className="text-[#ffb400]">⚠ outbid</span>
          <span className="text-[#1a3a6e]">■ live</span>
          <span>□ idle</span>
        </div>
      )}
      {hoveredPlot ? (
        <div
          data-testid="minimap-tooltip"
          className="pointer-events-none absolute bottom-full right-0 mb-1 w-max rounded border border-[#12303a] bg-[#050508]/95 px-2 py-1 font-mono text-[10px] text-[#9fd8e6]"
        >
          {sectorLabel(hoveredPlot)} · {hoveredPlot.id} ·{' '}
          {hoveredPlot.status === 'LIVE'
            ? `${formatPrice(hoveredPlot.currentPriceCents ?? 0)} LIVE`
            : 'IDLE'}
        </div>
      ) : null}
    </div>
  );
}
