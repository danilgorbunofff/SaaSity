/**
 * Phase 2.2 verification proof #1 — concurrent claims.
 * N parallel claims on one IDLE plot via the real HTTP route: exactly one
 * must 200; every other request must get 409; DB ends with exactly one
 * OPEN cycle and one leader.
 *
 * Usage: npx tsx scripts/concurrency-claims.ts [plotId]
 * Reset after: npx tsx prisma/seed.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: ['error'],
});

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const N = 8;

function bodyFor(plotId: string) {
  return {
    plotId,
    companyName: 'RaceCo',
    tagline: 'concurrency proof',
    targetUrl: 'https://raceco.example.com',
    twitterHandle: 'raceco',
    mrrText: '$1k MRR',
    maxBidCents: 500,
  };
}

async function main() {
  const argPlotId = process.argv[2];
  const plot = argPlotId
    ? await prisma.plot.findUnique({ where: { id: argPlotId } })
    : await prisma.plot.findFirst({ where: { status: 'IDLE', tier: 'MID' } });
  if (!plot) throw new Error('No IDLE MID plot found (reset with: npx tsx prisma/seed.ts)');
  if (plot.status !== 'IDLE') throw new Error(`Plot ${plot.id} is ${plot.status}, need IDLE`);

  console.log(`Firing ${N} parallel claims on ${plot.id} (${plot.tier})...`);
  const responses = await Promise.all(
    Array.from({ length: N }, () =>
      fetch(`${BASE}/api/plots/${plot.id}/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyFor(plot.id)),
      }),
    ),
  );

  const statuses = responses.map((r) => r.status);
  const okCount = statuses.filter((s) => s === 200).length;
  const conflictCount = statuses.filter((s) => s === 409).length;
  console.log('statuses:', statuses.join(','));

  const cycles = await prisma.auctionCycle.findMany({
    where: { plotId: plot.id, status: 'OPEN' },
  });
  const winner = await prisma.plot.findUnique({
    where: { id: plot.id },
    select: { status: true, currentCycleId: true, currentLeaderPreBidId: true },
  });
  const preBids = await prisma.preBid.count({ where: { plotId: plot.id, status: 'ACTIVE' } });
  const leaderPreBid = winner?.currentLeaderPreBidId
    ? await prisma.preBid.findUnique({
        where: { id: winner.currentLeaderPreBidId },
        select: { companyName: true },
      })
    : null;

  let pass = true;
  const fail = (msg: string): void => {
    pass = false;
    console.error(msg);
  };
  if (okCount !== 1) fail(`FAIL: expected exactly 1 x 200, got ${okCount}`);
  if (conflictCount !== N - 1) fail(`FAIL: expected ${N - 1} x 409, got ${conflictCount}`);
  if (cycles.length !== 1) fail(`FAIL: expected 1 OPEN cycle, got ${cycles.length}`);
  if (winner?.status !== 'LIVE') fail(`FAIL: plot status ${winner?.status}`);
  if (!winner?.currentLeaderPreBidId) fail('FAIL: no leader pre-bid');
  if (preBids !== 1) fail(`FAIL: expected 1 ACTIVE pre-bid, got ${preBids}`);

  if (pass) {
    console.log(
      `PASS: 1 claim won, ${conflictCount} x 409, 1 OPEN cycle, leader=${leaderPreBid?.companyName}`,
    );
  } else {
    process.exit(1);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
