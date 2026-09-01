import type { Plot, AuctionCycle } from '@/generated/prisma/client';
import type { PlotDto, LeaderBrandDto, BidTickDto } from '@/types/api';

/**
 * THE public plot serializer. Every consumer (REST in 0.3, SSE feed in 2.4)
 * must reuse this — no ad-hoc field picking elsewhere.
 *
 * Privacy invariant (binding): maxBidCents and non-leading bidders'
 * brand/identity are structurally absent — not gated by status, just never
 * selected. Only the leader's PUBLIC brand snapshot lands in the payload.
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

  if (plot.status !== 'LIVE' || !plot.currentCycle) return base;

  const dto: PlotDto = {
    ...base,
    currentPriceCents: plot.currentCycle.currentPriceCents ?? undefined,
    endAt: plot.currentCycle.endAt.toISOString(),
    currentLeaderPreBidId: plot.currentLeaderPreBidId ?? undefined,
  };

  if (plot.currentLeaderPreBidId) {
    const leader: LeaderBrandDto = {
      companyName: plot.leaderCompanyName,
      tagline: plot.leaderTagline,
      twitterHandle: plot.leaderTwitterHandle,
      logoUrl: plot.leaderLogoUrl,
      mrrText: plot.leaderMrrText,
      logoHidden: plot.leaderLogoHidden,
      leaderTargetUrl: plot.leaderTargetUrl,
    };
    dto.leader = leader;
  }

  return dto;
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
