# M0-M2 Remediation Pack

**Status:** Open review backlog  
**Scope:** Milestones 0, 1, and 2, including every phase and the current working tree  
**Release verdict:** No-go for M3 or production until the blocking gates below are closed

This directory converts the M0-M2 review into execution-ready workstreams. It
does not mark any issue fixed. A checkbox may be completed only after the
required implementation and its acceptance evidence both exist.

## Workstreams

| Order | Document | Scope | Recorded findings | Status |
| --- | --- | --- | ---: | --- |
| 1 | [Product lifecycle](part-01-product-lifecycle.md) | Define what is auctioned, when a lease begins, and who is displayed | 1 | ✅ Implemented + validated + committed (`e0ad13c`) |
| 2 | [Foundation, delivery, and data](part-02-foundation-delivery-data.md) | Clean-clone setup, migrations, deployment, identity constraints | 7 | ✅ Mostly resolved + committed (`b259010`) — 2 items honestly partial, see doc |
| 3 | [Auction engine, worker, and payments](part-03-auction-engine-worker-payments.md) | Race safety, proxy rules, soft-close, settlement, scheduling | 8 | ✅ Implemented + validated + committed (`76f82ea`) |
| 4 | [Realtime and client state](part-04-realtime-client-state.md) | Deploy-safe fan-out, SSE lifecycle, ownership/outbid synchronization | 6 | Open (`public-bidder-id` addressed as part of Part 1's SSE payload fix) |
| 5 | [3D city and performance](part-05-3d-city-performance.md) | OUTER regression, selection, motion, mobile performance | 5 | Open |
| 6 | [UI, UX, and accessibility](part-06-ui-ux-accessibility.md) | Bid flow, responsive HUD, accessibility, onboarding, interaction | 12 | Open |
| 7 | [Testing, release, and documentation](part-07-testing-release-documentation.md) | Integration coverage, preview proof, truthful milestone status | 3 |

## Required execution order

1. Resolve the lifecycle decision in Part 1 before changing Stripe, settlement,
   tenant display, or realtime payloads.
2. Make a clean checkout reproducible and commit coherent migrations in Part 2.
3. Fix money/state correctness in Part 3.
4. Replace or redesign process-local realtime in Part 4.
5. Repair the 3D state regression in Part 5.
6. Complete the primary user experience and accessibility work in Part 6.
7. Prove the entire system through Part 7 before changing milestone statuses.

Parts 3 and 4 may be developed in parallel only after Part 1 establishes the
canonical lifecycle and event vocabulary. Parts 5 and 6 may then proceed in
parallel against those stable contracts.

## Severity

| Level | Meaning |
| --- | --- |
| **Blocking** | Invalidates the product model, data correctness, deployability, or a primary workflow |
| **High** | Must be fixed before M3/release; major incorrectness or user harm |
| **Medium** | Required quality or contract gap; may follow blockers but cannot be silently waived |

## Rules for closing an item

- Keep the finding ID in the commit or pull-request description.
- Implement the root fix, not a success-shaped fallback.
- Add the regression test requested by the finding.
- Record the exact verification environment when deployment, browser, mobile,
  concurrency, or timing behavior is involved.
- Update milestone status only after its complete phase checklist is green.
- Never mark local `next start` evidence as Vercel preview or production proof.
- Do not begin real Stripe capture until Parts 1-4 are complete.

## Global definition of done

- [ ] A fresh clone can install, generate Prisma Client, migrate, seed, test,
      build, and start using documented commands only.
- [ ] The lifecycle grants the paid winner the advertised lease interval and
      never grants unpaid bidders equivalent exposure.
- [ ] Auction, worker, settlement, and realtime races have deterministic tests.
- [ ] Realtime works across separate deployment instances, not only one process.
- [ ] Every plot tier exposes equivalent status, selection, ownership, and
      outbid behavior.
- [ ] The full claim/bid/pre-bid/outbid flow works at desktop, short-laptop,
      mobile, 200% zoom, keyboard-only, and screen-reader conditions.
- [ ] M0-M2 phase statuses and exit criteria match reproducible evidence.

