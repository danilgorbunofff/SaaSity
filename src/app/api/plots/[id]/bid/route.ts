/**
 * Phase 2.2 — POST /api/plots/[id]/bid
 * Manual bid on a LIVE cycle: top-up own ACTIVE pre-bid upward-only or
 * outbid the leader; server-truth minimum; reset-based capped soft-close.
 * 200 | 400 | 404 | 409 | 429.
 */

import { prisma } from '@/server/prisma';
import { getOrCreateBidderPayload } from '@/server/bidder-cookie';
import { checkMutationRateLimit, clientIp } from '@/server/rate-limit';
import {
  lockPlot,
  upsertPreBid,
  resolveCycle,
  applySoftClose,
} from '@/server/auction/engine';
import { parseBody, isSameOrigin, errorJson } from '@/server/auction/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) {
    return errorJson(403, 'Cross-origin requests are not allowed');
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson(400, 'Malformed JSON body');
  }

  const bidder = await getOrCreateBidderPayload();

  const limit = checkMutationRateLimit(clientIp(request), bidder.bidderId);
  if (!limit.allowed) {
    return errorJson(429, 'Too many requests', { retryAfterSeconds: limit.retryAfterSeconds });
  }

  const plot = await prisma.plot.findUnique({
    where: { id },
    select: { id: true, tier: true, status: true },
  });
  if (!plot) return errorJson(404, 'Plot not found');
  if (plot.status !== 'LIVE') {
    return errorJson(409, 'No active auction on this plot — claim it first');
  }

  const parsed = parseBody(body, { mode: 'bid', tier: plot.tier });
  if (!parsed.ok) return parsed.response;

  const { maxBidCents, companyName, tagline, targetUrl, twitterHandle, mrrText } = parsed.values;

  const result = await prisma.$transaction(async (tx) => {
    await lockPlot(tx, id);

    const cycle = await tx.auctionCycle.findFirst({
      where: { plotId: id, status: 'OPEN' },
    });
    if (!cycle) {
      return { code: 'no-cycle' as const };
    }

    const now = new Date();
    if (cycle.endAt.getTime() <= now.getTime()) {
      return { code: 'ended' as const };
    }

    // SERVER truth for the minimum — client hints are ignored.
    const minimumNext = (cycle.currentPriceCents ?? cycle.floorPriceCents) + cycle.incrementCents;
    if (maxBidCents < minimumNext) {
      return {
        code: 'too-low' as const,
        minimumNext,
        currentPriceCents: cycle.currentPriceCents ?? cycle.floorPriceCents,
      };
    }

    // Upward-only top-up of the bidder's own ACTIVE pre-bid in this cycle.
    const own = await tx.preBid.findFirst({
      where: { cycleId: cycle.id, bidderId: bidder.bidderId, status: 'ACTIVE' },
    });
    if (own && maxBidCents <= own.maxBidCents) {
      return {
        code: 'not-higher' as const,
        yourMaxBidCents: own.maxBidCents,
        minimumNext,
      };
    }

    const preBidId = await upsertPreBid(tx, {
      plotId: id,
      cycleId: cycle.id,
      bidderId: bidder.bidderId,
      maxBidCents,
      brand: { companyName, tagline, targetUrl, twitterHandle, mrrText },
    });

    // Soft-close evaluated exactly once per request, from receivedAt.
    const softClose = await applySoftClose(tx, cycle, now);

    const resolution = await resolveCycle(tx, cycle, { humanSubmitCents: maxBidCents });

    return {
      code: 'ok' as const,
      cycleId: cycle.id,
      preBidId,
      endAt: softClose.newEndAt.toISOString(),
      extended: softClose.extended,
      priceCents: resolution?.priceCents ?? minimumNext - cycle.incrementCents,
      isLeader: resolution?.leaderBidderId === bidder.bidderId,
      incrementCents: cycle.incrementCents,
    };
  });

  switch (result.code) {
    case 'no-cycle':
      return errorJson(409, 'No active auction on this plot');
    case 'ended':
      return errorJson(409, 'This auction cycle has already ended');
    case 'too-low':
      return errorJson(409, 'Bid below the current minimum', {
        minimumNextBidCents: result.minimumNext,
        currentPriceCents: result.currentPriceCents,
      });
    case 'not-higher':
      return errorJson(409, 'Your new max bid must exceed your current max bid', {
        yourMaxBidCents: result.yourMaxBidCents,
        minimumNextBidCents: result.minimumNext,
      });
    case 'ok':
      return Response.json({
        ok: true,
        plotId: id,
        cycleId: result.cycleId,
        endAt: result.endAt,
        softCloseExtended: result.extended,
        currentPriceCents: result.priceCents,
        youAreLeader: result.isLeader,
        minimumNextBidCents: result.priceCents + result.incrementCents,
      });
  }
}
