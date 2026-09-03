/**
 * Part 3 (live-bid-authorization-seam) verification proof — the shared
 * `authorizeAttachedRows` helper and the expire-before-resolution +
 * compensate shape the claim/bid routes use, in-process against the DB.
 *
 *   A. all-success stub pass -> rows stay ACTIVE, partition correct.
 *   B. injected attach failure -> EXPIRED/'expired', and a subsequent
 *      proxy resolution prices survivors only (expire BEFORE resolution).
 *   C. injected PaymentIntent id -> persisted via the sanctioned writer;
 *      a repeat pass with failure injected still reports authorized
 *      (idempotent retry — M3 must never double-hold).
 *   D. bid-shaped compensation: resolve with the dead row priced in ->
 *      expire via the helper -> resolve again -> price AND leader pointer
 *      repaired (the exact sequence the claim/bid 402 paths run).
 *
 * The worker rotation path (T4) is covered by scripts/resolve-worker-proof.ts
 * scenarios B/C, which run the restructured worker end to end. The claim/bid
 * 402 HTTP responses share D's helper + compensate shape but cannot be
 * driven over HTTP — the injection hooks are in-process only.
 *
 * Usage: MOCK_PAYMENTS=1 npx tsx scripts/authorize-attach-proof.ts
 */
process.env.MOCK_PAYMENTS ??= '1';

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { lockPlot, upsertPreBid, resolveCycle, type Tx } from '../src/server/auction/engine';
import {
  authorizeAttachedRows,
  injectAttachAuthFailure,
  clearAttachAuthFailures,
  injectAttachAuthPiId,
  clearAttachAuthPiIds,
} from '../src/server/auction/finalize';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: ['error'],
});

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const BRAND = (tag: string) => ({
  companyName: `Auth${tag}`,
  targetUrl: `https://auth${tag.toLowerCase()}.example.com`,
  twitterHandle: `auth${tag.toLowerCase()}`,
});

async function makePlot(plotId: string): Promise<void> {
  await prisma.preBid.deleteMany({ where: { plotId } });
  await prisma.bid.deleteMany({ where: { plotId } });
  await prisma.auctionCycle.deleteMany({ where: { plotId } });
  await prisma.plot.upsert({
    where: { id: plotId },
    update: { status: 'LIVE', currentCycleId: null, currentLeaderPreBidId: null },
    create: { id: plotId, tier: 'OUTER', originX: 0, originY: 0, spanX: 1, spanY: 1, status: 'LIVE' },
  });
}

async function openCycle(plotId: string): Promise<string> {
  const cycle = await prisma.auctionCycle.create({
    data: {
      plotId,
      status: 'OPEN',
      floorPriceCents: 100,
      incrementCents: 50,
      durationMinutes: 360,
      startedAt: new Date(),
      endAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  await prisma.plot.update({ where: { id: plotId }, data: { currentCycleId: cycle.id } });
  return cycle.id;
}

async function locked<T>(plotId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockPlot(tx, plotId);
    return fn(tx);
  });
}

async function rowOf(id: string): Promise<{ status: string; lostReason: string | null; pi: string | null; cycleId: string | null }> {
  const row = await prisma.preBid.findUniqueOrThrow({
    where: { id },
    select: { status: true, lostReason: true, stripePaymentIntentId: true, cycleId: true },
  });
  return { status: row.status, lostReason: row.lostReason, pi: row.stripePaymentIntentId, cycleId: row.cycleId };
}

async function scenarioAllSuccess(): Promise<void> {
  console.log('A. all-success pass keeps rows ACTIVE');
  const plotId = 'proof-auth-a';
  await makePlot(plotId);
  const cycleId = await openCycle(plotId);
  const idA = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: `auth-a-a-${Date.now()}`, maxBidCents: 1000, brand: BRAND('A') }),
  );
  const idB = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: `auth-a-b-${Date.now()}`, maxBidCents: 700, brand: BRAND('B') }),
  );
  const out = await authorizeAttachedRows([idA, idB]);
  check('partition reports both authorized', out.authorizedIds.length === 2 && out.expiredIds.length === 0);
  check('A stays ACTIVE with no intent (stub)', (await rowOf(idA)).status === 'ACTIVE');
  check('B stays ACTIVE with no intent (stub)', (await rowOf(idB)).status === 'ACTIVE');
}

async function scenarioExpireBeforeResolution(): Promise<void> {
  console.log('B. failure expires before proxy resolution prices');
  const plotId = 'proof-auth-b';
  await makePlot(plotId);
  const cycleId = await openCycle(plotId);
  const stamp = Date.now();
  const idA = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: `auth-b-a-${stamp}`, maxBidCents: 1000, brand: BRAND('A') }),
  );
  const idB = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: `auth-b-b-${stamp}`, maxBidCents: 700, brand: BRAND('B') }),
  );
  injectAttachAuthFailure(idB);
  try {
    const out = await authorizeAttachedRows([idA, idB]);
    check('dead row reported expired', out.expiredIds.includes(idB) && out.authorizedIds.includes(idA));
    const dead = await rowOf(idB);
    check("dead row EXPIRED/'expired'", dead.status === 'EXPIRED' && dead.lostReason === 'expired');
    // Proxy resolution AFTER the helper returns must price survivors only:
    // with B dead, lone leader A pays the floor (100), not min(1000, 750).
    const price = await locked(plotId, async (tx) => {
      const cycle = await tx.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
      return (await resolveCycle(tx, cycle, {}))?.priceCents ?? -1;
    });
    check('resolution excludes the dead row (price 100)', price === 100, `price=${price}`);
  } finally {
    clearAttachAuthFailures();
  }
}

async function scenarioIntentPersistIdempotent(): Promise<void> {
  console.log('C. intent id persists via the sanctioned writer; retry skips');
  const plotId = 'proof-auth-c';
  await makePlot(plotId);
  const cycleId = await openCycle(plotId);
  const id = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: `auth-c-${Date.now()}`, maxBidCents: 1000, brand: BRAND('C') }),
  );
  injectAttachAuthPiId(id, 'pi_test_123');
  try {
    const first = await authorizeAttachedRows([id]);
    check('first pass authorizes', first.authorizedIds.includes(id));
    check('intent id persisted on the row', (await rowOf(id)).pi === 'pi_test_123');
    // Retry with FAILURE injected: the PI-skip must report authorized
    // without re-authorizing (no throw, no double-hold in M3).
    injectAttachAuthFailure(id);
    const second = await authorizeAttachedRows([id]);
    check('retry skips the intent-carrying row', second.authorizedIds.includes(id) && second.expiredIds.length === 0);
    check('row still ACTIVE after skipped retry', (await rowOf(id)).status === 'ACTIVE');
  } finally {
    clearAttachAuthFailures();
    clearAttachAuthPiIds();
  }
}

async function scenarioCompensate(): Promise<void> {
  console.log('D. bid-shaped compensation repairs price and leader');
  const plotId = 'proof-auth-d';
  await makePlot(plotId);
  const cycleId = await openCycle(plotId);
  const stamp = Date.now();
  const idA = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: `auth-d-a-${stamp}`, maxBidCents: 1000, brand: BRAND('A') }),
  );
  const idB = await locked(plotId, (tx) =>
    upsertPreBid(tx, { plotId, cycleId, bidderId: `auth-d-b-${stamp}`, maxBidCents: 700, brand: BRAND('B') }),
  );
  // Route tx: resolve with both rows live (price 750, leader A).
  const before = await locked(plotId, async (tx) => {
    const cycle = await tx.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
    return (await resolveCycle(tx, cycle, { humanSubmitCents: 700 }))?.priceCents ?? -1;
  });
  check('pre-failure price props on both rows (750)', before === 750, `price=${before}`);

  // Post-commit: B's authorization fails -> EXPIRED -> compensate tx.
  injectAttachAuthFailure(idB);
  try {
    const auth = await authorizeAttachedRows([idB]);
    if (!auth.expiredIds.includes(idB)) {
      check('helper expires the failed row', false);
      return;
    }
    check('helper expires the failed row', true);
    const after = await locked(plotId, async (tx) => {
      const cycle = await tx.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
      const resolution = await resolveCycle(tx, cycle, {});
      const plot = await tx.plot.findUniqueOrThrow({ where: { id: plotId } });
      const price = await tx.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
      return { price: resolution?.priceCents ?? -1, leader: plot.currentLeaderPreBidId, stored: price.currentPriceCents };
    });
    check('compensating resolve reprices to floor (100)', after.price === 100, `price=${after.price}`);
    check('leader pointer repaired to the survivor', after.leader === idA, `leader=${after.leader}`);
    check('stored cycle price repaired', after.stored === 100, `stored=${after.stored}`);
  } finally {
    clearAttachAuthFailures();
  }
}

async function cleanup(): Promise<void> {
  const ids = await prisma.plot.findMany({
    where: { id: { startsWith: 'proof-auth-' } },
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
  console.log('== live-bid-authorization-seam proof ==');
  await scenarioAllSuccess();
  await scenarioExpireBeforeResolution();
  await scenarioIntentPersistIdempotent();
  await scenarioCompensate();
  await cleanup();
  console.log(failures === 0 ? '\nPASS: attach-time authorization holds on every path' : `\nFAILED: ${failures} check(s)`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
