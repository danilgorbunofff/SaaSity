/**
 * Phase 2.2 — POST /api/plots/[id]/bid
 * Manual bid on a LIVE cycle: top-up own ACTIVE pre-bid upward-only or
 * outbid the leader; server-truth minimum; reset-based capped soft-close.
 * 200 | 400 | 402 | 404 | 409 | 429 (402 = attach-time authorization failed,
 * compensated: row EXPIRED, price/leader repaired, shell cancelled).
 */

import { prisma } from '@/server/prisma';
import { getOrCreateBidderPayload } from '@/server/bidder-cookie';
import { checkMutationRateLimit, clientIp } from '@/server/rate-limit';
import { lockPlot, upsertPreBid, resolveCycle, applySoftClose } from '@/server/auction/engine';
import { emitBidPlaced, emitCycleExtended, emitCycleResolved } from '@/server/realtime/bus';
// Part 4 `serverless-local-bus`: registers the durable outbox sink so this
// process's events fan out cross-instance (not just same-process).
import '@/server/realtime/outbox';
import { authorizeAttachedRows } from '@/server/auction/finalize';
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
  if (plot.status !== 'LIVE') {
    return errorJson(409, 'No active auction on this plot — claim it first', {
      code: 'no-auction',
    });
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

    const resolution = await resolveCycle(tx, cycle, {
      humanSubmitCents: maxBidCents,
      humanIds: { preBidId, bidderId: bidder.bidderId },
      // Attribute the extension to this request's ledger row (or its
      // requester-attributed tick when nothing moved).
      triggeredExtension: softClose.extended ? { preBidId, bidderId: bidder.bidderId } : undefined,
    });

    return {
      code: 'ok' as const,
      cycleId: cycle.id,
      preBidId,
      leaderPreBidId: resolution?.leaderPreBidId ?? preBidId,
      endAt: softClose.newEndAt.toISOString(),
      extended: softClose.extended,
      priceCents: resolution?.priceCents ?? minimumNext - cycle.incrementCents,
      isLeader: resolution?.leaderBidderId === bidder.bidderId,
      incrementCents: cycle.incrementCents,
    };
  });

  switch (result.code) {
    case 'no-cycle':
      return errorJson(409, 'No active auction on this plot', { code: 'no-cycle' });
    case 'ended':
      return errorJson(409, 'This auction cycle has already ended', { code: 'ended' });
    case 'too-low':
      // The live price moved past the caller's submitted max: the modal
      // surfaces this as the "outbid mid-submit" state, not a generic error.
      return errorJson(409, 'Bid below the current minimum', {
        code: 'outbid',
        minimumNextBidCents: result.minimumNext,
        currentPriceCents: result.currentPriceCents,
      });
    case 'not-higher':
      return errorJson(409, 'Your new max bid must exceed your current max bid', {
        code: 'not-higher',
        yourMaxBidCents: result.yourMaxBidCents,
        minimumNextBidCents: result.minimumNext,
      });
    case 'ok': {
      // Part 3 authorization seam (T2): the bidder's attach boundary is the
      // upsert above — authorize post-commit (Stripe I/O never inside the
      // tx). On failure the row is already EXPIRED by the helper: repair
      // the price/leader (cancelling the shell when nothing survives) and
      // report 402 instead of the bid.
      const auth = await authorizeAttachedRows([result.preBidId]);
      if (auth.expiredIds.includes(result.preBidId)) {
        const repaired = await prisma.$transaction(async (tx) => {
          await lockPlot(tx, id);
          const liveCycle = await tx.auctionCycle.findUnique({ where: { id: result.cycleId } });
          if (!liveCycle || liveCycle.status !== 'OPEN') return null;
          const resolution = await resolveCycle(tx, liveCycle, {});
          const survivors = await tx.preBid.count({
            where: { cycleId: liveCycle.id, status: 'ACTIVE' },
          });
          if (survivors === 0) {
            await tx.auctionCycle.update({
              where: { id: liveCycle.id },
              data: { status: 'CANCELLED' },
            });
            await tx.plot.update({
              where: { id },
              data: { status: 'IDLE', currentCycleId: null, currentLeaderPreBidId: null },
            });
            return { cancelled: true as const, resolution };
          }
          return { cancelled: false as const, resolution };
        });
        if (repaired && !repaired.cancelled && repaired.resolution) {
          emitBidPlaced({
            plotId: id,
            cycleId: result.cycleId,
            currentPriceCents: repaired.resolution.priceCents,
            leaderPreBidId: repaired.resolution.leaderPreBidId,
            isProxy: true,
            endAt: result.endAt,
          });
        }
        if (repaired?.cancelled) {
          emitCycleResolved({
            plotId: id,
            cycleId: result.cycleId,
            winner: null,
            clearingPriceCents: null,
            nextCycle: null,
          });
        }
        return errorJson(402, 'Payment authorization failed — no bid was placed', {
          code: 'authorization-failed',
          plotId: id,
        });
      }
      // Publish AFTER tx commit (M3 seam constraint: engine txs never
      // publish). isProxy = the proxy engine outbid a human challenger.
      // No brand here (Part 1 fix): the provisional leader of an open
      // auction has not won or paid anything and must never receive free
      // billboard exposure — only the opaque leaderPreBidId goes out.
      emitBidPlaced({
        plotId: id,
        cycleId: result.cycleId,
        currentPriceCents: result.priceCents,
        leaderPreBidId: result.leaderPreBidId,
        isProxy: !result.isLeader,
        endAt: result.endAt,
      });
      if (result.extended) {
        emitCycleExtended({ plotId: id, cycleId: result.cycleId, endAt: result.endAt });
      }
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
}
