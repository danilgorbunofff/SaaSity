# Phase 0.1 — Repo & Tooling

**Milestone:** [0 · Scaffold & Data Layer](../PLAN.md) · **Next:** [0.2 Database & Prisma](phase-02-database-and-prisma.md)
**Status:** ✅ Done (2026-09-01) · **Estimate:** ~0.5 day

## Goal

A committed, deployable Next.js skeleton with Tailwind, core frontend deps, and clean conventions — before any features exist.

## Prerequisites

- Node LTS installed locally; GitHub repo created (can be private)

## Steps

1. **Scaffold the app**
   - Create Next.js app with App Router + TypeScript (`create-next-app`, ESLint enabled, `src/` layout, path alias `@/*`)
   - Verify `npm run dev` renders the default page
2. **Styling & icons**
   - Confirm Tailwind v4 setup; define the brand palette as CSS variables (deep-black base, cyan/magenta neon accents) in one place
   - Install `lucide-react`; drop one test icon on the page to prove the import path
3. **Core frontend deps**
   - Install `three`, `@react-three/fiber`, `@react-three/drei`, `zustand`, `canvas-confetti` (+ `@types/three`, `@types/canvas-confetti`)
   - Add a placeholder `components/city/` route section (empty mount point) — actual 3D work is M1
4. **Conventions & hygiene**
   - ESLint + Prettier aligned (no formatting debates later); editorconfig
   - `.env.example` listing every planned variable (`DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, realtime keys) with comments — even though M0 only uses the DB one
   - Sensible folder skeleton: `app/`, `components/`, `lib/`, `server/` (server-only code), `types/`
5. **Deployment pipeline first**
   - Push to GitHub; connect Vercel; deploy the skeleton (production + preview builds)
   - Confirm env var configuration UI works on Vercel (values come in 0.2)

## Verification

- `npm run lint` and `npm run build` pass clean
- Production URL from Vercel serves the skeleton; preview deploys appear on PRs

## Exit criteria

- [ ] Repo, branch protection (or at least PR habit) and CI-via-Vercel working
- [ ] All M0/M1 dependencies installed with pinned versions
- [ ] Deployed URL exists and is referenced in README

## Out of scope / notes

- No database work here — resist wiring `DATABASE_URL` before phase 0.2 exists
