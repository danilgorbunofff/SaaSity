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

| Variable                                                        | Required         | Description                                       |
| --------------------------------------------------------------- | ---------------- | ------------------------------------------------- |
| `DATABASE_URL`                                                  | yes              | PostgreSQL connection string                      |
| `BIDDER_COOKIE_SECRET`                                          | yes              | HMAC secret for anonymous bidder identity cookies |
| `WORKER_SECRET`                                                 | yes (for cron)    | Shared secret authorizing `POST /api/cron/resolve` (expiry-sweep worker); the route always 401s without it |
| `MOCK_PAYMENTS`                                                 | yes, pre-M3       | Set to `1` to run the mock capture/cancel/authorize loop; unset means every capture fails closed (no unpaid winners) |
| Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, ...) | milestone M3      | Real payments (not yet wired)                     |

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
