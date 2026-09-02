/**
 * Phase 2.1 MOCK submit endpoint — proves the modal round-trips against a
 * real server using the SHARED validateBidForm contract. Phase 2.2 replaces
 * this with the atomic claim/bid/proxy engine; nothing here touches the DB.
 *
 * Simulation hooks for exercising every UI state by name:
 *   companyName "OUTBIDSIM"  -> 409 { code: 'outbid' }
 *   companyName "ERRSIM"     -> 400 { error: verbatim message }
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateBidForm, type BidFormInput, type BidMode } from '@/lib/validation/bid-form';
import type { PlotTier } from '@/lib/tiers';

interface MockBody extends BidFormInput {
  mode?: BidMode;
  tier?: PlotTier;
  currentPriceCents?: number;
}

export async function POST(req: NextRequest) {
  let body: MockBody;
  try {
    body = (await req.json()) as MockBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const mode: BidMode = body.mode ?? 'claim';
  const tier: PlotTier = body.tier ?? 'OUTER';
  const r = validateBidForm(body, {
    mode,
    tier,
    currentPriceCents: body.currentPriceCents,
    selfHostnames: [req.nextUrl.hostname],
  });
  if (!r.ok) {
    return NextResponse.json({ fieldErrors: r.errors }, { status: 422 });
  }

  if (r.values.companyName.toUpperCase() === 'OUTBIDSIM') {
    return NextResponse.json(
      { code: 'outbid', message: 'A rival bid landed first — someone else now leads.' },
      { status: 409 },
    );
  }
  if (r.values.companyName.toUpperCase() === 'ERRSIM') {
    return NextResponse.json(
      { error: 'Mock engine refused the write (simulated server failure).' },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, mode, values: r.values });
}