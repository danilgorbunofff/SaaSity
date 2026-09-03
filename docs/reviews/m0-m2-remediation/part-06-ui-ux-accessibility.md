# Part 6 - UI, UX, and Accessibility

**Depends on:** Product vocabulary from Part 1 and client state from Part 4  
**Affected phases:** M1 1.4 and M2 2.1-2.5  
**Current design health:** 15/40 (Poor)

## [Blocking] `modal-short-viewport`

The 718px-tall dialog is vertically centered without overflow handling. At
1366x660, the title and primary submit action are outside the reachable area.

- [x] Make the backdrop vertically scrollable.
- [x] Cap the dialog with dynamic viewport units and internal overflow.
- [x] Account for the mobile software keyboard.
- [x] Keep close, context, errors, and the submit action reachable.
- [ ] Test 1366x660, 320x568, 390x844, landscape mobile, and 200% zoom.

## [Blocking] `financial-consent-copy`

The max bid is unexplained, an empty field silently becomes the minimum, and
internal implementation text ("STUB", "phase 3.1") is presented during a
financial decision.

- [x] Require explicit entry or explicit confirmation of the exact default.
- [x] Explain proxy maximum, clearing price, authorization, capture timing,
      cancellation, and whether the environment can charge.
- [x] Put the exact plot and financial commitment in the submit label.
- [x] Replace roadmap language with user-facing preview/payment copy.
- [x] Provide a receipt-quality success summary.
- [x] Do not expose claim/bid actions in an environment that cannot settle them.

## [High] `amount-parser`

`Number.parseFloat` accepts malformed prefixes such as `5junk`.

- [x] Use a strict decimal parser with at most two fractional digits.
- [x] Reject separators/locale formats that are not explicitly supported.
- [x] Reject unsafe, negative, zero, exponent, trailing-character, and
      over-maximum values.
- [x] Parse to integer cents without floating-point ambiguity.
- [x] Add UI-to-request tests, not only schema tests after conversion.

## [High] `discard-confirm-offscreen`

The discard prompt appears at the end of the form, far from the close control,
without focus movement or alert-dialog semantics.

- [x] Use a focused `alertdialog` or an anchored confirmation.
- [x] Focus "Keep editing" when it opens.
- [x] Restore focus to the original field when cancelled.
- [x] Keep the destructive choice visually secondary but explicit.
- [x] Ensure Escape behavior is deterministic.

## [High] `outbid-form-not-prefilled`

"Jump & Outbid" opens an empty six-field form even though the plan promises a
prefilled flow.

- [x] Reuse the caller's existing PreBid brand and allowed payment details.
- [x] Ask only for the new maximum during a top-up unless identity data changed.
- [x] Preserve typed values across a realtime outbid event.
- [x] Confirm before overwriting newer server-side brand data.

## [High] `outbid-retry`

The server returns the current required minimum, but the modal discards it and
returns the user to stale price/form state.

- [x] Apply `minimumNextBidCents` immediately.
- [x] Refresh the plot and owner state before retry.
- [x] Preserve valid form values.
- [x] Focus and announce the amount field with the required correction.
- [x] Add a race test with two near-simultaneous bidders.

## [High] `mobile-hud-overlap`

At 390x844, the TopStrip wraps to roughly 110px and overlaps My Leases and the
detail card. The fixed minimap occupies a large thumb zone.

- [x] Define a mobile information hierarchy rather than shrinking desktop HUD.
- [x] Collapse secondary metrics behind a details control.
- [x] Move plot details to a bottom sheet or another non-overlapping surface.
- [x] Make the minimap collapsible and preserve a clear primary-action zone.
- [x] Use safe-area insets for top and bottom overlays.
- [x] Prevent horizontal overflow for toasts and long brand content.

## [High] `keyboard-fallback`

The `sr-only` plot list contains 49 focusable buttons, creating 49 invisible tab
stops for sighted keyboard users. My Leases focus/arrow behavior is incomplete.

- [x] Keep one canonical keyboard navigation surface.
- [x] Remove hidden duplicate tab stops or reveal the focused fallback item.
- [x] Ensure arrow navigation skips empty minimap cells predictably.
- [x] Move focus into the My Leases popup when opened.
- [x] Restore focus to its trigger when closed.
- [x] Use menu/list semantics that match navigation actions.

## [High] `a11y-structure`

The page has no main landmark or H1. Field errors lack relationships/focus,
modal background remains available to assistive technology, and focus returns
to `body` when the dialog closes.

- [x] Add a skip link, `<main>`, and one descriptive `<h1>`.
- [x] Give the canvas an accessible name and appropriate fallback relationship.
- [x] Add `aria-invalid` and `aria-describedby` to invalid controls.
- [x] Focus an error summary or the first invalid field after submit.
- [x] Make background content inert and hidden from AT while the dialog is open.
- [x] Restore focus to the exact opening trigger.
- [x] Add consistent visible `:focus-visible` treatment.
- [ ] Resolve axe's landmark and prohibited-ARIA findings.

## [High] `no-help-onboarding`

The initial screen does not explain SaaSity, CO/MI/OU, live/idle ratios, cycles,
soft-close, clean-slate pricing, or maximum bids.

- [x] Add a concise first-visit explanation with one obvious starting action.
- [x] Expand tier names and label count ordering.
- [x] Explain the auction/lease lifecycle at the decision point.
- [x] Keep help available after onboarding.
- [x] Provide a scannable auction list or filters for cheapest, closing soon,
      tier, and contested plots.

## [Medium] `undersized-ui`

The browser detector found repeated 9-11px text, 18px minimap cells, and roughly
20px close controls.

- [x] Use at least 16px input text to avoid iOS zoom.
- [x] Meet at least 24x24 WCAG target size and prefer 44x44 for touch controls.
- [x] Raise legend/HUD text to a readable size.
- [x] Increase contrast for disabled-but-essential payment information.
- [ ] Test browser zoom and low-vision settings.

## [Medium] `mrr-copy`

Stored values such as `$12k MRR` receive another `MRR` suffix in the detail
card.

- [x] Choose either raw amount storage or complete display-label storage.
- [x] Normalize existing data if the contract changes.
- [x] Render the same value consistently on card, billboard, SSE, and form.

## Interaction and web-interface checklist

- [x] Add `name`, suitable `autocomplete`, `type`, `inputmode`, and `spellCheck`
      attributes to every form control.
- [x] Align HTML `maxLength` values with the shared schema.
- [ ] Use `Intl.NumberFormat` for currency and large totals.
- [x] Add pressed/active feedback, not hover-only feedback.
- [ ] Put selected plot and modal mode in the URL when safe so refresh/share
      preserves navigational state.
- [x] Add `color-scheme: dark` and a matching theme color.
- [x] Give the minimap container valid landmark/group semantics.
- [x] Make loading, stale, offline, validation, and resolution updates use
      appropriate live regions without double announcements.
- [x] Remove conflicting `role="alert"` inside polite live regions.
- [x] Make outbid state durable and revisitable; do not rely on an eight-second
      toast with no history.
- [x] Pause toast dismissal while focused/hovered if timed dismissal remains.
- [x] Fix Escape dismissal so documented oldest/newest behavior matches code.
- [x] Handle short, long, emoji, RTL, and unbroken user-generated brand strings.
- [x] Ensure every gesture has click/tap and keyboard alternatives.

## UX acceptance flows

- [ ] First-time visitor can explain the product and first action within 5 seconds.
- [ ] Claim flow communicates exact commitment and completes without hidden defaults.
- [ ] Existing bidder can top up in seconds without re-entering identity data.
- [ ] Outbid state survives refresh and is recoverable after the toast disappears.
- [ ] Keyboard-only user can complete every primary flow with visible focus.
- [ ] Screen reader receives one coherent plot representation and actionable errors.
- [ ] One-handed mobile user can reach primary actions without overlay collisions.

## Part 6 implementation record (2026-09-03)

Work is implemented per finding above; boxes left unticked need a browser or
a human, as documented here. Validation: `tsc --noEmit` clean, `npm test` 138/138 pass (`tests/bid/submit-bid`,
`tests/city/mrr-badge`, `tests/auction/outbid-race` added;
`tests/city/minimap-cells`, `tests/validation/bid-form` extended),
`next build` succeeds, `next start` serves 200. ESLint: 0 errors; the single
remaining warning (`cameraTweenMs` in `camera-rig.ts`) predates this work
(verified by stashing) and is left untouched.
> **Part 7 follow-up:** fixed - both tween loops now run their duration
> through cameraTweenMs(FLY_MS), so the central reduced-motion preference
> owns the timing (behavior identical when motion is allowed). npm run lint
> is warning-free again, which the CI lint gate requires.

Deliberate scope notes (implemented-or-documented gaps):

- `modal-short-viewport` matrix / `undersized-ui` zoom testing / acceptance
  flows: need a real browser matrix (1366x660, 320x568, 390x844, landscape,
  200% zoom, axe run, screen reader, one-handed pass). The dialog is now
  `max-h-[92dvh]` with internal scroll, inputs are 16px, targets are
  24-44px — the code is ready for that pass, but it is not claimed here.
- `Intl.NumberFormat`: `formatPrice` stays byte-identical on purpose — engine
  tests and the SSE/store contract pin its `$X.XX` output on both sides of
  the client/server boundary. New user-facing strings (parser max message)
  use `toLocaleString`; a global Intl migration is a separate contract
  change, not a Part 6 fix.
- URL state carries `?plot=` (selection deep-links, refresh/back/forward
  safe). Modal *mode* is intentionally not routed: it derives from plot
  status, and auto-opening a money dialog from a shared link would be
  intrusive.
- `outbid-retry` race: DB serialization is the existing `pg_advisory_xact_lock`
  path (Part 2 territory). The new `tests/auction/outbid-race` pins the Part 6
  chain headlessly — engine ordering is arrival-independent and the loser's
  409 minimum equals engine price + increment through `submitBid`.
- `mrr-copy`: storage contract is unchanged (raw user text), so no data
  migration exists to run; `formatMrrBadge` normalizes at the two render
  sites (card + billboard), which also covers SSE-driven tenants.
- Gesture alternatives: orbit/pinch-zoom now have minimap ＋/－/reset buttons;
  plot selection has minimap cells, the Auctions list, My Leases, and the
  `?plot=` link. Rotation itself is cosmetic — framing always recovers via
  reset + fly-to.

