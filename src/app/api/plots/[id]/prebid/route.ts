/**
 * Phase 2.2 — POST /api/plots/[id]/prebid
 * Queue a proxy pre-bid for the NEXT cycle on a plot, never this one:
 * always stored with `cycleId = null`, never starts a cycle, never triggers
 * Stripe, never runs a resolution pass. 200 | 404 | 409 | 422 | 429.
 *
 * Phase 2.5 correction: this route used to attach to a running OPEN cycle
 * ("joins as an outbid candidate"). That contradicted the plan (2.2 step 4:
 * "targeting the *next*, not-yet-created cycle") and the UI copy, and it was
 * a silent no-op whenever the queued max was below the live price — a
 * pre-bid at the tier floor on a contested cycle could never lead. A
 * next-cycle commitment stays a next-cycle commitment: the worker's rotation
 * (2.3) or the next claim attaches it.
 */

import { prisma } from '@/server/prisma';
import { getOrCreateBidderPayload } from '@/server/bidder-cookie';
import { checkMutationRateLimit, clientIp } from '@/server/rate-limit';
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

  const limit = checkMutationRateLimit(clientIp(request), bidder.bidderId);
  if (!limit.allowed) {
    return errorJson(429, 'Too many requests', {
      code: 'rate-limited',
      retryAfterSeconds: limit.retryAfterSeconds,
    });
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

    // Upward-only guard on the bidder's QUEUED row (cycleId = null) so a
    // stale client can never lower an existing commitment.
    const queued = await tx.preBid.findFirst({
      where: { plotId: id, cycleId: null, bidderId: bidder.bidderId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (queued && maxBidCents <= queued.maxBidCents) {
      return { code: 'not-higher' as const, yourMaxBidCents: queued.maxBidCents };
    }

    // Always queued for the NEXT cycle — never attached to a running one.
    await upsertPreBid(tx, {
      plotId: id,
      cycleId: null,
      bidderId: bidder.bidderId,
      maxBidCents,
      brand: { companyName, tagline, targetUrl, twitterHandle, mrrText },
    });

    return { code: 'ok' as const, plotStatus: plot.status };
  });

  if (result.code === 'not-higher') {
    return errorJson(
      409,
      'Your new pre-bid must exceed the one you already have queued for this plot',
      { code: 'not-higher', yourMaxBidCents: result.yourMaxBidCents },
    );
  }

  return Response.json({
    ok: true,
    plotId: id,
    queuedForNextCycle: true,
    plotStatus: result.plotStatus,
  });
}
