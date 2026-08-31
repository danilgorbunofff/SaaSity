# Phase 4.1 — Marketing Sections

**Milestone:** [4 · Landing & Polish](../PLAN.md) · **Prev:** [Milestone 3](../../03-stripe-payments/PLAN.md) · **Next:** [4.2 Lease Win Celebration](phase-02-purchase-celebration.md)
**Status:** ⚪ Not started · **Estimate:** ~1–1.5 days

## Goal

A scrollable narrative wrapping the live city: a visitor understands the joke-and-the-value, the pricing, and how to buy — in seconds.

## Prerequisites

- M3 signed off (3.4 table green)

## Steps

1. **Page architecture**
   - Layout plan: hero (city is the hero — full-bleed interactive) → "how it works" (3 steps) → pricing tiers → FAQ → social proof → footer/legal
   - Decide scroll vs tabbed "City / About" split; recommendation: single scroll with city pinned as hero, sections below on dark continuation
2. **Copy pass**
   - Voice: confident cyberpunk deadpan ("Lease a plot in the world's first SaaS cyber city — if you can hold it"); every headline written, not lorem; tagline, per-tier blurbs, 6–8 FAQ answers (how proxy bidding + soft-close work, what happens when a lease cycle ends, **can I get outbid after I'm already live** [yes — until the cycle closes, and again at the start of every future cycle], how holds/charges work [we authorize your max bid but only ever charge the final clearing price; every losing bid's hold is released, never charged], NSFW rule) — no FAQ answer may imply a one-time or permanent purchase
3. **Pricing section**
   - Three tier cards mirroring in-game visuals, showing **floor price + bid increment + cycle duration** per tier ($1.00 · +$0.50 · 6h outer, $5.00 · +$1.00 · 12h mid, $25.00 · +$5.00 · 24h core) with live idle/live counts per tier (from the store, not hardcoded) — scarcity plus the ticking countdown is the salesperson
   - No fixed "city funds" progress bar toward a total — a recurring lease model has no cap to fill. Instead echo 1.4's HUD live-activity figure at landing-page scale: "X plots live right now, $Y in current bids" (recomputed on load, not a static number)
4. **Social proof strip**
   - Row of **currently-leasing** companies (logo-less text cards from plot data: name + X handle + `mrrText` badge if present, plus tier) that populates as plots go `LIVE`; empty state: "Founding districts await"
   - This strip inherently rotates as leases change hands over time — framed explicitly as a feature ("the city is always changing — today's HQ might not be tomorrow's") not a bug or staleness risk
5. **Legal & meta**
   - Terms/privacy stubs (one-pagers), X OG tags baseline (full per-plot OG in 4.3), favicon/brand mark

## Verification

- Read-through test with one unsuspecting person: can they explain the product and price unprompted afterward?

## Exit criteria

- [ ] No placeholder copy anywhere in prod
- [ ] Tier cards + counts driven by live data
- [ ] FAQ answers match actual implemented behavior (esp. how proxy bidding/holds/captures work — check against 3.4's accepted-risks note); confirm no copy anywhere implies a one-time or permanent purchase

## Out of scope / notes

- Cut line if schedule slips: FAQ can shrink to 4 answers
