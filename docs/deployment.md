# Deployment (Vercel)

Prep work for connecting this repo to Vercel. No account is connected yet —
this covers everything that can be decided and configured ahead of time
(Part 2 remediation: `delivery-pipeline-unproven`). The remaining step
(creating the Vercel project and pointing it at a real database) is a
one-time manual action the project owner does once, with the account.

## Build — zero config needed

Vercel auto-detects Next.js and runs `npm ci` then `next build`. Nothing in
`vercel.json` controls the build; the only thing it configures here is the
cron schedule (below). `npm ci` already runs `prisma generate` via
`package.json`'s `postinstall` hook — same as CI and a local clean checkout
(see `missing-prisma-generate` in the Part 2 remediation doc), so no custom
Vercel build command is required.

Nothing in this app reads the database at build time (no
`generateStaticParams`, no build-time data fetching — every route that
touches Prisma is `export const dynamic = 'force-dynamic'`). A Vercel
**preview deployment will build successfully even before `DATABASE_URL`
points at a reachable database** — it just won't serve real data until one
is connected.

## 1. Database

Vercel does not bundle Postgres. Bring your own — any of these work (pick
one; this repo has no provider lock-in, it only needs a standard Postgres
connection string):

- **Neon** (serverless Postgres; also sold as "Vercel Postgres" in the
  Vercel marketplace) — generous free tier, branching per environment.
- **Supabase** — Postgres + extras this project doesn't use.
- **Railway / Render / RDS / etc.** — any managed Postgres works.

Provision **separate databases for Production and Preview** — never point
both at the same instance (see `.env.example`'s `[all envs, own value]`
labels; a preview deploy running `npm run db:seed` or exercising the
auction loop must never touch production rows).

Once a database exists, apply the committed migration history to it before
routing any traffic:

```bash
DATABASE_URL="<production-or-preview-connection-string>" npx prisma migrate deploy
```

This is a **manual, deliberate step** — it is intentionally not wired into
the Vercel build (running schema migrations automatically on every
`git push`, including preview branches sharing a database, is how you get
half-migrated tables under concurrent deploys). Run it once when the
database is first connected, and again after every future migration lands
on `main`, before/alongside that deploy going live.

## 2. Environment variables

Set these in the Vercel dashboard (Project -> Settings -> Environment
Variables), scoped per the `.env.example` labels:

| Variable                | Scope                                              |
| ------------------------ | --------------------------------------------------- |
| `DATABASE_URL`            | Production and Preview — **different values**, per-database above |
| `BIDDER_COOKIE_SECRET`    | Production and Preview — **different values** (a leaked preview secret must never forge production cookies) |
| `WORKER_SECRET`           | Production and Preview — **different values**; also see the cron section below |
| `MOCK_PAYMENTS`           | Preview only, set to `1`. **Never set in Production** — leaving it unset there is what makes an uncaptured "winner" fail closed instead of activating for free |
| `CRON_SECRET`             | Production and Preview, **same value as that environment's `WORKER_SECRET`** — see below |

Stripe keys are not set yet; they land with milestone M3.

## 3. Resolving ended auction cycles (cron)

`/api/cron/resolve` sweeps ended cycles and must be called externally on a
schedule — nothing inside the Next.js app calls it on its own. Two
mechanisms are prepped; use one or both depending on your Vercel plan.

### `vercel.json` (ships in this repo, Hobby-safe by default)

```json
{
  "crons": [{ "path": "/api/cron/resolve", "schedule": "0 4 * * *" }]
}
```

**This default schedule is a once-daily safety net, not the real resolution
path.** Vercel's Hobby plan hard-rejects (deploy fails outright, it does not
silently downgrade) any cron schedule that would run more than once a day.
Cycles run 6-24 hours and are designed to resolve within minutes of ending
(`RESOLVING_TIMEOUT_MINUTES = 5` in `src/lib/tiers.ts`) — once a day is not
adequate for real gameplay. If/when the project is on **Vercel Pro**,
tighten this to something like `*/5 * * * *` so Vercel's own cron becomes
the primary mechanism.

Vercel's cron automatically sends `Authorization: Bearer $CRON_SECRET` —
which is why the table above has you set a Vercel-reserved `CRON_SECRET`
env var (in addition to this app's own `WORKER_SECRET` that the route
actually checks) to the **same value** as `WORKER_SECRET` in that
environment. Without that, Vercel's own cron calls would 401 against this
route just like any other unauthenticated caller.

### `.github/workflows/resolve-cron.yml` (plan-independent, recommended for now)

A scheduled GitHub Actions workflow that calls the same route every 5
minutes, regardless of Vercel plan. It stays inert (skips, doesn't fail)
until two repo secrets are set (Settings -> Secrets and variables ->
Actions):

- `RESOLVE_CRON_URL` — full URL, e.g. `https://<your-deployment>/api/cron/resolve`
- `WORKER_SECRET` — must equal that deployed environment's `WORKER_SECRET`

GitHub's scheduler is best-effort (can lag under load; disabled after 60
days of no activity on the default branch, reset by any push) — fine for a
project in active development, worth knowing if this repo ever goes quiet.

## 4. Go-live checklist

- [ ] Database provisioned (separate Production/Preview instances)
- [ ] `prisma migrate deploy` run against each database
- [ ] All env vars set per-environment in Vercel (table above)
- [ ] `MOCK_PAYMENTS` confirmed **unset** in Production
- [ ] Cron wired: `vercel.json` (Pro) and/or the GitHub Actions workflow, with `WORKER_SECRET`/`CRON_SECRET` matching the deployed environment
- [ ] `npm run db:seed` run once against a fresh database (49 plots) — never re-run against a database with real bids/tenants
- [ ] Record the resulting production/preview URLs in the README (not yet present — see `delivery-pipeline-unproven` in the Part 2 remediation doc)
