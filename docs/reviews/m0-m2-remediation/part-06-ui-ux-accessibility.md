# Part 6 - UI, UX, and Accessibility

**Depends on:** Product vocabulary from Part 1 and client state from Part 4  
**Affected phases:** M1 1.4 and M2 2.1-2.5  
**Current design health:** 15/40 (Poor)

## [Blocking] `modal-short-viewport`

The 718px-tall dialog is vertically centered without overflow handling. At
1366x660, the title and primary submit action are outside the reachable area.

- [ ] Make the backdrop vertically scrollable.
- [ ] Cap the dialog with dynamic viewport units and internal overflow.
- [ ] Account for the mobile software keyboard.
- [ ] Keep close, context, errors, and the submit action reachable.
- [ ] Test 1366x660, 320x568, 390x844, landscape mobile, and 200% zoom.

## [Blocking] `financial-consent-copy`

The max bid is unexplained, an empty field silently becomes the minimum, and
internal implementation text ("STUB", "phase 3.1") is presented during a
financial decision.

- [ ] Require explicit entry or explicit confirmation of the exact default.
- [ ] Explain proxy maximum, clearing price, authorization, capture timing,
      cancellation, and whether the environment can charge.
- [ ] Put the exact plot and financial commitment in the submit label.
- [ ] Replace roadmap language with user-facing preview/payment copy.
- [ ] Provide a receipt-quality success summary.
- [ ] Do not expose claim/bid actions in an environment that cannot settle them.

## [High] `amount-parser`

`Number.parseFloat` accepts malformed prefixes such as `5junk`.

- [ ] Use a strict decimal parser with at most two fractional digits.
- [ ] Reject separators/locale formats that are not explicitly supported.
- [ ] Reject unsafe, negative, zero, exponent, trailing-character, and
      over-maximum values.
- [ ] Parse to integer cents without floating-point ambiguity.
- [ ] Add UI-to-request tests, not only schema tests after conversion.

## [High] `discard-confirm-offscreen`

The discard prompt appears at the end of the form, far from the close control,
without focus movement or alert-dialog semantics.

- [ ] Use a focused `alertdialog` or an anchored confirmation.
- [ ] Focus "Keep editing" when it opens.
- [ ] Restore focus to the original field when cancelled.
- [ ] Keep the destructive choice visually secondary but explicit.
- [ ] Ensure Escape behavior is deterministic.

## [High] `outbid-form-not-prefilled`

"Jump & Outbid" opens an empty six-field form even though the plan promises a
prefilled flow.

- [ ] Reuse the caller's existing PreBid brand and allowed payment details.
- [ ] Ask only for the new maximum during a top-up unless identity data changed.
- [ ] Preserve typed values across a realtime outbid event.
- [ ] Confirm before overwriting newer server-side brand data.

## [High] `outbid-retry`

The server returns the current required minimum, but the modal discards it and
returns the user to stale price/form state.

- [ ] Apply `minimumNextBidCents` immediately.
- [ ] Refresh the plot and owner state before retry.
- [ ] Preserve valid form values.
- [ ] Focus and announce the amount field with the required correction.
- [ ] Add a race test with two near-simultaneous bidders.

## [High] `mobile-hud-overlap`

At 390x844, the TopStrip wraps to roughly 110px and overlaps My Leases and the
detail card. The fixed minimap occupies a large thumb zone.

- [ ] Define a mobile information hierarchy rather than shrinking desktop HUD.
- [ ] Collapse secondary metrics behind a details control.
- [ ] Move plot details to a bottom sheet or another non-overlapping surface.
- [ ] Make the minimap collapsible and preserve a clear primary-action zone.
- [ ] Use safe-area insets for top and bottom overlays.
- [ ] Prevent horizontal overflow for toasts and long brand content.

## [High] `keyboard-fallback`

The `sr-only` plot list contains 49 focusable buttons, creating 49 invisible tab
stops for sighted keyboard users. My Leases focus/arrow behavior is incomplete.

- [ ] Keep one canonical keyboard navigation surface.
- [ ] Remove hidden duplicate tab stops or reveal the focused fallback item.
- [ ] Ensure arrow navigation skips empty minimap cells predictably.
- [ ] Move focus into the My Leases popup when opened.
- [ ] Restore focus to its trigger when closed.
- [ ] Use menu/list semantics that match navigation actions.

## [High] `a11y-structure`

The page has no main landmark or H1. Field errors lack relationships/focus,
modal background remains available to assistive technology, and focus returns
to `body` when the dialog closes.

- [ ] Add a skip link, `<main>`, and one descriptive `<h1>`.
- [ ] Give the canvas an accessible name and appropriate fallback relationship.
- [ ] Add `aria-invalid` and `aria-describedby` to invalid controls.
- [ ] Focus an error summary or the first invalid field after submit.
- [ ] Make background content inert and hidden from AT while the dialog is open.
- [ ] Restore focus to the exact opening trigger.
- [ ] Add consistent visible `:focus-visible` treatment.
- [ ] Resolve axe's landmark and prohibited-ARIA findings.

## [High] `no-help-onboarding`

The initial screen does not explain SaaSity, CO/MI/OU, live/idle ratios, cycles,
soft-close, clean-slate pricing, or maximum bids.

- [ ] Add a concise first-visit explanation with one obvious starting action.
- [ ] Expand tier names and label count ordering.
- [ ] Explain the auction/lease lifecycle at the decision point.
- [ ] Keep help available after onboarding.
- [ ] Provide a scannable auction list or filters for cheapest, closing soon,
      tier, and contested plots.

## [Medium] `undersized-ui`

The browser detector found repeated 9-11px text, 18px minimap cells, and roughly
20px close controls.

- [ ] Use at least 16px input text to avoid iOS zoom.
- [ ] Meet at least 24x24 WCAG target size and prefer 44x44 for touch controls.
- [ ] Raise legend/HUD text to a readable size.
- [ ] Increase contrast for disabled-but-essential payment information.
- [ ] Test browser zoom and low-vision settings.

## [Medium] `mrr-copy`

Stored values such as `$12k MRR` receive another `MRR` suffix in the detail
card.

- [ ] Choose either raw amount storage or complete display-label storage.
- [ ] Normalize existing data if the contract changes.
- [ ] Render the same value consistently on card, billboard, SSE, and form.

## Interaction and web-interface checklist

- [ ] Add `name`, suitable `autocomplete`, `type`, `inputmode`, and `spellCheck`
      attributes to every form control.
- [ ] Align HTML `maxLength` values with the shared schema.
- [ ] Use `Intl.NumberFormat` for currency and large totals.
- [ ] Add pressed/active feedback, not hover-only feedback.
- [ ] Put selected plot and modal mode in the URL when safe so refresh/share
      preserves navigational state.
- [ ] Add `color-scheme: dark` and a matching theme color.
- [ ] Give the minimap container valid landmark/group semantics.
- [ ] Make loading, stale, offline, validation, and resolution updates use
      appropriate live regions without double announcements.
- [ ] Remove conflicting `role="alert"` inside polite live regions.
- [ ] Make outbid state durable and revisitable; do not rely on an eight-second
      toast with no history.
- [ ] Pause toast dismissal while focused/hovered if timed dismissal remains.
- [ ] Fix Escape dismissal so documented oldest/newest behavior matches code.
- [ ] Handle short, long, emoji, RTL, and unbroken user-generated brand strings.
- [ ] Ensure every gesture has click/tap and keyboard alternatives.

## UX acceptance flows

- [ ] First-time visitor can explain the product and first action within 5 seconds.
- [ ] Claim flow communicates exact commitment and completes without hidden defaults.
- [ ] Existing bidder can top up in seconds without re-entering identity data.
- [ ] Outbid state survives refresh and is recoverable after the toast disappears.
- [ ] Keyboard-only user can complete every primary flow with visible focus.
- [ ] Screen reader receives one coherent plot representation and actionable errors.
- [ ] One-handed mobile user can reach primary actions without overlay collisions.

