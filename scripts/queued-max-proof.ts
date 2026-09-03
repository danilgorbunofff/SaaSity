/**
 * Part 3 (queued-max-downgrade) verification proof — the upward-only
 * invariant at the engine choke point (upsertPreBid), in-process against the
 * local DB. maxBidCents is private (never serialized), so this asserts the
 * stored rows directly. Paths:
 *
 *   A. Claim path: queued high max attached into a fresh cycle with a lower
 *      submitted claim max -> row attaches (cycleId moves) but keeps the
 *      higher max.
 *   B. Stale tab / duplicate pre-bid: lower (or equal) re-submit on the same
 *      queued target -> max unchanged.
 *   C. Bid path: lower top-up on the exact live-cycle row -> max unchanged.
 *   D. Upgrade: higher submit raises the max (both queued and exact rows).
 *   E. Bulk attach (attachQueuedPreBids) never touches maxBidCents.
 *
 * Usage: npx tsx scripts/queued-max-proof.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { lockPlot, upsertPreBid, attachPreBidsToCycle, type Tx } from '../src/server/auction/engine';
import { TIERS } from '../src/lib/tiers';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: ['error'],
});

const TIER: keyof typeof TIERS = 'MID';
const CFG = TIERS[TIER];

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const BRAND = {
  companyName: 'MaxCo',
  targetUrl: 'https://maxco.example.com',
  twitterHandle: 'maxco',
  tagline: 'tag',
  mrrText: '$1k MRR',
};

async function makePlot(plotId: string): Promise<void> {
  await prisma.preBid.deleteMany({ where: { plotId } });
  await prisma.bid.deleteMany({ where: { plotId } });
  await prisma.auctionCycle.deleteMany({ where: { plotId } });
  await prisma.plot.upsert({
    where: { id: plotId },
    update: { status: 'LIVE', currentCycleId: null, currentLeaderPreBidId: null },
    create: {
      id: plotId,
      tier: TIER,
      originX: 0,
      originY: 0,
      spanX: 1,
      spanY: 1,
      status: 'LIVE',
    },
  });
}

async function openCycle(plotId: string): Promise<string> {
  const cycle = await prisma.auctionCycle.create({
    data: {
      plotId,
      status: 'OPEN',
      floorPriceCents: CFG.floorCents,
      incrementCents: CFG.incrementCents,
      durationMinutes: CFG.durationHours * 60,
      startedAt: new Date(),
      endAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  return cycle.id;
}

/** Run fn inside a tx holding the plot lock, like every route does. */
async function locked<T>(plotId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockPlot(tx, plotId);
    return fn(tx);
  });
}

async function readMax(id: string): Promise<{ max: number; cycleId: string | null }> {
  const row = await prisma.preBid.findUniqueOrThrow({ where: { id }, select: { maxBidCents: true, cycleId: true } });
  return { max: row.maxBidCents, cycleId: row.cycleId };
}

async function scenarioClaimAttach(): Promise<void> {
  console.log('A. claim path: queued high max survives low-max attach');
  const plotId = 'proof-max-a';
  await makePlot(plotId);
  const bidder = `proof-max-a-${Date.now()}`;

  const queuedId = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId: null, bidderId: bidder, maxBidCents: 2000, brand: BRAND }),
  );
  // Claim opens a fresh cycle; the claimer's submit is the floor.
  const cycleId = await openCycle(plotId);
  const attachedId = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: bidder, maxBidCents: CFG.floorCents, brand: BRAND }),
  );
  check('same row attached (no duplicate)', attachedId === queuedId);
  const row = await readMax(queuedId);
  check('row attached to the live cycle', row.cycleId === cycleId, `cycleId=${row.cycleId}`);
  check('higher queued max preserved', row.max === 2000, `max=${row.max}`);
}

async function scenarioStaleTab(): Promise<void> {
  console.log('B. stale tab / duplicate: lower re-submit never lowers');
  const plotId = 'proof-max-b';
  await makePlot(plotId);
  const bidder = `proof-max-b-${Date.now()}`;

  const id = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId: null, bidderId: bidder, maxBidCents: 2000, brand: BRAND }),
  );
  await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId: null, bidderId: bidder, maxBidCents: 1200, brand: BRAND }),
  );
  check('lower re-submit keeps max', (await readMax(id)).max === 2000);
  await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId: null, bidderId: bidder, maxBidCents: 2000, brand: BRAND }),
  );
  check('equal re-submit keeps max', (await readMax(id)).max === 2000);
}

async function scenarioBidTopUp(): Promise<void> {
  console.log('C. bid path: lower top-up on the live row never lowers');
  const plotId = 'proof-max-c';
  await makePlot(plotId);
  const cycleId = await openCycle(plotId);
  const bidder = `proof-max-c-${Date.now()}`;

  const id = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: bidder, maxBidCents: 2000, brand: BRAND }),
  );
  await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: bidder, maxBidCents: 1500, brand: BRAND }),
  );
  const row = await readMax(id);
  check('lower top-up keeps max', row.max === 2000, `max=${row.max}`);
  check('row stays in the live cycle', row.cycleId === cycleId);
}

async function scenarioUpgrade(): Promise<void> {
  console.log('D. upgrade: higher submit raises (queued + exact)');
  const plotId = 'proof-max-d';
  await makePlot(plotId);
  const bidder = `proof-max-d-${Date.now()}`;

  const id = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId: null, bidderId: bidder, maxBidCents: 1000, brand: BRAND }),
  );
  await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId: null, bidderId: bidder, maxBidCents: 2500, brand: BRAND }),
  );
  check('queued raise applies', (await readMax(id)).max === 2500);
  const cycleId = await openCycle(plotId);
  await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: bidder, maxBidCents: 2500, brand: BRAND }),
  );
  await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: bidder, maxBidCents: 3000, brand: BRAND }),
  );
  check('exact-cycle raise applies', (await readMax(id)).max === 3000);
}

async function scenarioBulkAttach(): Promise<void> {
  console.log('E. bulk attach preserves maxima');
  const plotId = 'proof-max-e';
  await makePlot(plotId);
  const cycleId = await openCycle(plotId);
  const a = `proof-max-e-a-${Date.now()}`;
  const b = `proof-max-e-b-${Date.now()}`;

  const idA = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId: null, bidderId: a, maxBidCents: 1800, brand: BRAND }),
  );
  const idB = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId: null, bidderId: b, maxBidCents: 2200, brand: BRAND }),
  );
  await locked(plotId, (tx) => attachPreBidsToCycle(tx, [idA, idB], cycleId));
  check('A attached with max intact', (await readMax(idA)).cycleId === cycleId && (await readMax(idA)).max === 1800);
  check('B attached with max intact', (await readMax(idB)).cycleId === cycleId && (await readMax(idB)).max === 2200);
}

async function cleanup(): Promise<void> {
  const ids = await prisma.plot.findMany({
    where: { id: { startsWith: 'proof-max-' } },
    select: { id: true },
  });
  for (const { id } of ids) {
    await prisma.preBid.deleteMany({ where: { plotId: id } });
    await prisma.bid.deleteMany({ where: { plotId: id } });
    await prisma.auctionCycle.deleteMany({ where: { plotId: id } });
    await prisma.plot.delete({ where: { id } });
  }
  if (ids.length > 0) console.log(`\ncleaned up ${ids.length} proof plot(s)`);
}

async function main(): Promise<void> {
  console.log('== queued-max-downgrade proof ==');
  await scenarioClaimAttach();
  await scenarioStaleTab();
  await scenarioBidTopUp();
  await scenarioUpgrade();
  await scenarioBulkAttach();
  await cleanup();
  console.log(failures === 0 ? '\nPASS: upward-only maxima hold on every path' : `\nFAILED: ${failures} check(s)`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
