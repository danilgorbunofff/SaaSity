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

- [ ] Expose connecting, live, stale, reconnecting, and offline states to users.
- [ ] Surface failed resynchronization instead of only logging a warning.
- [ ] Treat malformed frames as a resync condition, not a silent ignore.
- [ ] Define a maximum stale-data window.
- [ ] Confirm visibility/focus handlers do not duplicate connections.
- [ ] Test multiple tabs sharing the same bidder cookie.
- [ ] Test network offline/online transitions and server restart.
- [ ] Ensure unknown plots or schema versions trigger a full snapshot.
- [ ] Record deployed latency and connection lifetime limits.

