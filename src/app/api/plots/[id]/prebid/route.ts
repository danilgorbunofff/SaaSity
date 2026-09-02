/**
 * Phase 2.2 — POST /api/plots/[id]/prebid
 * Queue a proxy pre-bid for the NEXT cycle on a plot: allowed on IDLE plots
 * and on LIVE plots (joins as an outbid candidate), never starts a cycle,
 * never triggers Stripe. 200 | 404 | 422 | 429.
 */

import { prisma } from '@/server/prisma';
import { getOrCreateBidderPayload } from '@/server/bidder-cookie';
import { checkRateLimit, clientIp } from '@/server/rate-limit';
import { lockPlot, upsertPreBid } from '@/server/auction/engine';
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

  const limit = checkRateLimit(`${clientIp(request)}:${bidder.bidderId}`);
  if (!limit.allowed) {
    return errorJson(429, 'Too many requests', { retryAfterSeconds: limit.retryAfterSeconds });
  }

  const plot = await prisma.plot.findUnique({
    where: { id },
    select: { id: true, tier: true, status: true },
  });
  if (!plot) return errorJson(404, 'Plot not found');

  const parsed = parseBody(body, { mode: 'prebid', tier: plot.tier });
  if (!parsed.ok) return parsed.response;

  const { maxBidCents, companyName, tagline, targetUrl, twitterHandle, mrrText } = parsed.values;

  const result = await prisma.$transaction(async (tx) => {
    await lockPlot(tx, id);

    // LIVE: attach to the running cycle as a normal outbid candidate.
    // IDLE: queue for the next cycle (cycleId stays null).
    const openCycle = await tx.auctionCycle.findFirst({
      where: { plotId: id, status: 'OPEN', endAt: { gt: new Date() } },
      select: { id: true },
    });
    const cycleId = openCycle?.id ?? null;

    if (cycleId) {
      // Same upward-only guard as /bid so a stale client can't lower a max.
      const own = await tx.preBid.findFirst({
        where: { cycleId, bidderId: bidder.bidderId, status: 'ACTIVE' },
      });
      if (own && maxBidCents <= own.maxBidCents) {
        return {
          code: 'not-higher' as const,
          yourMaxBidCents: own.maxBidCents,
        };
      }
    }

    await upsertPreBid(tx, {
      plotId: id,
      cycleId,
      bidderId: bidder.bidderId,
      maxBidCents,
      brand: { companyName, tagline, targetUrl, twitterHandle, mrrText },
    });

    return {
      code: 'ok' as const,
      attachedToLiveCycle: cycleId !== null,
      plotStatus: plot.status,
    };
  });

  if (result.code === 'not-higher') {
    return errorJson(409, 'Your new max bid must exceed your current max bid', {
      yourMaxBidCents: result.yourMaxBidCents,
    });
  }

  return Response.json({
    ok: true,
    plotId: id,
    attachedToLiveCycle: result.attachedToLiveCycle,
    plotStatus: result.plotStatus,
  });
}
