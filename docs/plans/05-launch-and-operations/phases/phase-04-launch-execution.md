# Phase 5.4 — Launch Execution

**Milestone:** [5 · Launch & Operations](../PLAN.md) · **Prev:** [5.3 Observability & Admin](phase-03-observability-admin.md) · **Back:** [All milestones](../../README.md)
**Status:** ⚪ Not started · **Estimate:** ~1 day + launch week attention

## Goal

Ship it publicly with a story worth sharing, and survive day one with eyes open.

## Prerequisites

- All exit criteria of M0–M4 and 5.1–5.3 green; list any waivers explicitly in this file before proceeding

## Steps

1. **Assets**
   - Screen recording: orbit the city → claim a plot → place a bid → (admin force-resolve or a short demo-only cycle) → confetti win moment (reuse 3.4 evidence clips + fresh hero pass); 15s loop for PH thumbnail
   - X launch thread draft (story: why, the grid math, the auction mechanics, screenshots of mid-build), PH copy draft, day-of checklist (who posts where, timing: weekday AM US)
2. **Pre-launch freeze**
   - 48h code freeze except fixes; final 3.4-condensed smoke on prod the morning of
3. **Go**
   - Post → watch Sentry/uptime/funnel/**worker-health alert** during the first traffic spike (5.3's alerts are the cockpit); carding/bid-spam watch: if abuse appears, flip 5.2's CAPTCHA flag and/or tighten Radar rules — decision owner: you, threshold written in 5.2
   - First real leaseholder: screenshot, thank them publicly, prompt their share card (4.2/4.3) — early social proof is the flywheel
4. **Day-1 retro (T+24h)**
   - Funnel numbers vs assumptions; bugs found; plot occupancy, cycles resolved, average clearing price vs floor per tier; write a 10-line retro into this file's follow-ups
5. **Follow-up backlog seeding**
   - Park known wants (receipts polish, longer/auto-renewing leases for proven tenants, "city expansion" phase 2 grid, secondary market nonsense) as a backlog list — deliberately **not** part of this milestone

## Verification

- Launch posts live with working links; real purchase observed through the funnel dashboard

## Exit criteria

- [ ] Product public, purchases happening or a documented reason none are (pricing/copy learnings recorded)
- [ ] Zero unresolved sev-1s 24h post-launch
- [ ] Retro written; backlog captured; milestone table in root README flipped to 🟢

## Out of scope / notes

- "Making it go viral" is not a task; publishing, measuring, and responding is
