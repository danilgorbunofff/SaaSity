# Phase 4.3 — Social Images & Logos

**Milestone:** [4 · Landing & Polish](../PLAN.md) · **Prev:** [4.2 Celebration](phase-02-purchase-celebration.md) · **Next:** [4.4 Mobile & A11y](phase-04-mobile-a11y-pass.md)
**Status:** ⚪ Not started · **Estimate:** ~1.5 days

## Goal

Leaseholders can share "my HQ is live" with a great-looking thumbnail, and the `logoUrl` question from M2/M3 gets answered and rendered on the buildings.

## Prerequisites

- `LIVE` plot data shape stable (M2/M3); celebration share hook exists (4.2)

## Steps

1. **Per-plot OG images — two distinct routes, two distinct cache policies (important correction below)**
   - Dynamic route (`ImageResponse`-style edge generation — no headless browser needed): dark cyber backdrop, building silhouette per tier, company name, `mrrText` badge (if present), a **clearing-price badge** ("leasing at $X", never "sold for $X"), plot id, brand mark
   - **Generic per-plot preview**, `/plot/[id]` meta tags (used by organic shares and 4.2's live share prompt): must reflect **whichever plot state is current right now** (the `LIVE` leader, or a neutral `IDLE` card) — served with a **short, revalidating cache** (`s-maxage=30, stale-while-revalidate`), never immutable
   - **Cycle-scoped historical image**, `/plot/[id]/og?cycle=[cycleId]`: a resolved cycle's winner never changes after the fact, so this route **is** safe to cache immutably (forever) — this is the URL 4.2's win moment should actually share, not the generic one
   - **This is a deliberate correction to the pre-pivot plan**, not just renaming: the old plan cached the generic per-plot OG image "immutably" because `SOLD` was permanent under the one-time-sale model, so a plot's image genuinely never changed again. Under the lease model a plot's leader **will** change again, so caching the generic route immutably would serve a stale former leaseholder's image forever to anyone who shares or re-opens that link — a real correctness bug the pivot introduces if this split isn't made explicit
   - Verify both routes in X and Slack link inspectors with a real `LIVE` plot, and again after that plot has cycled to a different leader
2. **Landing OG** — one strong generic city panorama card for the root URL (revalidating cache is fine here too — the skyline composition itself doesn't change meaningfully cycle to cycle)
3. **logoUrl decision (document the verdict)**
   - Option A: bidder supplies an image URL (captured on the `PreBid` at claim/bid/pre-bid time, per M2 2.1), validated (https, content-type, size cap) and hotlinked onto MID billboards / CORE face with a texture load + fallback to initials
   - Option B: skip logos at launch (billboards show company name text only), keep field nullable
   - Recommendation: **A-lite** — accept URL, render on billboards, broken-image fallback to initials plaque; no upload hosting (scope guard)
4. **Rendering — two separate `logoUrl` fetch paths, two separate risk profiles**
   - **Client-side billboard texture** (this step): the *browser* loads the remote image directly into a Three.js texture (timeout, fit/cover, emissive tint so it reads neon; initials fallback generated as canvas texture). No SSRF risk here — the request never touches our server, it's the visitor's own browser fetching an image URL, same as a normal `<img>` tag. Next's `images.remotePatterns` is irrelevant to this path too (that config only gates the `next/image` optimizer, which isn't in use for a Three.js texture)
   - **Server-side OG-image fetch** (step 1's edge routes): when either OG route renders a `LIVE`/resolved plot, *our server* fetches `logoUrl` to composite it into the image. This is the actual SSRF-risk path — a malicious `logoUrl` could target internal/link-local addresses (e.g. `169.254.169.254` cloud metadata) from our infrastructure. Mitigate specifically here: https-only, resolve DNS and reject private/link-local/loopback ranges before fetching, enforce a content-length cap, short timeout, and fetch through a dedicated helper (not the generic client fetch used elsewhere) so the checks can't be bypassed
   - **Data source distinction, tied to step 1's cache split**: the generic `/plot/[id]` route reads the `Plot`'s current denormalized display fields (`logoUrl` included) — these are mutable, overwritten by the worker at every cycle resolution (per 0.2/2.3), which is exactly why that route can't be cached immutably. The cycle-scoped `/plot/[id]/og?cycle=[cycleId]` route instead reads `logoUrl`/company fields off that cycle's **winning `PreBid`** row directly — immutable historical data, safe to cache forever, and still correct after the plot has since cycled to a different leader
5. **Moderation seam (minimal, usable now — 5.3 doesn't exist yet at M4 time)**
   - Terms text: right to hide offensive logos; `Plot.logoHidden` boolean (already part of the 0.2 schema's denormalized display fields) flips a currently-live logo to a text-only fallback. Until 5.3's admin UI exists, flip it via a one-off script (`scripts/hide-logo.ts <plotId>`) or direct Prisma Studio edit — both already usable today, no dependency on a future milestone
   - **Inherently bounded by design, unlike the old permanent-SOLD model**: `logoHidden` is refreshed by the worker at every cycle resolution (per 0.2), so a hide is naturally scoped to the *current* leaseholder's cycle and resets for whoever wins next — no manual un-hide process needed. A repeat-offending bidder needs a fresh manual hide each time they win again, an acceptable tradeoff given lease cycles are short (6–24h); 5.3 later automates repeat-offender detection over the same column, it doesn't change the mechanism

## Verification

- Share debugger pass for: outer/mid/core tiers, long company names (truncation), broken URL (fallback), missing logo (text plaque)
- Force a plot through a second cycle resolution (different winner) and confirm the **generic** `/plot/[id]` preview updates to the new leader while the **first cycle's** `/plot/[id]/og?cycle=[cycleId]` link still shows the original winner unchanged

## Exit criteria

- [ ] Every plot has a stable, shareable OG image: a revalidating one reflecting its current live state, and an immutable one per resolved cycle
- [ ] Generic per-plot OG route confirmed **not** cached immutably — verified by forcing a cycle resolution and observing the shared link's preview update, not stuck on a stale leaseholder
- [ ] `logoUrl` policy decided, documented here, implemented or explicitly deferred with field left null
- [ ] Server-side OG-fetch path for `logoUrl` validated against SSRF (private/link-local IP rejection, https-only, size cap, timeout) — distinct from and in addition to the client-side texture path, which carries no such risk
- [ ] `logoHidden` column exists and is flippable today via script/Prisma Studio, independent of whether 5.3 has shipped yet

## Out of scope / notes

- Real upload/storage infra (S3 etc.) — deliberately out; URL-only keeps M4 within budget
