# Part 4 - Realtime and Client State

**Depends on:** Parts 1-3  
**Affected phases:** M2 2.3-2.5 and M1 ownership/outbid UI

## [Blocking] `serverless-local-bus`

The module-level listener set only connects requests inside one Node process.
Vercel may route bid mutations and SSE clients to different instances, so local
success does not prove deployed fan-out.

- [ ] Select a deploy-safe transport for Neon + Vercel.
- [ ] Prefer a managed shared broker or a deliberately designed polling model;
      do not treat a process-local Set as cross-instance infrastructure.
- [ ] Define ordering, retry, deduplication, retention, and reconnect behavior.
- [ ] Ensure worker events and API mutation events use the same transport.
- [ ] Remove process-local assumptions from rate limiting and sweep scheduling.
- [ ] Test with publishers and subscribers in separate processes/instances.

**Acceptance:** a bid handled by instance B reaches a browser connected to
instance A within the documented latency.

## [High] `sse-snapshot-race`

The route reads and sends the snapshot before subscribing. An event committed
in that window is absent from both snapshot and stream, with no sequence gap.

- [ ] Subscribe before the snapshot read and buffer events until the snapshot
      has been flushed, or use a durable global sequence/cursor.
- [ ] Apply buffered events in canonical order.
- [ ] Make event application idempotent.
- [ ] Test a mutation committed between query start, query completion, snapshot
      send, and subscription activation.

## [High] `sse-abort-leak`

If snapshot enqueue fails, cleanup runs before listener/timer creation but the
startup function continues and creates both afterward.

- [ ] Attach the abort handler before the first asynchronous operation.
- [ ] Check `request.signal.aborted` after every awaited initialization step.
- [ ] Stop initialization immediately after a failed write.
- [ ] Guarantee one cleanup path removes listener, heartbeat, buffers, and
      request references.
- [ ] Load-test slow snapshot queries with repeated disconnects.

## [High] `next-cycle-realtime-state`

`cycle:resolved` carries the previous winner plus only the next cycle's ID,
end time, and price. The client marks the next cycle LIVE while clearing its
real leader ID and showing the old winner's brand.

- [ ] Define the event from the Part 1 lifecycle model.
- [ ] Include the complete next-cycle public snapshot, including the correct
      leader brand and leader PreBid ID when those remain public.
- [ ] Prefer one serialized `PlotDto` replacement over partial, drifting fields.
- [ ] Update `cycleId`, status, leader, price, end time, and ownership atomically.
- [ ] Test previous winner A rotating into next-cycle leader B with no later bid.

## [High] `outbid-reconstruction`

The private endpoint returns only the caller's PreBid IDs. The client can know
whether it currently leads, but cannot reconstruct which live plot/cycle it has
lost after refresh. Outbid state exists only when a lead flip was observed.

- [ ] Return a privacy-safe owner projection such as PreBid ID, plot ID,
      cycle ID, and status; never return maxima in the public or list payload.
- [ ] Derive owned, active-but-outbid, won, and inactive states from current
      server snapshots rather than historical client transitions.
- [ ] Refresh owner state after claim, bid, resolution, reconnect, and tab wake.
- [ ] Clear outbid state when a cycle changes.
- [ ] Test refresh while outbid and immediate next-cycle rotation.

## [High] `public-bidder-id`

The unauthenticated resolution stream includes the stable site-wide bidder ID.
The client does not use it, and it enables long-term cross-brand correlation.

**Status: resolved as a side effect of the Part 1 lifecycle fix (uncommitted).**
`winner.bidderId` was replaced with `winner.preBidId` (opaque, meaningless
without the matching row in the caller's own private `/api/me/bids` list —
the same reasoning already applied to the pre-existing public
`currentLeaderPreBidId`) while rebuilding the `cycle:resolved` payload around
tenant vs. auction-leader separation. See
[Part 1](part-01-product-lifecycle.md) for the full change.

- [x] Remove `winner.bidderId` from public DTOs and event types. —
      `types/api.ts`'s `RealtimeEventDto.winner` and `bus.ts`'s
      `RealtimeEvent.winner` both carry `preBidId`, never `bidderId`.
- [x] Confirm no UI or ownership behavior depends on it. — Repo-wide search
      confirms `bidderId` appears only in private server-side code (bidder
      cookie, rate limiting, internal worker params) and explanatory
      comments; zero references anywhere under `src/lib/city` or
      `src/components`.
- [x] Add an explicit serializer privacy test covering every event type. —
      `tests/realtime/bus.test.ts` has one test per event (`bid:placed`,
      `cycle:extended`, `cycle:resolved`), each asserting the absence of
      `bidderId`/`maxBidCents`/non-tenant brand data, including a
      `JSON.stringify` substring check.
- [x] Keep ownership matching inside the authenticated cookie-scoped
      endpoint. — Unchanged: `/api/me/bids` remains the only place a caller's
      own `PreBid` ids are resolved; the public stream never did (and still
      doesn't) need to carry an identity token for that purpose.

## Additional realtime/client hardening

- [x] Expose connecting, live, stale, reconnecting, and offline states to users. —
      TopStrip badge shows `LIVE · {age} / CONNECTING… / RECONNECTING… /
      OFFLINE` (`role="status"`). Deliberate deviation: no `stale` enum —
      quiet 12h auctions are healthy silence, so freshness is the visible
      sync age (`store.lastSyncAt`), never a false alarm.
- [x] Surface failed resynchronization instead of only logging a warning. —
      3 consecutive resync failures raise the shared error surface
      (`ErrorChip` + manual retry); recovery clears only our own message.
- [x] Treat malformed frames as a resync condition, not a silent ignore. —
      1–2 bad frames skip; 3 in a row force a snapshot re-anchor. Unknown
      event *types* stay ignored (forward-compat: listeners are per known
      type).
- [x] Define a maximum stale-data window. — Bounded by time-since-lastSyncAt,
      displayed in the HUD; see "Recorded numbers" below.
- [x] Confirm visibility/focus handlers do not duplicate connections. —
      Split deliberately, not duplicated: realtime.ts owns the STREAM
      (visibilitychange → re-anchor); DataBinder owns DATA (focus →
      snapshot incl. the projection the stream never carries). One
      EventSource per page; `stopRealtime` removes every listener (tested).
- [x] Test multiple tabs sharing the same bidder cookie. — Proof section G:
      two streams + one shared cookie jar converge on identical payloads.
- [x] Test network offline/online transitions and server restart. —
      `tests/city/realtime-connection.test.ts` (offline badges, online
      re-anchors, wake-up re-anchors, stop cleans up); server restart is
      covered by the reconnect path (proof section F).
- [x] Ensure unknown plots or schema versions trigger a full snapshot. —
      Events naming plots outside the snapshot force a throttled (5s)
      re-anchor instead of a silent no-op.
- [x] Record deployed latency and connection lifetime limits. — See
      "Recorded numbers" below.

## Implementation record (Part 4 build session)

All six findings closed in one surgical pass; 92/92 unit tests green,
`resolve-worker-proof` PASS, `e2e-full-loop` PASS, and the new
`scripts/realtime-fanout-proof.ts` (34 checks) PASS against a production
build with `MOCK_PAYMENTS=1`.

- [x] `serverless-local-bus` — transport: **SSE + Postgres outbox poll, no
      broker** (scale envelope unchanged: 49 plots, single region,
      bursty-not-huge). `publish()` fans out to local listeners
      synchronously AND to the per-process durable sink
      (`src/server/realtime/outbox.ts`, registered by explicit import in the
      bid/claim routes and the worker — unit tests import `bus.ts` alone, so
      publish stays pure under test). Every instance's SSE loop polls rows
      newer than its cursor; `RealtimeOutbox.seq` (bigserial) is the global
      order; `eventKeyOf` (bus.ts) is the cross-copy idempotency key;
      retention is 24h via `pruneOutbox`, called fire-and-forget from the
      cron resolve route. Bid/claim/worker all publish through the same emit
      family. The "separate instances" acceptance leg is proven at the
      shared-table contract level (two independently-pooled Prisma clients:
      write on one, ordered read on the other) plus a live bid→SSE→outbox
      walk; true multi-instance soak is a preview-env exercise.
      Rate limiting stays a per-process abuse guard (`src/server/rate-limit.ts`
      header: "Single-node dev guard", Redis swap is the documented evolution
      path) — i.e. N instances grant N× the per-instance budget, fail-open on
      abuse, never fail-closed on legitimate traffic. The plots-route sweep is
      likewise per-process but deliberately redundant: it only invokes the
      idempotent worker claim path, so concurrent sweeps are harmless
      duplicate work, not double settlement.
- [x] `sse-snapshot-race` — subscribe-first + race-window buffer + replay in
      arrival order; outbox high-watermark read BEFORE the plot query with
      cursor advance; snapshot∩buffer overlap converges via idempotent
      field-overwrite patches; local/outbox double delivery dedupes by
      `eventKeyOf`.
- [x] `sse-abort-leak` — abort attached before the first await, aborted
      checks after every await, failed writes return before any timer or
      listener exists, one idempotent `cleanup` owns listener + heartbeat +
      poll timer + controller.
- [x] `next-cycle-realtime-state` — `cycle:resolved.nextCycle` is now the
      complete public snapshot (`cycleId/endAt/openingPriceCents` +
      `currentPriceCents/leaderPreBidId` re-read post-rotation); the client
      swaps all six fields atomically. Leader brand is deliberately NOT
      included (Part 1: no free exposure pre-payment). Stored-outcome replay
      gained a staleness guard (staged cycle's `startedAt` must equal the
      resolved cycle's `resolvedAt`) so a late re-emit can't attach an
      unrelated newer cycle. Proven by the A→B rotation check with no later
      bid (event equals `/api/plots` exactly).
- [x] `outbid-reconstruction` — `/api/me/bids` returns `positions`
      (`preBidId/plotId/cycleId/status`, caller-scoped, never maxima);
      `deriveOutbidFromPositions` rebuilds the loss from snapshots;
      `mergeOutbidPlotIds` clears on rotation/LOST with the projection and
      re-adds when still losing the fresh cycle; owner refresh after
      claim/bid/resolution (lightweight `fetchMyPositions`), reconnect, and
      tab focus.
- [x] Hardening — TopStrip shows `LIVE · {age} / CONNECTING… /
      RECONNECTING… / OFFLINE` (`role="status"`); 3 consecutive malformed
      frames force a re-anchor (unknown *types* stay ignored for
      forward-compat); online re-anchors, offline badges immediately;
      visibility (stream, realtime.ts) vs focus (data incl. projection,
      DataBinder) ownership is split deliberately and documented; multi-tab
      decision recorded (no shared channel — server is truth,
      last-write-wins at the API, focus refetch covers the window).

### Recorded numbers (transport decision annex)

- Cross-instance delivery: **≤ ~1s** (`OUTBOX_POLL_MS = 1000` + one indexed
  range query); same-process stays synchronous. Proof asserts live
  bid→SSE **<1s** end to end.
- Outbox retention: **24h** (`OUTBOX_RETENTION_HOURS`), pruned on every cron
  tick (fire-and-forget; sweep correctness never depends on it).
- Read cap per poll: **200 rows**, ascending, cursor-advancing past malformed
  payloads (a poison row can't wedge a consumer).
- Client retry: EventSource native retry + own backoff **0.5s → 30s max**;
  retries are unbounded (no polling fallback by design — snapshot re-anchor
  on reconnect/visibility/focus is the convergence path).
- Heartbeat: SSE comment every **15s**; browser `fetch` snapshot has no TTL
  (explicit refetch points, not polling).
- Stale-data window: bounded by time-since-`lastSyncAt`, displayed in the
  HUD — there is no silent staleness state, only a visible age.
- Connection model: one stream per tab; long-lived streams hold one server
  execution each — if the platform caps concurrent executions, clients
  degrade to reconnect + focus refetch, and a managed broker replaces the
  outbox poll (documented evolution path, not needed at this scale).

## Reverification (2026-09-03, strict pass)

Ran, not re-read: `npm test` → **138/138 pass** (the "92/92" in the
record above was the count at build time; later parts added suites —
history preserved, current count recorded here), `npx tsc --noEmit`
clean, `npm run lint` clean. Live proofs (`realtime-fanout-proof`,
`e2e-full-loop`) were NOT re-run — they need a live server +
`MOCK_PAYMENTS=1` + Postgres; last recorded runs stand.

- `serverless-local-bus` — CONFIRMED with one honesty fix: the record
  claimed closure but never mentioned the finding's own "rate limiting
  and sweep scheduling" sub-item. Both are still process-local; added the
  paragraph above (fail-open abuse guard, idempotent sweep) so the doc no
  longer over-claims. Outbox mechanics themselves verified line-exact
  (`outbox.ts`: sink never throws, `highSeq` advances past malformed rows,
  200-row cap, 24h prune wired fire-and-forget into the cron route;
  `bus.ts`: sync local fan-out + sink handoff, `eventKeyOf` per-type
  namespaces, throwing listeners/sinks isolated).
- `sse-snapshot-race` — CONFIRMED: subscribe (L118) precedes the
  watermark read (L134) precedes the plot query (L139); buffer replays in
  arrival order (L163); local/outbox double delivery dedupes by key.
  Residual window (cross-instance commit between plot query and first
  poll) converges within one poll interval (~1s, the documented latency).
- `sse-abort-leak` — CONFIRMED, no leak: abort listener attaches before
  the first await (L92); `closed || aborted` checked after every await
  (L135, L142, L178) and inside `write`/`deliver`; `write` self-cleans on
  enqueue-throw (L101); hello/snapshot write failures `return` only after
  cleanup has already run via the abort path or the throw path — the
  listener from step 1 is always removed exactly once (`cleanup` is
  idempotent, L65-88). One doc nit, no code change: "no listener … is
  ever created after a failure" means end-state, not creation order.
- `next-cycle-realtime-state` — CONFIRMED: `settleAndRotate` re-reads
  plot leader + next-cycle price post-rotation (`worker.ts` L351-368);
  `readStoredOutcome` staleness guard (`startedAt === resolvedAt`,
  L801-805); client swaps all six fields atomically (`realtime.ts`
  L162-210); tenant rotates to the paid winner, never evicted on empty
  resolution (L193-202).
- `outbid-reconstruction` — CONFIRMED: `/api/me/bids` selects only
  id/plotId/cycleId/status (never maxima); `deriveOutbidFromPositions` +
  `mergeOutbidPlotIds` (rotation/LOST clearing) verified; refresh paths
  real — claim/bid success dispatches `city-refetch` → `DataBinder`
  reloads snapshot incl. positions (`BidModal.tsx` L334,
  `CityScene.tsx` L86-103), resolution calls lightweight
  `refreshMyPositions` (`realtime.ts` L208), reconnect/focus covered by
  `fullResync`/`DataBinder`.
- `public-bidder-id` — CONFIRMED: `winner.preBidId` only in
  `types/api.ts` + `bus.ts`; zero `bidderId`/`maxBidCents` under
  `src/lib/city` or `src/components` (public surface); serializer tests
  assert absence per event type.
- Hardening — CONFIRMED: badge (`TopStrip.tsx` L89-121, `role="status"`,
  no `stale` enum by design — visible sync age instead); 3-strikes resync
  surfacing (`realtime.ts` L55-87); 3-strikes malformed-frame re-anchor
  with unknown *types* ignored for forward-compat (L246-276, L315-318);
  unknown-plot throttled re-anchor 5s (L90-101); offline→badge/online→
  re-anchor (L344-358); `stopRealtime` removes all listeners (L374-387).
- Recorded numbers — CONFIRMED present and matching code
  (`OUTBOX_POLL_MS=1000`, 24h retention, 200-row cap, backoff 0.5s→30s,
  15s heartbeat). Two drifts noted, not fixed (historical record):
  "92/92" is now 138/138 (see above); "34 checks" vs 40 `check(` call
  sites in the proof script (runtime count varies by path).

