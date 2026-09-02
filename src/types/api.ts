/**
 * Shared public API types — the ONLY shape serializers may emit.
 * Privacy invariant: maxBidCents and any non-leading bidder's brand/identity
 * are structurally absent from every public payload. Additionally (Part 1
 * lifecycle fix): the current auction's provisional leader is NEVER paired
 * with a brand in any public payload — only a confirmed, paid TENANT may be
 * displayed. See PlotDto.tenant vs. currentLeaderPreBidId below.
 */

import type { PlotTier } from '@/lib/tiers';

export type PlotStatusDto = 'IDLE' | 'LIVE';

/** A confirmed tenant's public brand snapshot — never the bidding leader's. */
export interface TenantBrandDto {
  companyName: string | null;
  tagline: string | null;
  twitterHandle: string | null;
  logoUrl: string | null;
  mrrText: string | null;
  logoHidden: boolean;
  /** Tenant's public marketing URL — display-cache only, never a bidder input. */
  targetUrl: string | null;
}

export interface PlotDto {
  id: string;
  tier: PlotTier;
  originX: number;
  originY: number;
  spanX: number;
  spanY: number;
  status: PlotStatusDto;
  /** Present only when status === "LIVE" — auction progress, not tenancy. */
  currentPriceCents?: number;
  /** Present only when status === "LIVE" */
  endAt?: string;
  /**
   * Present only when status === "LIVE". Not secret (the SSE feed already
   * publishes it on every bid/resolution event) — the client needs it for
   * 2.5's dev fast-forward trigger.
   */
  cycleId?: string;
  /**
   * Current auction's leading pre-bid id (LIVE only) — an opaque id, never
   * paired with a brand here. A bidder matches it against their own
   * /api/me/bids ids to derive "am I leading"; nobody else can learn who it
   * belongs to from this payload alone.
   */
  currentLeaderPreBidId?: string;
  /**
   * The confirmed, paid tenant currently displayed on the billboard.
   * INDEPENDENT of `status` — present whenever the plot has ever had a
   * winner settle, whether or not a new auction is currently open for the
   * next lease. Never the provisional leader of an open auction.
   */
  tenant?: TenantBrandDto;
  /**
   * The active tenant's preBid id — an opaque id, same privacy shape as
   * currentLeaderPreBidId. A bidder matches it against their own
   * /api/me/bids ids to derive "am I the tenant"; nobody else can learn who
   * it belongs to from this payload alone. Present whenever `tenant` is.
   */
  tenantPreBidId?: string;
}

export interface PlotsResponseDto {
  plots: PlotDto[];
  /**
   * Phase 2.5 — true when this deployment runs the mock money path
   * (`MOCK_PAYMENTS=1`). Drives the dev-only "fast-forward to resolution"
   * control; false means the endpoint 404s and the UI hides the button.
   */
  mockResolveEnabled: boolean;
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

/**
 * Phase 2.4 — realtime feed event payloads (GET /api/events, SSE).
 * Same privacy invariant as every public payload: maxBidCents, the current
 * auction leader's brand, and any bidder identifier are structurally absent.
 */
export type RealtimeEventType = 'bid:placed' | 'cycle:extended' | 'cycle:resolved';

export interface RealtimeEventDto {
  type: RealtimeEventType;
  plotId: string;
  cycleId: string | null;
  currentPriceCents: number | null;
  /**
   * Leader's preBid id ONLY (bid:placed) — already public via PlotDto, lets
   * a bidder derive "am I leading" without a refetch. Never paired with a
   * brand: the provisional leader of an open auction has not won or paid
   * anything and must never receive free billboard exposure.
   */
  leaderPreBidId: string | null;
  isProxy?: boolean;
  endAt: string | null;
  /**
   * Set only on cycle:resolved when a winner was actually captured. Their
   * brand is also the plot's new `tenant`; `preBidId` is the same kind of
   * opaque public id as `leaderPreBidId` above, letting the winning bidder
   * derive "am I the tenant" without a refetch. No bidderId here (Part 4
   * `public-bidder-id`: an anonymous bidder identifier must never be
   * broadcast to every connected client).
   */
  winner: { preBidId: string; brand: TenantBrandDto } | null;
  clearingPriceCents: number | null;
  nextCycle: { cycleId: string; endAt: string; openingPriceCents: number | null } | null;
}
