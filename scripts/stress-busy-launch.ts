/**
 * Busy-launch stress fixture — phase 1.5 measurement, NOT a seed.
 * Re-runnable: flips N plots to LIVE with open cycles + staggered endAt,
 * mints a stress bidder + 3 ACTIVE PreBids that lead 3 of those cycles
 * (simulates the 3-owned-plots overlay budget: beacons + aura rings + Html badges).
 *
 * Usage: npx tsx scripts/stress-busy-launch.ts
 * Reset: npx tsx prisma/seed.ts (back to 49 × IDLE)
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: ['error'],
});

const STRESS_BIDDER_ID = 'stress-bidder-00000000-0000-4000-8000-000000000001';
const LIVE_COUNT = 10; // 1 CORE + 2 MID + 7 OUTER spread across the hill

const floorFor: Record<string, number> = { CORE: 99000, MID: 24900, OUTER: 4900 };
const incrementFor: Record<string, number> = { CORE: 5000, MID: 2500, OUTER: 1000 };

function pickPlots(all: { id: string; tier: string; status: string }[]) {
  const byTier = (t: string) => all.filter((p) => p.tier === t);
  return [
    byTier('CORE')[0],
    ...byTier('MID').slice(0, 2),
    ...byTier('OUTER').slice(0, LIVE_COUNT - 3),
  ];
}

const now = Date.now();

async function main() {
  const plots = await prisma.plot.findMany({
    select: { id: true, tier: true, status: true },
  });
  const chosen = pickPlots(plots);

  // 3 of the LIVE plots get an ACTIVE PreBid from the stress bidder that
  // currently leads → client derives "owned" → beacons + auras + Html badges.
  let owned = 0;
  for (const plot of chosen) {
    const endAt = new Date(now + (5 + Math.floor(Math.random() * 180)) * 60_000);
    const currentPrice = floorFor[plot.tier];

    const cycle = await prisma.auctionCycle.create({
      data: {
        plotId: plot.id,
        status: 'OPEN',
        floorPriceCents: currentPrice,
        incrementCents: incrementFor[plot.tier],
        durationMinutes: 180,
        endAt,
        currentPriceCents: currentPrice,
      },
    });

    const stressLeads = owned < 3;
    let leaderPreBidId: string | null = null;
    if (stressLeads) {
      const pb = await prisma.preBid.create({
        data: {
          cycleId: cycle.id,
          plotId: plot.id,
          bidderId: STRESS_BIDDER_ID,
          maxBidCents: currentPrice * 3,
          status: 'ACTIVE',
          companyName: 'StressCo',
          targetUrl: 'https://stress.example.com',
          twitterHandle: 'stressco',
        },
      });
      leaderPreBidId = pb.id;
      owned += 1;
    }

    await prisma.plot.update({
      where: { id: plot.id },
      data: {
        status: 'LIVE',
        currentCycleId: cycle.id,
        currentLeaderPreBidId: leaderPreBidId,
      },
    });
  }

  // Clean up stale stress prebids from prior runs so /api/me/bids stays coherent.
  const keepIds = new Set(chosen.map((c) => c.id));
  await prisma.preBid.updateMany({
    where: { bidderId: STRESS_BIDDER_ID, status: 'ACTIVE', plotId: { notIn: [...keepIds] } },
    data: { status: 'EXPIRED', lostReason: 'expired' },
  });

  const counts = await prisma.plot.groupBy({ by: ['status'], _count: true });
  console.log('plot status:', counts.map((c) => `${c.status}=${c._count}`).join(' '));
  console.log(`stress bidder owns ${owned} leading prebids (${STRESS_BIDDER_ID})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
