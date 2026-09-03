# Part 3 - Auction Engine, Worker, and Payments

**Depends on:** Parts 1 and 2  
**Affected phases:** M2 2.2-2.3 and the M3 settlement seam

## [Blocking] `worker-endat-race`

The sweep finds expired cycle IDs once, processes them sequentially, and claims
each by ID/status without confirming it is still expired. A late bid may extend
`endAt`, yet the worker can close the cycle immediately afterward.

- [x] Include `endAt <= claimNow` in the conditional OPEN-to-RESOLVING update.
- [x] Recheck `endAt` after acquiring the plot lock.
- [x] Return the cycle to OPEN without settlement when it was extended.
- [x] Use one captured timestamp consistently for claim eligibility.
- [x] Add a deterministic interleaving test: sweep read, late bid extension,
      worker claim.

**Acceptance:** every successful late bid receives the complete soft-close
window even when a worker run is already in progress.

*Fixed 2026-09-03 (worker.ts: claim predicate + under-lock recheck;
scripts/resolve-worker-proof.ts scenario G1/G2). Verified locally on
Windows + Node 24 against saasity_dev (localhost Postgres,
MOCK_PAYMENTS=1, worker run in-process): full proof PASS (A–G), G fails
11 checks on the pre-fix worker (stash-verified). tsc clean, 67/67 unit
tests pass, eslint zero warnings.*

## [High] `live-bid-authorization-seam`

`authorizePreBidAtAttach` is called only for queued next-cycle attachment.
Immediate claims/bids and queued rows attached by the claim path can enter a
live cycle without a PaymentIntent.

- [x] Enumerate every transition from `cycleId = null` to a real cycle.
- [x] Authorize immediate claim/bid rows at their attach boundary.
- [x] Authorize queued rows attached through both worker rotation and claim.
- [x] Exclude failed authorizations before proxy resolution.
- [x] Persist PaymentIntent ID/status atomically with attach state.
- [x] Keep Stripe network I/O outside long database transactions.
- [x] Update the M3 seam document; this is not only a stub-body replacement.

*Fixed 2026-09-03. Transition table (T1–T5) in finalize.ts header; single
choke point `authorizeAttachedRows` (seam: skips non-ACTIVE, skips
intent-carrying rows for idempotent retry, authorizer I/O always outside
txs, per-row outcome in its own tx, failures EXPIRED/'expired', intent ids
persisted only via `attachStripePaymentIntentId`). Worker final tx split
(settle+stage → authorize → attach-survivors-by-id+resolve/cancel); bulk
`attachQueuedPreBids` replaced by explicit-id `attachPreBidsToCycle`.
Claim pre-authorizes queued rows and post-commit authorizes the claimer;
bid post-commit authorizes the bidder; both compensate (EXPIRED +
re-resolve, shell-cancel when empty, matching realtime events) and answer
402 `authorization-failed`. New scripts/authorize-attach-proof.ts (13/13).
The authorize stub is deliberately NOT MOCK-gated (it fakes no money;
gating bricked flagless claims/bids — caught by HTTP proofs) while
capture/cancel stay gated; mock-payments.test.ts updated to the contract.
Verified locally (Windows + Node 24, saasity_dev + prod build on :3457):
worker B/C rotation still PASS, soft-close/queued-max proofs PASS,
prebid-states 16/16 + concurrency PASS over HTTP without the flag,
tsc clean, 67/67 unit tests pass, eslint zero warnings.*

## [High] `idle-prebid-squatting`

The pre-bid route accepts IDLE plots despite the explicit LIVE-only contract.
Anonymous users can queue large permanent maxima before another user claims.

- [x] Return a state-specific conflict for IDLE plots.
- [x] Direct IDLE users to the claim action.
- [x] Revalidate plot state inside the plot lock.
- [x] Define expiry/cancellation policy for legitimately queued future bids.
- [x] Add API tests for IDLE, LIVE, resolving, stale-cycle, and unknown plots.

*Fixed 2026-09-03 (prebid route: in-lock status revalidation, 409
`claim-first` on IDLE, queued-row policy in the docblock;
submit-bid.ts `claim-first` kind; BidModal flips stale pre-bid tabs into
claim mode keeping typed values; scripts/prebid-states-proof.ts).
Verified over real HTTP against `next build && next start -p 3457`
(Windows + Node 24, saasity_dev): 16/16 checks PASS (404 unknown, 409
claim-first + nothing queued on IDLE, 200 during RESOLVING handover and
stale-cycle LIVE, 200 + 409 not-higher on LIVE+OPEN, claim→pre-bid flow).
tsc clean, 67/67 unit tests pass, eslint zero warnings.*

## [High] `queued-max-downgrade`

When a queued row is attached, `upsertPreBid` can overwrite a higher maximum
with a lower submitted value.

- [x] Apply the upward-only invariant to both exact-cycle and queued rows.
- [x] Preserve the higher existing maximum unless an explicit secure decrease
      workflow is designed.
- [x] Test claim, bid, attach, duplicate request, and stale-tab paths.

*Fixed 2026-09-03 (engine.ts upsertPreBid queued branch: Math.max guard;
scripts/queued-max-proof.ts scenarios A–E). Verified locally (Windows +
Node 24, saasity_dev): proof PASS; tsc clean.*

## [High] `soft-close-budget`

The extension counter charges a full three minutes per late request, even when
the actual `endAt` movement is only seconds. The two-hour budget can therefore
expire after only minutes of real extension.

- [x] Track actual extension milliseconds or a fixed maximum end timestamp.
- [x] Cap against `originalEndAt + 2 hours`.
- [x] Keep reset-to-three-minutes behavior.
- [x] Ensure one request can attribute at most one extension.
- [x] Test rapid bids, boundary timestamps, cap exhaustion, and clock skew.

*Fixed 2026-09-03 (engine.ts applySoftClose: budget derived from endAt
itself as actual ms past `startedAt + durationMinutes`, hard-capped at
originalEnd + 120min; sub-minute pushes no longer round to zero budget;
softCloseExtensions kept as an event counter; same-timestamp double-call
is a no-op). Also fixes a latent over-grant: the old counter charged
`round(pushMs/1min)`, so short pushes consumed zero budget (unbounded
extensions). Verified locally (Windows + Node 24, saasity_dev):
soft-close proof ALL PASS (rewritten C/C2, new F1–F4); worker proof A–G
and queued-max proof still PASS; tsc clean, 67/67 unit tests pass,
eslint zero warnings.*

## [Medium] `extension-audit-missing`

`Bid.triggeredExtension` exists but no Bid writer sets it.

- [x] Identify the single ledger row representing the triggering request.
- [x] Persist `triggeredExtension = true` on exactly that row.
- [x] Keep generated proxy ticks false.
- [x] Assert attribution in soft-close and concurrency tests.

*Fixed 2026-09-03 (engine.ts resolveCycle: `triggeredExtension` requester
option marks the written tick; orphan branch writes the requester's own
marked tick at the standing price when nothing moved; bid route passes it
iff applySoftClose extended; soft-close-proof.ts E1–E3; concurrency-bids.ts
marked===extended invariant). Verified locally (Windows + Node 24,
saasity_dev): soft-close proof ALL PASS incl. E1–E3; 6 parallel HTTP bids
(0 extended → 0 marked) PASS; scratch in-window run (4 parallel bids, 4
extended → exactly 4 marked) PASS; grid plot mid-10 reset to IDLE after.
tsc clean, 67/67 unit tests pass, eslint zero warnings.*

## [High] `cron-not-configured`

The protected worker route exists, but no committed schedule invokes it.
Read-path fire-and-forget work is neither reliable nor sufficient.

- [x] Configure the production scheduler for the supported Vercel plan.
- [x] Document actual schedule granularity and expected resolution latency.
- [x] Authenticate the trigger with `WORKER_SECRET`.
- [x] Remove or redesign fire-and-forget work after the response.
- [x] Keep opportunistic recovery only as a secondary mechanism.
- [x] Alert when ended cycles exceed the expected worker interval.

*Fixed 2026-09-03. Primary = GitHub Actions every 5 min (already committed,
Bearer WORKER_SECRET); safety net = vercel.json daily cron (Hobby ceiling);
read-path sweep demoted to a documented SECONDARY net that logs instead of
swallowing (`[auction:sweep]` warn when it settles anything). Staleness
alert: pure `staleCyclesSummary` (unit-tested, 5 new tests) wired into
resolveEndedCycles — structured `[auction:worker] stale ended cycles` warn
+ `staleCount/maxStaleMs` in the cron JSON; alert line 10 min (= 2x primary
cadence). RESOLVING_TIMEOUT 5 → 10 min for the same reason (F-proof uses a
relative timestamp, unaffected). deployment.md §3 documents the three
layers, <10min expected latency, and what to monitor. Verified locally:
72/67+5 unit tests pass, worker proof A–G PASS, tsc clean, eslint clean.*

## [High] `capture-replay`

A capture may succeed outside the settlement transaction, settlement may fail,
and the `finally` block may reopen the cycle without a durable capture marker.
A retry can mark the paid winner failed and capture a fallback bidder.

- [x] Model settlement as a persisted idempotent state machine.
- [x] Store capture attempt, PaymentIntent ID, idempotency key, amount, status,
      and Stripe result before selecting a fallback.
- [x] Treat "already captured" as success for the same intended settlement.
- [x] Never reopen a cycle after confirmed capture without reconciliation.
- [x] Separate retryable transport failures from definitive card failures.
- [x] Persist loser-release failures for retry instead of swallowing them.
- [x] Add crash-point tests before capture, after capture, before DB commit, and
      after DB commit.

*Fixed 2026-09-03. New SettlementAttempt ledger (migration
add_settlement_attempts; kinds CAPTURE/RELEASE; PENDING → CAPTURED /
FAILED_DEFINITIVE / FAILED_RETRYABLE, PENDING → RELEASED / RELEASE_FAILED).
runCaptureCascade records every money intent BEFORE the Stripe call under a
stable key (`saasity:v1:{capture,release}:…`, M3 passes it to Stripe);
CaptureFailureError taxonomy (retryable transport vs definitive card,
unknowns abort — never a fallback on uncertain money); recorded CAPTURED
adopts with zero new calls; releases persist RELEASE_FAILED for sweep
retry. Worker: settle+rotate extracted to settleAndRotate (shared by live
and reconcile paths); aborted passes return to OPEN; finally + stuck
recovery never reopen a confirmed capture; reconcileCapturedCycle settles
from the record (RESOLVED replays idempotently); sweep isolates per-cycle
failures and retries releases (new reconciled/releasesRetried counters).
New scripts/settlement-crash-proof.ts P1–P7 ALL PASS (incl. exactly-one
charge and zero-recall adoption). Cascade unit tests extended (abort,
adopt, release-failed) with a memory AttemptStore fake; mock-payments
updated to the abort contract. Verified locally: worker A–G, queued-max,
soft-close, prebid 16/16, authorize 13/13, concurrency HTTP PASS; 75/75
unit tests; tsc + eslint clean.*

## Worker and engine completion gate

- [x] Concurrent claims produce one cycle.
- [x] Concurrent bids preserve one mathematically correct leader and price.
- [x] Queued maxima are never reduced implicitly.
- [x] Soft-close survives an overlapping worker run.
- [x] Overlapping workers settle each cycle once.
- [x] Every external payment operation is idempotent and reconcilable.
- [x] No catch block silently converts a failed settlement into success.

*Gate run 2026-09-03 (Windows + Node 24, saasity_dev): concurrency-bids
HTTP PASS (one leader, second-price convergence); worker proof A–H PASS
(E: 5 concurrent sweeps settle exactly once); queued-max, soft-close
(incl. G worker-overlap), prebid-states 16/16, authorize-attach 13/13,
settlement-crash P1–P7 PASS; 75/75 unit tests; tsc clean; eslint zero
warnings; `npm run build` green. Catch audit: authorize failures →
EXPIRED/402, capture failures → FAILED_*/abort-or-fallback, sweep
failures → logged + continued, releases → RELEASE_FAILED + retried —
nothing converts failure into success.*

