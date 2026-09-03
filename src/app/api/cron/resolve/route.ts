import { NextResponse } from 'next/server';
import { resolveEndedCycles } from '@/server/auction/worker';
import { pruneOutbox } from '@/server/realtime/outbox';

// Settlement trigger for the external schedulers (Part 3:
// cron-not-configured). Primary: .github/workflows/resolve-cron.yml every 5
// min. Safety net: vercel.json's daily cron (Hobby-plan ceiling). See
// docs/deployment.md §3 for granularity, latency, and alerting.
//
// External cron callers have no Origin header and no bidder cookie —
// bypass the shared guard helpers and authenticate with a shared secret.
export const dynamic = 'force-dynamic';

function authorize(req: Request): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  return req.headers.get('x-worker-secret') === secret;
}

async function handle(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const result = await resolveEndedCycles();
  // Part 4 outbox retention: prune rows older than the window. Fire-and-
  // forget — sweep correctness never depends on it, and a prune failure
  // must not fail the settlement response.
  void pruneOutbox().catch((err) => {
    console.error('[cron] outbox prune failed', err);
  });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
