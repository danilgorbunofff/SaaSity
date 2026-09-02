import type { Plot, AuctionCycle } from '@/generated/prisma/client';
import type { PlotDto, TenantBrandDto, BidTickDto } from '@/types/api';

/**
 * THE public plot serializer. Every consumer (REST in 0.3, SSE feed in 2.4)
 * must reuse this — no ad-hoc field picking elsewhere.
 *
 * Privacy invariant (binding): maxBidCents and non-leading bidders'
 * brand/identity are structurally absent — not gated by status, just never
 * selected. Only a confirmed, paid TENANT's public brand snapshot lands in
 * the payload — never the current auction's provisional leader's brand.
 *
 * Tenant vs. auction-progress fields are gated INDEPENDENTLY (Part 1 lease
 * semantics fix): `tenant` reflects whoever last won and paid, and persists
 * across IDLE <-> LIVE transitions exactly as long as the lease lasts —
 * i.e. until this function serializes a plot after a NEW winner activates.
 * `currentPriceCents`/`endAt`/`cycleId`/`currentLeaderPreBidId` describe an
 * open auction for the NEXT lease and are LIVE-only, same as before.
 */
export function serializePlot(plot: Plot & { currentCycle: AuctionCycle | null }): PlotDto {
  const base: PlotDto = {
    id: plot.id,
    tier: plot.tier,
    originX: plot.originX,
    originY: plot.originY,
    spanX: plot.spanX,
    spanY: plot.spanY,
    status: plot.status,
  };

  if (plot.tenantPreBidId) {
    const tenant: TenantBrandDto = {
      companyName: plot.tenantCompanyName,
      tagline: plot.tenantTagline,
      twitterHandle: plot.tenantTwitterHandle,
      logoUrl: plot.tenantLogoUrl,
      mrrText: plot.tenantMrrText,
      logoHidden: plot.tenantLogoHidden,
      targetUrl: plot.tenantTargetUrl,
    };
    base.tenant = tenant;
    base.tenantPreBidId = plot.tenantPreBidId;
  }

  if (plot.status !== 'LIVE' || !plot.currentCycle) return base;

  return {
    ...base,
    currentPriceCents: plot.currentCycle.currentPriceCents ?? undefined,
    endAt: plot.currentCycle.endAt.toISOString(),
    cycleId: plot.currentCycle.id,
    currentLeaderPreBidId: plot.currentLeaderPreBidId ?? undefined,
  };
}

/** Public bid-ledger tick — never includes bidderId or maxBid data. */
export function serializeBidTick(
  bid: Pick<BidRow, 'id' | 'amountCents' | 'isProxy' | 'createdAt'>,
): BidTickDto {
  return {
    id: bid.id,
    amountCents: bid.amountCents,
    isProxy: bid.isProxy,
    createdAt: bid.createdAt.toISOString(),
  };
}

interface BidRow {
  id: string;
  amountCents: number;
  isProxy: boolean;
  createdAt: Date;
}
