'use client';

/**
 * Phase 1.4 radar minimap (bottom-right): flat 10x10 SVG/DOM overlay mapping
 * 1:1 to the 3D grid. Derives cell state from the city store - zero fetches.
 * Clicking a cell flies the camera to that plot.
 */

import { useCallback, useMemo, useState } from 'react';
import { useCityStore, isOwnedLeading } from '@/lib/city/store';
import { sectorLabel } from '@/lib/city/hud-hooks';
import { flyToPlot, resetView } from '@/lib/city/camera-rig';
import { useReducedMotion } from '@/lib/city/reduced-motion';
import { formatPrice } from '@/lib/tiers';
import type { PlotDto } from '@/types/api';

const GRID = 10;
const CELL = 18; // px per cell -> 180px board inside the frame

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
      const nx = Math.min(GRID - 1, Math.max(0, x + d[0]));
      const ny = Math.min(GRID - 1, Math.max(0, y + d[1]));
      const id = cells[ny][nx];
      if (!id) return;
      setFocusedCell(id);
      document.getElementById(`minimap-cell-${id}`)?.focus();
    },
    [cells],
  );

  const hoveredPlot = hovered ? plots.get(hovered) ?? null : null;

  return (
    <div
      data-testid="hud-minimap"
      className="absolute bottom-3 right-3 z-20 rounded-lg border border-[#12303a] bg-[#050508]/90 p-2 backdrop-blur-sm"
      aria-label="City minimap"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-widest text-[#6b7a8c]">RADAR</span>
        {/* Reset-view control (Part 5 selection-feedback): keyboard- and
            touch-accessible, restores canonical framing after orbit/fly-to. */}
        <button
          type="button"
          onClick={() => resetView()}
          aria-label="Reset camera view"
          title="Reset camera view"
          className="rounded border border-[#12303a] px-3 py-1 font-mono text-[10px] leading-none text-[#9fd8e6] hover:bg-[#0a2530] focus-visible:outline-2 focus-visible:outline-[#00f0ff] min-h-8 min-w-8"
        >
          ⌂ reset
        </button>
      </div>
      {plots.size > 0 && (
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
                tabIndex={focusedCell === null ? (id === defaultFocusId ? 0 : -1) : isFocused ? 0 : -1}
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
                className={`flex items-center justify-center rounded-[2px] font-mono text-[10px] leading-none ${kind === 'outbid' ? outbidCellStyle(reduceMotion) : CELL_STYLES[kind]}${isSelected ? ' outline-2 outline-offset-[-2px] outline-[#ffffff]' : ''}`}
              >
                {GLYPHS[kind]}
              </button>
            );
          }),
        )}
        </div>
      )}
      <div className="mt-1 flex items-center gap-2 font-mono text-[9px] text-[#6b7a8c]">
        <span className="text-[#00f0ff]">★ you</span>
        <span className="text-[#ffb400]">⚠ outbid</span>
        <span className="text-[#1a3a6e]">■ live</span>
        <span>□ idle</span>
      </div>
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