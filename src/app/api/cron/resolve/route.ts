import { NextResponse } from 'next/server';
import { resolveEndedCycles } from '@/server/auction/worker';

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
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
