# Part 1 - Product Lifecycle

**Gate:** Must be resolved before M3  
**Owners:** Product/founder and backend lead  
**Affected phases:** M0 0.2-0.3, M1 1.3-1.4, M2 2.2-2.5

## [Blocking] `core-lease-semantics`

### Problem

The implemented state machine does not grant the final winner a distinct
post-auction lease:

- `resolveCycle` writes the provisional leader's brand to `Plot` after every
  bidding change (`src/server/auction/engine.ts:201-212`).
- Payment is settled only when the cycle ends, so a bidder may receive hours of
  billboard exposure, lose at the end, and pay nothing.
- If queued bids exist, resolution immediately starts another cycle and its
  provisional leader overwrites the winner in the same transaction
  (`src/server/auction/worker.ts:233-239`).
- If no queued bids exist, the winner's fields remain in the database but IDLE
  serialization removes them (`src/server/serializers.ts:23`).
- This contradicts the promise that a winner remains visible until the next
  cycle takes the plot (`README.md:3`).

### Required product decision

Choose and document one model:

#### Model A - Auction awards a future lease (recommended)

The current tenant remains visible while bidding selects the next tenant.
Resolution activates the winner for a defined lease duration. Auction state and
lease/display state are separate.

#### Model B - Current auction leader buys live exposure

The provisional leader may be displayed immediately, but billing, copy,
refunds, and fairness must be redesigned around time-based exposure. The
product must stop promising a winner-owned post-auction lease.

Do not preserve the current hybrid. It gives unpaid losers the product benefit
while giving the charged winner no guaranteed benefit after resolution.

### Implementation checklist for Model A

**Status: implemented and validated (uncommitted).** See "Implementation
evidence log" at the end of this document for the full validation record.
Honest per-item breakdown below — every checked item was proven at runtime,
not just typed.

- [x] Introduce an explicit lease/display concept, either a `Lease` record or a
      clearly separated incumbent display state on `Plot`. — Implemented as
      the second option: `Plot.tenant*` fields (`tenantPreBidId`,
      `tenantCompanyName`, `tenantTagline`, `tenantTwitterHandle`,
      `tenantLogoUrl`, `tenantMrrText`, `tenantLogoHidden`, `tenantTargetUrl`,
      `tenantSince`), fully separate from the pre-existing
      `currentLeaderPreBidId` auction-progress pointer. No new `Lease` table —
      a plot has exactly one tenant slot, which matches "at most one active
      lease per plot" for free.
- [x] Define canonical states and transitions for auction and lease
      independently. — Auction: `Plot.status` (`IDLE`/`LIVE`) driven by
      `AuctionCycle`, untouched by this fix. Lease: orthogonal, mutated only
      by the new `activateTenant()` in `engine.ts`, called only from
      `worker.ts` at successful paid settlement. Auction state can flip
      freely without ever touching lease state.
- [x] Define when the next auction opens relative to the active lease. —
      Unchanged from the pre-existing M2 2.3 rule (queued pre-bids → next
      cycle opens immediately; none → plot goes `IDLE`, claimable again),
      now explicitly decoupled from tenant display via correction notes in
      `docs/plans/02-reservations-and-realtime/phases/phase-03-expiry-sweep.md`.
      The next auction can open (and even resolve) while the active lease's
      tenant keeps displaying, uninterrupted.
- [x] Stop `resolveCycle` from projecting provisional bidder branding onto the
      public incumbent display. — `resolveCycle()` in `engine.ts` is now
      strictly auction-progress-only (price/leader pointer/soft-close); it
      never touches `Plot.tenant*`.
- [x] At successful settlement, activate the winner for the complete
      documented lease duration. — **Interpretive note:** this codebase has no
      fixed calendar lease duration (e.g. "7 days"); "complete lease duration"
      is implemented as open-ended — a winner stays active tenant until the
      *next* cycle produces a new paid winner. This was confirmed with the
      product owner as the intended reading of Model A, not assumed
      unilaterally. If a fixed-term lease (with its own expiry/renewal clock)
      was actually intended, that is new scope beyond this fix and should be
      raised explicitly.
- [x] Keep the incumbent visible while the next auction is open. — This is
      the flagship proof: `scripts/e2e-full-loop.ts` step 6 asserts the prior
      paid winner (Bob) still shows as `plot.tenant` while a second cycle is
      `LIVE` and being contested by a new bidder (Cara), and
      `scripts/resolve-worker-proof.ts` scenario B asserts the same at the
      worker level. Both verified passing against a live DB + server this
      session, not just typechecked.
- [x] Define the behavior when every capture fails. — Two cases, both now
      covered: (a) plot had no prior tenant → stays empty/`IDLE`, nothing to
      lose (pre-existing, unaffected); (b) plot already had a standing tenant
      from an earlier lease → that tenant is **not** evicted by the new
      cycle's total failure. Case (b) was the gap — `resolve-worker-proof.ts`
      scenario D was strengthened this session to seed a pre-existing tenant
      before the all-captures-fail flow and assert they survive untouched.
- [x] Define the behavior when there are no queued bids at lease expiry. —
      **Interpretive note:** there is no lease-expiry clock independent of
      auction-cycle resolution in this model (see the open-ended-duration
      note above), so this reduces to "no queued pre-bids at cycle
      resolution": plot returns to `IDLE`, `currentCycleId = null`, and
      tenant fields are left exactly as `activateTenant()` last set them
      (either the just-activated new winner, or an unchanged pre-existing
      tenant if this cycle produced no winner). Proven by
      `e2e-full-loop.ts` step 7 and `resolve-worker-proof.ts` scenario A.
- [ ] Define cancellation, moderation, and failed-authorization transitions. —
      **Not fully done — flagging honestly.** Failed-authorization is well
      covered (capture-failure cascade, pre-bid attach-auth failure; both
      pre-existing from M2 2.3 and re-verified compatible with this fix, plus
      strengthened per the item above). **Cancellation and moderation flows
      do not exist anywhere in this codebase** — there is no admin action to
      cancel an active lease or moderate/remove objectionable tenant brand
      content. This was already absent before this fix and is out of this
      session's scope; leaving unchecked rather than claiming false coverage.
      Recommend a follow-up part/finding if this is needed before launch.
- [x] Update REST DTOs, SSE events, UI terminology, and milestone plans to use
      the same lifecycle vocabulary. — `types/api.ts` (`TenantBrandDto`,
      `PlotDto.tenant`/`tenantPreBidId`, `RealtimeEventDto.winner.preBidId`),
      `bus.ts`, `serializers.ts`, client store/hooks/components (`isTenant`,
      `MyLeasesPill`, `DetailCard`'s `TenantMeta`/`AuctionMeta` split,
      `PlotSkins`' `★ LEADING` vs. tenant billboard copy) all updated. The
      original M0-M2 milestone plan docs under `docs/plans/**/phases/*.md`
      (and two `PLAN.md` overviews) that described the now-fixed buggy
      behavior as intended design have been annotated in place with
      `> **Correction (Part 1 lifecycle fix, M2):**` blockquotes rather than
      silently rewritten, preserving the historical record of what was
      originally planned while making the current, corrected behavior
      unambiguous to future readers.

### Required invariants

- [x] Every charged winner receives the full advertised benefit. — Proven by
      `scripts/e2e-full-loop.ts`'s full 7-step walk: the paid winner is
      activated as `tenant` synchronously with capture in `worker.ts`.
- [x] A losing bidder cannot receive the same billboard exposure for free. —
      `bid:placed` carries no brand at all (only price/`isProxy`/leader
      pointer); proven structurally by `tests/realtime/bus.test.ts`'s privacy
      assertions and at runtime by `e2e-full-loop.ts` steps 1-2.
- [x] A failed capture never creates an active lease. — `activateTenant()` is
      only ever called from the successful-capture path in `worker.ts`; the
      capture-failure cascade (`finalize.ts`, pre-existing) never calls it.
      Proven by `resolve-worker-proof.ts` scenario D.
- [x] One plot has at most one active lease and one open auction. —
      Structural: `Plot.tenant*` is a single field set (not a collection) and
      `Plot.currentCycleId` is a single nullable FK, so the schema itself
      makes a second concurrent lease or auction on the same plot
      unrepresentable.
- [x] Auction leader, auction winner, and active tenant are distinct
      concepts. — The central fix: `currentLeaderPreBidId` (live auction
      progress, cleared on every `IDLE` transition), the resolution-time
      winner (`outcome.winnerPreBidId`, a point-in-time event), and
      `tenant*`/`tenantPreBidId` (the standing active tenant, status
      independent) are now three separately-named, separately-mutated
      concepts with no shared write path.
- [x] Public payloads never label the previous winner as the new cycle
      leader. — Proven by the flagship assertion in `e2e-full-loop.ts` step 6
      (Bob, the paid winner, keeps showing as `tenant` while Cara is merely
      `currentLeaderPreBidId` on a new, separate, contested cycle) and by
      `resolve-worker-proof.ts` scenario B's rewritten assertion.
- [x] Refresh, reconnect, and worker retry preserve the same visible tenant. —
      Refresh/reconnect trivially hold since tenant state is DB-backed, not
      derived from any ephemeral in-memory value. Worker retry/concurrency
      safety was already proven pre-existing (scenario E: five concurrent
      sweeps resolve exactly once; scenario F: stuck-`RESOLVING` recovery and
      same-sweep re-resolution) — this session only had to re-verify those
      scenarios' tenant-display assertions still hold under the new field
      names and semantics, which they do.

### Acceptance evidence

- [x] A state-transition test covers IDLE, auction open, auction resolving,
      lease active, next auction, capture failure, and return to
      availability. — **Honest nuance:** not one single named test, but
      collectively covered end to end across `scripts/resolve-worker-proof.ts`
      (6 scenarios: basic resolution, queued-pre-bid rollover, all-queued-
      auth-failure, all-capture-failure, concurrent-sweep safety, stuck-
      recovery) and the pre-existing `tests/auction/capture-cascade.test.ts`
      (6 unit tests covering the capture-failure cascade in finer-grained
      detail). Both verified passing this session — `capture-cascade.test.ts`
      via `npm test`, `resolve-worker-proof.ts` via live execution against a
      real Postgres DB.
- [x] An end-to-end test proves the winner remains visible for the promised
      interval while a later auction is contested. — `scripts/e2e-full-loop.ts`
      step 6, executed live against a running dev server + DB this session,
      not just typechecked.
- [x] An end-to-end test proves a losing provisional bidder receives no
      unintended public placement. — `scripts/e2e-full-loop.ts` steps 1-2 and
      `tests/realtime/bus.test.ts`'s explicit privacy assertions (no
      `bidderId`, no `companyName`/`maxBidCents` substring anywhere in a
      `bid:placed` payload).
- [x] Product copy and diagrams describe exactly the behavior implemented. —
      `README.md`'s lifecycle description, in-app copy (`RoofBadge`'s
      `★ LEADING` vs. tenant billboard text, `DetailCard`'s split
      tenant/auction sections, `MyLeasesPill`'s tenancy-based count) and the
      original M0-M2 milestone plan docs (annotated with correction notes,
      see checklist item 10 above) are now consistent. No lifecycle/state
      diagrams exist in this repo beyond `docs/plans/README.md`'s
      milestone-dependency flowchart, which does not reference lease/auction
      terminology and needed no change.

### Implementation evidence log

Full technical detail lives in the diffs themselves; this is the validation
record for anyone auditing this checkbox pass.

**Root cause (as found):** `resolveCycle()` wrote the current bidding
leader's brand onto `Plot`'s public fields on every tick — live, unpaid
exposure. The worker's next-cycle-open path re-ran `resolveCycle` and
overwrote the just-installed winner's brand with the new cycle's leader.
`serializePlot` gated all brand fields behind `status === 'LIVE'`, hiding a
winner with no follow-up bidder the moment their plot went `IDLE`. The public
SSE `winner.bidderId` additionally leaked a bidder's pseudonymous cookie id.

**Fix shape:** `Plot.leader*` renamed to `Plot.tenant*` (`tenantPreBidId`,
`tenantSince`, plus the brand fields) via a hand-authored migration.
`resolveCycle()` in `engine.ts` made strictly auction-progress-only. New
`activateTenant()` added as the sole tenant-mutation entrypoint, called only
by `worker.ts` at successful paid settlement. `worker.ts` sequences
`resolveCycle` (ledger) → `activateTenant` (tenant handoff) → mark `WON`,
never wipes tenant fields on an `IDLE` transition, and always clears
`currentLeaderPreBidId` on `IDLE` regardless of outcome. DTOs
(`types/api.ts`), the realtime bus (`bus.ts`), and `serializers.ts` all
updated to match — `TenantBrandDto` replaces `LeaderBrandDto`,
`RealtimeEventDto.winner` carries `preBidId` instead of `bidderId`, and brand
serialization is gated on `tenantPreBidId` existing, not on `status`. Client
store/hooks/components (`ownership.ts`'s `isTenant`, `hud-hooks.ts`'s
`useMyLeases`, `MyLeasesPill`, `PlotSkins`, `DetailCard`, `realtime.ts`)
updated to consume the new contract, and `bid`/`claim` routes no longer pass
a `brand` to `emitBidPlaced`.

**Validation performed, all passing:**

- `npx tsc --noEmit` — clean.
- `npm test` — 138/138 passing at re-verification time (the doc originally
  recorded 52/52 when Part 1 landed; later parts added suites — count
  re-verified 2026-09-03), including the rewritten
  `tests/realtime/bus.test.ts` with explicit privacy assertions.
- `npm run build` — succeeds (Next.js 16.3.4, Turbopack).
- `npm run lint` — clean.
- Repo-wide grep for every old `leader*` brand field name and
  `LeaderBrandDto` across `src/`, `scripts/`, `tests/`,
  `prisma/schema.prisma` — zero matches outside historical migration files
  and the still-valid `currentLeaderPreBidId` auction-progress field.
- **Live runtime execution** (not just typecheck) of all 5 diagnostic
  scripts against a real dev Postgres DB and a freshly built Next.js server:
  `resolve-worker-proof.ts` (all 6 scenarios A-F pass, including two
  strengthened Model A invariant checks), `e2e-full-loop.ts` (full 7-step
  walk passes, including the flagship "paid winner stays tenant through a
  contested next auction" assertion), `concurrency-claims.ts`,
  `concurrency-bids.ts`, and `stress-busy-launch.ts` (verified via direct
  Prisma query that zero plots received unpaid brand exposure from the
  fixture).

**Known gaps, flagged rather than hidden:**

- Cancellation and moderation flows do not exist in this codebase (checklist
  item 9). Pre-existing absence, not introduced or fixed by this pass.
- The "lease duration" is open-ended (until the next paid winner), not a
  fixed calendar term. Confirmed with the product owner as the intended
  reading of Model A before implementation began — flagged again here in
  case expectations differ from what shipped.
- Nothing in this pass has been committed. All changes are uncommitted in
  the working tree pending explicit instruction to commit.