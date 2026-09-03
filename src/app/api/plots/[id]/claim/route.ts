/**
 * Phase 2.2 — POST /api/plots/[id]/claim
 * Open an auction cycle on an IDLE plot: claimer's pre-bid at >= tier floor,
 * queued next-cycle pre-bids attach, resolution runs once.
 * 200 | 402 | 404 | 409 | 429 (402 = attach-time authorization failed,
 * compensated: row EXPIRED, price/leader repaired, shell cancelled).
 */

import { prisma } from '@/server/prisma';
import { getOrCreateBidderPayload } from '@/server/bidder-cookie';
import { checkMutationRateLimit, clientIp } from '@/server/rate-limit';
import { TIERS } from '@/lib/tiers';
import {
  lockPlot,
  startCycle,
  attachPreBidsToCycle,
  upsertPreBid,
  resolveCycle,
} from '@/server/auction/engine';
import { authorizeAttachedRows } from '@/server/auction/finalize';
import { emitBidPlaced, emitCycleResolved } from '@/server/realtime/bus';
// Part 4 `serverless-local-bus`: registers the durable outbox sink so this
// process's events fan out cross-instance (not just same-process).
import '@/server/realtime/outbox';
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

  // Part 3 authorization seam (T1): authorize the already-queued rows BEFORE
  // the claim tx (no lock held — pure reads + Stripe I/O), so only survivor
  // ids attach below. Failures expire while still queued.
  const queuedIds = (
    await prisma.preBid.findMany({
      where: { plotId: id, cycleId: null, status: 'ACTIVE' },
      select: { id: true },
    })
  ).map((q) => q.id);
  const queuedAuth = await authorizeAttachedRows(queuedIds);

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

    // Only pre-authorized survivors attach — never "every queued row", so a
    // row that arrived between the authorize pass above and this tx stays
    // queued for the next rotation instead of entering unauthorized.
    await attachPreBidsToCycle(tx, queuedAuth.authorizedIds, claim.id);

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

  // The claimer's own attach boundary is row creation above: authorize it
  // post-commit (Stripe I/O never inside the tx). On failure the row is
  // already EXPIRED by the helper — re-resolve to repair the price/leader
  // computed with the dead row (cancelling the shell when nothing survives,
  // so the plot never strands LIVE-but-empty), and tell the caller to fix
  // payment. Watchers get the matching event, not silence.
  const claimerAuth = await authorizeAttachedRows([result.preBidId]);
  if (claimerAuth.expiredIds.includes(result.preBidId)) {
    const repaired = await prisma.$transaction(async (tx) => {
      await lockPlot(tx, id);
      const cycle = await tx.auctionCycle.findUnique({ where: { id: result.cycleId } });
      if (!cycle || cycle.status !== 'OPEN') return null;
      const resolution = await resolveCycle(tx, cycle, {});
      const survivors = await tx.preBid.count({
        where: { cycleId: cycle.id, status: 'ACTIVE' },
      });
      if (survivors === 0) {
        await tx.auctionCycle.update({
          where: { id: cycle.id },
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
      // The shell never held a bid: tell watchers the plot is IDLE again.
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
