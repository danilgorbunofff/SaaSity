/**
 * Part 4 realtime proof — deploy-safe fan-out, race-free SSE lifecycle,
 * atomic next-cycle state, and reconstructible outbid, all against a live
 * server + real Postgres (default http://127.0.0.1:3457, MOCK_PAYMENTS=1).
 *
 *   A · Outbox cross-connection: rows written through one PrismaClient
 *       (simulating instance B's publish) are visible in global seq order
 *       to a second, independently-pooled client (instance A).
 *   B · Live bid fan-out: a claim over HTTP reaches an SSE watcher <1s AND
 *       persists an outbox row; after a full poll interval the stream holds
 *       exactly ONE copy of the event (local + poll dedupe by key).
 *   C · Rotation completeness: winner A settles while queued B opens the
 *       next cycle with NO later bid — cycle:resolved carries the complete
 *       next-cycle snapshot (cycleId/endAt/price/leaderPreBidId) matching
 *       /api/plots exactly, and the tenant is the paid winner, not the new
 *       leader.
 *   D · Outbid reconstruction: /api/me/bids positions let a client rebuild
 *       "which plot I am losing" from snapshots; after resolution the stale
 *       contest clears via the same projection.
 *   E · Retention: pruneOutbox drops aged rows and keeps fresh ones.
 *   F · Reconnect: a dropped stream re-anchors on a fresh snapshot.
 *
 * Honest scope: one server process here, so "separate instances" means
 * separate DB pools + the shared-table contract (the poll loop a second
 * instance runs is this same code over this same table). True multi-
 * instance soak is a preview-env exercise, noted in the Part 4 doc.
 *
 * Usage: npx tsx scripts/realtime-fanout-proof.ts [baseUrl]
 * Reset after: npx tsx prisma/seed.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { eventKeyOf } from '../src/server/realtime/bus';
import {
  readOutboxSince,
  readOutboxHighWatermark,
  pruneOutbox,
} from '../src/server/realtime/outbox';
import {
  deriveOutbidFromPositions,
  mergeOutbidPlotIds,
  type OwnerPosition,
} from '../src/lib/city/ownership';
import type { PlotDto as ApiPlotDto } from '../src/types/api';

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
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
    return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
  }
  async get<T = Record<string, unknown>>(path: string): Promise<{ status: number; json: T }> {
    const res = await fetch(`${BASE}${path}`, { headers: { Cookie: this.cookieHeader() } });
    this.absorb(res);
    return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
  }
}

/* ------------------------------------------------------------------ */
/* Observer: one live SSE stream                                       */
/* ------------------------------------------------------------------ */

interface Observed {
  type: string;
  id: string | null;
  data: Record<string, unknown>;
  at: number;
}

class Observer {
  readonly events: Observed[] = [];
  seenSnapshot = false;
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
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !o.seenSnapshot) await sleep(25);
    if (!o.seenSnapshot) throw new Error(`SSE ${name} never anchored (no snapshot)`);
    return o;
  }
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
          const id = /^id: (.*)$/m.exec(frame);
          const data = /^data: (.*)$/m.exec(frame);
          if (!ev) continue;
          const type = ev[1].trim();
          if (type === 'snapshot') {
            this.seenSnapshot = true;
            continue;
          }
          if (!data || type === 'hello') continue;
          try {
            this.events.push({
              type,
              id: id ? id[1].trim() : null,
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
  close(): void {
    this.controller.abort();
  }
}

/* ------------------------------------------------------------------ */

function brand(label: string) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  return {
    companyName: `Fanout ${label} ${STAMP}`,
    tagline: `${label} bids from the fanout proof`,
    targetUrl: `https://${slug}${STAMP}.example.com`,
    twitterHandle: `fan${slug}${STAMP}`.slice(0, 15),
    mrrText: `$${label.length}k MRR`,
  };
}

interface PlotDto {
  id: string;
  tier: string;
  status: string;
  cycleId?: string;
  currentPriceCents?: number;
  endAt?: string;
  currentLeaderPreBidId?: string | null;
  tenant?: { companyName: string | null } | null;
  tenantPreBidId?: string | null;
}

async function main(): Promise<void> {
  // Two independently-pooled clients = two "instances" for Postgres.
  const instanceA = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: ['error'],
  });
  const instanceB = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: ['error'],
  });
  const anon = new Session('anon');
  const alice = new Session('alice');
  const bob = new Session('bob');
  const cara = new Session('cara');

  try {
    section('0 · preflight');
    const boot = await anon.get<{ plots: PlotDto[]; mockResolveEnabled: boolean }>('/api/plots');
    check('GET /api/plots 200', boot.status === 200, `status ${boot.status}`);
    const mockOn = boot.json.mockResolveEnabled === true;
    check('server runs MOCK_PAYMENTS=1', mockOn, 'restart with MOCK_PAYMENTS=1');
    if (!mockOn || boot.status !== 200) return;

    section('A · outbox is visible across connections in global seq order');
    const mark = await readOutboxHighWatermark();
    const mkPayload = (n: number) => ({
      type: 'bid:placed',
      plotId: `proof-plot-${STAMP}`,
      cycleId: `proof-cycle-${STAMP}`,
      currentPriceCents: 500 + n,
      leaderPreBidId: `proof-pb-${n}`,
      endAt: new Date().toISOString(),
      winner: null,
      clearingPriceCents: null,
      nextCycle: null,
    });
    // Instance B publishes (what the sink's persist does on every publish).
    for (let n = 1; n <= 3; n++) {
      await instanceB.realtimeOutbox.create({
        data: { type: 'bid:placed', plotId: `proof-plot-${STAMP}`, payload: mkPayload(n) },
      });
    }
    // Instance A polls (what every SSE loop does, any process).
    const { entries, highSeq } = await readOutboxSince(mark);
    check('second connection reads all 3 rows', entries.length === 3, `got ${entries.length}`);
    const seqs = entries.map((e) => e.seq);
    check(
      'global seq order is ascending',
      seqs.every((s, i) => i === 0 || s > seqs[i - 1]),
      seqs.join(','),
    );
    check(
      'payloads round-trip intact with distinct dedup keys',
      new Set(entries.map((e) => eventKeyOf(e.event))).size === 3,
    );
    check('cursor advances to the newest row', highSeq === seqs[seqs.length - 1]);
    await instanceA.realtimeOutbox.deleteMany({ where: { plotId: `proof-plot-${STAMP}` } });

    section('B · live claim fans out to SSE <1s, persists, and delivers exactly once');
    let target = (boot.json.plots ?? []).find((p) => p.tier === 'MID' && p.status === 'IDLE');
    if (!target) {
      const anyMid = (boot.json.plots ?? []).find((p) => p.tier === 'MID');
      if (!anyMid) throw new Error('no MID plot in the grid');
      await instanceA.preBid.deleteMany({ where: { plotId: anyMid.id } });
      await instanceA.bid.deleteMany({ where: { plotId: anyMid.id } });
      await instanceA.auctionCycle.deleteMany({ where: { plotId: anyMid.id } });
      await instanceA.plot.update({
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
    const watch = await Observer.open('watch');
    check('SSE anchored on a fresh snapshot', watch.seenSnapshot);

    const t0 = Date.now();
    const claim = await alice.post<{
      cycleId?: string;
      currentPriceCents?: number;
      youAreLeader?: boolean;
    }>(`/api/plots/${plotId}/claim`, { plotId, ...brand('A'), maxBidCents: 500 });
    check('claim 200 at the floor', claim.status === 200 && claim.json.currentPriceCents === 500);
    const cycleId = claim.json.cycleId!;
    const hit = await watch.waitFor('bid:placed', (d) => d.plotId === plotId, 5000, t0);
    check(
      'watcher saw bid:placed <1s',
      !!hit && hit.latencyMs < 1000,
      hit ? `${hit.latencyMs}ms` : 'no event',
    );
    const outboxRow = await instanceA.realtimeOutbox.findFirst({
      where: { plotId, type: 'bid:placed' },
      orderBy: { seq: 'desc' },
    });
    check('claim persisted an outbox row (durable sink registered)', !!outboxRow);
    check(
      'outbox payload matches the broadcast shape',
      (outboxRow?.payload as { cycleId?: string })?.cycleId === cycleId,
    );
    // Past the poll interval: local + outbox copies must have deduped to one.
    await sleep(1800);
    const copies = watch.events.filter(
      (e) =>
        e.type === 'bid:placed' &&
        (e.data as { cycleId?: string }).cycleId === cycleId &&
        (e.data as { currentPriceCents?: number }).currentPriceCents === 500,
    );
    check(
      'exactly-once on the stream after poll ticks (key dedupe)',
      copies.length === 1,
      `got ${copies.length}`,
    );

    section(
      'C · rotation carries the complete next-cycle snapshot (A wins, B leads next, no later bid)',
    );
    const tBid = Date.now();
    const bidB = await bob.post(`/api/plots/${plotId}/bid`, {
      plotId,
      ...brand('B'),
      maxBidCents: 2000,
    });
    check('bob outbids 200', bidB.status === 200, JSON.stringify(bidB.json));
    const bobHit = await watch.waitFor(
      'bid:placed',
      (d) => d.plotId === plotId && (d as { leaderPreBidId?: string }).leaderPreBidId !== undefined,
      5000,
      tBid,
    );
    check('watcher saw the outbid tick', !!bobHit);

    // D-setup runs pre-resolve: alice is losing but ACTIVE on this cycle.
    const aliceMe = await alice.get<{ preBidIds: string[]; positions: OwnerPosition[] }>(
      '/api/me/bids',
    );
    const aliceActive = (aliceMe.json.positions ?? []).find(
      (p) => p.plotId === plotId && p.cycleId === cycleId && p.status === 'ACTIVE',
    );
    check(
      'alice holds an ACTIVE position on the live cycle',
      !!aliceActive,
      JSON.stringify(aliceMe.json.positions),
    );
    const liveNow = await anon.get<{ plots: PlotDto[] }>('/api/plots');
    const livePlot = liveNow.json.plots!.find((p) => p.id === plotId)!;
    const aliceOutbidNow = deriveOutbidFromPositions(
      new Map(liveNow.json.plots!.map((p) => [p.id, p as unknown as ApiPlotDto])),
      aliceMe.json.positions ?? [],
    );
    check(
      'outbid reconstructs from snapshots (rival leads, alice ACTIVE)',
      aliceOutbidNow.has(plotId) && livePlot.currentLeaderPreBidId !== aliceActive?.preBidId,
    );

    const pre = await cara.post(`/api/plots/${plotId}/prebid`, {
      plotId,
      ...brand('C'),
      maxBidCents: 4000,
    });
    check('cara queues for the next cycle 200', pre.status === 200, JSON.stringify(pre.json));
    const queuedRow = await instanceA.preBid.findFirst({
      where: { plotId, status: 'ACTIVE', cycleId: null },
    });
    check('queued row sits outside the running cycle', !!queuedRow);

    const tResolve = Date.now();
    const resolved = await anon.post<{
      clearingPriceCents?: number;
      winnerBrand?: { companyName?: string | null } | null;
      nextCycleId?: string | null;
    }>(`/api/mock-resolve/${cycleId}`, { mode: 'resolve' });
    check('mock-resolve 200', resolved.status === 200, JSON.stringify(resolved.json));
    check(
      'bob (highest attached) won',
      resolved.json.winnerBrand?.companyName === brand('B').companyName,
    );
    const done = await watch.waitFor('cycle:resolved', (d) => d.plotId === plotId, 5000, tResolve);
    check(
      'watcher saw cycle:resolved <1s',
      !!done && done.latencyMs < 1000,
      done ? `${done.latencyMs}ms` : 'no event',
    );
    const data = done?.event.data as unknown as {
      winner: { preBidId: string; brand: { companyName: string | null } } | null;
      nextCycle: {
        cycleId: string;
        endAt: string;
        currentPriceCents: number | null;
        leaderPreBidId: string | null;
      } | null;
    };
    check(
      'event names the paid winner as tenant (no bidderId)',
      !!data?.winner?.preBidId && !('bidderId' in (data?.winner ?? {})),
    );
    check(
      'nextCycle snapshot is complete',
      !!(
        data?.nextCycle?.cycleId &&
        data.nextCycle.endAt &&
        data.nextCycle.currentPriceCents != null &&
        data.nextCycle.leaderPreBidId
      ),
      JSON.stringify(data?.nextCycle),
    );
    check(
      'next leader is the queued pre-bid with NO later bid (A→B rotation)',
      data?.nextCycle?.leaderPreBidId === queuedRow?.id,
      `leader=${data?.nextCycle?.leaderPreBidId} queued=${queuedRow?.id}`,
    );
    check(
      'winner and next leader are distinct pre-bids',
      data?.winner?.preBidId !== data?.nextCycle?.leaderPreBidId,
    );
    const after = await anon.get<{ plots: PlotDto[] }>('/api/plots');
    const rotated = after.json.plots!.find((p) => p.id === plotId)!;
    check(
      'event matches server truth exactly (atomic swap)',
      rotated.status === 'LIVE' &&
        rotated.cycleId === data?.nextCycle?.cycleId &&
        rotated.currentPriceCents === data?.nextCycle?.currentPriceCents &&
        rotated.currentLeaderPreBidId === data?.nextCycle?.leaderPreBidId &&
        rotated.endAt === data?.nextCycle?.endAt,
      JSON.stringify({
        cycleId: rotated.cycleId,
        price: rotated.currentPriceCents,
        leader: rotated.currentLeaderPreBidId,
      }),
    );
    check(
      'paid winner stays the public tenant under the fresh auction',
      rotated.tenant?.companyName === brand('B').companyName,
    );

    section('D · stale outbid clears from the owner projection after rotation');
    const aliceAfter = await alice.get<{ preBidIds: string[]; positions: OwnerPosition[] }>(
      '/api/me/bids',
    );
    const stillActive = (aliceAfter.json.positions ?? []).filter(
      (p) => p.status === 'ACTIVE' && p.plotId === plotId,
    );
    check(
      'alice has no ACTIVE row on the plot anymore (LOST)',
      stillActive.length === 0,
      JSON.stringify(stillActive),
    );
    const plotsById = new Map(
      (after.json.plots ?? []).map((p) => [p.id, p as unknown as ApiPlotDto]),
    );
    const cleared = mergeOutbidPlotIds(
      new Set([plotId]),
      new Set(),
      plotsById,
      new Set(aliceAfter.json.preBidIds ?? []),
      aliceAfter.json.positions ?? [],
    );
    check('sticky outbid clears once the contest is history', !cleared.has(plotId));

    section('E · retention prune drops aged rows, keeps fresh ones');
    const aged = await instanceA.realtimeOutbox.create({
      data: {
        type: 'bid:placed',
        plotId: `proof-aged-${STAMP}`,
        payload: mkPayload(1),
        createdAt: new Date(Date.now() - 25 * 3_600_000),
      },
    });
    const pruned = await pruneOutbox();
    check('prune reports work', pruned >= 1, `pruned=${pruned}`);
    check(
      'aged row is gone',
      (await instanceA.realtimeOutbox.findUnique({ where: { seq: aged.seq } })) == null,
    );
    check(
      'fresh live rows survive',
      (await instanceA.realtimeOutbox.findFirst({ where: { plotId } })) != null,
    );

    section('F · dropped stream re-anchors on a fresh snapshot');
    watch.close();
    await sleep(100);
    const watch2 = await Observer.open('watch2');
    check('reconnect anchored (new snapshot received)', watch2.seenSnapshot);

    section('G · two tabs, one bidder cookie: both converge on the same event');
    // watch2 stays open (tab 1); a second stream is tab 2. Both are public
    // streams, but the bid below is authenticated through ONE shared cookie
    // jar — exactly two tabs of the same browser.
    const watch3 = await Observer.open('watch3');
    const tTwoTabs = Date.now();
    const bidG = await bob.post(`/api/plots/${plotId}/bid`, {
      plotId,
      ...brand('B2'),
      maxBidCents: 4500,
    });
    check('second-tab bid 200', bidG.status === 200, JSON.stringify(bidG.json));
    const isNewTick = (d: Record<string, unknown>) =>
      d.plotId === plotId && ((d as { currentPriceCents?: number }).currentPriceCents ?? 0) > 500;
    const seen2 = await watch2.waitFor('bid:placed', isNewTick, 5000, tTwoTabs);
    const seen3 = await watch3.waitFor('bid:placed', isNewTick, 5000, tTwoTabs);
    check('tab 1 saw the tab-2-identity bid <1s', !!seen2 && seen2.latencyMs < 1000);
    check('tab 2 saw the same bid <1s', !!seen3 && seen3.latencyMs < 1000);
    check(
      'both tabs converged on identical payloads (no per-tab skew)',
      !!seen2 &&
        !!seen3 &&
        (seen2.event.data as { leaderPreBidId?: string }).leaderPreBidId ===
          (seen3.event.data as { leaderPreBidId?: string }).leaderPreBidId &&
        (seen2.event.data as { cycleId?: string }).cycleId ===
          (seen3.event.data as { cycleId?: string }).cycleId,
    );
    // The shared cookie's owner projection agrees in "both tabs".
    const bobMe = await bob.get<{ positions: OwnerPosition[] }>('/api/me/bids');
    check(
      'owner projection shows bob ACTIVE on the live cycle (either tab reads this)',
      (bobMe.json.positions ?? []).some((p) => p.plotId === plotId && p.status === 'ACTIVE'),
    );
    watch2.close();
    watch3.close();
  } finally {
    await instanceA.$disconnect().catch(() => {});
    await instanceB.$disconnect().catch(() => {});
  }

  console.log(failures === 0 ? '\nPROOF PASS' : `\nPROOF FAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('proof crashed:', err);
  process.exit(1);
});
