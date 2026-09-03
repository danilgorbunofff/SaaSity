/**
 * Phase 2.1 — bidForm slice: one source of truth so the 3D scene, the
 * detail card, and the modal share open/mode/status without prop drilling.
 */

import { create } from 'zustand';
import type { BidMode } from '@/lib/validation/bid-form';
import type { SavedBrand } from '@/lib/bid/brand-memory';

export type BidFormStatus = 'idle' | 'submitting' | 'success' | 'error' | 'outbid';

/** Minimum ms between accepted submits — anti-resubmit spam (client side).
 *  The server-side guard lands in 2.2. */
export const RESUBMIT_THROTTLE_MS = 5000;

export interface OpenBidFormOptions {
  /**
   * Part 6 `outbid-form-not-prefilled`: the caller's own saved brand used to
   * prefill identity fields so a top-up asks only for the new maximum.
   */
  prefill?: SavedBrand | null;
  /**
   * Part 6 `outbid-retry`: the server's current required minimum, applied to
   * the amount field immediately instead of returning to stale price state.
   */
  suggestedMinCents?: number | null;
}

export interface BidFormState {
  open: boolean;
  plotId: string | null;
  mode: BidMode;
  status: BidFormStatus;
  /** Verbatim server message for the `error` state (safe to display). */
  serverError: string | null;
  lastSubmitAt: number | null;
  /** Prefill + suggested minimum for the current open (null when closed). */
  prefill: SavedBrand | null;
  suggestedMinCents: number | null;
  /**
   * Part 6 `outbid-retry`: the server's required minimum from a 409, kept
   * alongside the message so "Bid higher" applies it immediately.
   */
  outbidMinimumCents: number | null;
  openBidForm: (plotId: string, mode: BidMode, opts?: OpenBidFormOptions) => void;
  closeBidForm: () => void;
  setStatus: (status: BidFormStatus, serverError?: string | null) => void;
  setOutbid: (message: string, minimumCents: number | null) => void;
  /** Returns false when the throttle rejects the attempt. */
  tryMarkSubmit: () => boolean;
}

export const useBidFormStore = create<BidFormState>()((set, get) => ({
  open: false,
  plotId: null,
  mode: 'claim',
  status: 'idle',
  serverError: null,
  lastSubmitAt: null,
  prefill: null,
  suggestedMinCents: null,
  outbidMinimumCents: null,

  openBidForm: (plotId, mode, opts) =>
    set({
      open: true,
      plotId,
      mode,
      status: 'idle',
      serverError: null,
      prefill: opts?.prefill ?? null,
      suggestedMinCents: opts?.suggestedMinCents ?? null,
      outbidMinimumCents: null,
    }),
  closeBidForm: () =>
    set({
      open: false,
      status: 'idle',
      serverError: null,
      prefill: null,
      suggestedMinCents: null,
      outbidMinimumCents: null,
    }),
  setStatus: (status, serverError = null) => set({ status, serverError }),
  setOutbid: (message, minimumCents) =>
    set({ status: 'outbid', serverError: message, outbidMinimumCents: minimumCents }),
  tryMarkSubmit: () => {
    const now = Date.now();
    const { lastSubmitAt } = get();
    if (lastSubmitAt !== null && now - lastSubmitAt < RESUBMIT_THROTTLE_MS) return false;
    set({ lastSubmitAt: now });
    return true;
  },
}));
