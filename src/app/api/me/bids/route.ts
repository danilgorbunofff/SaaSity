import { NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { getBidderPayload } from '@/server/bidder-cookie';

export const dynamic = 'force-dynamic';

/**
 * Private owner view (phase 1.3): returns ONLY the caller's own ACTIVE
 * PreBid ids — never maxBidCents in a list context, never other bidders'
 * data. The client derives ownedLeading by matching PreBid.id against
 * Plot.currentLeaderPreBidId from the public /api/plots payload.
 */
export async function GET() {
  const bidder = await getBidderPayload();
  if (!bidder) {
    return NextResponse.json({ preBidIds: [] });
  }

  // ACTIVE only — WON/LOST/CANCELLED/EXPIRED pre-bids must not grant
  // ownership display on a live cycle.
  const preBids = await prisma.preBid.findMany({
    where: { bidderId: bidder.bidderId, status: 'ACTIVE' },
    select: { id: true },
  });

  return NextResponse.json(
    { preBidIds: preBids.map((pb) => pb.id) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
