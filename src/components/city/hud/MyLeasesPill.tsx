'use client';

/**
 * Phase 1.4 "My Leases" quick switcher: header pill + dropdown of plots we
 * currently lead, sorted soonest cycle-end first. Clicking an entry flies
 * the camera to that plot (flyToPlot from camera-rig).
 */

import { useEffect, useRef, useState } from 'react';
import { useMyLeases, sectorLabel } from '@/lib/city/hud-hooks';
import { useCityStore } from '@/lib/city/store';
import { flyToPlot } from '@/lib/city/camera-rig';

export function MyLeasesPill() {
  const leases = useMyLeases();
  const pulseIdlePlots = useCityStore((s) => s.pulseIdlePlots);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keyboard: arrows move focus, Enter handled by the button itself.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-lease-item]');
    if (!items || items.length === 0) return;
    const current = Array.from(items).indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(current + 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} data-testid="hud-my-leases" className="absolute left-3 top-3 z-20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="rounded-full border border-[#00f0ff]/40 bg-[#050508]/85 px-3 py-1.5 font-mono text-[11px] tracking-wide text-[#00f0ff] shadow-[0_0_18px_rgba(0,240,255,0.12)] backdrop-blur-sm hover:border-[#00f0ff]"
      >
        🏢 My Leases ({leases.length}) ▾
      </button>
      {open ? (
        leases.length === 0 ? (
          <div
            className="absolute left-0 top-full mt-1 w-60 rounded-lg border border-[#12303a] bg-[#050508]/95 p-3 backdrop-blur-sm"
            role="status"
          >
            <p className="font-mono text-[11px] text-[#6b7a8c]">
              No active leases — claim an IDLE plot to start
            </p>
            <button
              type="button"
              onClick={() => {
                pulseIdlePlots();
                setOpen(false);
              }}
              className="mt-2 w-full rounded border border-[#00f0ff]/50 px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[#00f0ff] hover:bg-[#00f0ff]/10"
            >
              Highlight idle plots
            </button>
          </div>
        ) : (
          <ul
            ref={listRef}
            role="listbox"
            aria-label="My active leases"
            onKeyDown={onKeyDown}
            className="absolute left-0 top-full mt-1 w-56 space-y-1 rounded-lg border border-[#12303a] bg-[#050508]/95 p-2 backdrop-blur-sm"
          >
            {leases.map(({ plot }) => (
              <li key={plot.id}>
                <button
                  type="button"
                  data-lease-item
                  role="option"
                  aria-selected="false"
                  onClick={() => {
                    setOpen(false);
                    flyToPlot(plot.id);
                  }}
                  className="w-full rounded px-2 py-1.5 text-left font-mono text-[11px] text-[#9fd8e6] hover:bg-[#0b0e14] hover:text-[#00f0ff]"
                >
                  Sector {sectorLabel(plot)} — {plot.leader?.companyName ?? 'Anonymous'}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}