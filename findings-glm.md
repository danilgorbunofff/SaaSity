# FINAL AUDIT REPORT — SaaSity M0-M2 Remediation (fresh-eye, adversarial)

**Auditor:** GLM 5.3 Flash (independent verification pass)
**Date:** 2026-09-03
**HEAD audited:** `a969e0a` ("Review remediation parts 1-7: verify and fix auction, realtime, 3D…"), working tree clean
**Method:** read-only. Every prior claim treated as untrusted; all gates re-run locally; doc checkboxes cross-checked against actual code, line by line. Ground truth = the 7 spec docs in `docs/reviews/m0-m2-remediation/`.

---

## Verification runs (independently executed)

| Gate | Result |
|---|---|
| `npm ci` (node 24 local) | exit 0 |
| `npx tsc --noEmit` (fresh checkout) | **FAIL** — TS2304 `Cannot find name 'LayoutProps'` @ `src/app/layout.tsx:25` |
| `npx tsc --noEmit` (after `npx next typegen`) | PASS |
| `npm test` | **138/138 PASS** |
| `npm run lint` | exit 0, 0 warnings |
| `npm run format:check` | exit 0 |
| `npm run build` | exit 0, all 11 routes |
| **CI run 33756066788 on main @ a969e0a (exact HEAD)** | **FAILURE** — died in `npm ci`: `EBADENGINE @prisma/streams-local@0.1.11 Required node>=22.0.0, Actual node v20.20.2` |
| Prior CI runs 33732315344 / 33718282864 | both failure (~34s, same npm ci stage) |
| CI run 33741510965 | "success" — but it is the scheduled resolve-cron workflow (6s, trivially passes when secrets unset), not the real CI |

**Conclusion: no real CI run for this codebase has ever gone green.**

---

## FINDINGS

### F1 — BLOCKER — CI is red at HEAD (falsifies Part 2/7 doc claims)
- **Where:**
  - `.npmrc:2` — `engine-strict=true`
  - `package.json:5-6` — `"engines": { "node": ">=20.9.0", "npm": ">=10" }`
  - `.nvmrc:1` — `20`
  - transitive dep `@prisma/streams-local@0.1.11` (of prisma 7.10.0) — declares `engines.node >= 22.0.0`
- **Spec requires:**
  - Part 2 (`part-02-foundation-delivery-data.md` lines 28-35), checkbox `[x]` "Document the supported Node and npm versions" — claims the engines+nvmrc+engine-strict combo is "verified".
  - Part 2 lines 36-45, checkbox `[x]` "Add a clean-checkout CI job" — claims "validated two ways… every step was dry-run locally".
  - Part 7 (`part-07-testing-release-documentation.md` line 10) — claims CI is "the repeatable clean-checkout proof — it runs on a fresh runner every push".
- **Actual:** CI's node v20.20.2 (resolved from `.nvmrc`) hard-fails `npm ci` under `engine-strict=true` because Prisma 7's transitive `@prisma/streams-local` requires node ≥22. Local node v24.13.0 masks the problem. The very mechanism the docs advertise as a safety feature is what kills the pipeline. **Both doc `[x]` claims are false at HEAD.**
- **Why it matters:** the entire remediation pack leans on "CI is the proof" as its release gate. The gate is red.

### F2 — MAJOR — CI Typecheck can never pass even after fixing the Node version
- **Where:**
  - `src/app/layout.tsx:25` — `export default function RootLayout({ children }: LayoutProps<'/'>)`. `LayoutProps` is a Next 16 global type declared ONLY in generated `.next/types/routes.d.ts`.
  - `tsconfig.json` — includes `.next/types/**/*.ts` and `next-env.d.ts`; **both are gitignored** (`.gitignore` lines 17/42).
  - `.github/workflows/ci.yml:84-85` — the Typecheck step runs `npx tsc --noEmit` with **no `next typegen` step before it**; `next build` (which would generate the types) runs last.
- **Actual:** fresh-checkout `tsc` fails TS2304; passes only after `npx next typegen`. Reproduced locally on this worktree. Falsifies Part 7 line 44 checkbox `[x] Typecheck`.
- **Why it matters:** fixing F1 alone still leaves CI red at Typecheck. Two independent breakers.

### F3 — MINOR — Part 4 doc checkbox/record inconsistency
- **Where:** `part-04-realtime-client-state.md` lines 12-33 (five required-boxes still `[ ]`) vs. the "Implementation record" (lines 140-199) claiming all six findings closed.
- **Actual:** the code substantiates the record (outbox bigserial seq / 200-row cap / poison-cursor / `eventKeyOf` dedup, subscribe-first SSE race fix, abort-leak cleanup, full next-cycle snapshot, `/api/me/bids` positions projection — all verified in source). So this is doc hygiene, not a false ✅. But the checkboxes should be ticked or annotated to match the record.

### F4 — MINOR — non-constant-time secret compare in cron-auth
- **Where:** `src/server/cron-auth.ts` compares `WORKER_SECRET` with plain `===`, while `src/server/bidder-cookie.ts` correctly uses `timingSafeEqual`.
- **Why it matters:** theoretical (network-jitter timing), but inconsistent with the repo's own crypto standard.

### F5 — MINOR — rate limiting remains per-process
- **Where:** `src/server/rate-limit.ts` — in-memory buckets, N instances grant N× budget.
- **Assessment:** explicitly documented as "Single-node dev guard" with Redis as the documented evolution path and fail-open semantics — defensible, but it is the one `serverless-local-bus` sub-item not truly closed at infrastructure level.

---

## Honest open items (correctly unticked — NOT false ✅s)

- **Part 1:** cancellation/moderation flows do not exist (flagged honestly in the doc).
- **Part 2:** commit-splitting by workstream + review-before-merge (deliberate, user-decided).
- **Part 5:** real-device perf run (Pixel 7a-class), headed browser visual passes, re-profile.
- **Part 6:** viewport matrix (1366x660 / 320x568 / 390x844 / landscape / 200% zoom), axe run, screen-reader pass, one-handed mobile pass.
- **Part 7:** preview deployment, DB-backed integration tests in CI, migration-from-current-release rehearsal, fresh-clone destructive rehearsal.

All are documented with exact procedures. The docs' honesty discipline here is genuinely good — the false claims are limited to F1/F2.

---

## CODE VERIFICATION (per part, all at HEAD)

### Part 1 — Product lifecycle ✅
Model A correctly implemented: `Plot.tenant*` fields fully separate from `currentLeaderPreBidId` auction-progress pointer; `activateTenant()` called only from the worker's successful-paid-settlement path; `resolveCycle()` strictly auction-progress-only; IDLE transition never wipes tenant fields; client `isTenant` / `MyLeasesPill` / `PlotSkins` (`★ LEADING` vs billboard copy) / `DetailCard` (tenant/auction split) consume the new contract. Grep sweeps: **zero** `bidderId` in `src/components` + `src/lib/city`; **zero** `LeaderBrandDto`/leader-brand leftovers anywhere in `src`. Privacy holds.

### Part 2 — Foundation/data ⚠️ (code good, CI claims false)
9 committed migrations + shadow-DB drift check (`migrate diff --exit-code`); deterministic seed with integrity-check abort (all plots IDLE); 12 proof scripts in `scripts/`; `.env.example` per-env labeled with `MOCK_PAYMENTS` never-production warning. CI *config* structure is correct (checkout → node → npm ci → shadow DB → drift → migrate → seed → tsc → format → lint → test → build) — **but see F1/F2: the pipeline is red at HEAD.**

### Part 3 — Engine/worker/payments ✅
Per-plot `pg_advisory_xact_lock(hashtextextended(plotId))`; soft-close budget derived from actual extension ms past `startedAt + duration`, hard-capped at `originalEndAt + 120min`, sub-minute pushes no longer round to zero; second-price math = `min(leader.max, second.max + increment)` clamped to floor; `triggeredExtension` attributed to exactly the triggering row; T1-T5 attach-transition enumeration with single choke point `authorizeAttachedRows` (authorizer I/O outside txs, per-row outcomes, EXPIRED + compensation, 402 `authorization-failed`); `SettlementAttempt` ledger (CAPTURE/RELEASE, PENDING → CAPTURED / FAILED_DEFINITIVE / FAILED_RETRYABLE / RELEASED / RELEASE_FAILED) with stable idempotency keys (`saasity:v1:{capture,release}:…`) recorded BEFORE any Stripe call; captures adopt idempotently; releases persist failures for sweep retry; sweep isolates per-cycle failures; catch audit line-by-line: every catch expires, aborts, retries, or logs — nothing converts failure into success.

### Part 4 — Realtime/client state ✅ (doc hygiene F3)
Outbox: bigserial `seq` global order, 200-row read cap ascending, cursor advances past malformed (poison) rows, 24h retention pruned fire-and-forget from cron route, `eventKeyOf` cross-copy dedup. SSE route: subscribe (L118) precedes watermark read (L134) precedes plot query (L139); race-window buffer replays in arrival order; abort listener attached before first await; `closed || aborted` checked after every await; `write` self-cleans on throw; single idempotent cleanup. Client: seq-gap → full resync; 3 consecutive malformed frames → re-anchor; visibility (stream) vs focus (data) split documented; `/api/me/bids` returns only `preBidId/plotId/cycleId/status` (never maxima); `deriveOutbidFromPositions` + `mergeOutbidPlotIds` rebuild/clear outbid from snapshots.

### Part 5 — 3D city/perf ✅
`buildSkinOverlays` builds one datum per seed plot for ALL tiers (36/12/1, regression-pinned in `tests/city/outer-skins.test.ts`) while tower bodies stay instanced (3 InstancedMeshes); SelectionRing (0.12 cyan pulse) distinct from hover (0.05 white); reduced-motion centralized (`reduced-motion.ts` media query + override + hook) with static high-contrast treatments for outbid/leading; shared tick stops on last unsubscribe and never starts on server; IS_LOW_POWER heuristic no longer treats every touch device as low power; TerracedHill overlap 0.01 anti-z-fight; `?perf=stats` / `DEBUG_OVERLAY` / `PERF_MINIMAL` instrumentation shipped. Device/browser evidence boxes honestly open.

### Part 6 — UI/UX/a11y ✅
BidModal: `max-h-[92dvh]` + internal scroll + backdrop scroll; strict amount parser (`bid-form.ts`: rejects commas, `5junk`, locale formats, signs, exponents; integer-cents math; MAX_BID_CENTS = 10M; contextual minimums; https-only target URL with hostile-host rejection); discard-confirm as focused alertdialog with focus restore; outbid retry applies `minimumNextBidCents` immediately and preserves values. Minimap: 24px cells, roving tabindex with edge-safe `findNextCell`, outbid flash with static reduced-motion variant. TopStrip: mobile disclosure, ConnectionBadge `role="status"` with sync age. Outbid state durable beyond the 8s toast. `formatMrrBadge` normalizes at both render sites. Browser-matrix boxes honestly open.

### Part 7 — Testing/release/docs ⚠️
All local gates independently re-verified green (138/138 tests; lint 0 warnings; format clean; build green; tsc clean **after typegen**). The doc's central claim — "CI gates: … That is the repeatable clean-checkout proof" — is **false** (F1, F2). The 138/138 count claim matches exactly. The honest-pending list is real and properly recorded.

---

## VERDICT PER PART

| Part | Verdict | % | Note |
|---|---|---|---|
| 1 — Product lifecycle | **PASS** | ~100% | One honestly-open box (cancellation/moderation) |
| 2 — Foundation/data | **FAIL** | ~80% | Code good; CI red at HEAD falsifies two `[x]` claims (F1, F2) |
| 3 — Engine/worker/payments | **PASS** | ~100% | Strongest part; proof-script claims consistent with code |
| 4 — Realtime/client state | **PASS** | ~97% | Code verified; checkbox hygiene (F3) |
| 5 — 3D city/perf | **PASS** | ~95% | Code verified; device evidence honestly open |
| 6 — UI/UX/a11y | **PASS** | ~97% | Code verified; browser matrix honestly open |
| 7 — Testing/release/docs | **FAIL** | ~85% | Local gates real; "CI as proof" claim false (F1, F2) |

---

## OVERALL: **FIX-FIRST** — do not ship

Ordered by risk:

1. **F1 (BLOCKER):** align the Node floor with Prisma 7's transitive requirement — bump `.nvmrc` to `22` and `engines.node` to `">=22"` (or pin prisma to a version whose `streams-local` supports node 20). One-line each.
2. **F2 (MAJOR):** add `npx next typegen` step to `ci.yml` before the Typecheck step (or move `tsc` after Build). One line.
3. Push and **watch CI go green on main** — only then do the Part 2/7 claims become true; verify run history shows a success.
4. **F3:** reconcile Part 4's five unticked boxes with its implementation record (tick them or annotate why they remain open).
5. **F4:** switch cron-auth to `timingSafeEqual` (3-line change, matches the repo's own standard in bidder-cookie).
6. **F5 + honest-open items:** unchanged, documented — fine to leave open with their recorded procedures.

---

## Bottom line

The application code itself is in genuinely strong shape — the adversarial pass found **no correctness bug** in the engine, settlement, realtime, or UI logic, and no privacy leak. What fails is exactly what Part 7 exists to guard: **the delivery gate.** The docs claim CI is the standing proof of the remediation; CI has never gone green on this codebase, for two independent reasons (node/engine mismatch at `npm ci`, and missing typegen before `tsc`). Fix those two lines, get a green run on main, and then every remaining claim in Parts 1-7 is substantiated by the code as audited.
