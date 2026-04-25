# Selector Health — Phase 1 Polish (Design Spec)

**Date:** 2026-04-26
**Scope:** UI polish only. No new metrics, no new endpoints, no new dependencies.
**Out of scope (deferred):** Health Score, severity system, sparklines, trend chart, recent-activity peek. These belong to Phases 2 and 3.

## Goal

Address 7 items from user-supplied UX feedback (#1, #3, #4, #5, #6, #9, #10) without introducing new concepts or backend work. Make the page feel deliberate at a glance — clear hero metric, readable cards, useful empty state, anchored filters.

## Files Touched

| File | Why |
|---|---|
| `web/src/components/selector-health/selector-health-page.tsx` | KpiStrip restructure, filter-bar reposition, empty-state replacement, header CTA de-emphasis |
| `web/src/components/selector-health/selector-health.css` | Hero tile size variant, contrast tokens, sticky filter, tighter empty state |
| `web/src/components/ui/EmptyState.tsx` | Reuse existing primitive — extend if needed for action-row support |

No backend changes. No new npm dependencies.

## Item-by-item changes

### Item 1 — Information hierarchy (Brittle Selectors as hero)

- Add `size: 'hero' | 'md'` prop to the existing `KpiTile` (declared inside `selector-health-page.tsx`). `'hero'` doubles font size, spans 2 columns on `md+`, gets stronger border accent.
- Reorder KPI strip: **Brittle selectors (hero)** + 5 supporting tiles (Total heals, Sessions touched, LLM heals, Est. cost, Resolved).
- Hero tile gets a single sub-line (e.g. `"distinct selectors needing attention"`) to anchor meaning, not just `"distinct"`.
- No new metrics, no Health Score formula.

### Item 3 — Empty state (guided)

Replace the current `<div className="sh-empty sh-empty--clean">` block with a structured empty state:

- **Icon:** `HeartPulse` (consistent with page identity), size `40`, `--green` for "clean" tabs, `--text-muted` for "nothing yet" tabs
- **Title:** tab-specific (`Locator hygiene is clean` / `Nothing pending` / `Nothing resolved yet` / `No muted selectors`)
- **Body:** one sentence of context (e.g. *"Once tests start running, brittle selectors will surface here ranked by heal frequency."*)
- **Action row:** secondary buttons that always work — `View documentation` (link to `/xenon/api-docs`), `Reset filters` (visible only when a filter is set). No fabricated "Run scan" button — Xenon doesn't run scans on its own.
- Container height capped at ~360px so it doesn't dominate the viewport (item 10).

### Item 4 — Contrast

- KPI tiles: surface `var(--surface)` → `var(--surface-raised)` (new token, ~`rgba(255,255,255,0.045)` on dark, falls back to `var(--surface)` if undefined). Border opacity `0.4` → `0.55`.
- Add `box-shadow: 0 0 0 1px rgba(255,255,255,0.04) inset` on hover for cards (subtle lift).
- Filter-bar background bumped to match KPI tiles so it visually anchors against the page background.
- Active-tab indicator: thicken bottom border `2px` → `3px`, brighten `var(--accent)` to full opacity (currently 0.6 in `.sh-tab--active`).

### Item 5 — Metrics tooltips

- Render a small `Info` Lucide icon (`size={12}`, `var(--text-muted)`) next to each KPI label.
- Use the **native `title="…"`** attribute on the icon for hover text. No new component, no new state, no Popover. Matches "keep simple" constraint.
- Tooltip content is short (≤2 sentences) and stored in a constant map at the top of `selector-health-page.tsx`:
  - *Total heals* — *"Number of times Xenon's self-heal kicked in within the selected window."*
  - *Brittle selectors* — *"Distinct selectors that needed at least one heal. Lower is better."*
  - *LLM heals* — *"Heals that escalated all the way to an LLM. The most expensive tier."*
  - *Est. cost* — *"Estimated dollar spend on LLM heals in the window."*

Skip tooltips on tiles where the label is fully self-explanatory (`Resolved`, `Sessions touched`).

If a future phase wants richer/interactive tooltips, we can swap `title=""` for the Radix `Popover` primitive without touching the data layer.

### Item 6 — Filter bar placement

- Move filter bar from its current position (above TabNav) to **below the TabNav, immediately above the content area**.
- Add `position: sticky; top: 0; z-index: 5;` so filters stay visible while scrolling long hotspot lists.
- Add a small `"Filter results"` label on the left so users see filters belong to the table, not the page.

### Item 9 — CTA placement

- Change `Send digest` and `Refresh` from filled buttons to **ghost icon-buttons** (`Send` / `RefreshCw` icons only, with title attribute for accessibility).
- No new primary CTA invented (per user constraint).
- Keep them in the page header `action` slot.

### Item 10 — Vertical space

- Empty state capped at 360px (handled in Item 3).
- Remove the empty container's full-height stretch (`min-height: 60vh` → `min-height: 0`).
- No new content added below the empty state in Phase 1 (deferred to Phase 2's narrative-flow work).

## Tokens added

In `web/src/tokens.css` (or wherever theme tokens live):

```css
--surface-raised: rgba(255, 255, 255, 0.045);   /* dark theme */
--border-strong: rgba(255, 255, 255, 0.55);     /* used by KPI tiles */
```

If the file uses a different naming convention, follow that. Light-theme equivalents added in the same block.

## What we're explicitly NOT doing

- ❌ No Health Score (no formula, no badge)
- ❌ No severity tags (🔴/🟡/🟢) — that's Phase 2
- ❌ No sparklines or trend chart — that's Phase 3 (needs a backend timeseries endpoint)
- ❌ No "Run scan" button — Xenon has no scan concept
- ❌ No new charts library
- ❌ No layout reflow on the table itself — only the chrome around it

## Test plan

- [ ] `tsc --noEmit` clean
- [ ] `npm run build:xenon` clean
- [ ] Visual smoke at `/xenon/selector-health`:
  - [ ] Brittle Selectors tile is visibly the largest in the strip
  - [ ] All 6 tiles still render correctly across viewport widths (mobile / tablet / desktop)
  - [ ] Empty state height is bounded; action buttons present
  - [ ] Tooltips open on click and dismiss on outside click
  - [ ] Filter bar stays pinned while scrolling the hotspot table
  - [ ] Send digest / Refresh icons retain their click handlers (digest send, list refresh)
  - [ ] Tab switch still works; tab-bar regression banner still appears

## Implementation order

1. CSS-only changes (tokens, contrast, sticky filter, empty-state container) — small, low-risk first
2. KpiTile `size` prop + reorder — JSX + CSS, medium risk
3. Empty state restructure — JSX, requires looking at all 4 tab branches
4. Tooltips — JSX + content map, no functional risk
5. Page header CTA de-emphasis — pure JSX swap

Each step verifiable in the running dev server (already up at port 4723).

## Branch / PR

- Branch: `feat/selector-health-polish-phase-1`
- Base: `main` (after PR #35 merges, otherwise base on `fix/selector-health-lucide-icons` and rebase)
- Single PR for all of Phase 1, since the items reinforce each other visually
