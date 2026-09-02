# Part 7 - Testing, Release, and Documentation

**Depends on:** Parts 1-6  
**Affected phases:** Every M0-M2 phase

## [High] `test-coverage-gap`

The green suite primarily covers pure helpers and event fan-out. Standard
`npm test` does not exercise API routes, serializers, database transactions,
migrations, React components, full browser flows, or deployment topology.

### Required automated layers

- [ ] Clean-checkout install/generate/migrate/seed/build test.
- [ ] Migration-from-empty and migration-from-current-release tests.
- [ ] REST and SSE serializer privacy tests.
- [ ] API integration tests for claim, bid, pre-bid, owner view, ledger,
      mock resolution, and cron authorization.
- [ ] Real Postgres concurrency tests for duplicate claims and concurrent bids.
- [ ] Worker interleaving tests covering soft-close and overlapping sweeps.
- [ ] Settlement crash/idempotency tests at every external-call boundary.
- [ ] Cross-process realtime integration test.
- [ ] SSE initialization/disconnect leak test.
- [ ] React tests for modal validation, focus, discard, retry, and prefill.
- [ ] Browser end-to-end flow with at least two independent sessions.
- [ ] Accessibility checks plus manual keyboard/screen-reader scripts.
- [ ] Responsive visual checks for desktop, short laptop, and mobile.
- [ ] Real-device busy-launch performance run.

### CI gates

- [ ] Formatting check.
- [ ] Lint with zero warnings.
- [ ] Typecheck.
- [ ] Unit tests.
- [ ] Database integration tests.
- [ ] Production build.
- [ ] Preview smoke test.
- [ ] Migration drift check.

Manual proof scripts may remain useful diagnostics, but release-critical
behavior must run in CI or have clearly documented, repeatable external proof.

## [High] `preview-proof-overclaim`

Phase 2.4 says Vercel testing is pending while its exit criterion says all event
types were demonstrated in production preview. Phase 2.5 requires a preview URL
but cites a local production server.

- [ ] Reopen every criterion lacking target-environment evidence.
- [ ] Deploy the exact reviewed commit to preview.
- [ ] Test across separate function instances where possible.
- [ ] Record URL, commit SHA, date, environment flags, scenario, and result.
- [ ] Do not reuse localhost timing as serverless proof.
- [ ] Verify mock routes and controls are absent/disabled in production.

## [Medium] `status-governance-drift`

The roadmap marks M0-M2 not started, M0 says Done with unchecked criteria, and
M2 says Not started while individual phases claim Done.

- [ ] Use one status vocabulary across roadmap, milestone, and phase files.
- [ ] Reopen every phase affected by this remediation pack.
- [ ] Link checked criteria to tests, run logs, or deployment evidence.
- [ ] Distinguish implemented, locally verified, preview verified, and production
      verified states.
- [ ] Remove dates/claims that cannot be reproduced.
- [ ] Update status only after the complete workstream is reviewed.

## Documentation corrections

- [ ] Update the product lifecycle after Part 1.
- [ ] Add the real environment-variable reference and deployment URL.
- [ ] Correct Stripe Checkout terminology.
- [ ] Document scheduler ownership, cadence, secret configuration, alerts, and
      recovery.
- [ ] Document realtime deployment architecture and fallback behavior.
- [ ] Document anonymous bidder identity limitations.
- [ ] Reconcile M1 performance claims with real-device evidence.
- [ ] Record known browser/accessibility constraints until fixed.
- [ ] Keep M3 blocked in the roadmap until Parts 1-4 are complete.

## Final release rehearsal

- [ ] Start from a fresh clone and empty database.
- [ ] Apply every migration and seed the 49-plot grid.
- [ ] Deploy preview with production-equivalent topology.
- [ ] Complete claim, concurrent bid, proxy bid, soft-close, resolution, active
      lease, next auction, capture failure, and return-to-availability flows.
- [ ] Observe the same state in multiple browsers and after refresh/reconnect.
- [ ] Run keyboard, screen-reader, short-laptop, mobile, and reduced-motion passes.
- [ ] Confirm mock settlement is unreachable in production.
- [ ] Confirm no private maximum, stable bidder ID, or non-public identity leaks.
- [ ] Record final evidence before marking M0, M1, or M2 complete.

## Review artifacts

- Design critique:
  `.impeccable/critique/2026-09-02T18-31-06Z__src-app-page-tsx.md`
- Browser evidence:
  session artifact directory `files/design-review-b/`
- Canonical remediation index:
  [README.md](README.md)

