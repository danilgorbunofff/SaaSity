/**
 * Phase 2.2 — POST /api/plots/[id]/claim
 * Open an auction cycle on an IDLE plot: claimer's pre-bid at >= tier floor,
 * queued next-cycle pre-bids attach, resolution runs once. 200 | 404 | 409.
 */

import { prisma } from '@/server/prisma';
import { getOrCreateBidderPayload } from '@/server/bidder-cookie';
import { checkMutationRateLimit, clientIp } from '@/server/rate-limit';
import { TIERS } from '@/lib/tiers';
import {
  lockPlot,
  startCycle,
  attachQueuedPreBids,
  upsertPreBid,
  resolveCycle,
} from '@/server/auction/engine';
import { emitBidPlaced } from '@/server/realtime/bus';
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
    return errorJson(429, 'Too many requests', {
      code: 'rate-limited',
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  // Plot must exist; tier needed for the shared-contract floor check.
  const plot = await prisma.plot.findUnique({
    where: { id },
    select: { id: true, tier: true, status: true },
  });
  if (!plot) return errorJson(404, 'Plot not found');

  const parsed = parseBody(body, { mode: 'claim', tier: plot.tier });
  if (!parsed.ok) return parsed.response;

  const { maxBidCents, companyName, tagline, targetUrl, twitterHandle, mrrText } = parsed.values;
  // Response floor fallback only — the cycle snapshot is authoritative for
  // all engine math; TIERS is consulted just in case resolution returns null
  // (startCycle always creates a snapshot, so this is belt-and-braces).
  const floor = TIERS[plot.tier].floorCents;

  const result = await prisma.$transaction(async (tx) => {
    await lockPlot(tx, id);

    const claim = await startCycle(tx, plot, new Date());
    if (!claim) {
      return { conflict: true as const };
    }

    // Claimer's pre-bid lands directly in the fresh cycle.
    const preBidId = await upsertPreBid(tx, {
      plotId: id,
      cycleId: claim.id,
      bidderId: bidder.bidderId,
      maxBidCents,
      brand: { companyName, tagline, targetUrl, twitterHandle, mrrText },
    });

    // Queued next-cycle pre-bids (placed while the plot was IDLE) attach.
    await attachQueuedPreBids(tx, id, claim.id);

    const resolution = await resolveCycle(tx, claim, { humanSubmitCents: maxBidCents });

    return {
      conflict: false as const,
      cycleId: claim.id,
      preBidId,
      endAt: claim.endAt.toISOString(),
      priceCents: resolution?.priceCents ?? floor,
      isLeader: resolution?.leaderBidderId === bidder.bidderId,
      incrementCents: claim.incrementCents,
    };
  });

  if (result.conflict) {
    // Someone claimed it milliseconds earlier — the modal's outbid state.
    return errorJson(409, 'Plot already has an active auction', {
      code: 'outbid',
      plotId: id,
    });
  }

  // Publish AFTER tx commit (M3 seam constraint). No brand here (Part 1
  // fix): the provisional leader hasn't won or paid anything and must
  // never receive free billboard exposure — only the opaque preBid id.
  emitBidPlaced({
    plotId: id,
    cycleId: result.cycleId,
    currentPriceCents: result.priceCents,
    leaderPreBidId: result.preBidId,
    isProxy: !result.isLeader,
    endAt: result.endAt,
  });

  return Response.json({
    ok: true,
    plotId: id,
    cycleId: result.cycleId,
    endAt: result.endAt,
    currentPriceCents: result.priceCents,
    youAreLeader: result.isLeader,
    minimumNextBidCents: result.priceCents + result.incrementCents,
  });
}
