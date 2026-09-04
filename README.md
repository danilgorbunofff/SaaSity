# SaaSity

A 10×10 isometric cyberpunk city where SaaS founders bid in recurring timed auctions for time-limited billboard-plot leases. Win a plot, your startup's name, tagline, link, and logo light up the skyline until the next auction cycle takes it.

## How it works

- **49 plots** on a 10×10 grid — 36 outer (1×1), 12 mid-district (2×2), 1 core spire (4×4).
- Plots are leased via **timed auctions with proxy pre-bidding, soft-close anti-sniping (+3 min), and per-cycle floor-price resets**.
- Lease cycles rotate continuously: winners' brand assets go live, losing pre-auth holds are released, and the next cycle opens at the tier floor.

### Tier economics

| Tier  | Span | Cycle    | Floor price | Bid step |
| ----- | ---- | -------- | ----------- | -------- |
| OUTER | 1×1  | 6 hours  | $1.00       | +$0.50   |
| MID   | 2×2  | 12 hours | $5.00       | +$1.00   |
| CORE  | 4×4  | 24 hours | $25.00      | +$5.00   |

## Tech stack

- **Next.js** (App Router, TypeScript) · **Tailwind CSS** · **Three.js** + **@react-three/fiber** + **@react-three/drei**
- **PostgreSQL** + **Prisma 7** · **Stripe** (SetupIntent pre-auth + manual-capture PaymentIntent — milestone M3, not yet wired) · **Zustand** · **canvas-confetti**
- Live plot updates via SSE
- **Current payments status:** M0-M2 run on a `MOCK_PAYMENTS=1` stub loop (no real Stripe calls yet) so the claim → bid → resolve → next-cycle flow is fully exercisable before M3 lands real captures. See [Environment variables](#environment-variables).

## Getting started

**Requires Node.js ≥22.0 and npm ≥10** (Prisma 7's transitive
`@prisma/streams-local` requires Node ≥22; also declared in
`package.json#engines`, which npm enforces during `npm install`).

```bash
# 1. Install
npm install

# 2. Configure env
cp .env.example .env
#    Fill in DATABASE_URL (PostgreSQL), BIDDER_COOKIE_SECRET and WORKER_SECRET.
#    Set MOCK_PAYMENTS=1 to exercise the auction loop before Stripe (M3) lands.

# 3. Apply schema and seed the 49 plots
npx prisma migrate deploy
npm run db:seed

# 4. Run
npm run dev
```

Open http://localhost:3000 to see the city grid.

## Environment variables

See [`.env.example`](.env.example) for the full, commented list. Summary:

| Variable                                                        | Required       | Description                                                                                                          |
| --------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                  | yes            | PostgreSQL connection string                                                                                         |
| `BIDDER_COOKIE_SECRET`                                          | yes            | HMAC secret for anonymous bidder identity cookies                                                                    |
| `WORKER_SECRET`                                                 | yes (for cron) | Shared secret authorizing `POST /api/cron/resolve` (expiry-sweep worker); the route always 401s without it           |
| `MOCK_PAYMENTS`                                                 | yes, pre-M3    | Set to `1` to run the mock capture/cancel/authorize loop; unset means every capture fails closed (no unpaid winners) |
| Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, ...) | milestone M3   | Real payments (not yet wired)                                                                                        |

## Deployment

No account is connected yet, but the repo is prepped for Vercel: a
Hobby-plan-safe `vercel.json` cron entry, a Vercel-plan-independent GitHub
Actions alternative for resolving ended auction cycles, required env vars
per environment, and a go-live checklist. See
[`docs/deployment.md`](docs/deployment.md).

## Bidder identity

There are no accounts, passwords, or emails. A bidder is an HMAC-signed
`httpOnly` cookie (`src/server/bidder-cookie.ts`) minted on their first
claim/bid/pre-bid — roughly: **one browser = one bidder**. Consequences:

- Clearing cookies, switching browsers/devices, or going incognito creates a
  **new** bidder identity. Positions, "am I leading", and tenant derivation
  for the old identity become unreachable from the new one (rows are keyed by
  the opaque `bidderRef`, and `/api/me/bids` only answers for the calling
  cookie).
- Rotating `BIDDER_COOKIE_SECRET` logs every existing bidder out at once.
  Never share one secret value across local/preview/production.
- Anyone with the cookie (e.g. a shared device) acts as that bidder. The
  cookie is `httpOnly` + `sameSite=lax`, but there is no second factor and no
  recovery flow — by design for an auction MVP, documented here so M3's card
  flows inherit the constraint knowingly.

## Dependency policy

`package.json` uses caret (`^`) ranges, not exact versions — reproducibility
comes from the **committed `package-lock.json`**, not from the manifest.
`npm ci` (what a clean checkout, `postinstall`, and CI all use) always
installs the exact resolved graph in the lockfile, ignoring what a bare
`npm install` might otherwise pick up. In practice:

- Bumping a dependency is a deliberate act — `npm install <pkg>@<range>`
  (or `npm update`) followed by committing the regenerated lockfile — never
  an incidental side effect of someone else's `npm install`.
- `overrides` in `package.json` forces specific transitive dependency
  versions when a security advisory affects a sub-dependency of a package
  we don't want to downgrade (currently: `deepmerge-ts` and `mysql2`, both
  transitive through `prisma`'s own CLI tooling — see
  [`docs/reviews/m0-m2-remediation/part-02-foundation-delivery-data.md`](docs/reviews/m0-m2-remediation/part-02-foundation-delivery-data.md)
  for the advisory details).
- No automated update bot (Renovate/Dependabot) is configured yet; updates
  are manual for now.

## Project layout

```
src/app/           Next.js App Router (pages + API routes)
src/server/        Prisma client, serializers, bidder identity
src/lib/           Grid geometry, tier economics, integrity checks
prisma/            Schema + seed
docs/plans/        Milestone plans (M0..M5)
```

## Docs

Milestone roadmap and detailed phase plans live in [`docs/plans/`](docs/plans/).
Deployment prep lives in [`docs/deployment.md`](docs/deployment.md).
