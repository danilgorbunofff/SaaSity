'use client';

/**
 * Shared client hooks for the phase 1.4 HUD (all DOM, outside the WebGL
 * canvas). Zero extra network traffic: everything derives from the city
 * store, which DataBinder refreshes.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { useCityStore, isOwnedLeading } from './store';
import type { PlotDto } from '@/types/api';

/* ------------------------------------------------------------------ */
/* 1 Hz wall-clock tick (detail card per-second countdown ONLY - do not  */
/* spread to other HUD surfaces; they refresh off the 5s grid tick)      */
/* ------------------------------------------------------------------ */

let hudTickValue = 0;
let hudNow = Date.now();
const hudListeners = new Set<() => void>();
let hudTickStarted = false;

function startHudTick() {
  if (hudTickStarted) return;
  hudTickStarted = true;
  setInterval(() => {
    hudTickValue += 1;
    hudNow = Date.now();
    hudListeners.forEach((fn) => fn());
  }, 1000);
}

function subscribeHudTick(fn: () => void): () => void {
  startHudTick();
  hudListeners.add(fn);
  return () => {
    hudListeners.delete(fn);
  };
}

function getHudTick(): number {
  startHudTick();
  return hudTickValue;
}

/** Re-renders the caller once per second (interval-snapshot wall clock). */
export function useHudTick(): number {
  return useSyncExternalStore(subscribeHudTick, getHudTick, getHudTick);
}

/** Wall-clock snapshot taken ON the hud interval - pure to read in render. */
export function hudNowMs(): number {
  return hudNow;
}

/** Per-second hh:mm:ss (or mm:ss under an hour) countdown. */
export function formatHudCountdown(endAt: string, now: number): string {
  const ms = new Date(endAt).getTime() - now;
  if (ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/* ------------------------------------------------------------------ */
/* Derived HUD data                                                    */
/* ------------------------------------------------------------------ */

/** Sector label: A-J = originY row, 1-10 = originX column. */
export function sectorLabel(plot: Pick<PlotDto, 'originX' | 'originY'>): string {
  return `${String.fromCharCode(65 + plot.originY)}${plot.originX + 1}`;
}

/**
 * Pulse CTA helper - kept for potential callers; the scene reads the same
 * flag via useCityStore((s) => s.highlightIdle) directly.
 */
export function useHighlightIdle(): boolean {
  return useCityStore((s) => s.highlightIdle);
}

/** Sigma of currentPriceCents over LIVE plots - the live activity meter. */
export function useCityValueCents(): number {
  const plots = useCityStore((s) => s.plots);
  return useMemo(() => {
    let sum = 0;
    plots.forEach((p) => {
      if (p.status === 'LIVE') sum += p.currentPriceCents ?? 0;
    });
    return sum;
  }, [plots]);
}

export interface LeaseEntry {
  plot: PlotDto;
  /** End of the cycle this plot currently leads, for soonest-first sorting. */
  endAtMs: number;
}

/** Plots we currently lead, sorted by soonest cycle end. */
export function useMyLeases(): LeaseEntry[] {
  const plots = useCityStore((s) => s.plots);
  const myPreBidIds = useCityStore((s) => s.myPreBidIds);
  return useMemo(() => {
    const leases: LeaseEntry[] = [];
    plots.forEach((p) => {
      if (isOwnedLeading(p, myPreBidIds, p.currentLeaderPreBidId)) {
        leases.push({ plot: p, endAtMs: p.endAt ? new Date(p.endAt).getTime() : Infinity });
      }
    });
    leases.sort((a, b) => a.endAtMs - b.endAtMs);
    return leases;
  }, [plots, myPreBidIds]);
}