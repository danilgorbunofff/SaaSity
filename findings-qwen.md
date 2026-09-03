# FRESH-EYE AUDIT — SaaSity M0–M2 Remediation, Parts 1–7

**Auditor model:** Qwen/Qwen3.8-Flash (adversarial, read-only verification)
**Date:** 2026-09-03
**HEAD audited:** `a969e0a` on `main` (worktree clean; the expected "~70 modified uncommitted files" was wrong — everything was already committed as one kitchen-sink commit).
**Method:** all 7 spec docs (`docs/reviews/m0-m2-remediation/part-01…07`) read in full; engine/worker/finalize/realtime read line-by-line; Parts 5–6 verified by targeted grep/sampling; gates re-run independently in a clean worktree (`npm ci`, `npm test`, `npm run lint`, `npm run format:check`, `npm run build`, `npx tsc --noEmit`); CI history pulled from GitHub via `gh run list/view`.

---

## BLOCKER-1 — CI is red on `main` and has never once passed

`.github/workflows/ci.yml` is the advertised "required check" gate (Part 2 GATE-07, Part 7). Reality:

| Run         | Commit           | Result      |
| ----------- | ---------------- | ----------- |
| 33756066788 | `a969e0a` (HEAD) | fail, 5m36s |
| 33732315344 | `dc8b453`        | fail, 34s   |
| 33718282864 | `a04c9b5`        | fail, 34s   |

These are the only three CI push runs that have ever existed. All three die at the same step, "Install dependencies":

```
npm error code EBADENGINE
npm error notsup Not compatible with your version of node/npm: @prisma/streams-local@0.1.11
npm error notsup Required: {"bun":">=1.2.0","node":">=22.0.0"}
npm error notsup Actual:   {"npm":"10.8.2","node":"v20.20.2"}
```

**Root cause chain:**

- `.nvmrc` pins 20; `ci.yml:54-60` feeds it to `actions/setup-node` via `node-version-file`.
- `.npmrc` sets `engine-strict=true` (a Part 2 addition — correctly doing its job).
- A transitive Prisma 7 dependency, `@prisma/streams-local@0.1.11`, requires Node >= 22.
- `package.json` `engines` says `node: ">=20.9.0"`.

The version floor was never re-checked when Prisma 7's dependency graph landed.

**Why it matters:** every "gates green / CI is the merge gate" statement in Parts 2 and 7 is vacuous — the pipeline exists but cannot pass on any commit. Local green (138/138 tests, lint, format, build all reproduced on Node 24 on this machine) masks this completely. The repo's own anti-drift mechanism (`engine-strict`) is what exposes it.

## MAJOR-2 — CI typecheck step is order-broken (fixing Node alone won't turn CI green)

`ci.yml:85` runs `npx tsc --noEmit` before the `Build` step at line 102. `next-env.d.ts` imports `./.next/types/routes.d.ts` and `./.next/types/root-params.d.ts`, which only exist after `next build`/typegen. On a fresh checkout this fails — reproduced verbatim in this clean worktree before running the build:

```
src/app/layout.tsx(25,50): error TS2304: Cannot find name 'LayoutProps'
```

(`layout.tsx:25` uses Next 16 typed routes: `LayoutProps<'/'>`.) After `npm run build` generates `.next/types`, tsc is clean. **Fix:** run `npx next typegen` before the typecheck step, or reorder tsc after build.

## MAJOR-3 — Commit-structure claims vs reality (Part 2)

- `a969e0a` bundles Parts 4+5+6+7 code plus doc churn in ~91 files ("kitchen sink"), contradicting Part 2's "reviewable commits per workstream" requirement. That checkbox is honestly unticked — but the workstream still shipped past it, and the commit log no longer maps 1:1 to Parts as Part 2's record claims.
- `a04c9b5` "Temp" sits between Part 2 (`b259010`) and Part 3 (`76f82ea`), falsifying Part 2's claim that `ac554dd` was the only stray Temp commit ("replace Temp commit" box). The Temp box in Part 2's record is now a false statement, not just an unticked box.
- No PR review evidence; everything was committed directly to `main` (the "review before merge" box is unticked — honest).

---

## Per-part findings

### Part 1 — Product lifecycle: PASS ~90%

State machine is real and closed:

- Auction cycle: IDLE <-> LIVE; OPEN -> RESOLVING -> RESOLVED with the `startedAt === resolvedAt` handoff invariant verified in `src/server/auction/worker.ts` / `engine.ts`.
- Lease outcomes: ACTIVE -> WON / LOST / EXPIRED; no dead ends — a crash in RESOLVING is retried by the worker, captured-but-unmarked cycles are reconciled (`reconcileCapturedCycle`, `worker.ts:739-822`), and unresolved expiry marks EXPIRED.
- Settlement correctness is enforced in the engine and verified under Part 3 below.
- 1 unticked box (moderation/cancel transitions) matches the doc's own deferred scope — honest.

**MINOR (doc):** stale statements at `part-01-product-lifecycle.md:47` and `:266` — "implemented and validated (uncommitted)" / "Nothing in this pass has been committed" — false since `b259010`/`e0ad13c`.

### Part 2 — Foundation / delivery / data: FAIL ~55%

What is genuinely there and verified:

- 9 migrations tracked end-to-end (`init` -> `realtime_outbox`), including `20260902180000_add_prebid_payment_intent_unique` and `20260903073439_add_settlement_attempts`.
- Schema-drift check wired in CI via `prisma migrate diff --from-migrations ... --exit-code` with a shadow database (`ci.yml:65-77`).
- `@@unique` on `stripePaymentIntentId` (`schema.prisma:191`) and `SettlementAttempt(cycleId, preBidId, kind, attemptNo)` (`schema.prisma:259-291`); `RealtimeOutbox` (`schema.prisma:308-317`); tenant/user split (`schema.prisma:86-93`).
- Deterministic seed + `seed-check` test; 12 proof scripts in `scripts/` including every claimed one.
- `.env.example` labeled per-env; `vercel.json` daily cron (`0 4 * * *`); skip-safe `resolve-cron.yml` (succeeds by exiting cleanly when secrets are unset — verified via its green scheduled run); `docs/deployment.md` exists (117 lines).

What fails:

- BLOCKER-1 — CI cannot install; never green.
- MAJOR-2 — a second guaranteed CI failure (typecheck ordering) is queued behind the first.
- MAJOR-3 — commit-structure claims contradicted by history.
- Proof-script "validated" claims need a live Postgres (`saasity_dev`); they could not be re-run during this audit, so their DB-dependent results remain documented-unverified.
- 5 unticked boxes (reviewable commits, Temp replace, review-before-merge, URL record, env separation) are honest not-done items.

### Part 3 — Engine / worker / payments: PASS ~95%

Line-by-line verified; zero false claims found:

- Advisory lock per plot at `engine.ts:105-108` — `pg_advisory_xact_lock(hashtextextended(plotId, 0))` taken inside the transaction; API routes correctly delegate to the engine rather than double-locking (grep for "advisory" in `src/app/api/` = 0 hits).
- 5s soft-close, second-price = runner-up + 1 increment capped at winner max, proxy/human attribution — all match spec.
- Crash-safety chain in `finalize.ts:434-560` (`runCaptureCascade`) + `worker.ts:720-822`:
  - PENDING settlement-attempt row persisted before the Stripe call;
  - replay adopts an existing CAPTURED row (never re-captures);
  - `FAILED_RETRYABLE` aborts the cascade without a silent fallback;
  - `RELEASE_FAILED` is persisted, not swallowed;
  - `reconcileCapturedCycle` idempotently finishes an unmarked settle;
  - stored-outcome read has a staleness guard (`nextCycle.startedAt === cycle.resolvedAt`, `worker.ts:739-822`).
- `payment-intent.ts` (in `src/server/auction/`): sole sanctioned intent writer; `attachStripePaymentIntentId` handles P2002 in both query-engine and driver-adapter error shapes (`payment-intent.ts:46-110`), idempotent on retry, raises a conflict error on mismatched intent.
- Zero unticked boxes in the checklist.

**MINOR (nit):** leader attribution via `priceCents === humanSubmitCents` equality can mislabel the leader when a proxy auto-tick lands exactly equal to the human bid in cents (attribution display only, not pricing; survives all tests).

### Part 4 — Realtime / client state: PASS ~85% (code) — doc bookkeeping sloppy

Verified:

- Outbox (`src/server/realtime/outbox.ts`): `seq bigserial` ordering, 1s poll loop, 24h prune wired into the cron route, malformed-row skip.
- SSE route (`src/app/api/events/route.ts`): subscribe (L118) before snapshot (L139), watermark read before the plots query, single idempotent `cleanup`, per-connection seq.
- Bus (`src/server/realtime/bus.ts`): `eventKeyOf` dedup keys; fire-and-forget persist never blocks auction writes — cross-instance loss is accepted, documented, and recovers via snapshot resync.
- Client (`src/lib/city/realtime.ts`): MAX_BACKOFF 30s / base 500ms; MAX_BAD_FRAMES 3 and MAX_RESYNC_FAILURES 3 -> ErrorChip; unknown-plot resync throttle 5s; six-field atomic next-cycle swap in `applyEvent`; seq-gap -> fullResync; positions-before-plots ordering in `fullResync`; offline/online handling; `refreshMyPositions`.
- `/api/me/bids` positions projection and `store.ts` sticky/merged outbid derivation; tenant-vs-leader gating in `src/server/serializers.ts`.

Findings:

- **MINOR (doc):** 25 checklist boxes were never ticked although the impl record claims closure and the code confirms it. Parts 1-3 updated their checklists; Part 4 didn't. A literal checkbox audit scores this part 0/25.
- **MINOR (doc):** stale "(uncommitted)" statement at `part-04-realtime-client-state.md:79`.
- **MINOR:** SSE gateway/buffering behavior (`X-Accel-Buffering`, Vercel stream limits) is not covered in `docs/deployment.md` (grep for stream/compression/writeHead = 0 hits) — the route exists, but "proven through the deployed path" is unverified.

### Part 5 — 3D city / performance: PASS ~85%

Verified by sampling:

- `src/lib/city/skin-overlays.ts`: exactly 36/12/1 overlay counts, with a dedicated test guarding the counts.
- `src/lib/city/reduced-motion.ts`: `QUERY` + `isReducedMotion` / `cameraTweenMs`; `tests/city/reduced-motion` exists.
- Camera rig: fly-to/tween gated (`camera-rig.ts:142,177-178`), `cancelFlyTo` fires on user interaction (`CityScene.tsx:60`), `resetView` present.
- `src/lib/city/shared-tick.ts`: refcounted interval, never instantiated on the server; test exists.
- `PlotSkins.tsx:314`: rotation gated by reduced-motion; `MRR-badge` and `outer-skins` tests exist.
- 9 unticked boxes are honestly the headed-browser / device / harness legs.

Residual risk: FPS/occlusion numbers were not visually confirmed; TerracedHill occlusion claims verified only by code presence.

### Part 6 — UI/UX/accessibility: PASS ~80%

Verified:

- `BidModal.tsx`: `100dvh` max-height + `overflow-y-auto` (mobile viewport safety), `text-base` (16px) inputs (`:834-836`, prevents iOS zoom), discard confirmation `role=alertdialog` (`:766`), focus-in/restore (`:165-230`), Tab trap (`:249`).
- `src/lib/validation/bid-form.ts`: strict regex `^\d+(\.\d{1,2})?$`, comma rejection, 100k cap; `tests/validation/bid-form` exists.
- Skip-link + `<main id="city-main">` + sr-only `h1` in `CityScene.tsx:334-433`.
- `MyLeasesPill.tsx`: full keyboard-nav pattern.
- Safe-area `env()` insets in TopStrip, HelpCard, DetailCard.
- 12 unticked boxes: axe/browser legs honestly open.

**MINOR (false checkmark):** `part-06-ui-ux-accessibility.md:84` — "[x] Use safe-area insets for top and bottom overlays" — but `Minimap.tsx:150` (a bottom overlay) uses plain `bottom-3` with no `env(safe-area-inset-bottom)`. Half the claim fails.

### Part 7 — Testing / release / documentation: PASS ~70% (conditional on CI fix)

- All claimed test files exist (22 files, incl. `tests/auction/outbid-race`, `tests/validation/bid-form`, `tests/city/mrr-badge`, `tests/seed-check`, `tests/realtime-apply`, `tests/realtime-connection`).
- Independently re-run in a clean worktree: `npm test` = 138/138 pass; `npm run lint` (`--max-warnings=0`) clean; `npm run format:check` clean; `npm run build` succeeds (all routes); `npx tsc --noEmit` clean only after the build — see MAJOR-2.
- All 20 unticked boxes are honest "PENDING: reason" entries (DB integration, coverage tooling, load tests).
- The "gates landed" claim is true; any implication that the gate is proven working is false (BLOCKER-1).
- **MINOR (doc):** stale statements — README:20 says Part 6 is uncommitted; `part-04:79` "(uncommitted)"; `part-01:47,266`.

---

## Checkbox-honesty audit (summary)

Unticked boxes per doc: P1: 1, P2: 5, P3: 0, P4: 25, P5: 9, P6: 12, P7: 20.

- Parts 1, 2, 3, 7: checklist state matches reality.
- Part 4: 25 boxes left unticked despite implemented, code-verified work — documentation drift, not false claims.
- Parts 5, 6: unticked boxes are honest open legs (headed browser, device, axe).
- False checkmarks found: exactly one — `part-06:84` (bottom safe-area, Minimap). Plus the stale-text/false-record items listed per part (`part-01:47/266`, `part-04:79`, README:20, Part 2's "only Temp commit" record).

---

## Verdicts

| Part                     | Verdict                | Score |
| ------------------------ | ---------------------- | ----- |
| 1 Lifecycle              | **PASS**               | 90%   |
| 2 Foundation/Delivery    | **FAIL**               | 55%   |
| 3 Engine/Worker/Payments | **PASS**               | 95%   |
| 4 Realtime               | **PASS**               | 85%   |
| 5 3D City                | **PASS**               | 85%   |
| 6 UI/UX/A11y             | **PASS**               | 80%   |
| 7 Testing/Docs           | **PASS** (conditional) | 70%   |

## FIX-FIRST list (ordered by risk)

1. **BLOCKER:** raise the Node floor — `.nvmrc` -> `22` (and `package.json` `engines.node` -> `>=22.0.0`), or remove the `@prisma/streams-local` dependency. `npm ci` currently fails on every push.
2. **MAJOR:** add `npx next typegen` before `npx tsc --noEmit` in `ci.yml:85` (or reorder tsc after build) — the second guaranteed CI failure.
3. **MAJOR:** get one green CI run on `main`, then re-verify the "gates" claims in Parts 2/7 against that run. Retroactively document the `a969e0a` kitchen-sink boundary and delete/annotate the false "only Temp commit" record in Part 2.
4. **MINOR:** fix stale "uncommitted" doc statements (`part-01:47,266`; `part-04:79`; `README:20`); tick the Part 4 checklist to match its impl record; add `env(safe-area-inset-bottom)` to Minimap or uncheck `part-06:84`; document SSE/gateway caveats in `docs/deployment.md`.
5. **MINOR:** engine leader-attribution tie case (`priceCents === humanSubmitCents`).

**SHIP? No — FIX-FIRST.** The core engine (Parts 1, 3) is unusually solid and survived adversarial line-by-line reading. But the delivery pipeline that Parts 2 and 7 hang their claims on has never been green — the repo's own `engine-strict` guard correctly proves the version story wrong, and a second latent CI failure is queued behind it. Items 1-2 are ~10 minutes of work; do them, post a green run, and Parts 2 and 7 flip to pass.
