# Phase 4.2 — Lease Win Celebration

**Milestone:** [4 · Landing & Polish](../PLAN.md) · **Prev:** [4.1 Marketing Sections](phase-01-marketing-sections.md) · **Next:** [4.3 Social & Logos](phase-03-social-and-logos.md)
**Status:** ⚪ Not started · **Estimate:** ~1 day

## Goal

The moment a cycle **resolves with a winner** feels like an event — for the winning bidder *and* for everyone else watching the city.

## Prerequisites

- Phase 3.2's reload-safe bid confirmation UI (this upgrades it); M2 2.4 realtime working (`cycle:resolved` broadcasts the win)

## Steps

1. **Buyer-side moment**
   - On a `cycle:resolved` event where the viewer's bidder cookie matches the winner (per 3.2's won/lost resolution copy): `canvas-confetti` burst (respect `prefers-reduced-motion` → fade instead), camera flies to and frames their newly-won building (ease with ortho zoom/pan, ~1.5s), detail card opens on it with a **"You're live"** variant — never "you own this": copy must never imply permanent ownership. Correct framing: "Your HQ is live on {tier}-{id} for the next {durationSeconds/3600}h"
   - Share prompt: prewritten X post — "{companyName} HQ is now live in @SaaSity at {tier}-{id} 🏙 — leasing until someone outbids us. Think you can take it?" + link + OG preview (depends on 4.3 for the best thumbnail; ship text-only now). The temporariness is framed as a dare/hook, not a caveat — matches the product's deliberate "you could be outbid any second" urgency design
2. **Spectator-side moment**
   - Any browser receiving a `cycle:resolved` event **with a winner**: brief emissive flare on that building + toast "New HQ live: {company} took {tier}-{id}" (click → selects the plot)
   - A `cycle:resolved` event **with no winner** (all bidders' captures failed, plot reverted to `IDLE`) gets a quieter, non-celebratory dim-flare only — it's a vacancy, not a sale, and should not read as an achievement
   - Toast throttled (max 1 concurrent, FIFO) so a busy stretch of resolutions doesn't stack spam
   - Regular `bid:placed` ticks during an still-open auction do **not** trigger any celebration effect (would be noisy/spammy at scale, especially during a contested bidding war) — only a `cycle:resolved` win does. This is a deliberate scope boundary
3. **CORE-plot escalation (cheap, fun)**
   - Any `CORE` cycle resolving with a winner gets a special elevated full-screen treatment (beam intensifies, unique toast) — CORE cycles are rare (24h duration, only one CORE plot exists), so this stays an event every time, not just once
   - Reserve genuinely one-time copy ("the first-ever CORE lease in SaaSity history") for the literal first CORE resolution only; every CORE resolution after that still gets the standard elevated treatment, just without the "first ever" framing — the city has no permanent "sold out" state to coast on, so the celebration can't be a single lifetime achievement the way it was pre-pivot
4. **Sound** (optional, 15-min budget): subtle synth blip on a cycle win, muted default, toggle in footer

## Verification

- Two-machine test: a bidder wins 3.4's cycle-resolution scenario while a spectator watches confetti + toast + auto-select

## Exit criteria

- [ ] Celebration triggers from a **server-confirmed `cycle:resolved` win** only — never from URL params or optimistic local state
- [ ] Reduced-motion users get a calm equivalent
- [ ] Share text includes live plot coordinates/id
- [ ] Copy never implies permanent ownership — audited across the confetti card, share text, and toasts ("leasing" / "live" / "won this cycle", never "own" / "yours forever")

## Out of scope / notes

- The final share-card image polish is 4.3 — wire the hook, don't build it twice
