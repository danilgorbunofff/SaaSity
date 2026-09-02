/**
 * Phase 2.5 — DEV-ONLY fast-forward trigger.
 *
 * `POST /api/mock-resolve/:cycleId` gives the mock loop (and the E2E script)
 * a way to move time without waiting hours for a cycle to end. It has two
 * modes, and NEITHER reimplements resolution — both delegate to the worker:
 *
 *   - `{"mode":"resolve"}` (default): forces an OPEN cycle's `endAt` to now
 *     and calls the worker's own `resolveOneCycle`. Identical code path to
 *     the cron sweep; only the clock is faked.
 *   - `{"mode":"shorten","seconds":N}`: sets `endAt = now + N seconds` and
 *     returns WITHOUT resolving, so a test can place a real bid inside the
 *     soft-close window and watch the countdown extend for real.
 *
 * Kill switch: 404 unless `MOCK_PAYMENTS=1`. Phase 3.1 deletes this route.
 * It is not authenticated beyond that flag — it CANNOT be reachable in any
 * deployment that has not explicitly opted into mock money.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { resolveOneCycle } from '@/server/auction/worker';
import { isMockPaymentsEnabled } from '@/server/mock-payments';
import { errorJson, isSameOrigin } from '@/server/auction/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_SHORTEN_SECONDS = 24 * 60 * 60;

interface MockBody {
  mode?: 'resolve' | 'shorten';
  seconds?: number;
}

export async function POST(request: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  // Unset flag => pretend the route does not exist (404, not 403 — don't
  // advertise that a mock trigger exists on a real deployment).
  if (!isMockPaymentsEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!isSameOrigin(request)) {
    return errorJson(403, 'Cross-origin requests are not allowed');
  }

  const { cycleId } = await params;

  let body: MockBody = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text) as MockBody;
  } catch {
    return errorJson(400, 'Malformed JSON body');
  }

  const cycle = await prisma.auctionCycle.findUnique({
    where: { id: cycleId },
    select: { id: true, plotId: true, status: true, endAt: true },
  });
  if (!cycle) return errorJson(404, 'Cycle not found');

  const now = new Date();

  /* ---- shorten: move endAt into the near future, do NOT resolve ---- */
  if (body.mode === 'shorten') {
    if (cycle.status !== 'OPEN') {
      return errorJson(409, `Cycle is ${cycle.status} — only OPEN cycles can be shortened`, {
        cycleId,
      });
    }
    const seconds = body.seconds ?? 60;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SHORTEN_SECONDS) {
      return errorJson(400, `seconds must be between 1 and ${MAX_SHORTEN_SECONDS}`);
    }
    const endAt = new Date(now.getTime() + seconds * 1000);
    await prisma.auctionCycle.update({ where: { id: cycleId }, data: { endAt } });
    return NextResponse.json({
      ok: true,
      mode: 'shorten' as const,
      cycleId,
      plotId: cycle.plotId,
      previousEndAt: cycle.endAt.toISOString(),
      endAt: endAt.toISOString(),
    });
  }

  /* ---- resolve: force endAt to now, then run the worker's path ---- */
  if (cycle.status === 'RESOLVED') {
    return errorJson(409, 'Cycle is already resolved', { cycleId });
  }
  if (cycle.status !== 'OPEN') {
    return errorJson(409, `Cycle is ${cycle.status} — cannot fast-forward`, { cycleId });
  }

  await prisma.auctionCycle.update({ where: { id: cycleId }, data: { endAt: now } });

  const outcome = await resolveOneCycle(cycleId, now);
  if (outcome === null) {
    return errorJson(409, 'Cycle was claimed by another resolver', { cycleId });
  }

  return NextResponse.json({
    ok: true,
    mode: 'resolve' as const,
    cycleId,
    plotId: outcome.plotId,
    winnerPreBidId: outcome.winnerPreBidId,
    clearingPriceCents: outcome.clearingPriceCents,
    winnerBrand: outcome.winnerBrand,
    nextCycleId: outcome.nextCycleId,
    nextEndAt: outcome.nextEndAt?.toISOString() ?? null,
    openingPriceCents: outcome.openingPriceCents,
  });
}
