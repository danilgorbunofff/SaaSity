import { NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { getBidderPayload } from '@/server/bidder-cookie';

export const dynamic = 'force-dynamic';

/**
 * Private owner view (phase 1.3; extended by Part 1 lifecycle fix): returns
 * ONLY the caller's own PreBid ids — ACTIVE (for the "am I leading an open
 * auction" derivation) and WON (for the "am I the active tenant" derivation)
 * — never maxBidCents in a list context, never other bidders' data. The
 * client matches these ids against Plot.currentLeaderPreBidId (leading) and
 * Plot.tenantPreBidId (tenancy) from the public /api/plots payload.
 */
export async function GET() {
  const bidder = await getBidderPayload();
  if (!bidder) {
    return NextResponse.json({ preBidIds: [] });
  }

  // ACTIVE (leading an open auction) + WON (holds an active/past lease).
  // LOST/CANCELLED/EXPIRED pre-bids must never grant ownership display.
  const preBids = await prisma.preBid.findMany({
    where: { bidderId: bidder.bidderId, status: { in: ['ACTIVE', 'WON'] } },
    select: { id: true },
  });

  return NextResponse.json(
    { preBidIds: preBids.map((pb) => pb.id) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
