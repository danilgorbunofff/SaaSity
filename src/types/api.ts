/**
 * Shared public API types — the ONLY shape serializers may emit.
 * Privacy invariant: maxBidCents and any non-leading bidder's brand/identity
 * are structurally absent from every public payload.
 */

import type { PlotTier } from '@/lib/tiers';

export type PlotStatusDto = 'IDLE' | 'LIVE';

export interface LeaderBrandDto {
  companyName: string | null;
  tagline: string | null;
  twitterHandle: string | null;
  logoUrl: string | null;
  mrrText: string | null;
  logoHidden: boolean;
}

export interface PlotDto {
  id: string;
  tier: PlotTier;
  originX: number;
  originY: number;
  spanX: number;
  spanY: number;
  status: PlotStatusDto;
  /** Present only when status === "LIVE" */
  currentPriceCents?: number;
  /** Present only when status === "LIVE" */
  endAt?: string;
  /** Current winning pre-bid id (LIVE only) — client matches vs /api/me/bids. */
  currentLeaderPreBidId?: string;
  leader?: LeaderBrandDto;
}

export interface PlotsResponseDto {
  plots: PlotDto[];
}

export interface BidTickDto {
  id: string;
  amountCents: number;
  isProxy: boolean;
  createdAt: string;
}

export interface PlotBidsResponseDto {
  plotId: string;
  cycleId: string | null;
  bids: BidTickDto[];
}
