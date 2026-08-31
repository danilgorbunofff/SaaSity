# Milestone 0 — Scaffold & Data Layer

**Back:** [All milestones](../README.md) · **Next:** [01 · 3D City](../01-3d-city/PLAN.md)
**Status:** ⚪ Not started

## Objective

Stand up the project skeleton and the entire data layer so every later milestone builds against a real, deployed database — not mocks.

## In scope

- Next.js (App Router, TypeScript) + Tailwind CSS + Lucide React; base repo config (lint, formatting, env handling)
- PostgreSQL provisioned (Neon or Supabase) with Prisma ORM
- Schema per the auction/lease model: `Plot` (spatial identity + current-display fields), `AuctionCycle`, `PreBid`, `Bid`, plus `PlotTier` / `PlotStatus` / `CycleStatus` / `PreBidStatus` enums, indexed for both grid lookup and the resolution worker's due-cycle query
- Seed script generating the exact grid geometry: 1 CORE (4x4) + 12 MID (2x2) + 36 OUTER (1x1) = 49 plots tiling the 10x10 plane, every plot seeded `IDLE` — pricing/duration are tier constants in code (`lib/tiers.ts`), not seeded per-plot
- Public read endpoints for the full grid (`GET /api/plots`) and a plot's bid ledger (`GET /api/plots/:id/bids`), cacheable
- Early deployment to Vercel with connected DB (the "hello city" shell)
- `canvas-confetti` and `zustand` dependencies installed and wired at smoke-test level so later milestones don't touch setup

## Out of scope

- Any 3D rendering, bidding/auction logic, Stripe pre-auth, realtime, marketing copy

## Planned phases

| Phase | File | Focus |
|-------|------|-------|
| 0.1 | [repo & tooling](phases/phase-01-repo-and-tooling.md) | App scaffold, lint/format, env vars, Vercel deploy pipeline |
| 0.2 | [database & Prisma](phases/phase-02-database-and-prisma.md) | Postgres provisioning, schema, first migration |
| 0.3 | [seed & read API](phases/phase-03-seed-and-read-api.md) | Seed script + grid integrity checks + plots API |

## Deliverables

- Deployed app URL showing a placeholder page reading live data
- Prisma schema + migration + seed committed and reproducible (`db seed` from scratch)
- Queryable plots API returning all 49 plots with coords, tier, status, and (once live) current price/leader/countdown

## Definition of done

- [ ] Fresh clone + install + migrate + seed works locally in one flow
- [ ] Seed produces exactly 49 plots and covers all 100 grid cells without overlap (verified by a check script)
- [ ] `/api/plots` returns correct data in production build
- [ ] No secrets in repo; env samples documented

## Dependencies

None — this is the root milestone.

## Risks & mitigations

- **Grid math drift in seed** → automated coverage/overlap check as part of the seed step
- **Hosting/DB mismatch with realtime approach** → resolved by construction: the DB host + realtime transport are decided together, once, in phase 0.2, before any database exists. Phase 0.3 and M2 phase 2.4 implement that decision; neither re-opens it
