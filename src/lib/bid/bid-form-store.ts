/**
 * Phase 2.1 — bidForm slice: one source of truth so the 3D scene, the
 * detail card, and the modal share open/mode/status without prop drilling.
 */

import { create } from 'zustand';
import type { BidMode } from '@/lib/validation/bid-form';

export type BidFormStatus = 'idle' | 'submitting' | 'success' | 'error' | 'outbid';

/** Minimum ms between accepted submits — anti-resubmit spam (client side).
 *  The server-side guard lands in 2.2. */
export const RESUBMIT_THROTTLE_MS = 5000;

export interface BidFormState {
  open: boolean;
  plotId: string | null;
  mode: BidMode;
  status: BidFormStatus;
  /** Verbatim server message for the `error` state (safe to display). */
  serverError: string | null;
  lastSubmitAt: number | null;
  openBidForm: (plotId: string, mode: BidMode) => void;
  closeBidForm: () => void;
  setStatus: (status: BidFormStatus, serverError?: string | null) => void;
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

  openBidForm: (plotId, mode) =>
    set({ open: true, plotId, mode, status: 'idle', serverError: null }),
  closeBidForm: () => set({ open: false, status: 'idle', serverError: null }),
  setStatus: (status, serverError = null) => set({ status, serverError }),
  tryMarkSubmit: () => {
    const now = Date.now();
    const { lastSubmitAt } = get();
    if (lastSubmitAt !== null && now - lastSubmitAt < RESUBMIT_THROTTLE_MS) return false;
    set({ lastSubmitAt: now });
    return true;
  },
}));