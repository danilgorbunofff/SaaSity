# Part 3 - Auction Engine, Worker, and Payments

**Depends on:** Parts 1 and 2  
**Affected phases:** M2 2.2-2.3 and the M3 settlement seam

## [Blocking] `worker-endat-race`

The sweep finds expired cycle IDs once, processes them sequentially, and claims
each by ID/status without confirming it is still expired. A late bid may extend
`endAt`, yet the worker can close the cycle immediately afterward.

- [ ] Include `endAt <= claimNow` in the conditional OPEN-to-RESOLVING update.
- [ ] Recheck `endAt` after acquiring the plot lock.
- [ ] Return the cycle to OPEN without settlement when it was extended.
- [ ] Use one captured timestamp consistently for claim eligibility.
- [ ] Add a deterministic interleaving test: sweep read, late bid extension,
      worker claim.

**Acceptance:** every successful late bid receives the complete soft-close
window even when a worker run is already in progress.

## [High] `live-bid-authorization-seam`

`authorizePreBidAtAttach` is called only for queued next-cycle attachment.
Immediate claims/bids and queued rows attached by the claim path can enter a
live cycle without a PaymentIntent.

- [ ] Enumerate every transition from `cycleId = null` to a real cycle.
- [ ] Authorize immediate claim/bid rows at their attach boundary.
- [ ] Authorize queued rows attached through both worker rotation and claim.
- [ ] Exclude failed authorizations before proxy resolution.
- [ ] Persist PaymentIntent ID/status atomically with attach state.
- [ ] Keep Stripe network I/O outside long database transactions.
- [ ] Update the M3 seam document; this is not only a stub-body replacement.

## [High] `idle-prebid-squatting`

The pre-bid route accepts IDLE plots despite the explicit LIVE-only contract.
Anonymous users can queue large permanent maxima before another user claims.

- [ ] Return a state-specific conflict for IDLE plots.
- [ ] Direct IDLE users to the claim action.
- [ ] Revalidate plot state inside the plot lock.
- [ ] Define expiry/cancellation policy for legitimately queued future bids.
- [ ] Add API tests for IDLE, LIVE, resolving, stale-cycle, and unknown plots.

## [High] `queued-max-downgrade`

When a queued row is attached, `upsertPreBid` can overwrite a higher maximum
with a lower submitted value.

- [ ] Apply the upward-only invariant to both exact-cycle and queued rows.
- [ ] Preserve the higher existing maximum unless an explicit secure decrease
      workflow is designed.
- [ ] Test claim, bid, attach, duplicate request, and stale-tab paths.

## [High] `soft-close-budget`

The extension counter charges a full three minutes per late request, even when
the actual `endAt` movement is only seconds. The two-hour budget can therefore
expire after only minutes of real extension.

- [ ] Track actual extension milliseconds or a fixed maximum end timestamp.
- [ ] Cap against `originalEndAt + 2 hours`.
- [ ] Keep reset-to-three-minutes behavior.
- [ ] Ensure one request can attribute at most one extension.
- [ ] Test rapid bids, boundary timestamps, cap exhaustion, and clock skew.

## [Medium] `extension-audit-missing`

`Bid.triggeredExtension` exists but no Bid writer sets it.

- [ ] Identify the single ledger row representing the triggering request.
- [ ] Persist `triggeredExtension = true` on exactly that row.
- [ ] Keep generated proxy ticks false.
- [ ] Assert attribution in soft-close and concurrency tests.

## [High] `cron-not-configured`

The protected worker route exists, but no committed schedule invokes it.
Read-path fire-and-forget work is neither reliable nor sufficient.

- [ ] Configure the production scheduler for the supported Vercel plan.
- [ ] Document actual schedule granularity and expected resolution latency.
- [ ] Authenticate the trigger with `WORKER_SECRET`.
- [ ] Remove or redesign fire-and-forget work after the response.
- [ ] Keep opportunistic recovery only as a secondary mechanism.
- [ ] Alert when ended cycles exceed the expected worker interval.

## [High] `capture-replay`

A capture may succeed outside the settlement transaction, settlement may fail,
and the `finally` block may reopen the cycle without a durable capture marker.
A retry can mark the paid winner failed and capture a fallback bidder.

- [ ] Model settlement as a persisted idempotent state machine.
- [ ] Store capture attempt, PaymentIntent ID, idempotency key, amount, status,
      and Stripe result before selecting a fallback.
- [ ] Treat "already captured" as success for the same intended settlement.
- [ ] Never reopen a cycle after confirmed capture without reconciliation.
- [ ] Separate retryable transport failures from definitive card failures.
- [ ] Persist loser-release failures for retry instead of swallowing them.
- [ ] Add crash-point tests before capture, after capture, before DB commit, and
      after DB commit.

## Worker and engine completion gate

- [ ] Concurrent claims produce one cycle.
- [ ] Concurrent bids preserve one mathematically correct leader and price.
- [ ] Queued maxima are never reduced implicitly.
- [ ] Soft-close survives an overlapping worker run.
- [ ] Overlapping workers settle each cycle once.
- [ ] Every external payment operation is idempotent and reconcilable.
- [ ] No catch block silently converts a failed settlement into success.

