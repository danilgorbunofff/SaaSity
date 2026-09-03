/**
 * Phase 2.5 E2E — the whole auction loop over real HTTP, no browser.
 *
 * Drives the milestone's acceptance walk against a running server:
 *   browse → claim an IDLE plot → other sessions see it go LIVE with a
 *   countdown → rivals bid (price updates live, no bidder brand leaked
 *   pre-payment) → a bid inside the soft-close window extends the
 *   countdown → mock-resolve → every viewer sees the new tenant → a queued
 *   pre-bid on the same plot opens the next cycle immediately, WITHOUT
 *   disturbing the still-paying tenant's public display → resolving that
 *   cycle leaves the plot IDLE with the new winner's brand as the standing
 *   display.
 *
 * It is deliberately NOT a unit test: three independent cookie jars (three
 * "browsers") plus three live SSE streams, so cross-session realtime is
 * asserted, not assumed. Prisma is used only to (a) reset the target plot to
 * a known IDLE state when the grid has none left and (b) inspect internal
 * rows (cycle status, queued pre-bid) the public API does not expose.
 *
 * Usage: npx tsx scripts/e2e-full-loop.ts [baseUrl]
 *        (default http://127.0.0.1:3457 — a `next build && next start` server
 *         with MOCK_PAYMENTS=1)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const BASE = (process.argv[2] ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3457').replace(
  /\/$/,
  '',
);
const STAMP = Date.now().toString(36).slice(-5);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(title: string): void {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
/* Session: one cookie jar = one browser                               */
/* ------------------------------------------------------------------ */

class Session {
  readonly cookies = new Map<string, string>();

  constructor(readonly name: string) {}

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(res: Response): void {
    const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
    if (!raw) return;
    for (const c of raw) {
      const pair = c.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async post<T = Record<string, unknown>>(
    path: string,
    body: unknown,
  ): Promise<{ status: number; json: T }> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: this.cookieHeader() },
      body: JSON.stringify(body),
    });
    this.absorb(res);
    const json = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, json };
  }

  async get<T = Record<string, unknown>>(path: string): Promise<{ status: number; json: T }> {
    const res = await fetch(`${BASE}${path}`, { headers: { Cookie: this.cookieHeader() } });
    this.absorb(res);
    const json = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, json };
  }
}

/* ------------------------------------------------------------------ */
/* SSE observer: one live stream = one watching browser                */
/* ------------------------------------------------------------------ */

interface Observed {
  type: string;
  data: Record<string, unknown>;
  at: number;
}

class Observer {
  readonly events: Observed[] = [];
  private readonly controller = new AbortController();

  private constructor(readonly name: string) {}

  static async open(name: string): Promise<Observer> {
    const o = new Observer(name);
    const res = await fetch(`${BASE}/api/events`, {
      headers: { Accept: 'text/event-stream' },
      signal: o.controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`SSE ${name} failed: ${res.status}`);
    void o.pump(res.body.getReader());
    // Wait for the snapshot frame so "connected" means "anchored".
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && o.events.length === 0 && !o.seenSnapshot) {
      await sleep(25);
    }
    return o;
  }

  private seenSnapshot = false;

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          idx = buf.indexOf('\n\n');
          const ev = /^event: (.*)$/m.exec(frame);
          const data = /^data: (.*)$/m.exec(frame);
          if (!ev) continue;
          const type = ev[1].trim();
          if (type === 'snapshot') {
            this.seenSnapshot = true;
            continue;
          }
          if (!data) continue;
          try {
            this.events.push({
              type,
              data: JSON.parse(data[1]) as Record<string, unknown>,
              at: Date.now(),
            });
          } catch {
            // ignore malformed
          }
        }
      }
    } catch {
      // aborted on close
    }
  }

  /** Waits for the first matching event; returns it plus arrival latency. */
  async waitFor(
    type: string,
    match: (data: Record<string, unknown>) => boolean,
    timeoutMs = 5000,
    since = 0,
  ): Promise<{ event: Observed; latencyMs: number } | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.events.find((e) => e.type === type && e.at >= since && match(e.data));
      if (hit) return { event: hit, latencyMs: hit.at - since };
      if (Date.now() > deadline) return null;
      await sleep(20);
    }
  }

  clear(): void {
    this.events.length = 0;
  }

  close(): void {
    this.controller.abort();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/* Brand fixtures                                                      */
/* ------------------------------------------------------------------ */

function brand(label: string) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  return {
    companyName: `Loop ${label} ${STAMP}`,
    tagline: `${label} bids from the loop test`,
    targetUrl: `https://${slug}.example.com`,
    twitterHandle: `loop${slug}${STAMP}`.slice(0, 15),
    mrrText: `$${label.length}k MRR`,
  };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

interface PlotDto {
  id: string;
  tier: string;
  status: string;
  cycleId?: string;
  currentPriceCents?: number;
  endAt?: string;
  currentLeaderPreBidId?: string | null;
  tenant?: { companyName: string | null } | null;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: ['error'],
  });

  const anon = new Session('anon');
  const alice = new Session('alice');
  const bob = new Session('bob');
  const cara = new Session('cara');

  try {
    /* ---------------- 0. preflight ---------------- */
    section('0 · preflight');
    const boot = await anon.get<{ plots: PlotDto[]; mockResolveEnabled: boolean }>('/api/plots');
    check('GET /api/plots 200', boot.status === 200, `status ${boot.status}`);
    const mockOn = boot.json.mockResolveEnabled === true;
    check(
      'server reports MOCK_PAYMENTS=1 (mock loop enabled)',
      mockOn,
      'start the server with MOCK_PAYMENTS=1 — the mock-resolve route 404s without it',
    );
    if (!mockOn) return;

    let target = (boot.json.plots ?? []).find((p) => p.tier === 'MID' && p.status === 'IDLE');
    if (!target) {
      const anyMid = (boot.json.plots ?? []).find((p) => p.tier === 'MID');
      if (!anyMid) throw new Error('no MID plot in the grid');
      await prisma.preBid.deleteMany({ where: { plotId: anyMid.id } });
      await prisma.bid.deleteMany({ where: { plotId: anyMid.id } });
      await prisma.auctionCycle.deleteMany({ where: { plotId: anyMid.id } });
      await prisma.plot.update({
        where: { id: anyMid.id },
        data: {
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
      });
      target = anyMid;
      console.log(`  ..   no IDLE MID plot — reset ${target.id} to IDLE`);
    }
    const plotId = target.id;
    console.log(`  ..   target plot ${plotId} (MID: floor $5.00, increment $1.00, 12h cycles)`);

    const watchA = await Observer.open('A');
    const watchB = await Observer.open('B');
    const watchC = await Observer.open('C');
    check('three SSE sessions anchored (snapshot received)', true);

    /* ---------------- 1. claim ---------------- */
    section('1 · Alice claims the IDLE plot');
    const t0 = Date.now();
    const claim = await alice.post(`/api/plots/${plotId}/claim`, {
      plotId,
      ...brand('A'),
      maxBidCents: 500,
    });
    check('claim 200', claim.status === 200, JSON.stringify(claim.json));
    const claimBody = claim.json as {
      cycleId?: string;
      endAt?: string;
      currentPriceCents?: number;
      youAreLeader?: boolean;
    };
    check(
      'claim opens a cycle at the floor price',
      claimBody.currentPriceCents === 500,
      `got ${claimBody.currentPriceCents}`,
    );
    check('claimer leads', claimBody.youAreLeader === true);
    check(
      'cycle endAt is ~12h out (MID duration)',
      !!claimBody.endAt && new Date(claimBody.endAt).getTime() - t0 > 11 * 3600_000,
    );

    for (const [name, obs] of [
      ['A', watchA],
      ['B', watchB],
      ['C', watchC],
    ] as const) {
      const hit = await obs.waitFor('bid:placed', (d) => d.plotId === plotId, 5000, t0);
      check(
        `session ${name} saw bid:placed <1s (no bidder brand leaked pre-payment)`,
        !!hit &&
          hit.latencyMs < 1000 &&
          !('leader' in hit.event.data) &&
          !('brand' in hit.event.data),
        hit ? `${hit.latencyMs}ms, keys=${Object.keys(hit.event.data).join(',')}` : 'no event',
      );
    }

    /* ---------------- 2. rival bid → price changes live, no brand leak ---------------- */
    section(
      '2 · Bob outbids — the price updates live in every session, with no bidder identity broadcast',
    );
    const tBid = Date.now();
    const bidB = await bob.post(`/api/plots/${plotId}/bid`, {
      plotId,
      ...brand('B'),
      maxBidCents: 2000,
    });
    check('bid 200', bidB.status === 200, JSON.stringify(bidB.json));
    check(
      'second price = 500 + 100 = 600',
      (bidB.json as { currentPriceCents?: number }).currentPriceCents === 600,
    );

    const tBid2 = Date.now();
    const bidC = await cara.post(`/api/plots/${plotId}/bid`, {
      plotId,
      ...brand('C'),
      maxBidCents: 3000,
    });
    check('third bidder 200', bidC.status === 200, JSON.stringify(bidC.json));
    check(
      'second price = 2000 + 100 = 2100',
      (bidC.json as { currentPriceCents?: number }).currentPriceCents === 2100,
    );

    for (const [name, obs] of [
      ['A', watchA],
      ['B', watchB],
      ['C', watchC],
    ] as const) {
      const priceB = await obs.waitFor(
        'bid:placed',
        (d) => d.plotId === plotId && d.currentPriceCents === 600,
        5000,
        tBid,
      );
      check(
        `session ${name} saw Bob's bid raise price to 600 <1s (no brand)`,
        !!priceB &&
          priceB.latencyMs < 1000 &&
          !('leader' in priceB.event.data) &&
          !('brand' in priceB.event.data),
        priceB ? `${priceB.latencyMs}ms` : 'no event',
      );
      const priceC = await obs.waitFor(
        'bid:placed',
        (d) => d.plotId === plotId && d.currentPriceCents === 2100,
        5000,
        tBid2,
      );
      check(
        `session ${name} saw Cara's bid raise price to 2100 <1s (no brand)`,
        !!priceC &&
          priceC.latencyMs < 1000 &&
          !('leader' in priceC.event.data) &&
          !('brand' in priceC.event.data),
        priceC ? `${priceC.latencyMs}ms` : 'no event',
      );
    }

    /* ---------------- 3. soft-close ---------------- */
    section('3 · a bid inside the final 3 minutes extends the countdown');
    const cycleId = (bidC.json as { cycleId?: string }).cycleId ?? claimBody.cycleId!;
    const shorten = await anon.post(`/api/mock-resolve/${cycleId}`, {
      mode: 'shorten',
      seconds: 60,
    });
    check('shorten cycle to 60s', shorten.status === 200, JSON.stringify(shorten.json));
    const shortenedEndAt = new Date((shorten.json as { endAt: string }).endAt).getTime();

    const tLate = Date.now();
    const lateBid = await bob.post(`/api/plots/${plotId}/bid`, {
      plotId,
      ...brand('B'),
      maxBidCents: 5000,
    });
    check('late bid 200', lateBid.status === 200, JSON.stringify(lateBid.json));
    check(
      'soft-close flag set on the response',
      (lateBid.json as { softCloseExtended?: boolean }).softCloseExtended === true,
    );
    const extendedEndAt = new Date((lateBid.json as { endAt?: string }).endAt ?? 0).getTime();
    check(
      'endAt reset to ~now + 3min (reset-based, not additive)',
      Math.abs(extendedEndAt - (tLate + 180_000)) < 5000,
      `endAt-now = ${extendedEndAt - tLate}ms (was ${shortenedEndAt - tLate}ms)`,
    );

    for (const [name, obs] of [
      ['A', watchA],
      ['B', watchB],
      ['C', watchC],
    ] as const) {
      const ext = await obs.waitFor('cycle:extended', (d) => d.plotId === plotId, 5000, tLate);
      check(
        `session ${name} saw cycle:extended <1s`,
        !!ext &&
          ext.latencyMs < 1000 &&
          new Date(String(ext.event.data.endAt)).getTime() === extendedEndAt,
        ext ? `${ext.latencyMs}ms` : 'no event',
      );
    }

    /* ---------------- 4. queue a pre-bid for the NEXT cycle ---------------- */
    section('4 · Cara queues a pre-bid for the next cycle');
    const pre = await cara.post(`/api/plots/${plotId}/prebid`, {
      plotId,
      ...brand('C'),
      maxBidCents: 4000,
    });
    check('pre-bid 200', pre.status === 200, JSON.stringify(pre.json));
    check(
      'queued for the next cycle (never the running one)',
      (pre.json as { queuedForNextCycle?: boolean }).queuedForNextCycle === true,
    );
    const queuedRow = await prisma.preBid.findFirst({
      where: { plotId, status: 'ACTIVE', cycleId: null },
    });
    check('queued row has cycleId = null in the DB', !!queuedRow, 'no queued pre-bid found');

    /* ---------------- 5. mock resolve ---------------- */
    section('5 · mock-resolve runs the real worker');
    const tResolve = Date.now();
    const resolved = await anon.post(`/api/mock-resolve/${cycleId}`, { mode: 'resolve' });
    check('mock-resolve 200', resolved.status === 200, JSON.stringify(resolved.json));
    const resBody = resolved.json as {
      clearingPriceCents?: number;
      winnerBrand?: { companyName?: string | null } | null;
      nextCycleId?: string | null;
      openingPriceCents?: number | null;
    };
    check(
      'winner is the highest max bid (Bob, 5000)',
      resBody.winnerBrand?.companyName === brand('B').companyName,
      JSON.stringify(resBody.winnerBrand),
    );
    check(
      'clearing price is second-price (3000 + 100 = 3100)',
      resBody.clearingPriceCents === 3100,
      `got ${resBody.clearingPriceCents}`,
    );
    check('queued pre-bid opened the next cycle immediately', !!resBody.nextCycleId);
    check(
      'next cycle opens at the tier floor (clean slate)',
      resBody.openingPriceCents === 500,
      `got ${resBody.openingPriceCents}`,
    );

    for (const [name, obs] of [
      ['A', watchA],
      ['B', watchB],
      ['C', watchC],
    ] as const) {
      const done = await obs.waitFor('cycle:resolved', (d) => d.plotId === plotId, 5000, tResolve);
      const winner = done?.event.data.winner as {
        preBidId?: string;
        brand?: { companyName?: string };
      } | null;
      check(
        `session ${name} saw cycle:resolved with the new tenant <1s`,
        !!done && done.latencyMs < 1000 && winner?.brand?.companyName === brand('B').companyName,
        done ? `${done.latencyMs}ms winner=${winner?.brand?.companyName}` : 'no event',
      );
      check(
        `session ${name}'s cycle:resolved winner carries preBidId (no bidderId)`,
        typeof winner?.preBidId === 'string' &&
          winner.preBidId.length > 0 &&
          !('bidderId' in (winner ?? {})),
        JSON.stringify(winner),
      );
    }

    /* ---------------- 6. next auction is live; PREVIOUS tenant stays displayed ---------------- */
    section(
      '6 · second cycle is live from the queued pre-bid — Bob (paid) stays the tenant while Cara merely bids',
    );
    const after = await anon.get<{ plots: PlotDto[] }>('/api/plots');
    const live = (after.json.plots ?? []).find((p) => p.id === plotId)!;
    check('plot is LIVE again (no gap back to IDLE)', live.status === 'LIVE', live.status);
    check(
      "core Model A invariant: Bob (last paid winner) is STILL the public tenant — Cara's unpaid bid must not evict him",
      live.tenant?.companyName === brand('B').companyName,
      JSON.stringify(live.tenant),
    );
    check(
      'price reset to the floor',
      live.currentPriceCents === 500,
      String(live.currentPriceCents),
    );
    check(
      'countdown restarted at ~12h',
      !!live.endAt && new Date(live.endAt).getTime() - Date.now() > 11 * 3600_000,
    );

    /* ---------------- 7. resolve again → IDLE, tenant display handed off ---------------- */
    section('7 · resolving the last cycle leaves an IDLE plot with the new standing tenant (Cara)');
    const cycle2 = live.cycleId!;
    await anon.post(`/api/mock-resolve/${cycle2}`, { mode: 'shorten', seconds: 30 });
    const tResolve2 = Date.now();
    const resolved2 = await anon.post(`/api/mock-resolve/${cycle2}`, { mode: 'resolve' });
    check('second mock-resolve 200', resolved2.status === 200, JSON.stringify(resolved2.json));
    check(
      'no queued pre-bids → no next cycle',
      (resolved2.json as { nextCycleId?: string | null }).nextCycleId == null,
    );

    for (const [name, obs] of [
      ['A', watchA],
      ['B', watchB],
      ['C', watchC],
    ] as const) {
      const done = await obs.waitFor(
        'cycle:resolved',
        (d) => d.plotId === plotId && d.nextCycle == null,
        5000,
        tResolve2,
      );
      check(`session ${name} saw the plot go IDLE with no next cycle`, !!done, 'no event');
    }

    const final = await anon.get<{ plots: PlotDto[] }>('/api/plots');
    const idle = (final.json.plots ?? []).find((p) => p.id === plotId)!;
    check('plot is IDLE and claimable again', idle.status === 'IDLE', idle.status);
    check(
      "winner's brand survives as the standing display on an IDLE plot (via the public API, not just the DB)",
      idle.tenant?.companyName === brand('C').companyName,
      JSON.stringify(idle.tenant),
    );
    const row = await prisma.plot.findUniqueOrThrow({ where: { id: plotId } });
    check(
      'DB row confirms the tenant handoff from Bob to Cara',
      row.tenantCompanyName === brand('C').companyName,
      `display=${row.tenantCompanyName}`,
    );

    watchA.close();
    watchB.close();
    watchC.close();
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    failures === 0
      ? '\nE2E FULL LOOP: PASS — every assertion green'
      : `\nE2E FULL LOOP: FAIL — ${failures} assertion(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nE2E FULL LOOP: ERROR');
  console.error(e);
  process.exit(1);
});
