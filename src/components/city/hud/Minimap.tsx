'use client';

/**
 * Phase 1.4 radar minimap (bottom-right): flat 10x10 SVG/DOM overlay mapping
 * 1:1 to the 3D grid. Derives cell state from the city store - zero fetches.
 * Clicking a cell flies the camera to that plot.
 */

import { useCallback, useMemo, useState } from 'react';
import { useCityStore, isOwnedLeading } from '@/lib/city/store';
import { sectorLabel } from '@/lib/city/hud-hooks';
import { flyToPlot } from '@/lib/city/camera-rig';
import { formatPrice } from '@/lib/tiers';
import type { PlotDto } from '@/types/api';

const GRID = 10;
const CELL = 18; // px per cell -> 180px board inside the frame

type CellKind = 'mine' | 'outbid' | 'taken' | 'idle';

function cellKind(plot: PlotDto, myPreBidIds: Set<string>): CellKind {
  if (isOwnedLeading(plot, myPreBidIds, plot.currentLeaderPreBidId)) return 'mine';
  if (plot.status === 'LIVE') return 'taken';
  return 'idle';
}

const CELL_STYLES: Record<CellKind, string> = {
  mine: 'bg-[#00f0ff] text-[#050508]',
  outbid: 'bg-[#ffb400] text-[#050508] animate-[city-outbid-flash_0.8s_ease-in-out_infinite]',
  taken: 'bg-[#1a3a6e] text-[#9fd8e6]',
  idle: 'border border-[#3a4a56] text-[#6b7a8c]',
};

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
      <div className="grid" style={{ gridTemplateColumns: `repeat(${GRID}, ${CELL}px)` }}>
        {cells.map((row, y) =>
          row.map((id, x) => {
            if (!id) {
              return <div key={`${x}-${y}`} style={{ width: CELL, height: CELL }} />;
            }
            const plot = plots.get(id)!;
            const kind: CellKind =
              outbidPlotIds.has(id) && cellKind(plot, myPreBidIds) === 'mine' ? 'outbid' : cellKind(plot, myPreBidIds);
            const isFocused = focusedCell === id;
            return (
              <button
                key={id}
                id={`minimap-cell-${id}`}
                type="button"
                tabIndex={focusedCell === null ? (id === 'core-01' ? 0 : -1) : isFocused ? 0 : -1}
                aria-label={`Sector ${sectorLabel(plot)} ${plot.status === 'LIVE' ? 'live' : 'idle'}${
                  plot.status === 'LIVE' ? ` ${formatPrice(plot.currentPriceCents ?? 0)}` : ''
                }`}
                onMouseEnter={() => setHovered(id)}
                onMouseLeave={() => setHovered((h) => (h === id ? null : h))}
                onFocus={() => setFocusedCell(id)}
                onKeyDown={(e) => onKeyDown(e, x, y)}
                onClick={() => flyToPlot(id)}
                style={{ width: CELL, height: CELL }}
                className={`flex items-center justify-center rounded-[2px] font-mono text-[10px] leading-none ${CELL_STYLES[kind]}`}
              >
                {GLYPHS[kind]}
              </button>
            );
          }),
        )}
      </div>
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