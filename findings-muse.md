# Adversarial verification findings — SaaSity (fresh-eye, strict)

Date: 2026-09-03
Scope: Parts 1–7 specs in `docs/reviews/m0-m2-remediation/part-0*.md` vs. commit `a969e0a` (tree clean, nothing uncommitted).
Method: read-only. Prior claims treated as untrusted. Gates re-run by hand.

## Gates (re-run, not quoted)

- `./node_modules/.bin/tsc --noEmit` → **FAIL**: `src/app/layout.tsx(25,50): error TS2304: Cannot find name 'LayoutProps'`
- `npm test` → **PASS**: 138/138
- `npm run lint` (`--max-warnings=0`) → **PASS**
- `npm run format:check` → **PASS**

So the Part 7 claim "`npx tsc --noEmit` clean" is **false** on this commit.

---

## BLOCKER 1 — `bid:placed` emits the wrong leader when the caller doesn't take the lead

Files:

- `src/app/api/plots/[id]/bid/route.ts:205-212`
- `src/app/api/plots/[id]/claim/route.ts:180-187`

Spec requires (Parts 1+4): `bid:placed.leaderPreBidId` is the **actual** resolution leader. Every client derives "am I leading" by matching that id against its own pre-bid ids (`isOwnedLeading`), plus outbid toasts, minimap cells, TopStrip, DetailCard.

What the code does: emits the **caller's** `result.preBidId` unconditionally:

```ts
emitBidPlaced({
  ...
  leaderPreBidId: result.preBidId,   // caller's row, not the leader's
  isProxy: !result.isLeader,
  ...
});
```

`result.isLeader` is computed (`resolution?.leaderBidderId === bidder.bidderId`) but never used for the emitted id.

Repro (bid): A leads with max $100. B bids $20 (≥ minimum). Second-price moves the price to ~$21, leader stays A — but the event says leader=B. Both clients flip wrong (B shows "leading", A never gets its outbid).

Same shape in claim: queued survivors attach (`attachPreBidsToCycle`) before `resolveCycle`, so a queued bidder can out-max the claimer — the event still names the claimer. Notably, the **repair** paths in the same two files correctly emit `repaired.resolution.leaderPreBidId`, which proves the happy path is just wrong. Fix: thread `resolution.leaderPreBidId` through `result` and emit it.

Why it matters: corrupts the single source of ownership truth for every live client on every contested bid. This alone fails Part 1 (ownership) and Part 4 (realtime correctness).

## BLOCKER 2 — `tsc` red on `LayoutProps`

File: `src/app/layout.tsx:25`

```tsx
export default function RootLayout({ children }: LayoutProps<'/'>) {
```

`./node_modules/.bin/tsc --noEmit` → `error TS2304: Cannot find name 'LayoutProps'`. No import, no global type. Part 7's evidence log claims a clean typecheck on this exact tree — false. CI's typecheck step fails on this commit. (Next build may paper over it depending on config; the `tsc --noEmit` gate does not.)

---

## MAJOR 1 — no server-side max-bid cap (shared-contract violation)

Files:

- `src/server/auction/http.ts:21` (`auctionBodySchema`: `maxBidCents: z.number().int().positive()` — no max)
- `src/lib/validation/bid-form.ts:61` (`bidFormSchema`: same, no max)

Spec (Part 6): the bid contract runs **identically** client and server. `MAX_BID_CENTS` ($100k) exists only in the client's `parseDollarsToCents`. A curl with `$1B`sails through structural validation; contextual minimums only check the floor, never the ceiling. Consequences: absurd holds, Postgres-int overflow → 500 on write. Fix: enforce`MAX_BID_CENTS`in both zod schemas (or in`validateBidForm`, which the server already calls).

## MAJOR 2 — outbox persist failure is silent; "snapshot + seq-gap refetch" does not recover it

Files:

- `src/server/realtime/outbox.ts:48-55` (fire-and-forget `sink`: log + drop)
- `src/app/api/events/route.ts:55,111` (`seq` is per-connection, not global outbox seq)

The module doc is honest that the cross-instance copy is lost, then claims "the SSE snapshot + seq-gap refetch recovers from" it. It doesn't: a lost outbox row produces **no gap** on any other instance's stream (each connection numbers its own frames from its own cursor), so live clients there simply never see the event. Recovery waits for the next reconnect / visibility / focus refetch. At-least-once is not met cross-instance. Either retry the persist (bounded queue) or downgrade the claim to documented known-loss with a cross-instance test.

## MAJOR 3 — reduced-motion gaps in HUD

Files:

- `src/components/city/hud/DetailCard.tsx:189` (outbid banner: `animate-[city-outbid-flash...]` unconditional)
- `src/components/city/hud/TopStrip.tsx:78-81,111` (`animate-pulse` on connecting/reconnecting dot, unconditional)

Part 5 contract: CSS keyframe flashes are **not applied** under `prefers-reduced-motion` (static high-contrast treatment stays). Minimap (`outbidCellStyle`) and PlotSkins honor this; DetailCard and TopStrip never read `useReducedMotion`/`isReducedMotion`. The most-aggressive flash (amber outbid banner) is the one that escapes the guard.

## MAJOR 4 — `PreBidStatus.CANCELLED` is unreachable

File: `prisma/schema.prisma` (enum value); zero writers anywhere under `src/server/auction/` (verified by search — only `CANCELLED` for _cycles_, `EXPIRED`/`LOST`/`WON` for pre-bids). If Part 1 claims every lifecycle state is reachable, that checkbox is false. At minimum a dead enum variant that will confuse the next reader; either wire it (e.g. shell-cancelled rows) or remove it.

---

## MINOR 1 — OutbidToast steals Escape from the modal

File: `src/components/city/hud/OutbidToast.tsx:60-67`. Window-level `keydown` dismisses the oldest toast on **any** Escape, including while the BidModal (or its discard-confirm) is open and has its own deterministic Escape handling. No open-modal guard, no `stopPropagation` coordination.

## MINOR 2 — MyLeases outside-click close strands focus

File: `src/components/city/hud/MyLeasesPill.tsx:28-30`. Outside `mousedown` does bare `setOpen(false)`; only the toggle/Escape path uses `closeAndRestore()` (focus back to trigger). Keyboard users who opened the menu then clicked outside lose their place.

## MINOR 3 — stale-tab brand clobber (server doesn't enforce the confirm)

`upsertPreBid` queued branch keeps `max(old, new)` for the amount but overwrites brand unconditionally. The modal's "billboard is newer, confirm overwrite" dialog is client-only; the server happily lets a stale tab with a lower max but different brand rewrite the brand while keeping the higher max. Either scope brand writes to the winning submit or version them.

## MINOR 4 — CI never runs on branch pushes

File: `.github/workflows/ci.yml:10-13` (`push: branches: [main]`, `pull_request` to `main`). Iterating on a feature branch gets zero signal until a PR exists. Cheap fix: run on all pushes (keep the PR trigger).

---

## What verified OK (so the verdicts stay honest)

- **Lifecycle machine**: IDLE↔LIVE / OPEN→RESOLVING→RESOLVED (+CANCELLED shells), WON/LOST/EXPIRED transitions, empty-cycle resolution, tenant-vs-auction independence in `serializePlot`, privacy invariant (no `maxBidCents`/`bidderId`/leader brand on the wire) — all as specified.
- **Engine**: `lockPlot` advisory-lock discipline on every mutation path, claim predicate (`OPEN` + `endAt <= now`) with under-lock recheck, soft-close evaluated once per request from `receivedAt`, second-price math shared between `computeResolution` and the cascade, upward-only top-up guards.
- **Worker**: cascade outside every tx, abort-on-retryable with no fallback, `RESOLVING` never reopened after a confirmed capture (reconcile path), poisoned-cycle isolation in the sweep, staged-rotation with survivor-only attach.
- **Realtime transport**: watermark-before-query snapshot race handling, heartbeat/timeout hygiene, abort-safe writes, per-key dedup, atomic next-cycle patch, outbid reconstruction from the private owner projection (`deriveOutbidFromPositions` + sticky merge) — genuinely implemented.
- **3D**: OUTER instancing, per-plot skins incl. OUTER overlays, seed/DTO divergence guard, selection + URL deep-link, camera interruptibility, reduced-motion infra (rig, skins, minimap).
- **UI/a11y**: skip link + `main` landmark, canvas `role="img"` with operable equivalents, focus trap + opener restore + scroll lock in BidModal, shared validation contract, outbid-retry with server minimum, claim-first flip, financial-consent copy.
- **Docs honesty**: Part 7 correctly marks preview/device/browser/integration items pending rather than waiving them.

---

## VERDICTS

| Part                     | Result        | Note                                                                                        |
| ------------------------ | ------------- | ------------------------------------------------------------------------------------------- |
| 1 Lifecycle              | **FAIL ~80%** | machine + privacy sound; B1 corrupts live leader, M4 dead state                             |
| 2 Foundation             | **PASS ~90%** | CI/drift/migrate/seed/serializers real; minus CI trigger scope                              |
| 3 Engine/worker/payments | **PASS ~85%** | locks, rechecks, cascade, reconcile correct; minus M1 cap                                   |
| 4 Realtime               | **FAIL ~70%** | transport + reconstruction genuine; B1 + M2 break headline claims                           |
| 5 3D city                | **PASS ~85%** | perf + selection + motion infra; minus M3 guards                                            |
| 6 UI/UX/a11y             | **PASS ~80%** | landmarks, focus, validation, retry real; minus Escape/focus/cap parity                     |
| 7 Testing/docs           | **FAIL ~65%** | 138/138 + lint + format verified; **tsc claim false**; integration/preview honestly pending |

## Overall: FIX-FIRST, ordered by risk

1. B1 — emit the actual `leaderPreBidId` on bid + claim happy paths.
2. B2 — fix the `LayoutProps` typecheck break (CI is red).
3. M1 — server-side `MAX_BID_CENTS` in the shared contract.
4. M2 — outbox durability (retry, or downgraded claim + cross-instance test).
5. M3 — reduced-motion guards in DetailCard/TopStrip.
6. Minors — Escape scoping, focus restore, brand-preserve, CI triggers.
