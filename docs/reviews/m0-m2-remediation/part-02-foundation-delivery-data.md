# Part 2 - Foundation, Delivery, and Data

**Depends on:** Part 1 for final lifecycle schema  
**Affected phases:** M0 0.1-0.3 and M2 migration/delivery work

## [Blocking] `missing-prisma-generate` — ✅ Resolved

`src/generated` is ignored and untracked, while `package.json` never runs
`prisma generate`. The current checkout builds only because generated files
already exist locally.

- [x] Add a deterministic Prisma generation step to install/build. —
      `"postinstall": "prisma generate"` in `package.json`.
- [x] Keep the generated directory untracked. — Already true;
      `src/generated` remains listed in `.gitignore`.
- [x] Confirm seed and server imports resolve from an empty checkout. —
      Actually executed: `rm -rf node_modules src/generated`, then `npm ci`
      (postinstall regenerated the Prisma client with no manual step), then
      `tsc --noEmit`, `npm run lint`, `npm test` (52/52), `npm run build`,
      and `npm run db:seed` — all green from nothing. Repeated a second time
      with `.env` itself removed and only `DATABASE_URL` /
      `BIDDER_COOKIE_SECRET` / `WORKER_SECRET` / `MOCK_PAYMENTS` set as bare
      env vars (i.e. exactly how CI provides them, not via a dotfile) —
      same result.
      (Suite has since grown to 138/138 as Parts 3–5 added tests; the
      clean-checkout property is enforced continuously by CI, not by the
      number.)
- [x] Document the supported Node and npm versions. — `package.json` now
      declares `"engines": { "node": ">=20.9.0", "npm": ">=10" }`, matching
      `next@16`'s own declared `engines.node` (`>=20.9.0`) and
      `@types/node@^20`. `.npmrc` sets `engine-strict=true` so a mismatched
      Node/npm actually **fails** `npm install`/`npm ci` instead of only
      warning (verified: `npm config get engine-strict` → `true`). A `.nvmrc`
      (`20`) pins the same floor for local `nvm`/CI use. README's "Getting
      started" states the requirement up front.
- [x] Add a clean-checkout CI job: install, generate, migrate, seed, test,
      build. — `.github/workflows/ci.yml`, runs on push/PR to `main` against
      an ephemeral `postgres:16-alpine` service container. Steps: checkout →
      setup Node from `.nvmrc` → `npm ci` → create shadow DB → schema-drift
      check → `prisma migrate deploy` → `db:seed` → `tsc --noEmit` →
      `format:check` (added by Part 7) → `npm run lint` → `npm test` →
      `npm run build`. Validated two ways
      before relying on it: `actionlint` reports zero issues, and every step
      was dry-run locally with the exact env-var-only setup CI uses (no
      `.env` file) against freshly-created empty databases — all passed.

**Acceptance:** `git clone` plus documented commands succeeds without any local
artifact copied from another checkout. — **Met**, verified live (see above),
not just asserted.

## [Blocking] `untracked-migrations` — ✅ Resolved

The committed schema references PreBid brand fields, `lostReason`, and
`Bid.triggeredExtension`, but their corrective migrations are currently
untracked.

- [x] Reconcile `schema.prisma` against the complete ordered migration
      history. — Verified with `npx prisma migrate diff --from-migrations
      ./prisma/migrations --to-schema prisma/schema.prisma --exit-code` →
      `No difference detected.` (exit 0). Needs `SHADOW_DATABASE_URL` set
      (as CI's workflow does) — without it the command errors instead of
      checking. Replaying all migrations from
      empty reproduces `schema.prisma` exactly.
- [x] Review defaults/backfills for non-empty production tables. — Read
      every `ALTER TABLE` in the 4 newer migrations:
      `add_prebid_brand_fields` backfills existing `PreBid` rows with
      `companyName='Unknown'`, `targetUrl=''`, `twitterHandle=''` before the
      following migration drops those defaults for future rows;
      `add_bid_triggered_extension` backfills `Bid.triggeredExtension=false`;
      `separate_tenant_lease_from_auction_leader` intentionally **drops**
      `Plot.leader*` (old data doesn't represent a real paid tenancy under
      Model A — see that migration's own header comment) and adds nullable
      `tenant*` columns so every existing plot lands on "no confirmed tenant
      yet", which is the correct Model A starting state. Confirmed all of
      this by executing it, not just reading it (next item).
- [x] Commit every migration required by the current schema. — All 9
      migrations are committed; `prisma migrate status` reports
      "Database schema is up to date!" against the real dev DB.
      (Count grew from 6 → 7 → 9 as Parts 3/4 landed their own
      migrations; the drift check below is what actually enforces this,
      not the number.)
- [x] Apply the history to an empty database. — `prisma migrate diff
      --from-migrations` (above) does this on every invocation via a scratch
      shadow DB; also re-verified directly with a plain `prisma migrate
      deploy` against a freshly `CREATE DATABASE`'d instance.
- [x] Apply the history to a database at the current committed migration
      level. — Built the actual upgrade scenario, not just asserted it's
      fine: created a scratch DB, applied only the 2 migrations that existed
      before this remediation pass (matching the old `ac554dd` state),
      hand-inserted a realistic non-empty `Plot`/`AuctionCycle`/`PreBid`/`Bid`
      row set with the **old** `leader*` fields populated (simulating a real
      plot mid-auction pre-upgrade), then applied the remaining 4 migrations
      on top. Result: zero errors, and every backfill landed exactly as
      designed (`tenantPreBidId`/`tenantCompanyName` correctly `NULL`,
      `tenantLogoHidden` correctly `false`, `PreBid.companyName` correctly
      backfilled to `'Unknown'`, `Bid.triggeredExtension` correctly `false`,
      old `leader*` data gone as intended). This is the strongest evidence
      in this pass — it exercises the exact non-empty-table path production
      data would hit, not just a fresh/empty one.
- [x] Run a schema-drift check in CI. — `.github/workflows/ci.yml`'s
      "Schema-drift check" step runs the same `migrate diff --exit-code`
      command on every push/PR to `main`.

**Acceptance:** both fresh and upgrade paths produce the same schema with no
`db push`. — **Met**, both paths were actually executed this session (not
just reasoned about), see evidence above. No `db push` was used anywhere;
every change went through `migrate deploy`.

## [Blocking] `uncommitted-m2` — Partially resolved

Worker, realtime, mock-resolution, migration, script, and test changes are not
fully versioned on `main`.

- [ ] Separate the work into reviewable commits by workstream. — **Not
      done.** Per explicit user decision, everything (pre-existing
      uncommitted M2 phases 2.3-2.5 + this session's Part 1 fix + doc
      remediation) was combined into one commit (`e0ad13c`) rather than
      split, to unblock forward progress now; proper workstream separation
      was deferred, not skipped by omission.
- [ ] Replace the `Temp` commit message with follow-up commits that document
      the actual state; do not rewrite shared history without explicit
      approval. — The `Temp` commit (`ac554dd`) itself was deliberately left
      untouched (no rebase/amend) per the "don't rewrite shared history"
      rule. `e0ad13c`'s message documents the actual combined state in
      detail, but is a superset commit sitting on top of `Temp`, not a
      clean replacement for it.
- [x] Ensure no required route, migration, test, or script remains
      untracked. — Verified: `git status --porcelain` was clean immediately
      after `e0ad13c`; all 4 pending migrations, the worker route, the SSE
      route, mock-payments route, and their tests are committed.
- [x] Keep unrelated user changes out of remediation commits. — The only
      files touched were ones this session (or the pre-existing uncommitted
      M2 2.3-2.5 work) actually changed; verified via `git status
      --porcelain` before staging that nothing unexpected was included.
- [ ] Require review before merging the combined M2 state. — Not
      applicable/not done yet: this work has not been pushed or opened as a
      pull request. Still needs an actual review pass before `origin/main`
      (currently at `ac554dd`, one commit behind local) moves forward.

**Acceptance:** a clone of the reviewed commit reproduces the exact tested
working tree. — **Met for `e0ad13c` itself** (a fresh checkout at that SHA
plus documented commands reproduces the tested tree — see
`missing-prisma-generate`'s clean-checkout proof above, run against this
exact commit), but the finding's other acceptance implication — that the
history is *reviewable* — is not met until it's split or at least reviewed
as-is via a PR.

> **Boundary note (2026-09-03):** the commit record above describes the tree
> as of `e0ad13c`. Later work landed as further direct-to-`main` commits —
> `76f82ea` (Part 3), `330cb53` (Part 4), `1bbe913` (Part 5), and the bundled
> `a969e0a` (Parts 4–7 fixes, ~91 files) — plus a second `Temp` commit
> (`a04c9b5`) between Parts 2 and 3. So "the `Temp` commit (`ac554dd`)" is no
> longer the only such commit, and the per-workstream commit mapping is
> superseded by the bundled `a969e0a`. The "reviewable commits" and
> "review before merge" boxes remain honestly unticked by explicit decision.

## [High] `delivery-pipeline-unproven` — Partially resolved

There is no repository evidence of a deployment URL, deployment status, checks,
pull-request flow, workflow configuration, or branch protection.

- [x] Establish the intended CI system and required checks. —
      `.github/workflows/ci.yml` (GitHub Actions) runs migrate/seed/typecheck/
      lint/test/build plus the schema-drift check on every push/PR to `main`.
- [x] Protect `main` or document and enforce a pull-request-only workflow. —
      **Asked; you chose "leave `main` unprotected for now."** Recorded as a
      deliberate decision, not an oversight: the authenticated `gh` token has
      repo admin and branch protection can be turned on at any time this is
      revisited — nothing about this choice is permanent or silent.
- [~] Connect preview and production deployments. — Still requires a Vercel
      (or equivalent) account action outside this repo's files; no commit
      can do that part. **Everything that can be prepped ahead of the
      account existing is now committed** (asked; you chose "prep what you
      can now, I'll connect the account later"):
      - `vercel.json` — a Hobby-plan-safe (once-daily) `crons` entry for
        `/api/cron/resolve`, with `docs/deployment.md` explaining exactly
        why that default is a slow safety net, not the real mechanism, and
        how to tighten it once/if the project is on Vercel Pro.
      - `.github/workflows/resolve-cron.yml` — a Vercel-plan-independent
        5-minute scheduled caller of the same route, safe to merge now
        because it skips (rather than fails) until its two secrets
        (`RESOLVE_CRON_URL`, `WORKER_SECRET`) are set — which can only
        happen after a deployment exists.
      - `docs/deployment.md` — database provisioning (bring-your-own
        Postgres; Vercel has none built in), the exact env vars to set per
        environment (cross-referenced to `.env.example`'s labels), the
        `prisma migrate deploy` step and why it's deliberately a manual
        action rather than wired into the Vercel build, and a go-live
        checklist.
- [ ] Record the production/preview URL in `README.md`. — Still blocked on
      the account-connection step above; `docs/deployment.md`'s checklist
      ends on this exact action so it isn't lost once that happens.
- [x] Require migration, test, typecheck, lint, and build gates. — All six
      are steps in `.github/workflows/ci.yml`, and it is the only workflow,
      so there's nothing else that could pass instead.
- [ ] Verify environment separation between development and production. —
      Still not yet meaningful: no separate deployed environments exist to
      verify separation between. `docs/deployment.md` states the
      requirement up front (separate databases and separate
      `BIDDER_COOKIE_SECRET`/`WORKER_SECRET` values per environment) so it's
      enforced at setup time rather than checked after the fact.

**Honest status:** 4 of 6 items are either done or explicitly decided by you.
The remaining 2 (recording a live URL, verifying real environment
separation) cannot be completed by editing files — they need an actual
Vercel account connected to this repo, which was explicitly left as your
own follow-up action.

## [High] `missing-env-example` — ✅ Resolved

`README.md` instructs `cp .env.example .env`, but `.env.example` does not exist
and `.gitignore` excludes it.

- [x] Add `!.env.example` after the `.env*` ignore rule.
- [x] Add a safe, committed `.env.example` with every current variable. —
      Repo-wide `process.env.*` search confirms the only application
      variables are `DATABASE_URL`, `BIDDER_COOKIE_SECRET`, `WORKER_SECRET`,
      `MOCK_PAYMENTS` (framework-provided `NODE_ENV` excluded intentionally);
      all four are present with placeholder values.
- [x] Include `DATABASE_URL`, `BIDDER_COOKIE_SECRET`, `WORKER_SECRET`,
      `MOCK_PAYMENTS`, and the planned Stripe/realtime variables. — All four
      present; `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` documented
      commented-out for M3. No realtime-specific variable exists to
      document — the project uses the in-process SSE bus, not Supabase, so
      there is nothing to add there.
- [x] Explain which variables are local-only, preview-only, or
      production-only. — Added an explicit `[all envs, own value]` /
      `[local + preview ONLY — never production]` /
      `[future / M3, per-env value]` label to every variable's comment.
      `MOCK_PAYMENTS` is the safety-critical one: labeled "never
      production" because leaving it set in a real deployment would let a
      resolution crown a "winner" without ever collecting payment (the
      exact failure mode `finalize.ts`'s `requireMockPayments` guard
      exists to prevent). The others are "own value per environment" —
      correct today (single local environment) and forward-looking for
      when preview/production environments exist, so a shared secret is
      never silently reused across them.
- [x] Never include real values. — Every value is an obvious placeholder
      (`"change-me-to-a-long-random-string"`, a localhost connection
      string with literal `user`/`password`). Verified byte-for-byte via
      `grep`/`base64` (not just visual read) that the committed
      `DATABASE_URL` placeholder is exactly
      `postgresql://user:password@localhost:5432/saasity` — no real
      credential.

## [Medium] `cookie-no-sliding-refresh` — ✅ Resolved

The bidder identity document promises a sliding one-year expiry, but existing
cookies are returned without renewal.

- [x] Either implement bounded sliding refresh or remove the promise. —
      Implemented: `getOrCreateBidderPayload()` now re-issues a valid cookie
      once it's older than half the TTL (`needsRefresh`/`refreshPayload` in
      `src/server/bidder-cookie.ts`), extending it another full ~1 year from
      the refresh moment. Bounded because a payload nothing ever reads (a
      genuinely inactive bidder) still hard-expires at the original TTL —
      nothing extends it in the background.
- [x] Rotate signatures without changing bidder identity. — `refreshPayload`
      only changes `issuedAt`; `bidderId`/`stripeCustomerId` are copied
      untouched. Since the HMAC signs the whole payload, a changed
      `issuedAt` necessarily produces a new signature, satisfying "rotate
      the signature" as a side effect of the timestamp change, not a
      separate mechanism. Verified with a dedicated test
      (`refreshPayload produces a payload that re-signs with a fresh
      signature`).
- [x] Test expired, tampered, old-key, and refresh-threshold cases. — New
      `tests/server/bidder-cookie.test.ts`, 15 tests (0 pre-existing — this
      module had no test coverage before): 2 expired-boundary cases, 4
      tampered/malformed cases, 2 old-key cases (a cookie signed under a
      since-rotated-away `BIDDER_COOKIE_SECRET` is rejected; the same cookie
      still parses under the key it was actually signed with), 6
      refresh-threshold cases, plus a valid-round-trip and an age-math case.
      All 15 pass (exactly 15 `test(` blocks — recounted during Part 7
      verification; suite total was 67/67 at the time, 138/138 now).
- [x] Document the user consequence of clearing cookies or changing
      devices. — This was previously only written in an internal
      architecture-planning doc
      (`docs/plans/00-scaffold-and-data-layer/phases/phase-02-database-and-prisma.md`),
      never surfaced to an actual bidder. Added a real, user-facing
      disclosure line under the submit button in `BidModal.tsx`: *"No
      account — you're identified by a browser cookie. Clearing cookies or
      switching devices means you can't manage this bid later, but it never
      affects the auction itself."* Verified live in a running dev server
      via `agent-browser` (screenshot) — renders correctly, matches the
      modal's existing muted-caption style. (Aside, not part of this
      finding: doing this surfaced that the modal has no internal scroll on
      short viewports, cutting off the CTA and this new line alike — that's
      the pre-existing, separately tracked Part 3 `modal-short-viewport`
      finding, not something this pass fixes.)

## [Medium] `payment-intent-not-unique` — ✅ Resolved

`PreBid.stripePaymentIntentId` lacks the required unique database constraint.

- [x] Add the uniqueness constraint through a reviewed migration. — Schema
      field changed to `stripePaymentIntentId String? @unique`; migration
      `20260902180000_add_prebid_payment_intent_unique` generated via
      `prisma migrate diff` (not hand-written) and applied with `migrate
      deploy`. Postgres unique indexes permit unlimited `NULL`s (`NULL` is
      never equal to another `NULL`), so this is safe even though every
      existing row has this column unset today — confirmed with a direct
      transaction test (two inserts with `stripePaymentIntentId` left
      unset both succeed; a third statement setting the same non-null
      value on both rows fails with `duplicate key value violates unique
      constraint "PreBid_stripePaymentIntentId_key"`).
- [x] Audit existing rows before applying it. — `stripePaymentIntentId` is
      a schema field with no current writer anywhere in the codebase (M3
      Stripe integration hasn't landed; `authorizePreBidAtAttach` in
      `finalize.ts` is a documented no-op stub). Queried the real dev DB
      directly before migrating:
      `SELECT "stripePaymentIntentId", COUNT(*) FROM "PreBid" WHERE
      "stripePaymentIntentId" IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1`
      → 0 rows, and a plain `COUNT(*) WHERE ... IS NOT NULL` → 0. Verified
      empirically rather than assumed from reading the code.
- [x] Handle uniqueness conflicts as idempotent retries, not generic
      failures. — New `src/server/auction/payment-intent.ts` exports
      `attachStripePaymentIntentId(prisma, preBidId, stripePaymentIntentId)`:
      catches the P2002 unique-constraint violation specifically (handles
      both the classic query-engine `meta.target` shape and the
      driver-adapters `meta.driverAdapterError.cause` shape actually used
      by this project's `@prisma/adapter-pg` setup — confirmed the real
      shape by deliberately triggering the error and inspecting it, the
      two shapes are different enough that a naive check silently misses
      the driver-adapters one), re-reads the current owner, and either
      returns silently (same preBid retrying its own already-attached id —
      idempotent no-op) or throws a new typed `PaymentIntentConflictError`
      (a different preBid already owns that id — a real conflict, never
      left as an opaque Prisma error). `finalize.ts`'s `authorizePreBidAtAttach`
      doc comment now states this helper is the required write path for
      the eventual M3 implementation — no bare `prisma.preBid.update` on
      this column is permitted once real Stripe calls land.
- [x] Add a test proving one PaymentIntent cannot settle multiple PreBids.
      — New `scripts/payment-intent-uniqueness-proof.ts` (follows this
      repo's existing live-DB proof-script convention, since this is a
      DB-constraint behavior — `npm test` is deliberately zero-DB, see the
      "Additional foundation cleanup" note above). 11 checks against the
      real DB, all passing: (A) the raw constraint itself rejects a
      cross-row duplicate with Prisma error code `P2002`, leaving the
      losing row untouched; (B) `attachStripePaymentIntentId` called twice
      with the same preBid + same id is a no-op, not an error; (C) the
      same call with a *different* preBid throws `PaymentIntentConflictError`
      carrying the losing preBid id, the contested PaymentIntent id, and
      the existing owner's preBid id — and again leaves the losing row's
      column untouched (no partial write). Script cleans up its own
      synthetic `zz-proof-*` rows; verified zero residue after the run.
      Full suite re-verified after this change: `tsc --noEmit` clean,
      `npm run lint` clean, `npm test` 67/67 at the time (138/138 at Part 7 verification), `npm run build` succeeds,
      and a schema-drift check (`prisma migrate diff --exit-code` against
      a scratch shadow DB) reports "No difference detected" — the 9 (at the
      time, 7) migrations on disk exactly reconstruct `schema.prisma`.

## Additional foundation cleanup

- [x] Correct the ESLint configuration/comment mismatch that currently excludes
      `prisma/**` while claiming the seed remains lintable. — Changed
      `eslint.config.mjs`'s `globalIgnores` entry from `'prisma/**'` to
      `'prisma/migrations/**'` (only the generated SQL is exempt now).
      Verified with `npx eslint prisma/seed.ts --no-cache` (exit 0, actually
      linted, not silently skipped) and a full repo-wide `npx eslint . --no-cache`
      (clean).
- [x] Make lint fail on warnings in CI; current lint reports unused-symbol
      warnings. — `package.json`'s `lint` script now runs `eslint --cache
      --max-warnings=0`; since CI's lint step is just `npm run lint`, this
      applies identically in both places. Repo is currently at 0
      warnings/0 errors, so this is a real, currently-passing guard against
      regression, not just a documented intention.
- [x] Review the reported Prisma-tooling dependency advisories and upgrade when
      a compatible release is available; do not force a Prisma downgrade. —
      `npm audit` flagged 4 high-severity advisories, all transitive through
      `prisma`'s own dependency tree, not `prisma` or the runtime client
      itself: `deepmerge-ts@7.1.5` (stack exhaustion,
      [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx),
      fixed `>=8.0.0`) via `@prisma/config`, and `mysql2@3.15.3` (auth
      plugin downgrade leaking plaintext credentials,
      [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr);
      decompression-bomb DoS,
      [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3),
      fixed `>=3.22.0`/`>3.23.0`) — Prisma's CLI bundles a MySQL driver for
      multi-database support even though this project only uses Postgres,
      so this project never exercises the vulnerable code path regardless,
      but a real fix was available and free, so left unfixed would have
      been lazy. `npm audit`'s own suggested fix was downgrading `prisma`
      to `6.19.3` (a major-version **downgrade**) — exactly what this item
      says not to do. Instead added an `overrides` block in `package.json`
      pinning `deepmerge-ts@^8.0.2` and `mysql2@^3.24.3` directly (both
      already-released patched versions), keeping `prisma@7.10.0`
      untouched. Verified this doesn't silently break the CLI: `npm ls
      deepmerge-ts mysql2` confirms the overridden versions actually
      resolved, `prisma validate` / `prisma migrate status` / `prisma
      generate` all still work, and the full `tsc`/`lint`/`test`/`build`
      suite was re-run clean afterward. `npm audit` now reports **0
      vulnerabilities** (was 4 high).
- [x] Correct `README.md` terminology: the planned payment flow uses
      SetupIntent/PaymentIntent and manual capture, not Stripe Checkout. —
      Already fixed in an earlier pass this session; README's "Tech stack"
      section reads "SetupIntent pre-auth + manual-capture PaymentIntent".
- [x] Pin or document dependency update policy consistently with M0 claims. —
      `docs/plans/00-scaffold-and-data-layer/phases/phase-01-repo-and-tooling.md`'s
      exit criterion ("All M0/M1 dependencies installed with pinned
      versions") was the M0 claim in question; added a `> **Correction**`
      note there (matching the established pattern from Part 1) clarifying
      the actual, deliberate policy: `package.json` keeps caret ranges,
      reproducibility comes from the committed `package-lock.json` + `npm
      ci`. Documented this properly for the first time in a new README
      "Dependency policy" section: caret ranges + lockfile-enforced
      installs, `overrides` reserved for forcing patched transitive deps
      without touching a direct dependency's own major version (the
      concrete example: this pass's `deepmerge-ts`/`mysql2` overrides,
      above), and an explicit statement that no Renovate/Dependabot
      automation exists yet (manual updates only, for now).

## Part 7 strict re-verification (2026-09-03) — ✅ all substance holds

Every checkable claim above was re-executed live against the current
tree, not just re-read: `tsc --noEmit` clean, `npm run lint` clean
(`--max-warnings=0`), `npm test` **138/138** (growth from 67 is Parts
3–5 coverage, not regressions), `npm audit` **0 vulnerabilities**,
`prisma migrate diff --exit-code` → **"No difference detected"** (all 9
migrations, fresh shadow DB created and dropped for the check),
`prisma migrate status` → **"Database schema is up to date!"**,
`git ls-files prisma/migrations` ≡ disk (nothing untracked), cookie
tests recounted at exactly 15 `test(` blocks, seed lint + README /
`.env.example` / `vercel.json` / `resolve-cron.yml` / `deployment.md` /
`BidModal` disclosure / phase-01 `Correction` notes all confirmed
present. Stale numbers left by later passes (migration/test counts, the
new CI format-check step, the `SHADOW_DATABASE_URL` prerequisite) were
corrected inline above.

Two honest caveats, neither a Part 2 regression: (1) the working tree
is currently dirty again (60+ modified files + 9 new untracked test/
helper files from the Parts 3–5 remediation passes sitting on top of
`1bbe913`) — the "clean `git status` / fresh-clone reproduces the tree"
property must be re-proved once after the final commit, same as last
time; (2) `uncommitted-m2` and `delivery-pipeline-unproven` remain
accurately marked partial — no push/PR and no connected Vercel account
yet, both still your follow-ups.

