import { NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { serializePlot } from "@/server/serializers";

export const dynamic = "force-dynamic";

// Tier order then id — deterministic ordering for the grid renderer.
const TIER_ORDER = { CORE: 0, MID: 1, OUTER: 2 } as const;

export async function GET() {
  const plots = await prisma.plot.findMany({
    include: { currentCycle: true },
  });

  plots.sort((a, b) => {
    const t = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });

  return NextResponse.json(
    { plots: plots.map(serializePlot) },
    { headers: { "Cache-Control": "s-maxage=5, stale-while-revalidate" } },
  );
}