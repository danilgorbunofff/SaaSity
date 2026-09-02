/**
 * Phase 2.2 verification proof #3 — soft-close behavior.
 * A) A bid landing OUTSIDE the final window does NOT extend endAt.
 * B) A bid landing INSIDE the final window pushes endAt to receivedAt+3min.
 * C) Rapid-fire bids never push total extensions past the +120min cap.
 *
 * Runs directly against the engine helpers (no HTTP) with a disposable
 * throwaway plot row so the shared dev grid stays untouched.
 *
 * Usage: npx tsx scripts/soft-close-proof.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { lockPlot, applySoftClose, resolveCycle, upsertPreBid } from '../src/server/auction/engine';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: ['error'],
});

const PROOF_PLOT_ID = 'proof-soft-close-plot';

async function main() {
  // Disposable plot (deleted at the end) — not part of the 10x10 grid.
  await prisma.plot.upsert({
    where: { id: PROOF_PLOT_ID },
    update: {},
    create: {
      id: PROOF_PLOT_ID,
      tier: 'OUTER',
      originX: 0,
      originY: 0,
      spanX: 1,
      spanY: 1,
      status: 'IDLE',
    },
  });

  let failures = 0;
  const fail = (msg: string) => {
    failures += 1;
    console.error('FAIL:', msg);
  };

  // ---------- A) outside window: no extension ----------
  {
    const t = await prisma.$transaction(async (tx) => {
      await lockPlot(tx, PROOF_PLOT_ID);
      const cycle = await tx.auctionCycle.create({
        data: {
          plotId: PROOF_PLOT_ID,
          status: 'OPEN',
          floorPriceCents: 100,
          incrementCents: 50,
          durationMinutes: 360,
          endAt: new Date(Date.now() + 120 * 60_000), // 2h left >> 3min window
          softCloseExtensions: 0,
        },
      });
      const r = await applySoftClose(tx, cycle, new Date());
      return r;
    });
    if (t.extended) fail('A: endAt extended although bid was outside the window');
    else console.log('A PASS: no extension outside the window');
  }

  // ---------- B) inside window: push to receivedAt + 3min ----------
  {
    const receivedAt = new Date(Date.now() + 119 * 60_000); // 1min before end
    const endBefore = new Date(Date.now() + 120 * 60_000);
    const t = await prisma.$transaction(async (tx) => {
      await lockPlot(tx, PROOF_PLOT_ID);
      const cycle = await tx.auctionCycle.create({
        data: {
          plotId: PROOF_PLOT_ID,
          status: 'OPEN',
          floorPriceCents: 100,
          incrementCents: 50,
          durationMinutes: 360,
          endAt: endBefore,
          softCloseExtensions: 0,
        },
      });
      return applySoftClose(tx, cycle, receivedAt);
    });
    const expected = receivedAt.getTime() + 3 * 60_000;
    if (!t.extended) fail('B: no extension inside the window');
    else if (Math.abs(t.newEndAt.getTime() - expected) > 2_000)
      fail(`B: newEndAt ${t.newEndAt.toISOString()} != receivedAt+3min`);
    else console.log('B PASS: endAt pushed to receivedAt + 3min');
  }

  // ---------- C) cap: extensions never exceed +120min total ----------
  {
    const t = await prisma.$transaction(async (tx) => {
      await lockPlot(tx, PROOF_PLOT_ID);
      const cycle = await tx.auctionCycle.create({
        data: {
          plotId: PROOF_PLOT_ID,
          status: 'OPEN',
          floorPriceCents: 100,
          incrementCents: 50,
          durationMinutes: 360,
          endAt: new Date(Date.now() + 10 * 60_000),
          softCloseExtensions: 119, // budget left: 1min — last grantable window
        },
      });
      const first = await applySoftClose(tx, cycle, new Date(Date.now() + 9.5 * 60_000)); // 30s before end: inside window, +1min only
      const reloaded = await tx.auctionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      const second = await applySoftClose(tx, reloaded, new Date(Date.now() + 9.5 * 60_000)); // budget spent
      return { first, second, reloaded };
    });
    const totalExt = t.reloaded.softCloseExtensions;
    if (totalExt !== 120) fail(`C: expected exactly 120min extensions, got ${totalExt}`);
    else if (t.second.extended) fail('C: extended beyond the cap');
    else console.log('C PASS: extensions capped at +120min total');
  }

  // ---------- D) resolveCycle single implementation sanity on live data ----------
  {
    const price = await prisma.$transaction(async (tx) => {
      await lockPlot(tx, PROOF_PLOT_ID);
      const cycle = await tx.auctionCycle.create({
        data: {
          plotId: PROOF_PLOT_ID,
          status: 'OPEN',
          floorPriceCents: 100,
          incrementCents: 50,
          durationMinutes: 360,
          endAt: new Date(Date.now() + 60 * 60_000),
        },
      });
      const a = 'proof-bidder-a';
      const b = 'proof-bidder-b';
      await upsertPreBid(tx, {
        plotId: PROOF_PLOT_ID,
        cycleId: cycle.id,
        bidderId: a,
        maxBidCents: 1000,
        brand: { companyName: 'A', targetUrl: 'https://a.test', twitterHandle: 'a' },
      });
      await upsertPreBid(tx, {
        plotId: PROOF_PLOT_ID,
        cycleId: cycle.id,
        bidderId: b,
        maxBidCents: 700,
        brand: { companyName: 'B', targetUrl: 'https://b.test', twitterHandle: 'b' },
      });
      const resolution = await resolveCycle(tx, cycle);
      return resolution?.priceCents ?? -1;
    });
    if (price !== 750) fail(`D: expected 750, got ${price}`);
    else console.log('D PASS: resolveCycle applies second-price math transactionally');
  }

  // Cleanup disposable artifacts.
  await prisma.bid.deleteMany({ where: { plotId: PROOF_PLOT_ID } });
  await prisma.preBid.deleteMany({ where: { plotId: PROOF_PLOT_ID } });
  await prisma.auctionCycle.deleteMany({ where: { plotId: PROOF_PLOT_ID } });
  await prisma.plot.delete({ where: { id: PROOF_PLOT_ID } });

  if (failures > 0) process.exit(1);
  console.log('ALL SOFT-CLOSE PROOFS PASSED');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
