/**
 * Phase 2.3 verification proof — expiry sweep worker end-to-end against the
 * local DB. Runs resolveEndedCycles() in-process (the same entry point the
 * cron route calls) on a synthetic plot. Scenarios:
 *
 *   A. Basic resolution: winner rotated onto the plot, cycle RESOLVED, losers
 *      LOST, winner's brand persists as the standing display (IDLE plot).
 *   B. Next cycle from queued pre-bids: partial attach-auth failures expire
 *      (lostReason 'expired'), survivors open a new OPEN cycle.
 *   C. ALL queued pre-bids fail attach auth: shell cycle CANCELLED, plot
 *      IDLE, display wiped (no winner this round).
 *   D. All captures fail: no winner, plot IDLE, display wiped, every
 *      candidate LOST with lostReason 'capture_failed'.
 *   E. Idempotence / race arbiter: 5 concurrent sweeps resolve one cycle
 *      exactly once (no double RESOLVED, no double-captured winner).
 *   F. Stuck RESOLVING recovery: a cycle stuck in RESOLVING older than
 *      RESOLVING_TIMEOUT_MINUTES returns to OPEN (recovered >= 1).
 *   G. Late-bid survival (worker-endat-race): sweep read, soft-close
 *      extension, worker claim — the worker must NOT settle a cycle whose
 *      endAt moved past the sweep timestamp, via the claim predicate (G1)
 *      or via the under-lock recheck when the extension lands after the
 *      claim (G2, lock-held interleaving).
 *
 * Usage: npx tsx scripts/resolve-worker-proof.ts
 * Reset after: npx tsx prisma/seed.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { resolveEndedCycles, resolveOneCycle } from '../src/server/auction/worker';
import { lockPlot, applySoftClose } from '../src/server/auction/engine';
import {
  injectAttachAuthFailure,
  clearAttachAuthFailures,
  injectCaptureFailure,
  clearCaptureFailures,
} from '../src/server/auction/finalize';
import { TIERS, RESOLVING_TIMEOUT_MINUTES } from '../src/lib/tiers';

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

// Synthetic plots live outside the real grid — the seed only upserts real
// grid ids, so cleanup is a hard delete of the proof plots' descendants.
async function makePlot(plotId: string): Promise<string> {
  await prisma.preBid.deleteMany({ where: { plotId } });
  await prisma.bid.deleteMany({ where: { plotId } });
  await prisma.auctionCycle.deleteMany({ where: { plotId } });
  await prisma.plot.upsert({
    where: { id: plotId },
    update: {
      status: 'IDLE',
      currentCycleId: null,
      currentLeaderPreBidId: null,
      tenantPreBidId: null,
      tenantSince: null,
      tenantCompanyName: null,
      tenantTagline: null,
      tenantTwitterHandle: null,
      tenantLogoUrl: null,
      tenantMrrText: null,
      tenantTargetUrl: null,
    },
    create: {
      id: plotId,
      tier: TIER,
      originX: 0,
      originY: 0,
      spanX: 1,
      spanY: 1,
      status: 'IDLE',
    },
  });
  return plotId;
}

async function makeBidder(name: string): Promise<string> {
  // bidderId is an opaque string (no Bidder table) — namespaced per scenario.
  return `proof-${name}-${Math.random().toString(36).slice(2, 8)}`;
}

async function openCycle(plotId: string, endAt: Date): Promise<string> {
  const cycle = await prisma.auctionCycle.create({
    data: {
      plotId,
      status: 'OPEN',
      floorPriceCents: CFG.floorCents,
      incrementCents: CFG.incrementCents,
      durationMinutes: CFG.durationHours * 60,
      startedAt: new Date(),
      endAt,
    },
  });
  return cycle.id;
}

async function addPreBid(
  cycleId: string,
  plotId: string,
  bidderId: string,
  name: string,
  maxBidCents: number,
): Promise<string> {
  const pb = await prisma.preBid.create({
    data: {
      cycleId,
      plotId,
      bidderId,
      status: 'ACTIVE',
      maxBidCents,
      companyName: name,
      tagline: `${name} tagline`,
      targetUrl: `https://${name.toLowerCase()}.example.com`,
      twitterHandle: name.toLowerCase(),
      mrrText: '$1k MRR',
    },
  });
  return pb.id;
}

async function addQueuedPreBid(
  plotId: string,
  bidderId: string,
  name: string,
  maxBidCents: number,
): Promise<string> {
  const pb = await prisma.preBid.create({
    data: {
      cycleId: null,
      plotId,
      bidderId,
      status: 'ACTIVE',
      maxBidCents,
      companyName: name,
      tagline: `${name} tagline`,
      targetUrl: `https://${name.toLowerCase()}.example.com`,
      twitterHandle: name.toLowerCase(),
      mrrText: '$1k MRR',
    },
  });
  return pb.id;
}

async function getPlot(plotId: string) {
  return prisma.plot.findUniqueOrThrow({ where: { id: plotId } });
}

// ---- scenarios -------------------------------------------------------------

/** A. Basic resolution: winner rotated, display persists, losers lost. */
async function scenarioA(): Promise<void> {
  console.log('A. basic resolution: winner rotated, display persists, losers lost');
  const plotId = await makePlot('proof-2-3-a');
  const cycleId = await openCycle(plotId, new Date(Date.now() - 60_000)); // ended
  const alpha = await makeBidder('A-alpha');
  const beta = await makeBidder('A-beta');
  const alphaPb = await addPreBid(cycleId, plotId, alpha, 'Alpha', 2000);
  await addPreBid(cycleId, plotId, beta, 'Beta', 1500);

  const sweep = await resolveEndedCycles();
  check('sweep resolved >= 1 cycle', sweep.resolved >= 1, JSON.stringify(sweep));

  const cycle = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
  check('cycle RESOLVED', cycle.status === 'RESOLVED');
  check(
    'winner Alpha, clearing = min(2000, 1500+100) = 1600',
    cycle.winnerPreBidId === alphaPb && cycle.clearingPriceCents === 1600,
    `winner=${cycle.winnerPreBidId} price=${cycle.clearingPriceCents}`,
  );
  const plot = await getPlot(plotId);
  check(
    'plot IDLE with winner display kept (standing lease)',
    plot.status === 'IDLE' && plot.tenantCompanyName === 'Alpha',
    `status=${plot.status} tenant=${plot.tenantCompanyName}`,
  );
  const betaRow = await prisma.preBid.findFirstOrThrow({
    where: { cycleId, companyName: 'Beta' },
  });
  check('Beta LOST', betaRow.status === 'LOST');
  check(
    'Alpha WON',
    (await prisma.preBid.findUniqueOrThrow({ where: { id: alphaPb } })).status === 'WON',
  );
}

/**
 * B. Next cycle from queued pre-bids: partial attach-auth failures expire,
 * survivors open a new OPEN cycle with the winner brand persisting.
 */
async function scenarioB(): Promise<void> {
  console.log('B. queued pre-bids: partial attach-auth failure, survivors open next cycle');
  const plotId = await makePlot('proof-2-3-b');
  const cycleId = await openCycle(plotId, new Date(Date.now() - 60_000));
  const alpha = await makeBidder('B-alpha');
  const alphaPb = await addPreBid(cycleId, plotId, alpha, 'Alpha', 2000);
  // Queued (cycleId null) pre-bids for the NEXT cycle.
  const gamma = await makeBidder('B-gamma');
  const delta = await makeBidder('B-delta');
  const gammaPb = await addQueuedPreBid(plotId, gamma, 'Gamma', 3000);
  const deltaPb = await addQueuedPreBid(plotId, delta, 'Delta', 2500);
  injectAttachAuthFailure(deltaPb); // Delta fails auth at attach

  const sweep = await resolveEndedCycles();
  clearAttachAuthFailures();
  check('sweep resolved >= 1 cycle', sweep.resolved >= 1, JSON.stringify(sweep));

  const oldCycle = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
  check(
    'old cycle RESOLVED with winner Alpha',
    oldCycle.status === 'RESOLVED' && oldCycle.winnerPreBidId === alphaPb,
  );

  const plot = await getPlot(plotId);
  check(
    'plot LIVE again on a new OPEN cycle',
    plot.status === 'LIVE' && plot.currentCycleId != null && plot.currentCycleId !== cycleId,
    `status=${plot.status} cycle=${plot.currentCycleId}`,
  );

  const nextCycle = await prisma.auctionCycle.findUniqueOrThrow({
    where: { id: plot.currentCycleId! },
  });
  check(
    'next cycle OPEN, ended in the future',
    nextCycle.status === 'OPEN' && nextCycle.endAt.getTime() > Date.now(),
  );

  const deltaRow = await prisma.preBid.findUniqueOrThrow({ where: { id: deltaPb } });
  check(
    'Delta EXPIRED with lostReason "expired"',
    deltaRow.status === 'EXPIRED' && deltaRow.lostReason === 'expired',
    `status=${deltaRow.status} reason=${deltaRow.lostReason}`,
  );
  const gammaRow = await prisma.preBid.findUniqueOrThrow({ where: { id: gammaPb } });
  check(
    'Gamma still ACTIVE in next cycle',
    gammaRow.status === 'ACTIVE' && gammaRow.cycleId === nextCycle.id,
  );

  // Single surviving pre-bid -> opening price = MID floor (500).
  check(
    'next cycle opening price = floor 500 (single survivor)',
    nextCycle.currentPriceCents === CFG.floorCents,
    `price=${nextCycle.currentPriceCents}`,
  );
  check(
    'core Model A invariant: Alpha (paid winner of the OLD cycle) remains the tenant display; Gamma is only auction-leading the NEW cycle, not yet a tenant',
    plot.tenantCompanyName === 'Alpha' && plot.currentLeaderPreBidId === gammaPb,
    `tenant=${plot.tenantCompanyName} leaderPreBidId=${plot.currentLeaderPreBidId}`,
  );
}

/** C. ALL queued pre-bids fail attach auth: shell cycle cancelled, plot IDLE. */
async function scenarioC(): Promise<void> {
  console.log('C. all queued pre-bids fail attach auth: shell cycle cancelled, IDLE');
  const plotId = await makePlot('proof-2-3-c');
  const cycleId = await openCycle(plotId, new Date(Date.now() - 60_000));
  const alpha = await makeBidder('C-alpha');
  await addPreBid(cycleId, plotId, alpha, 'Alpha', 2000); // winner on old cycle
  const zeta = await makeBidder('C-zeta');
  const zetaPb = await addQueuedPreBid(plotId, zeta, 'Zeta', 3000);
  injectAttachAuthFailure(zetaPb);

  const sweep = await resolveEndedCycles();
  clearAttachAuthFailures();
  check('sweep resolved >= 1 cycle', sweep.resolved >= 1, JSON.stringify(sweep));

  const oldCycle = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
  check('old cycle RESOLVED', oldCycle.status === 'RESOLVED');

  const shell = await prisma.auctionCycle.findFirst({
    where: { plotId, id: { not: cycleId } },
  });
  check(
    'shell next cycle CANCELLED (not left OPEN)',
    shell?.status === 'CANCELLED',
    `status=${shell?.status ?? 'none'}`,
  );

  const plot = await getPlot(plotId);
  check(
    'plot IDLE, auction-progress pointer cleared, winner display KEPT (standing lease)',
    plot.status === 'IDLE' &&
      plot.currentCycleId === null &&
      plot.currentLeaderPreBidId === null &&
      plot.tenantCompanyName === 'Alpha',
    `status=${plot.status} leaderPreBidId=${plot.currentLeaderPreBidId} tenant=${plot.tenantCompanyName}`,
  );
  const zetaRow = await prisma.preBid.findUniqueOrThrow({ where: { id: zetaPb } });
  check('Zeta EXPIRED', zetaRow.status === 'EXPIRED' && zetaRow.lostReason === 'expired');
}

/**
 * D. All captures fail: no winner, IDLE, auction-progress pointer cleared —
 * but (Part 1 lifecycle fix) a standing tenant from a PRIOR settled lease
 * must never be evicted by a failed/empty auction on the NEXT lease.
 */
async function scenarioD(): Promise<void> {
  console.log(
    'D. all captures fail: no winner, IDLE, standing tenant from a prior lease is NOT evicted',
  );
  const plotId = await makePlot('proof-2-3-d');
  // Simulate a tenant from an already-settled PRIOR lease — this scenario's
  // failing cycle is for the NEXT lease, and must not touch it.
  await prisma.plot.update({
    where: { id: plotId },
    data: {
      tenantPreBidId: 'proof-2-3-d-prior-tenant',
      tenantSince: new Date(Date.now() - 3600_000),
      tenantCompanyName: 'PriorCo',
      tenantTagline: 'already paid, already live',
      tenantTwitterHandle: 'priorco',
      tenantTargetUrl: 'https://priorco.example.com',
      tenantMrrText: '$9k MRR',
    },
  });
  const cycleId = await openCycle(plotId, new Date(Date.now() - 60_000));
  const alpha = await makeBidder('D-alpha');
  const beta = await makeBidder('D-beta');
  const alphaPb = await addPreBid(cycleId, plotId, alpha, 'Alpha', 2000);
  const betaPb = await addPreBid(cycleId, plotId, beta, 'Beta', 1500);
  injectCaptureFailure(alphaPb);
  injectCaptureFailure(betaPb);

  const sweep = await resolveEndedCycles();
  clearCaptureFailures();
  check('sweep resolved >= 1 cycle', sweep.resolved >= 1, JSON.stringify(sweep));

  const cycle = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
  check(
    'cycle RESOLVED with no winner and no clearing price',
    cycle.status === 'RESOLVED' &&
      cycle.winnerPreBidId === null &&
      cycle.clearingPriceCents === null,
    `status=${cycle.status} winner=${cycle.winnerPreBidId} price=${cycle.clearingPriceCents}`,
  );
  const plot = await getPlot(plotId);
  check(
    'plot IDLE, auction-progress pointer cleared, but standing tenant PriorCo is NOT evicted by the failed auction',
    plot.status === 'IDLE' &&
      plot.currentLeaderPreBidId === null &&
      plot.tenantCompanyName === 'PriorCo',
    `status=${plot.status} tenant=${plot.tenantCompanyName}`,
  );
  const rows = await prisma.preBid.findMany({ where: { cycleId } });
  check(
    'both candidates LOST capture_failed',
    rows.every((r) => r.status === 'LOST' && r.lostReason === 'capture_failed'),
    rows.map((r) => `${r.companyName}:${r.status}:${r.lostReason}`).join(', '),
  );
}

/** E. Race arbiter: N concurrent sweeps -> exactly one resolution. */
async function scenarioE(): Promise<void> {
  console.log('E. idempotence: 5 concurrent sweeps resolve exactly once');
  const plotId = await makePlot('proof-2-3-e');
  const cycleId = await openCycle(plotId, new Date(Date.now() - 60_000));
  const alpha = await makeBidder('E-alpha');
  const beta = await makeBidder('E-beta');
  await addPreBid(cycleId, plotId, alpha, 'Alpha', 2000);
  await addPreBid(cycleId, plotId, beta, 'Beta', 1500);

  const sweeps = await Promise.all(Array.from({ length: 5 }, () => resolveEndedCycles()));
  const totalResolved = sweeps.reduce((s, r) => s + r.resolved, 0);
  check('exactly one sweep reports the resolution', totalResolved === 1, `total=${totalResolved}`);

  const cycle = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
  check('cycle RESOLVED exactly once', cycle.status === 'RESOLVED');
  check('winner recorded once', cycle.winnerPreBidId != null && cycle.clearingPriceCents === 1600);

  // No duplicated settlement side effects.
  const alphaRow = await prisma.preBid.findFirstOrThrow({
    where: { cycleId, companyName: 'Alpha' },
  });
  check('Alpha WON', alphaRow.status === 'WON');
  const ledgerTicks = await prisma.bid.count({ where: { cycleId } });
  check('ledger ticks sane (>= 1)', ledgerTicks >= 1, `ticks=${ledgerTicks}`);
}

/** F. Stuck RESOLVING recovery back to OPEN. */
async function scenarioF(): Promise<void> {
  console.log('F. stuck RESOLVING recovery');
  const plotId = await makePlot('proof-2-3-f');
  const cycleId = await openCycle(plotId, new Date(Date.now() - 60_000));
  await prisma.auctionCycle.update({
    where: { id: cycleId },
    data: {
      status: 'RESOLVING',
      // Backdate updatedAt beyond the timeout so recovery picks it up.
      updatedAt: new Date(Date.now() - (RESOLVING_TIMEOUT_MINUTES + 5) * 60_000),
    },
  });

  const sweep = await resolveEndedCycles();
  // Recovery and re-resolution happen in the SAME sweep: recoverStuckResolving
  // flips the stuck cycle back to OPEN, then the ended-cycle scan picks it up
  // and resolves it (F has no pre-bids -> winnerless resolution).
  check('recovered >= 1 stuck cycle', sweep.recovered >= 1, JSON.stringify(sweep));
  const cycle = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
  check('stuck cycle recovered and resolved in one sweep', cycle.status === 'RESOLVED');
  check(
    'winnerless resolution recorded',
    cycle.winnerPreBidId === null && cycle.clearingPriceCents === null,
  );
  const plot = await getPlot(plotId);
  check(
    'recovered cycle leaves plot IDLE, no tenant (none existed before)',
    plot.status === 'IDLE' && plot.currentCycleId === null && plot.tenantCompanyName === null,
    `status=${plot.status} tenant=${plot.tenantCompanyName}`,
  );
}

/** G. Late-bid survival: an extended cycle is never settled by a stale sweep. */
async function scenarioG(): Promise<void> {
  console.log('G. worker-endat-race: extended cycles survive the sweep');

  // G1: extension lands BEFORE the worker claim -> claim predicate rejects.
  {
    const plotId = await makePlot('proof-2-3-g1');
    const originalEndAt = new Date(Date.now() - 30_000); // expired
    const cycleId = await openCycle(plotId, originalEndAt);
    await prisma.plot.update({
      where: { id: plotId },
      data: { status: 'LIVE', currentCycleId: cycleId },
    });
    const bidder = await makeBidder('G1-alpha');
    const pbId = await addPreBid(cycleId, plotId, bidder, 'Alpha', 2000);

    // Sweep read (captured timestamp): the cycle looks eligible...
    const sweepNow = new Date();
    const eligible = await prisma.auctionCycle.findMany({
      where: { status: 'OPEN', endAt: { lte: sweepNow } },
      select: { id: true },
    });
    check(
      'G1 sweep read sees the expired cycle',
      eligible.some((c) => c.id === cycleId),
    );

    // ...but a late bid received inside the soft-close window extends it
    // first (same engine call the bid route makes, under the plot lock).
    const receivedAt = new Date(originalEndAt.getTime() - 10_000);
    const extendedEndAt = await prisma.$transaction(async (tx) => {
      await lockPlot(tx, plotId);
      const cycle = await tx.auctionCycle.findFirstOrThrow({ where: { id: cycleId } });
      const softClose = await applySoftClose(tx, cycle, receivedAt);
      check('G1 late bid extends the window', softClose.extended === true);
      return softClose.newEndAt;
    });
    check(
      'G1 extension moves endAt past the sweep timestamp',
      extendedEndAt.getTime() > sweepNow.getTime(),
    );

    // Worker claim with the STALE sweep timestamp must refuse the cycle.
    const outcome = await resolveOneCycle(cycleId, sweepNow);
    check('G1 worker declines the extended cycle', outcome === null);

    const cycle = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
    check('G1 cycle still OPEN', cycle.status === 'OPEN');
    check(
      'G1 extended endAt preserved (not settled, not truncated)',
      cycle.endAt.getTime() === extendedEndAt.getTime(),
      `endAt=${cycle.endAt.toISOString()}`,
    );
    check(
      'G1 no settlement recorded',
      cycle.winnerPreBidId === null && cycle.clearingPriceCents === null,
    );
    const pb = await prisma.preBid.findUniqueOrThrow({ where: { id: pbId } });
    check('G1 candidate still ACTIVE', pb.status === 'ACTIVE');
    const ticks = await prisma.bid.count({ where: { cycleId } });
    check('G1 no ledger ticks written', ticks === 0, `ticks=${ticks}`);
    const plot = await getPlot(plotId);
    check(
      'G1 plot still LIVE on the same cycle',
      plot.status === 'LIVE' && plot.currentCycleId === cycleId,
    );
  }

  // G2: extension lands AFTER the claim but BEFORE the worker's main tx
  // takes the plot lock -> under-lock recheck reopens without settlement.
  {
    const plotId = await makePlot('proof-2-3-g2');
    const cycleId = await openCycle(plotId, new Date(Date.now() - 30_000)); // expired
    await prisma.plot.update({
      where: { id: plotId },
      data: { status: 'LIVE', currentCycleId: cycleId },
    });
    const bidder = await makeBidder('G2-alpha');
    const pbId = await addPreBid(cycleId, plotId, bidder, 'Alpha', 2000);
    const sweepNow = new Date();

    // Hold the plot lock so the worker's main tx blocks right after its
    // (lock-free) claim commits — the exact claim-then-extend interleaving.
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await lockPlot(tx, plotId);
        await gate;
      },
      { timeout: 15_000 },
    );

    const workerPromise = resolveOneCycle(cycleId, sweepNow);

    // Wait for the claim to land (poll, bounded).
    let claimed = false;
    for (let i = 0; i < 200; i++) {
      const row = await prisma.auctionCycle.findUniqueOrThrow({
        where: { id: cycleId },
        select: { status: true },
      });
      if (row.status === 'RESOLVING') {
        claimed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    check('G2 claim landed while the lock was held', claimed);

    // The late bid's extension commits while the worker is queued on the lock.
    const extendedEndAt = new Date(sweepNow.getTime() + 3 * 60_000);
    await prisma.auctionCycle.update({ where: { id: cycleId }, data: { endAt: extendedEndAt } });

    release();
    await holder;
    const outcome = await workerPromise;
    check('G2 worker reopens instead of settling', outcome === null);

    const cycle = await prisma.auctionCycle.findUniqueOrThrow({ where: { id: cycleId } });
    check('G2 cycle back to OPEN', cycle.status === 'OPEN');
    check(
      'G2 extended endAt preserved',
      cycle.endAt.getTime() === extendedEndAt.getTime(),
      `endAt=${cycle.endAt.toISOString()}`,
    );
    check(
      'G2 no settlement recorded',
      cycle.winnerPreBidId === null && cycle.clearingPriceCents === null,
    );
    const pb = await prisma.preBid.findUniqueOrThrow({ where: { id: pbId } });
    check('G2 candidate still ACTIVE', pb.status === 'ACTIVE');
    const ticks = await prisma.bid.count({ where: { cycleId } });
    check('G2 no ledger ticks written', ticks === 0, `ticks=${ticks}`);
  }
}

async function cleanupProofPlots(): Promise<void> {
  // Synthetic plots live at origin (0,0), which would overlap the real grid
  // if left behind — hard-delete every proof plot and its descendants.
  const ids = await prisma.plot.findMany({
    where: { id: { startsWith: 'proof-2-3-' } },
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
  console.log('== Phase 2.3 resolve-worker proof ==');
  await scenarioA();
  await scenarioB();
  await scenarioC();
  await scenarioD();
  await scenarioE();
  await scenarioF();
  await scenarioG();
  await cleanupProofPlots();
  console.log(
    failures === 0 ? '\nPASS: all 2.3 proof scenarios passed' : `\nFAILED: ${failures} check(s)`,
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
