# Responsive layout: laptop + tablet floor (1280–1440)

**Status:** design, approved for planning
**Date:** 2026-07-16
**Scope owner:** dashboard (`web/`)

## Summary

Guarantee the Xenon dashboard renders without clipping between **1280px and 1440px**, and add a
regression guard that keeps it that way.

The honest framing: this is a **small fix set behind a durable guard**, not a large refactor. The
fixes are a handful of CSS rules. The guard is the deliverable that carries value forward.

## Why this is not "93% of files lack breakpoints"

An audit counted 21 responsive prefixes across 108 `.tsx` files and concluded 93% of the app is
non-responsive. That number is real but misleading as a work estimate: most components don't need
breakpoints, because flex and grid already reflow. Adding `md:`/`lg:` to 101 files would be churn.

The actual defect is a small number of **hard floors** — layouts with a computable intrinsic
minimum width — plus one systematic bug class that produced them.

## The bug class

> **A breakpoint chosen without checking the layout's intrinsic minimum.**

Selector Health demonstrates it precisely:

| | |
|---|---|
| 9 columns (`selector-health.css:375`) | 966px |
| 8 gaps × 12px | 96px |
| row padding (14px × 2) | 28px |
| sidebar rail | 56px |
| **intrinsic minimum viewport** | **1146px** |
| `max-width` override (`selector-health.css:836`) fires at | **≤1024px** |

Between **1025px and 1145px** the 9-column grid is active and cannot fit — a 121px dead zone. It
went unnoticed because both ends are fine: 1440 fits the wide grid, 1024 gets the narrow override.
Only the middle breaks.

This dead zone is **below the 1280 floor and therefore out of scope for the fixes** — but it is the
reason the guard exists. The same mistake will recur at any breakpoint unless something checks
floors mechanically.

## Scope

**In:** 1280–1440. Every route renders with no element clipped.

**Out, explicitly:**
- Phone (375) and tablet portrait (768). No hamburger, no drawer, no mobile nav.
- The sidebar stays a fixed 56px rail. At 1280 that is 4.4% of width; a collapse mechanism buys
  nothing and costs state.
- The dead zone (1025–1145). Documented, guarded against recurrence, not fixed.
- A shared layout primitive (`Table`/`Rail`/`Page`). Better end state, and it would also address
  the 7% `Button` adoption problem — but bundling a large refactor with a responsive fix makes both
  unreviewable. Separate project.

## Known breakage at 1280

Measured live at 1280×800 against a running 1.7.0 server:

1. **Device Control** — `device-interactions-column`, `interaction-tabs`, and
   `interactions-scroll-area` clip by **16px**; an inner `<span>` by 19px. Visible symptom: the tab
   bar truncates mid-word at "OMNI-VISI…". Contributing floors in `device-control.css`:
   `.device-preview-column { min-width: 400px }` (`:202`) and
   `.device-screen-wrapper { min-width: 450px }` (`:324`). This is the most-used page in the
   product and the only confirmed functional break in range.

2. **`apps.css:498`** — `@media (max-width: 1400px)` fires across most of the supported range
   (1280–1400) and only changes padding. Cosmetic, but it is desktop-first CSS inside the target
   band and should move to the min-width convention.

**Verified as NOT broken at 1280** (do not "fix" these):
- Selector Health 9-col table: 1146px floor — fits.
- Selector Health 7-col timeline: 678px floor — fits.
- `build-list-rail.tsx:64` `w-[280px]`: leaves 944px of content at 1280 — fits.
- All 13 routes: zero escaping elements at 1024 **on an empty database** — see the caveat below;
  this measurement is weak evidence, not a clean bill of health.

## The measurement traps (both hit during investigation)

Any plan here must respect two facts, or it will produce false confidence:

1. **`body { overflow: hidden }` (`index.css:32`) makes `document.scrollWidth` lie.** It is forced
   equal to `innerWidth`, so overflow is reported as zero while content is silently clipped. The
   guard **must** measure element bounding rects against `innerWidth`, never document scroll.

2. **Empty tables cannot clip.** A fresh database renders Selector Health as all-zeros with no
   rows, so the 9-column grid never mounts and every assertion passes vacuously. Data is a
   correctness requirement of the test, not a convenience.

## Design

### 1. Seed script — `src/scripts/seed-dev-data.ts`

Dev-only, invoked explicitly (`npm run db:seed`), never wired into boot.

Populates devices, builds, sessions, and selector-health rows using deliberately **hostile
content**, because that is what exercises the floors:
- long device names (40+ chars)
- full-length UDIDs (`00008110-00084CE80E51401E`)
- long XPath/selector strings in both `minmax(220px, 2fr)` columns
- enough rows to render the table and timeline grids

Load-bearing: without it the guard is worthless. Build this first.

### 2. Viewport guard — Playwright in `web/`

New devDependency; follow the existing `mac-app/playwright.config.ts` precedent rather than
inventing a second pattern.

For every route × width, assert **no element's right edge exceeds `innerWidth`**, measured via
bounding rects (see trap 1).

Widths — chosen to catch the bug class, not just the current bugs:

| Width | Why |
|---|---|
| 1280 | the floor |
| 1281 | boundary + 1 |
| 1440 | the ceiling |
| 1399 / 1400 | `apps.css:498` boundary, both sides |

Testing **both sides of every breakpoint boundary** is the specific mechanism that would have
caught the Selector Health dead zone, and is the part of this design that must not be dropped.

Failure output must name the offending element and the overflow in px — a bare "something
overflowed" is not actionable.

### 3. Fix the floors

- `device-control.css` — resolve the 16px clip. Investigate whether `.device-preview-column`
  `min-width: 400px` + `.device-screen-wrapper` `min-width: 450px` + the interactions column
  genuinely exceed 1280 minus the rail, or whether a `flex-shrink` is missing. Fix the cause, not
  the symptom; do not simply add `overflow: hidden` and hide the tabs.
- `apps.css:498` — migrate to min-width.

Actions stay visible at every supported width. Never hide `.sh-th--actions` or equivalent controls
inside 1280–1440; a narrow window must not silently become read-only.

### 4. Breakpoint convention

One direction: **Tailwind mobile-first `min-width` only.** Document it in `web/README` or
`CLAUDE.md`.

Migrate the 7 `max-width` queries (`settings.css:568`, `device-control.css:1291`,
`device-explorer.css:171,199`, `selector-health.css:836`, `apps.css:220,498`).

Today `device-explorer.css:171` and `selector-health.css:836` use `max-width: 1024px` while
`settings.css:148,171,190` use `min-width: 1024px` — the same number meaning opposite things in one
codebase. That ambiguity is how the dead zone got in.

Migrating `selector-health.css:836` is out-of-scope-but-adjacent: it governs <1024 behaviour. Leave
its behaviour identical; only flip the direction if it can be done without changing what renders.

## Sequencing

TDD at the layout level:

1. Seed script → real data in the tables.
2. Playwright guard → **watch it fail** on the Device Control 16px clip.
3. Fix Device Control → guard green.
4. Migrate `apps.css:498` → guard still green.
5. Convention doc + remaining max-width migrations → guard still green.

Step 2 failing first is the point. A guard that has never failed proves nothing — the same reason
the audit's "zero overflow at 1024" reading was worthless.

## Risks

- **Playwright as a web devDep** — ~1 min CI, and a second Playwright config in the repo. Mitigated
  by following the mac-app pattern.
- **Seed script touches the DB** — dev-only, explicit invocation, never on boot. Must not run
  against `~/.cache/xenon/xenon.db` by default; require an explicit `DATABASE_URL`.
- **The fixes are CSS-only** and low risk. The guard is what could be flaky: MJPEG streams and the
  5s poll can shift layout mid-assertion. Stub the stream endpoints or wait for a settled state.
- **Under-scoping risk:** if real users do sit at 1024, this design leaves the dead zone live. That
  was an explicit call; revisit if it bites.

## Open questions

- Does Device Control's 16px clip reproduce with **no device connected**? Measured with a live
  Android streaming; the interactions column may size differently when the preview is absent.
- Should the guard run on every PR or nightly? Every PR is the honest answer if it takes ~1 min.

## Out of scope, recorded for later

Found during this investigation, worth their own work:
- `ErrorBoundary` renders unstyled — 4 undefined CSS vars, no fallbacks, on the page users see when
  something already broke.
- Focus-visible nearly absent — 4 `:focus-visible` rules vs 19 files setting `outline: none`;
  `.btn-base` has no focus ring at all.
- `card-view.tsx:35` — `React.Children.toArray` positional keys can re-point an open modal at a
  different device when the list re-filters. Correctness bug, one-line fix.
- No `visibilitychange` handling anywhere — 6 polls and all MJPEG streams run at full rate on a
  hidden tab.
