# Part 2 - Foundation, Delivery, and Data

**Depends on:** Part 1 for final lifecycle schema  
**Affected phases:** M0 0.1-0.3 and M2 migration/delivery work

## [Blocking] `missing-prisma-generate`

`src/generated` is ignored and untracked, while `package.json` never runs
`prisma generate`. The current checkout builds only because generated files
already exist locally.

**Partial progress (uncommitted):** item 1 below is done; items 2-5 are not
— this finding stays open, do not treat it as resolved.

- [x] Add a deterministic Prisma generation step to install/build. —
      `"postinstall": "prisma generate"` added to `package.json`.
- [x] Keep the generated directory untracked. — Already true;
      `src/generated` remains listed in `.gitignore`.
- [ ] Confirm seed and server imports resolve from an empty checkout. — Not
      verified this session. A real `rm -rf node_modules src/generated &&
      npm install` (exercising the new `postinstall`) from a clean clone has
      not been run; the validation done was `prisma generate` run manually
      mid-session, not a from-scratch install.
- [ ] Document the supported Node and npm versions.
- [ ] Add a clean-checkout CI job: install, generate, migrate, seed, test, build.

**Acceptance:** `git clone` plus documented commands succeeds without any local
artifact copied from another checkout.

## [Blocking] `untracked-migrations`

The committed schema references PreBid brand fields, `lostReason`, and
`Bid.triggeredExtension`, but their corrective migrations are currently
untracked.

- [ ] Reconcile `schema.prisma` against the complete ordered migration history.
- [ ] Review defaults/backfills for non-empty production tables.
- [ ] Commit every migration required by the current schema.
- [ ] Apply the history to an empty database.
- [ ] Apply the history to a database at the current committed migration level.
- [ ] Run a schema-drift check in CI.

**Acceptance:** both fresh and upgrade paths produce the same schema with no
`db push`.

## [Blocking] `uncommitted-m2`

Worker, realtime, mock-resolution, migration, script, and test changes are not
fully versioned on `main`.

- [ ] Separate the work into reviewable commits by workstream.
- [ ] Replace the `Temp` commit message with follow-up commits that document the
      actual state; do not rewrite shared history without explicit approval.
- [ ] Ensure no required route, migration, test, or script remains untracked.
- [ ] Keep unrelated user changes out of remediation commits.
- [ ] Require review before merging the combined M2 state.

**Acceptance:** a clone of the reviewed commit reproduces the exact tested
working tree.

## [High] `delivery-pipeline-unproven`

There is no repository evidence of a deployment URL, deployment status, checks,
pull-request flow, workflow configuration, or branch protection.

- [ ] Establish the intended CI system and required checks.
- [ ] Protect `main` or document and enforce a pull-request-only workflow.
- [ ] Connect preview and production deployments.
- [ ] Record the production/preview URL in `README.md`.
- [ ] Require migration, test, typecheck, lint, and build gates.
- [ ] Verify environment separation between development and production.

## [High] `missing-env-example`

`README.md` instructs `cp .env.example .env`, but `.env.example` does not exist
and `.gitignore` excludes it.

**Mostly resolved (uncommitted):** see items below.

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
- [ ] Explain which variables are local-only, preview-only, or
      production-only. — **Partial:** each variable has an inline comment
      explaining its purpose and risk (e.g. `MOCK_PAYMENTS` explains exactly
      when it must stay unset), but none are explicitly labeled
      local-only/preview-only/production-only the way this item asks.
      Leaving unchecked rather than claiming full coverage.
- [x] Never include real values. — Every value is an obvious placeholder
      (`"change-me-to-a-long-random-string"`, a localhost connection string).

## [Medium] `cookie-no-sliding-refresh`

The bidder identity document promises a sliding one-year expiry, but existing
cookies are returned without renewal.

- [ ] Either implement bounded sliding refresh or remove the promise.
- [ ] Rotate signatures without changing bidder identity.
- [ ] Test expired, tampered, old-key, and refresh-threshold cases.
- [ ] Document the user consequence of clearing cookies or changing devices.

## [Medium] `payment-intent-not-unique`

`PreBid.stripePaymentIntentId` lacks the required unique database constraint.

- [ ] Add the uniqueness constraint through a reviewed migration.
- [ ] Audit existing rows before applying it.
- [ ] Handle uniqueness conflicts as idempotent retries, not generic failures.
- [ ] Add a test proving one PaymentIntent cannot settle multiple PreBids.

## Additional foundation cleanup

- [ ] Correct the ESLint configuration/comment mismatch that currently excludes
      `prisma/**` while claiming the seed remains lintable.
- [ ] Make lint fail on warnings in CI; current lint reports unused-symbol warnings.
- [ ] Review the reported Prisma-tooling dependency advisories and upgrade when
      a compatible release is available; do not force a Prisma downgrade.
- [ ] Correct `README.md` terminology: the planned payment flow uses
      SetupIntent/PaymentIntent and manual capture, not Stripe Checkout.
- [ ] Pin or document dependency update policy consistently with M0 claims.

