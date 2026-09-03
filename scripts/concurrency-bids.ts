/**
 * Phase 2.2 verification proof #2 — concurrent bids from distinct bidders.
 * N bidders bid in parallel on one LIVE cycle (after a claimer opens it).
 * Race outcomes are order-dependent (a late low bid is correctly rejected as
 * too-low once a higher leader max raised the price), so the proof asserts
 * the final DB state, not per-request statuses:
 *   - >= 2 ACTIVE pre-bids, exactly one leader;
 *   - currentPriceCents == min(topMax, secondMax + increment);
 *   - leader pre-bid id matches the plot's currentLeaderPreBidId;
 *   - ledger ticks >= 1.
 *
 * Usage: npx tsx scripts/concurrency-bids.ts
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
const BIDDERS = 6;

async function claimAsNewBidder(plotId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/plots/${plotId}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      plotId,
      companyName: 'ClaimerCo',
      targetUrl: 'https://claimer.example.com',
      twitterHandle: 'claimer',
      maxBidCents: 100_000,
    }),
  });
  if (res.status !== 200) throw new Error(`claim failed: ${res.status} ${await res.text()}`);
}

async function bidAsNewBidder(
  plotId: string,
  maxBidCents: number,
  name: string,
): Promise<{ status: number; extended: boolean }> {
  // No cookie sent -> server mints a fresh bidder per request (distinct bidders).
  const res = await fetch(`${BASE}/api/plots/${plotId}/bid`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      plotId,
      companyName: name,
      targetUrl: `https://${name.toLowerCase()}.example.com`,
      twitterHandle: name.toLowerCase(),
      maxBidCents,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { softCloseExtended?: boolean };
  return { status: res.status, extended: res.status === 200 && body.softCloseExtended === true };
}

async function main() {
  // 1. Reset target to a clean LIVE cycle owned by a fresh claimer.
  const plot = await prisma.plot.findFirst({ where: { status: 'IDLE', tier: 'MID' } });
  if (!plot) throw new Error('No IDLE MID plot available');
  await claimAsNewBidder(plot.id);
  console.log(`claimed ${plot.id} as ClaimerCo (max 100000)`);

  // 2. N distinct fresh bidders bid in parallel. Maxes must all clear the
  // MID floor + increment (500 + 100 = 600) so no bid dies on the 422 gate.
  const maxes = [700, 900, 1100, 1300, 1500].slice(0, BIDDERS);
  const names = ['BidderA', 'BidderB', 'BidderC', 'BidderD', 'BidderE', 'BidderF'].slice(
    0,
    BIDDERS,
  );

  console.log(`Firing ${BIDDERS} parallel bids with maxes [${maxes.join(', ')}]...`);
  const outcomes = await Promise.all(maxes.map((max, i) => bidAsNewBidder(plot.id, max, names[i])));
  const statuses = outcomes.map((o) => o.status);
  const extendedResponses = outcomes.filter((o) => o.extended).length;
  console.log('statuses:', statuses.join(','), `extended-responses: ${extendedResponses}`);

  // 3. Verify final state, not per-request statuses: race outcomes are
  // order-dependent (late low bids are correctly rejected as too-low).
  const cycle = await prisma.auctionCycle.findFirst({
    where: { plotId: plot.id, status: 'OPEN' },
  });
  if (!cycle) throw new Error('No OPEN cycle found after bids');

  const preBids = await prisma.preBid.findMany({
    where: { cycleId: cycle.id, status: 'ACTIVE' },
    orderBy: [{ maxBidCents: 'desc' }, { createdAt: 'asc' }],
  });
  const plotRow = await prisma.plot.findUnique({
    where: { id: plot.id },
    select: { currentLeaderPreBidId: true },
  });
  const bidCount = await prisma.bid.count({ where: { cycleId: cycle.id } });
  // Extension audit (Part 3): every request that observed an extension
  // marks exactly its own ledger row, so marked ticks === extended
  // responses — no orphan extensions, no double-marking under concurrency.
  const markedTicks = await prisma.bid.count({
    where: { cycleId: cycle.id, triggeredExtension: true },
  });

  let pass = true;
  if (preBids.length < 2) {
    pass = false;
    console.error('FAIL: need >= 2 ACTIVE pre-bids for second-price math');
  }

  if (preBids.length >= 2) {
    const sorted = [...preBids].sort(
      (a, b) => b.maxBidCents - a.maxBidCents || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const expectedPrice = Math.min(
      sorted[0].maxBidCents,
      sorted[1].maxBidCents + (cycle.incrementCents ?? 0),
    );
    const expectedLeader = sorted[0].id;

    if (cycle.currentPriceCents !== expectedPrice) {
      pass = false;
      console.error(`FAIL: price ${cycle.currentPriceCents} != expected ${expectedPrice}`);
    }
    if (plotRow?.currentLeaderPreBidId !== expectedLeader) {
      pass = false;
      console.error('FAIL: wrong leader pre-bid');
    }
    if (!statuses.includes(200)) {
      pass = false;
      console.error('FAIL: no winning bid in statuses');
    }
  }

  if (bidCount === 0) {
    pass = false;
    console.error('FAIL: no ledger ticks written');
  }

  if (markedTicks !== extendedResponses) {
    pass = false;
    console.error(
      `FAIL: marked extension ticks ${markedTicks} != extended responses ${extendedResponses}`,
    );
  }

  console.log(
    `pre-bids=${preBids.length} ticks=${bidCount} price=${cycle.currentPriceCents} leader=${preBids[0]?.companyName}`,
  );

  if (pass) console.log('PASS: concurrent bids converged to correct second-price state');
  else process.exit(1);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
