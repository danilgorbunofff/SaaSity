import { NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { serializeBidTick } from '@/server/serializers';

export const dynamic = 'force-dynamic';

const LEDGER_LIMIT = 50;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const plot = await prisma.plot.findUnique({
    where: { id },
    include: { currentCycle: true },
  });
  if (!plot) {
    return NextResponse.json({ error: 'Plot not found' }, { status: 404 });
  }

  const cycleId = plot.currentCycleId;

  if (!cycleId || plot.status !== 'LIVE' || !plot.currentCycle) {
    return NextResponse.json(
      { plotId: id, cycleId: null, bids: [] },
      { headers: { 'Cache-Control': 's-maxage=5, stale-while-revalidate' } },
    );
  }

  const bids = await prisma.bid.findMany({
    where: { cycleId },
    orderBy: { createdAt: 'desc' },
    take: LEDGER_LIMIT,
    select: { id: true, amountCents: true, isProxy: true, createdAt: true },
  });

  return NextResponse.json(
    { plotId: id, cycleId, bids: bids.map(serializeBidTick) },
    { headers: { 'Cache-Control': 's-maxage=5, stale-while-revalidate' } },
  );
}
