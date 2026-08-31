# Phase 2.1 — Bid & Pre-Bid Form Validation

**Milestone:** [2 · Auctions & Realtime](../PLAN.md) · **Prev:** [Milestone 1](../../01-3d-city/PLAN.md) · **Next:** [2.2 Claim, Bid & Proxy Engine API](phase-02-atomic-reserve-api.md)
**Status:** ⚪ Not started · **Estimate:** ~1.5 days

## Goal

One shared form — claim, manual bid, or proxy pre-bid; same field contract, different submit target and copy depending on plot/cycle state — with the full brand-asset set and a validated `maxBidCents`. UI-complete even before the backend or Stripe exists.

## Prerequisites

- M1 done: detail card with the claim/bid CTA hook point

## Steps

1. **Field contract**
   - Define one schema (zod or equivalent) shared by client and server: `plotId` (must exist), `companyName` (1–48 chars), `tagline` (≤ 80 chars), `targetUrl` (https URL, normalized, reject self/Stripe/localhost), `twitterHandle` (strip `@`, 1–15 chars, `[A-Za-z0-9_]`), `mrrText` (optional, ≤ 20 chars, free-text badge e.g. "$12k MRR"), `maxBidCents` (integer, positive) — the same five brand fields as the original spec, plus the one new field this pivot adds
   - `maxBidCents`'s minimum is **contextual, not fixed**: for a **claim** (plot `IDLE`) it must be ≥ the tier's floor price; for a **bid** (plot `LIVE`) it must be ≥ `currentPriceCents + incrementCents`; for a **pre-bid** (targeting the next cycle) it must be ≥ the tier's floor price (same as a claim — nobody knows the next cycle's competitive state yet). The modal computes and displays the live minimum so the field never rejects a value the user couldn't have anticipated
2. **Modal UX — three modes, one shell**
   - Opens from the detail card CTA for the selected plot; header shows plot id + contextual copy: **"Claim this plot"** (`IDLE`, price = tier floor), **"Place a bid"** (`LIVE`, shows current price + minimum next bid), or **"Schedule a pre-bid"** (`LIVE`, explicitly targeting the plot's *next* cycle, for a founder who can't be online when it opens — the timezone-fairness feature)
   - Per-field inline errors, submit disabled until locally valid; keyboard focus trap (formal a11y audit later in 4.4); ESC/backdrop close with confirm-if-dirty
3. **Payment step (stubbed here, real in 3.1)**
   - A placeholder "payment method" section in the same modal (visually present, non-functional) — this phase never talks to Stripe; 3.1 replaces the stub with a mounted Stripe PaymentElement/SetupIntent flow without changing the surrounding form's shape
4. **States**
   - idle → submitting (spinner, fields locked) → success (hands off to 2.5's cycle view) / error (server message surfaced verbatim where safe) / **outbid** (a live auction moved past the user's just-submitted amount before the request landed — distinct copy: "someone else just took the lead, try a higher amount")
5. **Store wiring**
   - Zustand slice: `bidForm` (open/plotId/mode: `claim`\|`bid`\|`prebid`/status) so the 3D scene and modal share one state without prop drilling
6. **Anti-spam placeholder**
   - Client-side throttle on resubmits; server-side guard is 2.2's job — note it there

## Verification

- Form validation table tested manually: valid, each-field-invalid, hostile URLs (`javascript:`, data URIs), and each of the three modes' contextual minimum-amount copy

## Exit criteria

- [ ] One shared schema validates identically client and server across all three modes
- [ ] Modal flow works with a mocked submit endpoint
- [ ] All five brand fields plus `maxBidCents` captured exactly as M3's pre-auth will need them

## Out of scope / notes

- `logoUrl` deliberately excluded from this phase — URL-vs-upload decision is M4 phase 4.3; schema reserves room for it. `mrrText` **is** in scope here (plain optional text, no decision needed)
- Real payment collection is 3.1 — this phase's payment step is a visual stub only
