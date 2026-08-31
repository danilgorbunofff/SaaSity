# Phase 5.3 — Observability & Admin

**Milestone:** [5 · Launch & Operations](../PLAN.md) · **Prev:** [5.2 Hardening](phase-02-hardening-ratelimits.md) · **Next:** [5.4 Launch Execution](phase-04-launch-execution.md)
**Status:** ⚪ Not started · **Estimate:** ~1 day

## Goal

You can see what's happening (funnel, errors, DB, **worker health**) and fix weird cycles by hand (admin) — the ops half of "stay live".

## Prerequisites

- 5.1–5.2 (production env to observe)

## Steps

1. **Error tracking**
   - Sentry: client + server + worker + reconciliation-webhook handler; release tagging; env filtering; alert routing to email/Telegram — a worker resolution error pages you, loudly (it's now the primary finalization authority per M3 3.3, not a secondary path)
2. **Funnel events** (privacy-light, first-party or PostHog-free tier)
   - `view` → `claim_open`/`bid_open` → `card_saved` (SetupIntent confirmed) → `claim_confirmed`/`bid_placed` → `cycle_won`/`outbid` per plotId/tier; separately track the pre-bid path (`prebid_open` → `prebid_saved`); activity rollup query (sum of current `LIVE` prices, not a fixed revenue total) saved as a favorite
3. **Infrastructure signals**
   - Uptime monitor on `/api/plots` (external, e.g. UptimeRobot free); Vercel spending/anomaly alerts; DB connection count alert (pool exhaustion is a realistic launch failure)
   - **Worker-health alert (new, most important addition here):** alert if the cron hasn't completed successfully within ~2 intervals, or — a more direct business-logic check — if any `AuctionCycle` is `OPEN`/`RESOLVING` with `endAt` more than a few minutes in the past. A stuck worker means plots stay `LIVE` forever past their real close time; this is the single most launch-critical failure mode this milestone needs to catch fast
4. **Admin console** — single protected page `/admin` (secret token / Vercel SSO gate, *not* in the public nav, no user system)
   - Grid + cycle table: every plot's raw state incl. internal fields, its current/last `AuctionCycle`, last event
   - Actions (each requires confirm + writes an audit line): **force-resolve a stuck cycle** (wraps 5.1's proven script in a real UI — invokes the same `resolveCycle`/`finalizeCycle` functions M2 2.3 and M3 3.3 already built, not a new implementation), **cancel a cycle back to `IDLE`** (e.g. clearly fraudulent claim), **hide/unhide logo** (4.3's `logoHidden` flag), **manually cancel a stuck PaymentIntent/SetupIntent** (escape hatch when Stripe and DB truly disagree — worker's record still wins per 3.3, this is for genuinely stuck state), **re-emit realtime event** (unstuck UIs)
   - This is also where **the capture-failure cascade log** (M2 2.3 / M3 3.3) surfaces for human review — 2.3 already commits to this exact surface, so it's a hard dependency, not a nice-to-have; a repeated pattern of cascades on one bidder's cards is itself a carding signal worth cross-checking against 5.2's fraud policy
5. **Runbook** (`docs/runbook.md`, linked here) — copy-paste procedures:
   - "Leaseholder's brand data wrong on a live plot" · "**Worker/cron stopped resolving cycles**" (primary-authority failure — highest severity) · "Reconciliation webhook lagging/stopped" (secondary — degrades cross-checking, not resolution itself) · "Restore from backup" · "Kill switches: disable claim/bid, disable mock, pause the worker, pause deploy"

## Verification

- Tableflip drills: simulate each runbook scenario once on prod-adjacent data and execute the procedure, including a deliberately stalled worker to confirm the health alert actually fires

## Exit criteria

- [ ] Sentry catches a deliberately thrown worker resolution error within a minute
- [ ] Worker-health alert fires within its documented window when cron is deliberately paused
- [ ] Funnel shows all claim/bid events live during a test claim
- [ ] Admin force-resolve action verified against a real stuck cycle (with audit trail); cancel-cycle and logo-hide actions verified
- [ ] Capture-failure cascade log populated and reviewable after a deliberate cascade test (reuse M2 2.3's cascade test)
- [ ] Runbook exists and survived rehearsal, not just authorship

## Out of scope / notes

- Dashboards/grafana — unnecessary at 49-plot scale; queries + alerts suffice
