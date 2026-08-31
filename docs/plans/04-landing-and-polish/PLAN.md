# Milestone 4 — Landing & Polish

**Prev:** [03 · Stripe Payments](../03-stripe-payments/PLAN.md) · **Next:** [05 · Launch & Operations](../05-launch-and-operations/PLAN.md)
**Status:** ⚪ Not started

## Objective

Turn the working product into a page people share and bid on: marketing narrative around the city (explaining the **lease/auction** model, not a one-time purchase), celebration moments when a cycle is won, shareable per-plot identity, and mobile/accessibility correctness.

## In scope

- Landing sections around the city view: hero, "how it works" (claim/bid/pre-bid + soft-close explained), tier economics table (floor price + increment + cycle duration per tier: $1.00 +$0.50/6h outer, $5.00 +$1.00/12h mid, $25.00 +$5.00/24h core), FAQ, social proof strip (current leaseholders with their X handles)
- Celebration UX: canvas-confetti on winning a lease cycle, momentary focus/fly-to on the newly-won plot
- Dynamic OG/social images per plot (building + company name) for link previews when leaseholders share their win
- Company logo story: decide `logoUrl` handling (URL field vs hosted upload) and render logos on billboards/mid-tier frames
- Mobile pass: camera/controls ergonomics, tap targets, modal layout, reduced-motion respect
- Accessibility pass: keyboard-reachable claim/bid flow, focus management in modals, color/state redundancy (state also conveyed non-visually)
- Copywriting + brand voice pass for the cyberpunk theme

## Out of scope

- Infrastructure hardening, monitoring, admin tooling (M5)

## Planned phases

| Phase | File | Focus |
|-------|------|-------|
| 4.1 | [marketing sections](phases/phase-01-marketing-sections.md) | Hero/how-it-works/pricing/FAQ layout + copy |
| 4.2 | [lease win celebration](phases/phase-02-purchase-celebration.md) | Confetti, camera fly-to, "you're live" moment |
| 4.3 | [social & logos](phases/phase-03-social-and-logos.md) | OG images per plot, logoUrl decision + rendering |
| 4.4 | [mobile & a11y pass](phases/phase-04-mobile-a11y-pass.md) | Responsive and accessibility fixes |

## Deliverables

- Public-ready landing experience at the root route with all sections above
- Shareable OG preview verified in X/Slack/LinkedIn debuggers for a sample live plot (both the revalidating generic URL and an immutable per-cycle URL)
- Lighthouse score documented (target: >90 accessibility, reasonable perf tradeoff accepted for WebGL)

## Definition of done

- [ ] First-time visitor understands the lease/auction model and tier pricing in under 15 seconds
- [ ] Winning a lease cycle feels like an event (confetti + plot highlight + share prompt)
- [ ] Claim/bid flow fully usable on a phone and via keyboard only
- [ ] A leaseholder can share "my HQ is live in SaaS City" and the link preview shows their building — correctly reflecting whoever is the *current* leader if the link is opened again later

## Dependencies

- **M1–M3** (product must work end-to-end before dressing it)

## Risks & mitigations

- **Polish scope creep delays launch** → phases 4.3/4.4 are the designated cut lines if the schedule slips
- **WebGL page + marketing SEO tension** → keep copy in DOM text, not textures
