/**
 * Phase 2.2 verification proof #3 — soft-close behavior.
 * A) A bid landing OUTSIDE the final window does NOT extend endAt.
 * B) A bid landing INSIDE the final window pushes endAt to receivedAt+3min.
 * C) Total extensions never exceed originalEnd + 120min (exact cap edge).
 * C2) Sub-minute pushes spend actual milliseconds, not minute units.
 * E) Extension attribution: exactly one ledger row per extension
 *    (challenger tick, unmarked proxy pass, orphan capped-raise tick).
 * F) Rapid bids, exact window boundaries, same-timestamp double-call, and
 *    post-end receipts.
 *
 * Runs directly against the engine helpers (no HTTP) with a disposable
 * throwaway plot row so the shared dev grid stays untouched.
 *
 * Usage: npx tsx scripts/soft-close-proof.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  lockPlot,
  applySoftClose,
  resolveCycle,
  upsertPreBid,
  type Tx,
} from '../src/server/auction/engine';

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

  // ---------- C) cap: total extensions never exceed +120min past the ORIGINAL end ----------
  {
    // A heavily-extended cycle: original end is now+10min, endAt already sits
    // at original+119min. Next in-window bid gets a truncated +1min grant to
    // exactly original+120min; anything after is refused.
    const now0 = Date.now();
    const startedAt = new Date(now0 - 350 * 60_000);
    const durationMinutes = 360;
    const originalEndMs = startedAt.getTime() + durationMinutes * 60_000; // now0+10min
    const t = await prisma.$transaction(async (tx) => {
      await lockPlot(tx, PROOF_PLOT_ID);
      const cycle = await tx.auctionCycle.create({
        data: {
          plotId: PROOF_PLOT_ID,
          status: 'OPEN',
          floorPriceCents: 100,
          incrementCents: 50,
          durationMinutes,
          startedAt,
          endAt: new Date(originalEndMs + 119 * 60_000),
          softCloseExtensions: 41, // event count is audit-only; budget comes from endAt math
        },
      });
      const first = await applySoftClose(tx, cycle, new Date(cycle.endAt.getTime() - 30_000));
      const reloaded = await tx.auctionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      const second = await applySoftClose(
        tx,
        reloaded,
        new Date(reloaded.endAt.getTime() - 30_000),
      );
      const final = await tx.auctionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      return { first, second, final };
    });
    const capMs = originalEndMs + 120 * 60_000;
    if (!t.first.extended) fail('C: expected a truncated final grant at the cap edge');
    else if (t.first.newEndAt.getTime() !== capMs)
      fail(`C: grant must land exactly on original+120min, got ${t.first.newEndAt.toISOString()}`);
    else if (t.second.extended) fail('C: extended beyond the cap');
    else if (t.final.endAt.getTime() !== capMs) fail('C: final endAt moved past the cap');
    else console.log('C PASS: extensions capped at exactly originalEnd + 120min');
  }

  // ---------- C2) small pushes spend actual milliseconds, not minute units ----------
  {
    const now0 = Date.now();
    const t = await prisma.$transaction(async (tx) => {
      await lockPlot(tx, PROOF_PLOT_ID);
      const cycle = await tx.auctionCycle.create({
        data: {
          plotId: PROOF_PLOT_ID,
          status: 'OPEN',
          floorPriceCents: 100,
          incrementCents: 50,
          durationMinutes: 60,
          startedAt: new Date(now0),
          endAt: new Date(now0 + 60 * 60_000),
          softCloseExtensions: 0,
        },
      });
      // 10s before end: reset grants receivedAt+3min = endAt+170s exactly.
      const r = await applySoftClose(tx, cycle, new Date(now0 + 60 * 60_000 - 10_000));
      const reloaded = await tx.auctionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      return { r, extensions: reloaded.softCloseExtensions };
    });
    if (!t.r.extended) fail('C2: expected extension 10s before end');
    else if (t.r.newEndAt.getTime() - (now0 + 60 * 60_000) !== 170_000)
      fail(
        `C2: push must be exactly +170s, got ${t.r.newEndAt.getTime() - (now0 + 60 * 60_000)}ms`,
      );
    else if (t.extensions !== 1) fail(`C2: event counter must increment by 1, got ${t.extensions}`);
    else console.log('C2 PASS: sub-minute push accounted to the millisecond');
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

  // ---------- E) extension attribution: exactly one ledger row per extension ----------
  {
    const brandA = { companyName: 'A', targetUrl: 'https://a.test', twitterHandle: 'a' };
    const brandB = { companyName: 'B', targetUrl: 'https://b.test', twitterHandle: 'b' };

    // E1: in-window challenger bid -> exactly one marked tick, naming the challenger.
    {
      const r = await prisma.$transaction(async (tx) => {
        await lockPlot(tx, PROOF_PLOT_ID);
        const cycle = await tx.auctionCycle.create({
          data: {
            plotId: PROOF_PLOT_ID,
            status: 'OPEN',
            floorPriceCents: 100,
            incrementCents: 50,
            durationMinutes: 360,
            endAt: new Date(Date.now() + 60 * 60_000),
            softCloseExtensions: 0,
          },
        });
        await upsertPreBid(tx, {
          plotId: PROOF_PLOT_ID,
          cycleId: cycle.id,
          bidderId: 'proof-bidder-a',
          maxBidCents: 1000,
          brand: brandA,
        });
        const challengerId = await upsertPreBid(tx, {
          plotId: PROOF_PLOT_ID,
          cycleId: cycle.id,
          bidderId: 'proof-bidder-b',
          maxBidCents: 2000,
          brand: brandB,
        });
        const softClose = await applySoftClose(tx, cycle, new Date(Date.now() + 59 * 60_000));
        const resolution = await resolveCycle(tx, cycle, {
          humanSubmitCents: 2000,
          triggeredExtension: softClose.extended
            ? { preBidId: challengerId, bidderId: 'proof-bidder-b' }
            : undefined,
        });
        const ticks = await tx.bid.findMany({ where: { cycleId: cycle.id } });
        return { softClose, resolution, ticks };
      });
      const marked = r.ticks.filter((t) => t.triggeredExtension);
      if (!r.softClose.extended) fail('E1: expected the in-window bid to extend');
      else if (marked.length !== 1)
        fail(`E1: expected exactly 1 marked tick, got ${marked.length}`);
      else if (marked[0].bidderId !== 'proof-bidder-b')
        fail(`E1: marked tick names ${marked[0].bidderId}, expected the challenger`);
      else console.log('E1 PASS: in-window extension attributed to the challenger tick');
    }

    // E2: out-of-window bid (proxy shape, no trigger) -> zero marked ticks.
    {
      const r = await prisma.$transaction(async (tx) => {
        await lockPlot(tx, PROOF_PLOT_ID);
        const cycle = await tx.auctionCycle.create({
          data: {
            plotId: PROOF_PLOT_ID,
            status: 'OPEN',
            floorPriceCents: 100,
            incrementCents: 50,
            durationMinutes: 360,
            endAt: new Date(Date.now() + 60 * 60_000),
            softCloseExtensions: 0,
          },
        });
        await upsertPreBid(tx, {
          plotId: PROOF_PLOT_ID,
          cycleId: cycle.id,
          bidderId: 'proof-bidder-a',
          maxBidCents: 1000,
          brand: brandA,
        });
        const softClose = await applySoftClose(tx, cycle, new Date());
        await resolveCycle(tx, cycle);
        const ticks = await tx.bid.findMany({ where: { cycleId: cycle.id } });
        return { softClose, ticks };
      });
      const marked = r.ticks.filter((t) => t.triggeredExtension);
      if (r.softClose.extended) fail('E2: out-of-window bid must not extend');
      else if (marked.length !== 0) fail(`E2: expected 0 marked ticks, got ${marked.length}`);
      else console.log('E2 PASS: non-extending pass leaves every tick unmarked');
    }

    // E3: leader raise capped below the standing price, in-window -> the
    // orphan branch writes the requester's own marked tick at the price.
    {
      const r = await prisma.$transaction(async (tx) => {
        await lockPlot(tx, PROOF_PLOT_ID);
        const cycle = await tx.auctionCycle.create({
          data: {
            plotId: PROOF_PLOT_ID,
            status: 'OPEN',
            floorPriceCents: 100,
            incrementCents: 50,
            durationMinutes: 360,
            endAt: new Date(Date.now() + 60 * 60_000),
            softCloseExtensions: 0,
          },
        });
        const leaderId = await upsertPreBid(tx, {
          plotId: PROOF_PLOT_ID,
          cycleId: cycle.id,
          bidderId: 'proof-bidder-a',
          maxBidCents: 1000,
          brand: brandA,
        });
        await upsertPreBid(tx, {
          plotId: PROOF_PLOT_ID,
          cycleId: cycle.id,
          bidderId: 'proof-bidder-b',
          maxBidCents: 700,
          brand: brandB,
        });
        await resolveCycle(tx, cycle); // price 750, tick names the leader
        await upsertPreBid(tx, {
          plotId: PROOF_PLOT_ID,
          cycleId: cycle.id,
          bidderId: 'proof-bidder-a',
          maxBidCents: 1200, // capped: min(1200, 700+50) = 750, nothing moves
          brand: brandA,
        });
        const reloaded = await tx.auctionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
        const softClose = await applySoftClose(tx, reloaded, new Date(Date.now() + 59 * 60_000));
        await resolveCycle(tx, reloaded, {
          humanSubmitCents: 1200,
          triggeredExtension: softClose.extended
            ? { preBidId: leaderId, bidderId: 'proof-bidder-a' }
            : undefined,
        });
        const ticks = await tx.bid.findMany({ where: { cycleId: cycle.id } });
        return { softClose, ticks };
      });
      const marked = r.ticks.filter((t) => t.triggeredExtension);
      if (!r.softClose.extended) fail('E3: expected the in-window raise to extend');
      else if (marked.length !== 1)
        fail(`E3: expected exactly 1 marked tick, got ${marked.length}`);
      else if (
        marked[0].bidderId !== 'proof-bidder-a' ||
        marked[0].amountCents !== 750 ||
        marked[0].isProxy
      )
        fail(
          `E3: orphan tick must name the requester at 750 as a human tick, got ${marked[0].bidderId}/${marked[0].amountCents}/isProxy=${marked[0].isProxy}`,
        );
      else console.log('E3 PASS: capped raise still attributes its extension to one row');
    }
  }

  // ---------- F) rapid bids, exact boundaries, double-call, late processing ----------
  {
    const WINDOW = 3 * 60_000;

    // F1: five rapid sequential in-window bids — each extends (reset-based),
    // endAt strictly increases, total stays within the cap, counter = 5.
    {
      const now0 = Date.now();
      const r = await prisma.$transaction(async (tx) => {
        await lockPlot(tx, PROOF_PLOT_ID);
        const cycle = await tx.auctionCycle.create({
          data: {
            plotId: PROOF_PLOT_ID,
            status: 'OPEN',
            floorPriceCents: 100,
            incrementCents: 50,
            durationMinutes: 60,
            startedAt: new Date(now0),
            endAt: new Date(now0 + 60_000),
            softCloseExtensions: 0,
          },
        });
        let current = cycle;
        let allExtended = true;
        let strictlyIncreasing = true;
        for (let i = 0; i < 5; i++) {
          const out = await applySoftClose(tx, current, new Date(now0 + (i + 1) * 1000));
          allExtended &&= out.extended;
          strictlyIncreasing &&= out.newEndAt.getTime() > current.endAt.getTime();
          current = await tx.auctionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
        }
        return { allExtended, strictlyIncreasing, final: current };
      });
      const overCap = r.final.endAt.getTime() - (now0 + 60 * 60_000) > 120 * 60_000;
      if (!r.allExtended) fail('F1: every rapid in-window bid must extend');
      else if (!r.strictlyIncreasing) fail('F1: endAt must strictly increase');
      else if (overCap) fail('F1: rapid bids blew past the cap');
      else if (r.final.softCloseExtensions !== 5)
        fail(`F1: counter must be 5, got ${r.final.softCloseExtensions}`);
      else console.log('F1 PASS: rapid bids each extend once, cap respected');
    }

    // F2: exact window boundaries (1ms resolution).
    {
      const base = Date.now() + 3_600_000;
      const mk = (tx: Tx, endAtMs: number) =>
        tx.auctionCycle.create({
          data: {
            plotId: PROOF_PLOT_ID,
            status: 'OPEN',
            floorPriceCents: 100,
            incrementCents: 50,
            durationMinutes: 60,
            startedAt: new Date(base - 60 * 60_000),
            endAt: new Date(endAtMs),
            softCloseExtensions: 0,
          },
        });
      const r = await prisma.$transaction(async (tx) => {
        await lockPlot(tx, PROOF_PLOT_ID);
        const endAt = base;
        const justOutside = await applySoftClose(
          tx,
          await mk(tx, endAt),
          new Date(endAt - WINDOW - 1),
        );
        const edgeZeroPush = await applySoftClose(
          tx,
          await mk(tx, endAt),
          new Date(endAt - WINDOW),
        );
        const justInside = await applySoftClose(
          tx,
          await mk(tx, endAt),
          new Date(endAt - WINDOW + 50),
        );
        const atEnd = await applySoftClose(tx, await mk(tx, endAt), new Date(endAt));
        return { justOutside, edgeZeroPush, justInside, atEnd };
      });
      if (r.justOutside.extended) fail('F2: 1ms outside the window must not extend');
      else if (r.edgeZeroPush.extended)
        fail('F2: window-edge exact hit grants zero push and must report false');
      else if (!r.justInside.extended) fail('F2: 50ms inside the window must extend');
      else if (r.justInside.newEndAt.getTime() !== base + 50)
        fail('F2: inside grant must equal receivedAt+3min exactly');
      else if (r.atEnd.extended) fail('F2: bid at exactly endAt must not extend');
      else console.log('F2 PASS: window boundaries exact to the millisecond');
    }

    // F3: same receivedAt twice (one request wired twice) extends at most once.
    {
      const now0 = Date.now();
      const r = await prisma.$transaction(async (tx) => {
        await lockPlot(tx, PROOF_PLOT_ID);
        const cycle = await tx.auctionCycle.create({
          data: {
            plotId: PROOF_PLOT_ID,
            status: 'OPEN',
            floorPriceCents: 100,
            incrementCents: 50,
            durationMinutes: 60,
            startedAt: new Date(now0),
            endAt: new Date(now0 + 60_000),
            softCloseExtensions: 0,
          },
        });
        const receivedAt = new Date(now0 + 30_000);
        const first = await applySoftClose(tx, cycle, receivedAt);
        const reloaded = await tx.auctionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
        const second = await applySoftClose(tx, reloaded, receivedAt);
        return { first, second };
      });
      if (!r.first.extended) fail('F3: first call must extend');
      else if (r.second.extended)
        fail('F3: second call with the same timestamp must not extend again');
      else if (r.second.newEndAt.getTime() !== r.first.newEndAt.getTime())
        fail('F3: second call must leave endAt untouched');
      else console.log('F3 PASS: one request timestamp attributes at most one extension');
    }

    // F4: receivedAt past endAt (tx waited out the clock) grants nothing.
    {
      const now0 = Date.now();
      const r = await prisma.$transaction(async (tx) => {
        await lockPlot(tx, PROOF_PLOT_ID);
        const cycle = await tx.auctionCycle.create({
          data: {
            plotId: PROOF_PLOT_ID,
            status: 'OPEN',
            floorPriceCents: 100,
            incrementCents: 50,
            durationMinutes: 60,
            startedAt: new Date(now0),
            endAt: new Date(now0 + 60_000),
            softCloseExtensions: 0,
          },
        });
        return applySoftClose(tx, cycle, new Date(now0 + 60_500));
      });
      if (r.extended) fail('F4: post-end receipt must not extend');
      else console.log('F4 PASS: late-processed receipt grants no extension');
    }
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
