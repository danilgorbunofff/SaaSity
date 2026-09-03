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
  - > **Correction (Part 2 foundation fix, M2):** GitHub Actions CI now
    > exists and runs on every push/PR to `main`
    > (`.github/workflows/ci.yml`: migrate/seed/typecheck/lint/test/build),
    > but there is no Vercel connection — "CI-via-Vercel" specifically was
    > never built, a plain GitHub Actions pipeline was, which is a
    > different (equally valid, but not what this line describes) choice.
    > Branch protection is not yet enabled; it's a real decision (it
    > changes how pushes to `main` are allowed) intentionally left for the
    > repo owner, not something to flip silently from a remediation pass.
    > See `docs/reviews/m0-m2-remediation/part-02-foundation-delivery-data.md`.
- [ ] All M0/M1 dependencies installed with pinned versions
  - > **Correction (Part 2 foundation fix, M2):** `package.json` still uses
    > caret ranges, not exact versions — that was a deliberate choice, not
    > an oversight, made explicit now rather than left ambiguous.
    > Reproducibility comes from the committed `package-lock.json` plus
    > `npm ci` (used by `postinstall`, the documented clean-checkout path,
    > and CI), which always installs the exact locked graph regardless of
    > the ranges in `package.json`. See the README's "Dependency policy"
    > section and
    > `docs/reviews/m0-m2-remediation/part-02-foundation-delivery-data.md`.
- [ ] Deployed URL exists and is referenced in README
  - > **Correction (Part 2 foundation fix, M2):** still not done — this
    > requires a Vercel (or equivalent) account action outside anything a
    > commit alone can do. Flagged as open in
    > `docs/reviews/m0-m2-remediation/part-02-foundation-delivery-data.md`.

## Out of scope / notes

- No database work here — resist wiring `DATABASE_URL` before phase 0.2 exists
