# Phase 4.4 — Mobile & Accessibility Pass

**Milestone:** [4 · Landing & Polish](../PLAN.md) · **Prev:** [4.3 Social & Logos](phase-03-social-and-logos.md) · **Next:** [Milestone 5](../../05-launch-and-operations/PLAN.md)
**Status:** ⚪ Not started · **Estimate:** ~1 day

## Goal

The product works on the device most launch traffic will arrive on (phones, from X), and nobody is blocked by pointer-only or motion-heavy design. Last scope gate before launch work begins.

## Prerequisites

- 4.1–4.3 complete (audit the finished surface, not a moving one)

## Steps

1. **Mobile ergonomics**
   - One-finger orbit vs page-scroll conflict resolution (canvas captures drags; explicit scroll affordance below hero)
   - Detail card + modal as bottom sheets on small screens; tap targets ≥ 44px; text legibility at min zoom (bake a mobile zoom floor if 20 is unreadable — adjust per-platform maxZoom)
   - Re-run 1.5's perf gates on the same phone model used for verification, including the busy-launch simulation (several `LIVE` auctions ticking at once), not just an idle grid — mobile shader budget may force: no transmission, simpler CORE beam
2. **Keyboard path**
   - Extend 1.4's hidden plot list into a real focusable layer: Tab cycles plots (order = tier then id), Enter selects, claim/bid flow fully completable without a mouse (modal, forms, Stripe Elements confirmation are native-focus-safe)
   - Visible focus states on neon-on-dark (contrast ≥ 3:1 for focus indicators)
3. **Screen reader & semantics**
   - Canvas gets `aria-hidden` + a text alternative: live region summarizing HUD counts; detail card is a real dialog with proper roles; leader links are anchors
   - Status never conveyed by color alone (skins from 1.3 get text labels in card/HUD — mostly done, verify)
   - The live per-second countdown (1.4, shown for the selected plot) must **not** be wired as a naive `aria-live` region — announcing every second is a well-known screen-reader anti-pattern (constant interruption). Correct treatment: the numeric countdown updates visually every second, but any live-region announcement is throttled to meaningful thresholds only (e.g. once on selection, again on entering the "under 3 minutes — soft-close window" state, again under 30 seconds — never on every tick)
4. **Motion & contrast**
   - `prefers-reduced-motion`: no auto-rotations/pulses/confetti animation (4.2 hook exists); no vestibular-risky camera flies (instant select instead)
   - Audit body copy contrast (neon text on black commonly fails — fix tokens globally, not per-component)
5. **Tooling sweep**
   - axe/Lighthouse accessibility ≥ 90 on root + plot page; fix list triaged: blocker vs follow-up, follow-ups written into 5.4's known-issues note

## Verification

- Complete a full mock claim/bid on a real phone + keyboard-only, both end-to-end

## Exit criteria

- [ ] Two-device matrix (iOS Safari, Android Chrome) sign-off on: render, orbit, claim/bid, pre-auth (test mode), share
- [ ] Keyboard claim/bid flow demo-able
- [ ] Lighthouse a11y score recorded in this file; remaining gaps listed with reasons
- [ ] Live countdown confirmed to use throttled (not per-second) `aria-live` announcements

## Out of scope / notes

- Native app-feel gestures, RTL localization — backlog, not launch blockers
