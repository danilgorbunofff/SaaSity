import { NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { serializePlot } from '@/server/serializers';
import { resolveEndedCycles } from '@/server/auction/worker';

export const dynamic = 'force-dynamic';

// Tier order then id — deterministic ordering for the grid renderer.
const TIER_ORDER = { CORE: 0, MID: 1, OUTER: 2 } as const;

// Inline sweep singleton: piggyback cycle resolution onto grid reads so
// ended auctions settle even without an external cron. Never blocks or
// fails the read path.
const sweep = { lastRun: 0 };
const SWEEP_INTERVAL_MS = 30_000;

export async function GET() {
  if (Date.now() - sweep.lastRun > SWEEP_INTERVAL_MS) {
    sweep.lastRun = Date.now();
    void resolveEndedCycles().catch(() => {});
  }

  const plots = await prisma.plot.findMany({
    include: { currentCycle: true },
  });

  plots.sort((a, b) => {
    const t = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });

  return NextResponse.json(
    { plots: plots.map(serializePlot) },
    { headers: { 'Cache-Control': 's-maxage=5, stale-while-revalidate' } },
  );
}
