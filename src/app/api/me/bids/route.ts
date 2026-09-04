import { NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { getBidderPayload } from '@/server/bidder-cookie';

export const dynamic = 'force-dynamic';

/**
 * Private owner view (phase 1.3; extended by Part 1 lifecycle fix, then Part
 * 4 `outbid-reconstruction`): returns the caller's own PreBid ids — ACTIVE
 * (for the "am I leading an open auction" derivation) and WON (for the "am
 * I the active tenant" derivation) — PLUS a privacy-safe owner projection
 * per row (preBidId, plotId, cycleId, status) so the client can reconstruct
 * WHICH plot/cycle it leads or has lost after a refresh, from current server
 * snapshots rather than historical client transitions. Never maxBidCents in
 * any context, never other bidders' data.
 */
export async function GET() {
  const bidder = await getBidderPayload();
  if (!bidder) {
    return NextResponse.json({ preBidIds: [], positions: [] });
  }

  // ACTIVE (leading an open auction) + WON (holds an active/past lease).
  // LOST/EXPIRED pre-bids must never grant ownership display.
  const preBids = await prisma.preBid.findMany({
    where: { bidderId: bidder.bidderId, status: { in: ['ACTIVE', 'WON'] } },
    select: { id: true, plotId: true, cycleId: true, status: true },
  });

  return NextResponse.json(
    {
      preBidIds: preBids.map((pb) => pb.id),
      positions: preBids.map((pb) => ({
        preBidId: pb.id,
        plotId: pb.plotId,
        cycleId: pb.cycleId,
        status: pb.status,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
