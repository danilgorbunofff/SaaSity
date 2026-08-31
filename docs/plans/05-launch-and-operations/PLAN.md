# Milestone 5 — Launch & Operations

**Prev:** [04 · Landing & Polish](../04-landing-and-polish/PLAN.md) · **Back:** [All milestones](../README.md)
**Status:** ⚪ Not started

## Objective

Go live and stay live: production keys, hardening, observability, minimal admin tooling, and the launch push itself (X / Product Hunt).

## In scope

- Production cutover: live Stripe keys + reconciliation webhook endpoint registration, production DB with backups enabled, worker/cron deployment verified, env audit
- Hardening: rate limiting on claim/bid/pre-bid + webhook + worker-cron routes, input limits, card-testing/carding abuse consideration (any endpoint that touches Stripe SetupIntent/PaymentIntent creation is a carding target, not just a griefing one)
- Observability: error tracking (Sentry), bid funnel events, worker-health monitoring (cycles resolving on schedule, not just app uptime), DB/connection monitoring
- Admin essentials: small protected console to inspect grid/cycle state, force-resolve a stuck cycle, review the capture-failure cascade log, and handle dispute edge cases (dispute via Stripe dashboard + manual status procedure documented)
- Launch assets & run: screen recording of the city, Product Hunt listing, X launch thread, starter FAQ/support channel
- Post-launch loop: daily activity/occupancy glance, respond-to-leaseholders process

## Out of scope

- New product features beyond launch needs (park any in a backlog section of this doc's follow-ups)

## Planned phases

| Phase | File | Focus |
|-------|------|-------|
| 5.1 | [production cutover](phases/phase-01-production-cutover.md) | Live keys, reconciliation webhook, worker/cron verified, DB backups, env audit |
| 5.2 | [hardening & rate limits](phases/phase-02-hardening-ratelimits.md) | Abuse-resistant claim/bid/pre-bid, route + worker-endpoint limits |
| 5.3 | [observability & admin](phases/phase-03-observability-admin.md) | Sentry, funnel events, worker-health alerts, admin controls |
| 5.4 | [launch execution](phases/phase-04-launch-execution.md) | Assets, PH/X push, day-of checklist |

## Deliverables

- Live product with real leases possible and monitored
- Ops runbook: "leaseholder brand data wrong on a live plot", "force-resolve/cancel a stuck cycle", "worker/cron stopped resolving cycles", "webhook reconciliation lagging", "restore from backup"
- Launch post published + traffic verified through the claim/bid funnel in production

## Definition of done

- [ ] One real-dollar smoke claim/bid completed in live mode, force-resolved, captured correctly, and reviewed/refunded via the documented process
- [ ] Error alerts, worker-health alert, and DB backup restore all verified at least once manually
- [ ] Rate-limit behavior tested (hammering claim/bid/pre-bid returns graceful 429s, no unthrottled card-testing pattern, no 5xx storms)
- [ ] Launch day checklist executed; funnel analytics reporting

## Dependencies

- **M0–M4 all green** — this milestone is the gate; do not start cutover with open defects in M3 pre-auth/capture correctness

## Risks & mitigations

- **Launch-traffic 3D perf** → load test the read path; base `/api/plots` fetch is cacheable for initial load, SSE (M2 2.4) carries the live-tick load so the read path isn't repolled
- **Capture-failure cascade at scale** → if a popular cycle's top several bidders all have failing cards, a plot can revert to `IDLE` despite real demand; 5.3's cascade log makes this visible fast, and Stripe Radar tuning (5.2) reduces how often it happens
- **Carding / card-testing abuse** → any SetupIntent/PaymentIntent creation path is a target for stolen-card validation, not just plot griefing; addressed in 5.2 (rate limits + Radar), not treated as a refund/regret-buy problem the way a one-time purchase would be
