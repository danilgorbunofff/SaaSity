# Part 7 - Testing, Release, and Documentation

**Status:** 🟡 In progress (2026-09-03 — CI gates + M0 evidence + status governance landed; preview/device/browser items honestly pending, no deployment exists)
**Depends on:** Parts 1-6
**Affected phases:** Every M0-M2 phase

## Part 7 evidence log (this pass)

- `npx tsc --noEmit` clean; `npm test` 138/138 (incl. 10 new: 5 in `tests/server/serializers.test.ts` + 5 in `tests/server/cron-auth.test.ts`); `npm run format:check` clean; `npm run lint` (`--max-warnings=0`) clean; `npm run build` clean (all 11 routes listed, re-verified 2026-09-03 in this strict pass).
- CI (`ci.yml`) now gates: fresh install (`npm ci` → `prisma generate` via postinstall) → shadow-DB drift check → `migrate deploy` → seed → **format check (new)** → typecheck → lint (`--max-warnings=0`) → tests → build. That is the repeatable clean-checkout proof — it runs on a fresh runner every push.
- M0 exit criteria re-adjudicated with evidence links (PLAN.md + phases 0.1–0.3); roadmap + M0/M1/M2/M3 statuses corrected to the verification-state vocabulary below.
- Phase 2.4's "prod preview" box reopened and 2.5's Verification qualified as local-only (`preview-proof-overclaim`).
- Honestly NOT done here (no deployment, device lab, or browser farm in this environment): preview smoke test, migration-from-current-release test, cross-instance fan-out timing, real-device perf run, manual keyboard/screen-reader/responsive passes. Each is recorded below as pending with its exact procedure — not waived.

## [High] `test-coverage-gap`

The green suite primarily covers pure helpers and event fan-out. Standard
`npm test` does not exercise API routes, serializers, database transactions,
migrations, React components, full browser flows, or deployment topology.

### Required automated layers

- [x] Clean-checkout install/generate/migrate/seed/build test. — CI does exactly this on a fresh runner every push (`npm ci` → drift check → `migrate deploy` → `db:seed` → `tsc` → lint → test → `next build`). No separate script needed; the pipeline IS the test.
- [ ] Migration-from-empty and migration-from-current-release tests. — From-empty: covered (CI migrates a fresh service DB every run). From-current-release: PENDING — needs a baseline dump + upgrade rehearsal once a production database exists; procedure belongs in `docs/deployment.md` go-live, not in this repo yet.
- [x] REST and SSE serializer privacy tests. — `tests/server/serializers.test.ts` (PlotDto/BidTickDto shapes, tenant-vs-leader independence, hostile-row leak scan) + `tests/realtime/bus.test.ts` privacy case; both run in CI.
- [ ] API integration tests for claim, bid, pre-bid, owner view, ledger,
      mock resolution, and cron authorization. — PARTIAL: cron authorization is unit-pinned (`tests/server/cron-auth.test.ts`, pure rule extracted to `src/server/cron-auth.ts`); mock-payment guards in `tests/auction/mock-payments.test.ts`; full HTTP claim/bid/pre-bid paths are exercised by proof scripts (`concurrency-claims/bids`, `prebid-states`, `queued-max`, `e2e-full-loop`) but not yet as CI-runnable DB integration tests. Promoting them needs a CI Postgres-backed integration job — recorded, not started.
- [x] Real Postgres concurrency tests for duplicate claims and concurrent bids. — Proof scripts `scripts/concurrency-claims.ts` + `scripts/concurrency-bids.ts` run against real Postgres (advisory-lock serialization). Manual trigger today; CI promotion pending with the integration job above.
- [x] Worker interleaving tests covering soft-close and overlapping sweeps. — `scripts/soft-close-proof.ts` + `scripts/resolve-worker-proof.ts` (incl. overlapping-sweep + stale-recovery cases) against real Postgres. Same CI-promotion note.
- [x] Settlement crash/idempotency tests at every external-call boundary. — `scripts/settlement-crash-proof.ts` (crash before/after capture, idempotency-key replay) + `tests/auction/capture-cascade.test.ts` in CI.
- [x] Cross-process realtime integration test. — `scripts/realtime-fanout-proof.ts` (two SSE observers + separate bidder sessions, outbox-backed fan-out). Cross-*instance* (two Vercel lambdas) timing still needs the preview deployment.
- [x] SSE initialization/disconnect leak test. — `tests/city/realtime-connection.test.ts` + 15-reconnect zero-leak run recorded in phase 2.4 evidence; slow-snapshot load test pending (needs a loaded DB).
- [x] React tests for modal validation and outbid-retry. — `tests/bid/submit-bid.test.ts` (outbid-retry UI-to-request) + `tests/validation/bid-form.test.ts` (validation incl. amount parser). NOT covered by automation (no jsdom/Testing Library harness in this repo; remains manual): component-level focus management, discard behavior, and prefill rendering.
- [ ] Component tests for modal focus, discard, and prefill rendering. — PENDING: needs a jsdom/Testing Library harness (not installed) or a recorded manual script; Part 6's open boxes are the interim procedure.
- [x] Browser end-to-end flow with at least two independent sessions. — `scripts/e2e-full-loop.ts` (38 assertions, three SSE sessions, real-browser pass in 2.5 evidence) — local prod-mode server. Preview re-run pending.
- [ ] Accessibility checks plus manual keyboard/screen-reader scripts. — PENDING: no axe harness, no screen-reader run recorded. Part 6's remaining manual boxes are the procedure; they need a human + browser.
- [ ] Responsive visual checks for desktop, short laptop, and mobile. — PENDING: same, Part 6 boxes.
- [ ] Real-device busy-launch performance run. — PENDING: Pixel 7a-class procedure documented in phase-05 addendum; no hardware in this environment.

### CI gates

- [x] Formatting check. — `npm run format:check` (`prettier --check .`), added to `ci.yml` by Part 7 after a 57-file conformance pass.
- [x] Lint with zero warnings. — `npm run lint` (`--max-warnings=0`) in CI since Part 2.
- [x] Typecheck. — `npx tsc --noEmit` in CI.
- [x] Unit tests. — `npm test` in CI (138 tests).
- [ ] Database integration tests. — PENDING: CI provisions a Postgres service and migrates/seeds it, but no test job hits it yet; proof scripts are the interim cover (see above).
- [x] Production build. — `npm run build` in CI.
- [ ] Preview smoke test. — PENDING: no deployment exists. When it does: deploy the exact commit, run the release-rehearsal flow below, record URL+SHA+date.
- [x] Migration drift check. — `prisma migrate diff --exit-code` against a shadow DB in CI since Part 2.

Manual proof scripts may remain useful diagnostics, but release-critical
behavior must run in CI or have clearly documented, repeatable external proof.

## [High] `preview-proof-overclaim`

Phase 2.4 says Vercel testing is pending while its exit criterion says all event
types were demonstrated in production preview. Phase 2.5 requires a preview URL
but cites a local production server.

- [x] Reopen every criterion lacking target-environment evidence. — DONE: phase 2.4's "demonstrated sub-second in prod preview" box reopened with the reason recorded; 2.5's Verification qualified as local-only. M0 "deployed" boxes left open (0.1 deploy URL, 0.3 deployed APIs).
- [ ] Deploy the exact reviewed commit to preview. — PENDING: no deployment exists (owner action, `docs/deployment.md` go-live checklist).
- [ ] Test across separate function instances where possible. — PENDING with deploy; the outbox transport was built for it (`serverless-local-bus` resolution), `realtime-fanout-proof.ts` covers cross-process locally.
- [ ] Record URL, commit SHA, date, environment flags, scenario, and result. — TEMPLATE SET: 2.4/2.5 now demand exactly these fields at their reopened boxes before they may be re-ticked.
- [x] Do not reuse localhost timing as serverless proof. — 2.4/2.5 evidence blocks now say LOCAL-ONLY explicitly; remediation README rule ("Never mark local `next start` evidence as preview/production proof") already forbids it.
- [x] Verify mock routes and controls are absent/disabled in production. — `MOCK_PAYMENTS` unset ⇒ `/api/mock-resolve/*` 404s, stubs throw `MockPaymentsDisabledError`, `/api/plots` reports `mockResolveEnabled: false` (tested: `tests/auction/mock-payments.test.ts`; `docs/deployment.md` §2/§4 makes "unset in Production" a go-live box).

## [Medium] `status-governance-drift`

The roadmap marks M0-M2 not started, M0 says Done with unchecked criteria, and
M2 says Not started while individual phases claim Done.

- [x] Use one status vocabulary across roadmap, milestone, and phase files. — DONE: roadmap table + verification-state note in `docs/plans/README.md`; Done = implemented + locally verified, preview/production verified are separate states.
- [x] Reopen every phase affected by this remediation pack. — DONE: M0 PLAN + phases 0.1–0.3, M1 PLAN, M2 PLAN, phases 2.4–2.5 now show 🟡 with the open boxes named; nothing claims ✅ while holding unchecked deploy/preview/device boxes except M3–M5 future work (correctly ⚪/🔴).
- [x] Link checked criteria to tests, run logs, or deployment evidence. — DONE for M0 (every ticked box names its test/file/CI step); 2.4/2.5 evidence blocks carry suite counts + environment.
- [x] Distinguish implemented, locally verified, preview verified, and production
      verified states. — vocabulary note in roadmap; 2.4/2.5 evidence stamped LOCAL-ONLY.
- [x] Remove dates/claims that cannot be reproduced. — 2.4 "prod server on :3457" reworded to local prod-mode server; M0 "Done (2026-09-01)" replaced with state descriptions.
- [ ] Update status only after the complete workstream is reviewed. — PROCESS RULE, kept: Parts 4–6 rows in the remediation index stay 🟡 (all committed; Part 7 gate still running); M3 stays 🔴 Blocked.

## Documentation corrections

- [x] Update the product lifecycle after Part 1. — done by Part 1 itself (lifecycle doc + corrections threaded through M0/M2/M3 phase files).
- [x] Add the real environment-variable reference and deployment URL. — HALF: env reference is real (`.env.example` per-variable labels + README table + `docs/deployment.md` §2). Deployment URL cannot exist before a deployment — recorded as the open 0.1 box, not claimed.
- [x] Correct Stripe Checkout terminology. — done before Part 7: M3 PLAN + phase 3.1 state Checkout Sessions are never used (cannot express hold-now/decide-later); SetupIntent + manual-capture PaymentIntent throughout. No stale usage remains in prose, contracts, or code — except the historical phase-01 filename slug (`phase-01-checkout-session-api.md`), kept to avoid breaking links; its content already disclaims Checkout.
- [x] Document scheduler ownership, cadence, secret configuration, alerts, and
      recovery. — `docs/deployment.md` §3 (primary/recovery/net layers, latency expectation, three alert lines) + `resolve-cron.yml` header + `STALE_ENDED_CYCLE_ALERT_MINUTES` pinned by `tests/auction/cron-staleness.test.ts`.
- [x] Document realtime deployment architecture and fallback behavior. — transport decision in 0.2 step 1 + 2.4 header (SSE + Postgres outbox, no broker); process-local Set documented as latency optimization only (`bus.ts` header); polling fallback + Vercel buffering caveat in 2.4 step 5.
- [x] Document anonymous bidder identity limitations. — new README "Bidder identity" section (cookie-bound identity, rotation logs out, shared-device caveat); rotation rule also in `.env.example`.
- [x] Reconcile M1 performance claims with real-device evidence. — already honest before Part 7: phase-05 records headless-desktop numbers only, names Pixel 7a-class reference device + `?perf=stats` procedure, M1 PLAN DoD phone box stays open. No change needed beyond keeping it open (done).
- [ ] Record known browser/accessibility constraints until fixed. — PENDING human passes: Part 6's open boxes (viewport matrix, axe findings, zoom/low-vision, screen-reader, one-handed mobile) ARE the constraint list; no separate constraints doc needed once they are worked, but they are not worked yet.
- [x] Keep M3 blocked in the roadmap until Parts 1-4 are complete. — M3 PLAN + roadmap row set to 🔴 Blocked with the gate named.

## Final release rehearsal

Locally runnable steps (this environment) vs. deployment-gated steps:

- [x] Apply every migration and seed the 49-plot grid. — CI does this fresh every push; rehearsal-grade locally via `npx prisma migrate deploy` + `npm run db:seed`.
- [x] Complete claim, concurrent bid, proxy bid, soft-close, resolution, active
      lease, next auction, capture failure, and return-to-availability flows. — covered locally by proof scripts (concurrency-claims/bids, soft-close, resolve-worker, settlement-crash, queued-max, e2e-full-loop). Fresh-clone start NOT rehearsed (would wipe this dev DB; CI's fresh service DB is the standing proof).
- [ ] Start from a fresh clone and empty database. — PENDING human run (destructive locally; CI approximates it per-push).
- [ ] Deploy preview with production-equivalent topology. — PENDING (no deployment).
- [ ] Observe the same state in multiple browsers and after refresh/reconnect. — PENDING (2.5's local multi-session pass is the interim evidence).
- [ ] Run keyboard, screen-reader, short-laptop, mobile, and reduced-motion passes. — PENDING (Part 6 open boxes).
- [ ] Confirm mock settlement is unreachable in production. — PROCEDURE READY, unexecuted: unset `MOCK_PAYMENTS` (go-live box, `docs/deployment.md` §4) + unit-pinned guards (`tests/auction/mock-payments.test.ts`).
- [ ] Confirm no private maximum, stable bidder ID, or non-public identity leaks. — unit-pinned locally (`serializers`, bus privacy, `public-bidder-id` fix); production re-confirmation rides with the preview smoke test.
- [ ] Record final evidence before marking M0, M1, or M2 complete. — THIS FILE + roadmap vocabulary; M0/M1/M2 stay 🟡 until preview evidence lands.

## Review artifacts

- Design critique:
  `.impeccable/critique/2026-09-02T18-31-06Z__src-app-page-tsx.md`
- Browser evidence:
  session artifact directory `files/design-review-b/`
- Canonical remediation index:
  [README.md](README.md)

