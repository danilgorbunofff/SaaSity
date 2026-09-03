/**
 * Part 3 (idle-prebid-squatting) verification proof — the pre-bid route's
 * per-state behavior over real HTTP against a running server (prod build,
 * like scripts/e2e-full-loop.ts). Prisma is used only for setup and for
 * inspecting the private queued rows the public API does not expose.
 *
 *   unknown plot -> 404, no row
 *   IDLE plot    -> 409 code=claim-first, no row queued
 *   RESOLVING cycle (LIVE plot, handover) -> 200 queued for the next cycle
 *   stale cycle (LIVE plot, no OPEN cycle) -> 200 queued
 *   LIVE + OPEN -> 200 queued; repeat at same max -> 409 not-higher
 *   claim-first -> claim over HTTP succeeds -> pre-bid queues (directed
 *     action works end to end)
 *
 * Usage: npx tsx scripts/prebid-states-proof.ts [baseUrl]
 *        (default http://127.0.0.1:3457 — a `next build && next start`
 *         server; no MOCK_PAYMENTS needed, nothing here settles money)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { TIERS } from '../src/lib/tiers';

const BASE = (process.argv[2] ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3457').replace(
  /\/$/,
  '',
);

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

/* Minimal cookie jar: one jar = one browser/bidder. */
class Jar {
  private cookies: string[] = [];

  async post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookies.length > 0 ? { Cookie: this.cookies.join('; ') } : {}),
      },
      body: JSON.stringify(body),
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) this.cookies.push(sc.split(';')[0]);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  }
}

const STAMP = Date.now().toString(36).slice(-5);

function brand(label: string): Record<string, unknown> {
  const slug = `${label}${STAMP}`.toLowerCase();
  return {
    companyName: `State ${label} ${STAMP}`,
    tagline: `${label} tagline`,
    targetUrl: `https://${slug}.example.com`,
    twitterHandle: `st${slug}`.slice(0, 15),
    mrrText: '$1k MRR',
  };
}

async function makePlot(plotId: string, status: 'IDLE' | 'LIVE'): Promise<void> {
  await prisma.preBid.deleteMany({ where: { plotId } });
  await prisma.bid.deleteMany({ where: { plotId } });
  await prisma.auctionCycle.deleteMany({ where: { plotId } });
  await prisma.plot.upsert({
    where: { id: plotId },
    update: {
      status,
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
      status,
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
  await prisma.plot.update({ where: { id: plotId }, data: { currentCycleId: cycle.id } });
  return cycle.id;
}

async function queuedCount(plotId: string): Promise<number> {
  return prisma.preBid.count({ where: { plotId, cycleId: null, status: 'ACTIVE' } });
}

async function main(): Promise<void> {
  console.log(`== idle-prebid-squatting proof (server ${BASE}) ==`);

  // Unknown plot -> 404.
  {
    const jar = new Jar();
    const res = await jar.post('/api/plots/no-such-plot-xyz/prebid', {
      plotId: 'no-such-plot-xyz',
      ...brand('U'),
      maxBidCents: 1000,
    });
    check('unknown plot -> 404', res.status === 404, `status=${res.status}`);
  }

  // IDLE plot -> 409 claim-first, nothing queued.
  const idlePlot = 'proof-prebid-idle';
  await makePlot(idlePlot, 'IDLE');
  {
    const jar = new Jar();
    const res = await jar.post(`/api/plots/${idlePlot}/prebid`, {
      plotId: idlePlot,
      ...brand('I'),
      maxBidCents: 1000,
    });
    check('IDLE plot -> 409', res.status === 409, `status=${res.status}`);
    check('IDLE conflict code is claim-first', res.json.code === 'claim-first', JSON.stringify(res.json));
    check('IDLE conflict names the plot', res.json.plotId === idlePlot);
    check('IDLE queues nothing', (await queuedCount(idlePlot)) === 0);
  }

  // RESOLVING handover (LIVE plot) -> still accepted as a next-cycle queue.
  const resolvingPlot = 'proof-prebid-resolving';
  await makePlot(resolvingPlot, 'LIVE');
  {
    const cycleId = await openCycle(resolvingPlot);
    await prisma.auctionCycle.update({ where: { id: cycleId }, data: { status: 'RESOLVING' } });
    const jar = new Jar();
    const res = await jar.post(`/api/plots/${resolvingPlot}/prebid`, {
      plotId: resolvingPlot,
      ...brand('R'),
      maxBidCents: 1000,
    });
    check('RESOLVING handover -> 200', res.status === 200, `status=${res.status} ${JSON.stringify(res.json)}`);
    check('handover response flags next-cycle queue', res.json.queuedForNextCycle === true);
    const row = await prisma.preBid.findFirstOrThrow({ where: { plotId: resolvingPlot } });
    check('handover row queued with cycleId null', row.cycleId === null && row.status === 'ACTIVE');
  }

  // Stale cycle (LIVE plot, no OPEN cycle) -> accepted as a next-cycle queue.
  const stalePlot = 'proof-prebid-stale';
  await makePlot(stalePlot, 'LIVE');
  {
    const jar = new Jar();
    const res = await jar.post(`/api/plots/${stalePlot}/prebid`, {
      plotId: stalePlot,
      ...brand('S'),
      maxBidCents: 1000,
    });
    check('stale-cycle LIVE plot -> 200', res.status === 200, `status=${res.status}`);
    check('stale-cycle row queued', (await queuedCount(stalePlot)) === 1);
  }

  // LIVE + OPEN -> 200; same-max repeat -> 409 not-higher (guard intact).
  const livePlot = 'proof-prebid-live';
  await makePlot(livePlot, 'LIVE');
  {
    await openCycle(livePlot);
    const jar = new Jar();
    const body = { plotId: livePlot, ...brand('L'), maxBidCents: 1000 };
    const first = await jar.post(`/api/plots/${livePlot}/prebid`, body);
    check('LIVE + OPEN -> 200', first.status === 200, `status=${first.status}`);
    check('LIVE response carries plotStatus LIVE', first.json.plotStatus === 'LIVE');
    const second = await jar.post(`/api/plots/${livePlot}/prebid`, body);
    check('same-max repeat -> 409', second.status === 409, `status=${second.status}`);
    check('repeat code is not-higher', second.json.code === 'not-higher', JSON.stringify(second.json));
  }

  // The directed action works: claim-first -> claim over HTTP -> pre-bid queues.
  {
    const jar = new Jar();
    const claim = await jar.post(`/api/plots/${idlePlot}/claim`, {
      plotId: idlePlot,
      ...brand('C'),
      maxBidCents: CFG.floorCents,
    });
    check('claim after claim-first succeeds', claim.status === 200, `status=${claim.status} ${JSON.stringify(claim.json)}`);
    const retry = await jar.post(`/api/plots/${idlePlot}/prebid`, {
      plotId: idlePlot,
      ...brand('C2'),
      maxBidCents: 1000,
    });
    check('pre-bid queues once LIVE', retry.status === 200, `status=${retry.status}`);
  }

  // Cleanup synthetic plots.
  for (const id of [idlePlot, resolvingPlot, stalePlot, livePlot]) {
    await prisma.preBid.deleteMany({ where: { plotId: id } });
    await prisma.bid.deleteMany({ where: { plotId: id } });
    await prisma.auctionCycle.deleteMany({ where: { plotId: id } });
    await prisma.plot.delete({ where: { id } });
  }
  console.log('\ncleaned up 4 proof plot(s)');

  console.log(failures === 0 ? '\nPASS: pre-bid states behave per state' : `\nFAILED: ${failures} check(s)`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
