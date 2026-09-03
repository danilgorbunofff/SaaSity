import { NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { serializePlot } from '@/server/serializers';
import { resolveEndedCycles } from '@/server/auction/worker';
import { isMockPaymentsEnabled } from '@/server/mock-payments';

export const dynamic = 'force-dynamic';

// Tier order then id — deterministic ordering for the grid renderer.
const TIER_ORDER = { CORE: 0, MID: 1, OUTER: 2 } as const;

// Secondary recovery net (Part 3: cron-not-configured): the PRIMARY
// settlement path is the external scheduler (GitHub Actions every 5 min,
// Vercel cron as safety net — see docs/deployment.md). This piggybacked
// sweep only catches stragglers when grid reads happen to arrive between
// ticks. Throttled, never blocking, never failing the read — but its
// outcome is LOGGED (a real alert when it finds stale cycles), never
// swallowed, so a dead primary scheduler shows up in the logs.
const sweep = { lastRun: 0 };
const SWEEP_INTERVAL_MS = 30_000;

export async function GET() {
  if (Date.now() - sweep.lastRun > SWEEP_INTERVAL_MS) {
    sweep.lastRun = Date.now();
    resolveEndedCycles().then(
      (r) => {
        if (r.staleCount > 0 || r.resolved > 0 || r.recovered > 0 || r.reconciled > 0) {
          console.warn(
            `[auction:sweep] secondary sweep settled work the primary missed: ` +
              `resolved=${r.resolved} recovered=${r.recovered} reconciled=${r.reconciled} ` +
              `releasesRetried=${r.releasesRetried} staleCount=${r.staleCount}`,
          );
        }
      },
      (err) => console.error('[auction:sweep] secondary sweep failed', err),
    );
  }

  const plots = await prisma.plot.findMany({
    include: { currentCycle: true },
  });

  plots.sort((a, b) => {
    const t = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });

  return NextResponse.json(
    // mockResolveEnabled: 2.5's dev fast-forward UI keys off server truth,
    // never a client-side env guess.
    { plots: plots.map(serializePlot), mockResolveEnabled: isMockPaymentsEnabled() },
    { headers: { 'Cache-Control': 's-maxage=5, stale-while-revalidate' } },
  );
}
