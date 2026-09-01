import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { generateInitialGrid } from '../src/lib/grid';
import { checkGridIntegrity } from '../src/lib/grid-integrity';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const grid = generateInitialGrid();
  const integrity = checkGridIntegrity(grid);
  if (!integrity.ok) {
    console.error('GRID INTEGRITY CHECK FAILED - aborting seed:');
    for (const e of integrity.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `Integrity OK: ${integrity.plotCount} plots, ${integrity.coveredCells}/100 cells, ${integrity.overlaps} overlaps`,
  );

  for (const p of grid) {
    await prisma.plot.upsert({
      where: { id: p.id },
      update: {
        tier: p.tier,
        originX: p.originX,
        originY: p.originY,
        spanX: p.spanX,
        spanY: p.spanY,
      },
      create: {
        id: p.id,
        tier: p.tier,
        originX: p.originX,
        originY: p.originY,
        spanX: p.spanX,
        spanY: p.spanY,
        status: 'IDLE',
      },
    });
  }
  console.log(`Seeded ${grid.length} plots (all IDLE).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
