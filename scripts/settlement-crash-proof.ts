/**
 * Part 3 (capture-replay) crash-point proof — the persisted settlement
 * state machine, in-process against the DB with MOCK_PAYMENTS=1.
 *
 *   P1. retryable failure BEFORE any charge sticks: cascade aborts with NO
 *       fallback; the next sweep retries under the SAME idempotency key.
 *   P2. crash AFTER capture, before settle: reconcile settles from the
 *       recorded CAPTURED attempt with no new Stripe call.
 *   P3. crash BEFORE the settle commit (settle tx throws): the cycle is
 *       left RESOLVING (never reopened — capture is confirmed) and a later
 *       sweep reconciles with exactly one charge total.
 *   P4. crash AFTER commit: reconcile replays the stored outcome
 *       idempotently (no new rows, no new charges).
 *   P5. loser-release failure persists as RELEASE_FAILED and a later sweep
 *       retries it to RELEASED under the original key.
 *   P6. "already captured" (lost Stripe response): a CAPTURED row on
 *       record is adopted with ZERO new Stripe calls.
 *   P7. stuck recovery never reopens a cycle holding a confirmed capture,
 *       however old — it reconciles it instead.
 *
 * Usage: MOCK_PAYMENTS=1 npx tsx scripts/settlement-crash-proof.ts
 */
process.env.MOCK_PAYMENTS ??= '1';

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { lockPlot, upsertPreBid, secondPriceFor, type Tx } from '../src/server/auction/engine';
import {
  runCaptureCascade,
  settlementIdempotencyKey,
  injectCaptureFailure,
  clearCaptureFailures,
  injectCancelFailure,
  clearCancelFailures,
  resetCaptureCallLog,
  getCaptureCallCount,
} from '../src/server/auction/finalize';
import {
  resolveOneCycle,
  resolveEndedCycles,
  reconcileCapturedCycle,
  injectSettleFailure,
  clearSettleFailures,
} from '../src/server/auction/worker';

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
  companyName: `Settle${tag}`,
  targetUrl: `https://settle${tag.toLowerCase()}.example.com`,
  twitterHandle: `settle${tag.toLowerCase()}`,
});

async function makePlot(plotId: string): Promise<void> {
  await prisma.settlementAttempt.deleteMany({ where: { cycle: { plotId } } });
  await prisma.preBid.deleteMany({ where: { plotId } });
  await prisma.bid.deleteMany({ where: { plotId } });
  await prisma.auctionCycle.deleteMany({ where: { plotId } });
  await prisma.plot.upsert({
    where: { id: plotId },
    update: { status: 'LIVE', currentCycleId: null, currentLeaderPreBidId: null },
    create: { id: plotId, tier: 'OUTER', originX: 0, originY: 0, spanX: 1, spanY: 1, status: 'LIVE' },
  });
}

/** OPEN cycle already past endAt (floor 100, increment 50). */
async function openEndedCycle(plotId: string): Promise<string> {
  const cycle = await prisma.auctionCycle.create({
    data: {
      plotId,
      status: 'OPEN',
      floorPriceCents: 100,
      incrementCents: 50,
      durationMinutes: 360,
      startedAt: new Date(Date.now() - 2 * 60_000),
      endAt: new Date(Date.now() - 60_000),
    },
  });
  await prisma.plot.update({ where: { id: plotId }, data: { currentCycleId: cycle.id } });
  return cycle.id;
}

async function addRow(plotId: string, cycleId: string, tag: string, max: number): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await lockPlot(tx as Tx, plotId);
    return upsertPreBid(tx as Tx, {
      plotId,
      cycleId,
      bidderId: `settle-${tag}-${Date.now()}`,
      maxBidCents: max,
      brand: BRAND(tag),
    });
  });
}

async function attempts(cycleId: string): Promise<
  Array<{ preBidId: string; kind: string; attemptNo: number; status: string; key: string; amount: number | null }>
> {
  const rows = await prisma.settlementAttempt.findMany({
    where: { cycleId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    preBidId: r.preBidId,
    kind: r.kind,
    attemptNo: r.attemptNo,
    status: r.status,
    key: r.idempotencyKey,
    amount: r.amountCents,
  }));
}

async function scenarioAbortRetryable(): Promise<void> {
  console.log('P1. retryable failure aborts with no fallback; retry reuses the key');
  const plotId = 'proof-settle-p1';
  await makePlot(plotId);
  const cycleId = await openEndedCycle(plotId);
  const idA = await addRow(plotId, cycleId, 'A', 5000);
  const idB = await addRow(plotId, cycleId, 'B', 3000);

  injectCaptureFailure(idA, true);
  resetCaptureCallLog();
  const outcome = await resolveOneCycle(cycleId, new Date());
  try {
    check('aborted pass settles nothing (null outcome)', outcome === null);
    const cycle = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
    check('cycle handed back to OPEN for retry', cycle.status === 'OPEN', cycle.status);
    const rows = await attempts(cycleId);
    check(
      'one FAILED_RETRYABLE row, B untouched',
      rows.length === 1 && rows[0].status === 'FAILED_RETRYABLE' && rows[0].preBidId === idA,
      JSON.stringify(rows),
    );
    check('leader attempted once, fallback never attempted', getCaptureCallCount(idA) === 1 && getCaptureCallCount(idB) === 0);
    const b = await prisma.preBid.findUniqueOrThrow({ where: { id: idB } });
    check('loser still ACTIVE (no fallback, no release)', b.status === 'ACTIVE', b.status);

    // Next sweep retries under the same key.
    clearCaptureFailures();
    const sweep = await resolveEndedCycles();
    check('retry resolves the cycle', sweep.resolved === 1, JSON.stringify(sweep));
    const rows2 = await attempts(cycleId);
    const aRows = rows2.filter((r) => r.preBidId === idA && r.kind === 'CAPTURE');
    check(
      'retry adds attemptNo 2 under the SAME key',
      aRows.length === 2 && aRows[0].key === aRows[1].key && aRows[1].status === 'CAPTURED',
      JSON.stringify(aRows),
    );
    const winner = await prisma.preBid.findUniqueOrThrow({ where: { id: idA } });
    check('leader WON at second price', winner.status === 'WON');
    const settled = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
    check('clearing price min(5000, 3000+50)', settled.clearingPriceCents === 3050, `got ${settled.clearingPriceCents}`);
  } finally {
    clearCaptureFailures();
  }
}

async function scenarioReconcileAfterCapture(): Promise<void> {
  console.log('P2. crash after capture reconciles with no new charge');
  const plotId = 'proof-settle-p2';
  await makePlot(plotId);
  const cycleId = await openEndedCycle(plotId);
  const idA = await addRow(plotId, cycleId, 'A', 5000);
  await addRow(plotId, cycleId, 'B', 3000);
  // Claimed, captured, crashed before settle.
  await prisma.auctionCycle.update({ where: { id: cycleId }, data: { status: 'RESOLVING' } });
  resetCaptureCallLog();

  const candidates = await prisma.preBid.findMany({ where: { cycleId, status: 'ACTIVE' } });
  const cascade = await runCaptureCascade({
    cycleId,
    candidates,
    computeRemainingPrice: (c, remaining) => {
      const highestOther = remaining.length === 0 ? null : Math.max(...remaining.map((r) => r.maxBidCents));
      return secondPriceFor(c.maxBidCents, highestOther, 100, 50);
    },
    markLost: async (id) => {
      await prisma.preBid.update({ where: { id }, data: { status: 'LOST', lostReason: 'capture_failed' } });
    },
  });
  check('direct cascade captures the leader', cascade.winnerPreBidId === idA && cascade.clearingPriceCents === 3050);
  check('one Stripe call for the intent', getCaptureCallCount(idA) === 1);

  const outcome = await reconcileCapturedCycle(cycleId, new Date());
  check('reconcile settles from the record', outcome?.winnerPreBidId === idA && outcome.clearingPriceCents === 3050);
  check('reconcile makes no new Stripe call', getCaptureCallCount(idA) === 1, `calls=${getCaptureCallCount(idA)}`);
  const cycle = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
  check('cycle RESOLVED', cycle.status === 'RESOLVED', cycle.status);
}

async function scenarioCrashBeforeCommit(): Promise<void> {
  console.log('P3. crash before commit leaves RESOLVING; later sweep reconciles once');
  const plotId = 'proof-settle-p3';
  await makePlot(plotId);
  const cycleId = await openEndedCycle(plotId);
  const idA = await addRow(plotId, cycleId, 'A', 5000);
  await addRow(plotId, cycleId, 'B', 3000);

  injectSettleFailure();
  resetCaptureCallLog();
  const sweep1 = await resolveEndedCycles();
  check('poisoned settle resolves nothing yet', sweep1.resolved === 0 && sweep1.reconciled === 0);
  const mid = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
  check('cycle left RESOLVING (never reopened after confirmed capture)', mid.status === 'RESOLVING', mid.status);
  check('charge happened exactly once', getCaptureCallCount(idA) === 1);
  const rows = await attempts(cycleId);
  check('CAPTURED row on record', rows.some((r) => r.preBidId === idA && r.status === 'CAPTURED'));

  clearSettleFailures();
  const sweep2 = await resolveEndedCycles();
  check('later sweep reconciles', sweep2.reconciled === 1, JSON.stringify(sweep2));
  check('still exactly one charge total', getCaptureCallCount(idA) === 1, `calls=${getCaptureCallCount(idA)}`);
  const done = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
  check('cycle RESOLVED at 3050', done.status === 'RESOLVED' && done.clearingPriceCents === 3050);
  const winner = await prisma.preBid.findUniqueOrThrow({ where: { id: idA } });
  check('winner WON', winner.status === 'WON', winner.status);
}

async function scenarioReplayAfterCommit(): Promise<void> {
  console.log('P4. crash after commit replays idempotently');
  const plotId = 'proof-settle-p3'; // P3's settled cycle
  const cycle = await prisma.auctionCycle.findFirstOrThrow({
    where: { plotId, status: 'RESOLVED' },
  });
  const before = await attempts(cycle.id);
  resetCaptureCallLog();
  const outcome = await reconcileCapturedCycle(cycle.id, new Date());
  check('replay returns the stored outcome', outcome?.winnerPreBidId === cycle.winnerPreBidId && outcome.clearingPriceCents === 3050);
  const after = await attempts(cycle.id);
  check('no new attempt rows on replay', after.length === before.length, `${before.length} -> ${after.length}`);
  check('no Stripe calls on replay', getCaptureCallCount() === 0);
}

async function scenarioReleaseRetry(): Promise<void> {
  console.log('P5. release failure persists and retries');
  const plotId = 'proof-settle-p5';
  await makePlot(plotId);
  const cycleId = await openEndedCycle(plotId);
  const idA = await addRow(plotId, cycleId, 'A', 5000);
  const idB = await addRow(plotId, cycleId, 'B', 3000);

  injectCancelFailure(idB);
  resetCaptureCallLog();
  try {
    const outcome = await resolveOneCycle(cycleId, new Date());
    check('settlement succeeds despite the failed release', outcome?.winnerPreBidId === idA);
    const rows = await attempts(cycleId);
    check(
      'RELEASE_FAILED row persisted for the loser',
      rows.some((r) => r.preBidId === idB && r.kind === 'RELEASE' && r.status === 'RELEASE_FAILED'),
      JSON.stringify(rows),
    );
  } finally {
    clearCancelFailures();
  }
  const sweep = await resolveEndedCycles();
  check('sweep retried the release', sweep.releasesRetried === 1, JSON.stringify(sweep));
  const rows = await attempts(cycleId);
  check(
    'release now RELEASED',
    rows.some((r) => r.preBidId === idB && r.kind === 'RELEASE' && r.status === 'RELEASED'),
  );
}

async function scenarioAlreadyCaptured(): Promise<void> {
  console.log('P6. lost Stripe response: recorded capture adopted with zero new calls');
  const plotId = 'proof-settle-p6';
  await makePlot(plotId);
  const cycleId = await openEndedCycle(plotId);
  const idA = await addRow(plotId, cycleId, 'A', 5000);
  await addRow(plotId, cycleId, 'B', 3000);
  // A previous pass charged A at 3050 but the response never arrived.
  await prisma.settlementAttempt.create({
    data: {
      cycleId,
      preBidId: idA,
      kind: 'CAPTURE',
      attemptNo: 1,
      amountCents: 3050,
      idempotencyKey: settlementIdempotencyKey(cycleId, idA, 'CAPTURE', 3050),
      status: 'CAPTURED',
      stripeResult: JSON.stringify({ note: 'pre-seeded confirmed charge' }),
    },
  });
  resetCaptureCallLog();

  const outcome = await resolveOneCycle(cycleId, new Date());
  check('recorded winner adopted', outcome?.winnerPreBidId === idA && outcome.clearingPriceCents === 3050);
  check('Stripe never called again', getCaptureCallCount() === 0, `calls=${getCaptureCallCount()}`);
}

async function scenarioRecoveryGuard(): Promise<void> {
  console.log('P7. stuck recovery never reopens a confirmed capture');
  const plotId = 'proof-settle-p7';
  await makePlot(plotId);
  const cycleId = await openEndedCycle(plotId);
  const idA = await addRow(plotId, cycleId, 'A', 5000);
  await prisma.settlementAttempt.create({
    data: {
      cycleId,
      preBidId: idA,
      kind: 'CAPTURE',
      attemptNo: 1,
      amountCents: 5000,
      idempotencyKey: settlementIdempotencyKey(cycleId, idA, 'CAPTURE', 5000),
      status: 'CAPTURED',
    },
  });
  // Age the claim far past the stuck timeout.
  await prisma.auctionCycle.update({
    where: { id: cycleId },
    data: { status: 'RESOLVING', updatedAt: new Date(Date.now() - 60 * 60_000) },
  });

  const sweep = await resolveEndedCycles();
  const cycle = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
  check('ancient RESOLVING+capture reconciled, not reopened', cycle.status === 'RESOLVED' && sweep.reconciled === 1);
  check('recovery did not claim it as stuck', sweep.recovered === 0, JSON.stringify(sweep));
}

async function cleanup(): Promise<void> {
  const ids = await prisma.plot.findMany({
    where: { id: { startsWith: 'proof-settle-' } },
    select: { id: true },
  });
  for (const { id } of ids) {
    await prisma.settlementAttempt.deleteMany({ where: { cycle: { plotId: id } } });
    await prisma.preBid.deleteMany({ where: { plotId: id } });
    await prisma.bid.deleteMany({ where: { plotId: id } });
    await prisma.auctionCycle.deleteMany({ where: { plotId: id } });
    await prisma.plot.delete({ where: { id } });
  }
  if (ids.length > 0) console.log(`\ncleaned up ${ids.length} proof plot(s)`);
}

async function main(): Promise<void> {
  console.log('== capture-replay crash-point proof ==');
  await scenarioAbortRetryable();
  await scenarioReconcileAfterCapture();
  await scenarioCrashBeforeCommit();
  await scenarioReplayAfterCommit();
  await scenarioReleaseRetry();
  await scenarioAlreadyCaptured();
  await scenarioRecoveryGuard();
  await cleanup();
  console.log(failures === 0 ? '\nPASS: every crash point resumes from the ledger' : `\nFAILED: ${failures} check(s)`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
