# Selector Health — Phase 1 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the visual polish in `docs/superpowers/specs/2026-04-26-selector-health-polish-design.md` — hero KPI, sticky filter, ghost CTAs, KPI tooltips, guided empty state, contrast lift — without introducing new metrics, endpoints, or dependencies.

**Architecture:** Pure frontend changes scoped to `web/src/components/selector-health/selector-health-page.tsx` and `selector-health.css`, plus reuse of the existing `EmptyState` primitive in `web/src/components/ui/`. No new tokens needed — `--surface-2` and `--border-strong` already exist in `web/src/tokens.css`.

**Tech Stack:** React 17 + Vite + Tailwind CSS, lucide-react icons, existing CSS-variable token system.

**Verification:** TypeScript compile (`npx tsc --noEmit` from `web/`), then a visual smoke pass at `http://localhost:4723/xenon/selector-health` after `npm run build:xenon && npm run build:copy`. The Appium server already runs in the background.

---

## File Structure

| File | Why |
|---|---|
| `web/src/components/selector-health/selector-health-page.tsx` | KpiStrip restructure (hero tile, reorder, tooltips), filter-bar reposition, empty-state replacement, header CTA swap |
| `web/src/components/selector-health/selector-health.css` | Hero tile sizing, KPI contrast bump, sticky filter, tab indicator, ghost CTA styles, empty-state container trim |

No new files. No new dependencies.

---

## Pre-flight

- [ ] **Step 0.1: Confirm branch state**

Run: `git status && git branch --show-current`
Expected output:
```
On branch feat/selector-health-polish-phase-1
nothing to commit, working tree clean   (or only temp-appium/* + generated/* unstaged)
```

If on a different branch, run `git checkout feat/selector-health-polish-phase-1`.

- [ ] **Step 0.2: Confirm dev server is up**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4723/xenon/`
Expected: `200`

If not 200, restart with `npm run dev` in the background.

---

## Task 1: Hero KPI tile — make Brittle Selectors dominant

**Files:**
- Modify: `web/src/components/selector-health/selector-health-page.tsx` (KpiTile component ~line 117, KpiStrip JSX ~line 150)
- Modify: `web/src/components/selector-health/selector-health.css` (`.sh-kpi-strip`, `.sh-kpi`, add `.sh-kpi--hero`)

- [ ] **Step 1.1: Add `size` prop to KpiTile**

Edit `web/src/components/selector-health/selector-health-page.tsx`. Replace the existing `KpiTileProps` interface and `KpiTile` component (lines ~109-128) with:

```tsx
interface KpiTileProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  delta?: React.ReactNode;
  tone?: 'neutral' | 'warn' | 'critical';
  size?: 'md' | 'hero';
  hint?: string;
}

const KpiTile: React.FC<KpiTileProps> = ({ label, value, sub, delta, tone = 'neutral', size = 'md', hint }) => (
  <div className={`sh-kpi sh-kpi--${tone} sh-kpi--${size}`}>
    <div className="sh-kpi__label">
      {label}
      {hint && <Info size={11} className="sh-kpi__info" aria-label={hint} />}
    </div>
    <div className="sh-kpi__value">{value}</div>
    {(sub || delta) && (
      <div className="sh-kpi__foot">
        {sub && <span className="sh-kpi__sub">{sub}</span>}
        {delta && <span className="sh-kpi__delta">{delta}</span>}
      </div>
    )}
  </div>
);
```

Then add `Info` to the lucide-react import block at the top of the file (around line 10–20):

```tsx
import {
  HeartPulse,
  RefreshCw,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ChevronRight,
  Filter,
  Send,
  Info,
} from 'lucide-react';
```

The `hint` prop renders the `Info` icon with a native `title=""` (passed via `aria-label` so the browser's accessible-name → tooltip resolution works on hover). Tooltip wiring is fleshed out in Task 5; here we only add the prop plumbing.

- [ ] **Step 1.2: Reorder KpiStrip — Brittle Selectors first as hero**

In the same file, replace the entire `<div className="sh-kpi-strip">` JSX block (lines ~150-205) with the following. Brittle Selectors moves to position 1 with `size="hero"`; the other tiles retain their current props but lose the `hint`-less labels stay as-is.

```tsx
return (
  <div className="sh-kpi-strip">
    <KpiTile
      size="hero"
      label="Brittle selectors"
      value={loading ? '—' : cur.distinctSelectors.toLocaleString()}
      sub="distinct selectors needing attention"
      delta={
        !loading && <Delta current={cur.distinctSelectors} prior={prior.distinctSelectors} />
      }
      tone={cur.distinctSelectors > 50 ? 'warn' : 'neutral'}
    />
    <KpiTile
      label="Total heals"
      value={loading ? '—' : cur.totalHeals.toLocaleString()}
      sub={`${summary?.windowDays ?? 30}d window`}
      delta={!loading && <Delta current={cur.totalHeals} prior={prior.totalHeals} />}
      tone={cur.totalHeals > prior.totalHeals && prior.totalHeals > 0 ? 'warn' : 'neutral'}
    />
    <KpiTile
      label="Sessions touched"
      value={loading ? '—' : cur.sessionsTouched.toLocaleString()}
      sub="by self-heal"
      delta={!loading && <Delta current={cur.sessionsTouched} prior={prior.sessionsTouched} />}
    />
    <KpiTile
      label="LLM heals"
      value={loading ? '—' : llmHeals.toLocaleString()}
      sub={`${llmShare}% of total`}
      tone={llmShare > 30 ? 'critical' : llmShare > 10 ? 'warn' : 'neutral'}
    />
    <KpiTile
      label="Est. cost"
      value={loading ? '—' : formatCost(cur.estCostUsd)}
      sub="this window"
      delta={
        !loading && (
          <Delta
            current={Math.round(cur.estCostUsd * 100)}
            prior={Math.round(prior.estCostUsd * 100)}
          />
        )
      }
    />
    <KpiTile
      label="Resolved"
      value={loading ? '—' : (summary?.resolvedCount ?? 0).toLocaleString()}
      sub={`last ${summary?.windowDays ?? 30}d`}
      delta={
        !loading && typeof summary?.pendingCount === 'number' ? (
          <span className="sh-kpi__delta">⏳ {summary.pendingCount} pending</span>
        ) : undefined
      }
      tone="neutral"
    />
  </div>
);
```

(The `⏳` on the Resolved tile is left for Task 6 — we'll swap it for `Hourglass` when we touch icons. Don't change it now.)

- [ ] **Step 1.3: CSS — hero size + grid template**

Edit `web/src/components/selector-health/selector-health.css`. Replace the existing `.sh-kpi-strip` rule (lines ~27-43) and the `.sh-kpi` rule (lines ~45-54) with:

```css
.sh-kpi-strip {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

@media (min-width: 768px) {
  .sh-kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  /* Hero tile spans both columns on tablet so it stays prominent. */
  .sh-kpi--hero {
    grid-column: 1 / -1;
  }
}

@media (min-width: 1280px) {
  .sh-kpi-strip {
    /* 2fr hero + 5 × 1fr supporting = 7fr total. */
    grid-template-columns: 2fr repeat(5, minmax(0, 1fr));
  }
  .sh-kpi--hero {
    grid-column: auto; /* let the explicit 2fr track size it */
  }
}

.sh-kpi {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: var(--surface);
  border: 1px solid var(--border);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.sh-kpi--hero {
  background: var(--surface-2);
  border-color: var(--border-strong);
  padding: 20px 22px;
  gap: 6px;
}

.sh-kpi--hero .sh-kpi__label {
  font-size: 11px;
  color: var(--text);
}

.sh-kpi--hero .sh-kpi__value {
  font-size: 2.75rem;
  line-height: 1.05;
}

.sh-kpi--hero .sh-kpi__foot {
  font-size: 12px;
  margin-top: 4px;
}
```

Leave the existing `.sh-kpi__label`, `.sh-kpi__value`, `.sh-kpi__foot`, `.sh-kpi__sub`, `.sh-kpi--warn`, `.sh-kpi--critical` rules untouched.

- [ ] **Step 1.4: Type-check**

Run from repo root: `cd web && npx tsc --noEmit && cd ..`
Expected: no output (success). If errors mention missing `Info` icon, confirm the import was added in Step 1.1.

- [ ] **Step 1.5: Rebuild + visual smoke**

Run: `npm run build:xenon && npm run build:copy`
Expected last line: `✅ Xenon build complete.` (or `+ schema.json` copy with no errors)

Hard-refresh `http://localhost:4723/xenon/selector-health`. Confirm:
- Brittle Selectors tile is the leftmost and visibly the largest
- On a wide viewport it spans roughly 2× the width of supporting tiles
- Numerals are noticeably larger
- All 6 tiles still render

- [ ] **Step 1.6: Commit**

```bash
git add web/src/components/selector-health/selector-health-page.tsx \
        web/src/components/selector-health/selector-health.css
git commit -m "$(cat <<'EOF'
feat(web): hero Brittle Selectors KPI in selector-health strip

Adds size="hero" variant to KpiTile and reorders the strip so the
most actionable number (distinct brittle selectors) reads first and
loudest. Other 5 tiles unchanged. Pure visual hierarchy — no new
metrics or formulas.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Contrast bump — KPI tile borders + active-tab indicator

**Files:**
- Modify: `web/src/components/selector-health/selector-health.css` (`.sh-kpi`, `.sh-tab--active`)

- [ ] **Step 2.1: Strengthen KPI tile borders**

In `selector-health.css`, find the `.sh-kpi` rule (the one we already touched in Task 1) and change its `border` line:

```css
/* before */
border: 1px solid var(--border);

/* after */
border: 1px solid var(--border-strong);
```

Also add a hover state right after `.sh-kpi--hero { ... }`:

```css
.sh-kpi:hover {
  border-color: var(--text-dim);
}
```

- [ ] **Step 2.2: Brighten the active-tab underline**

Find the `.sh-tab--active` rule (around line 770 in `selector-health.css`):

```css
/* before */
.sh-tab--active {
  ...
  border-bottom-color: var(--accent, #60a5fa);
}
```

Change `border-bottom-width` (look at the parent `.sh-tab`) so the active state is 3px instead of 2px, and bump opacity if needed. Concretely, find `.sh-tab` and add to the active state:

Find `.sh-tab--active` (~line 768) and replace its block with:

```css
.sh-tab--active {
  color: var(--text);
  border-bottom-color: var(--accent, #60a5fa);
  border-bottom-width: 3px;
}
```

If `.sh-tab` has `padding-bottom` set, the existing block doesn't need extra adjustment — the 1px change is absorbed into the existing layout.

- [ ] **Step 2.3: Type-check**

`cd web && npx tsc --noEmit && cd ..`
Expected: no output. (CSS changes don't affect TS compile, but run anyway as habit.)

- [ ] **Step 2.4: Rebuild + visual smoke**

`npm run build:xenon && npm run build:copy`

Hard-refresh page. Confirm:
- KPI tile borders are now perceptibly visible against the page background
- Hovering a tile darkens its border further (subtle but present)
- Active tab indicator looks heavier than before

- [ ] **Step 2.5: Commit**

```bash
git add web/src/components/selector-health/selector-health.css
git commit -m "$(cat <<'EOF'
fix(web): raise KPI tile + tab indicator contrast

KPI tiles and active-tab underline used --border which is intentionally
quiet. Switch to --border-strong on tiles and bump active-tab to 3px
border-bottom so the visual scaffolding survives at-a-glance scanning.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Sticky filter bar below the tabs

**Files:**
- Modify: `web/src/components/selector-health/selector-health-page.tsx` (filter-bar JSX position + label)
- Modify: `web/src/components/selector-health/selector-health.css` (`.sh-filter-bar`)

- [ ] **Step 3.1: Add a "Filter results" lead-in label to the filter bar**

In `selector-health-page.tsx`, find the `<div className="sh-filter-bar">` block (~line 413). Add a new lead-in `<span>` as the first child:

```tsx
<div className="sh-filter-bar">
  <span className="sh-filter-bar__lead">Filter results</span>
  <div className="sh-filter-bar__group">
    ...
```

The bar's existing position (it currently lives inside `<>...</>` after `MutedList`'s ternary, ~line 413) is already below the TabNav, so no JSX move is needed — the visual ordering today is: PageHeader → RegressionBanner → KpiStrip → TabNav → FilterBar → content. We just need to make the bar sticky.

- [ ] **Step 3.2: CSS — sticky position + lead-in label style**

In `selector-health.css`, find the `.sh-filter-bar` rule (~line 126). Replace it with:

```css
.sh-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px 18px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  position: sticky;
  top: 0;
  z-index: 5;
  /* When the bar pins, give it an opaque backdrop so content scrolling
     under it stays readable. */
  backdrop-filter: blur(6px);
  background-color: color-mix(in srgb, var(--surface) 92%, transparent);
}

.sh-filter-bar__lead {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  margin-right: 6px;
}
```

- [ ] **Step 3.3: Type-check**

`cd web && npx tsc --noEmit && cd ..`
Expected: no output.

- [ ] **Step 3.4: Rebuild + visual smoke**

`npm run build:xenon && npm run build:copy`

Hard-refresh. With a viewport tall enough to scroll a long hotspot list:
- Confirm the filter bar pins to the top when you scroll
- Confirm the "FILTER RESULTS" lead-in label is visible to the left of the controls
- Confirm the bar has visible contrast against the scrolling table beneath it

If the page doesn't have enough rows to scroll, manually resize the browser to a short height (~600px) to force scroll.

- [ ] **Step 3.5: Commit**

```bash
git add web/src/components/selector-health/selector-health-page.tsx \
        web/src/components/selector-health/selector-health.css
git commit -m "$(cat <<'EOF'
feat(web): sticky filter bar + lead-in label

Filter bar pins to top while scrolling the hotspot table so users
always see what's scoping the results. Adds a "Filter results" lead
label so the bar's purpose is unambiguous.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Page-header CTA de-emphasis (ghost icon buttons)

**Files:**
- Modify: `web/src/components/selector-health/selector-health-page.tsx` (PageHeader `action` prop, ~lines 370-393)
- Modify: `web/src/components/selector-health/selector-health.css` (`.sh-refresh-btn` ghost variant)

- [ ] **Step 4.1: Replace text+icon buttons with icon-only ghost buttons**

In `selector-health-page.tsx`, find the `action={...}` prop on the `<PageHeader />` (~lines 370-393). Replace the two `<button>`s with:

```tsx
action={
  <>
    <button
      type="button"
      className="sh-ghost-btn"
      onClick={sendDigest}
      disabled={sendingDigest}
      title={sendingDigest ? 'Sending digest…' : 'Send digest to subscribed webhooks'}
      aria-label="Send digest"
    >
      <Send size={14} className={sendingDigest ? 'animate-spin' : ''} />
    </button>
    <button
      type="button"
      className="sh-ghost-btn"
      onClick={load}
      disabled={loading}
      title="Refresh hotspots"
      aria-label="Refresh"
    >
      <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
    </button>
  </>
}
```

Note: kept `onClick` handlers (`sendDigest`, `load`) and disabled-state behavior unchanged. Only chrome changes.

- [ ] **Step 4.2: CSS — ghost button style**

In `selector-health.css`, add a new rule near the existing `.sh-refresh-btn` block (~line 192):

```css
.sh-ghost-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.sh-ghost-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-dim);
  background: var(--surface-2);
}

.sh-ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

Don't delete `.sh-refresh-btn` — the detail page still uses it (`selector-detail-page.tsx`).

- [ ] **Step 4.3: Type-check**

`cd web && npx tsc --noEmit && cd ..`
Expected: no output.

- [ ] **Step 4.4: Rebuild + visual smoke**

`npm run build:xenon && npm run build:copy`

Hard-refresh. Confirm:
- The two header buttons are now icon-only squares
- Hovering them shows a subtle border + background lift
- Tooltips appear on hover (native title)
- Clicking Refresh still spins; clicking Send digest still calls the API (toast appears)

- [ ] **Step 4.5: Commit**

```bash
git add web/src/components/selector-health/selector-health-page.tsx \
        web/src/components/selector-health/selector-health.css
git commit -m "$(cat <<'EOF'
fix(web): de-emphasize header CTAs with ghost icon buttons

Send digest and Refresh were text+icon pills competing with the page
title. Switch to 32px ghost icon-only buttons (title attribute provides
hover hint, aria-label preserves accessibility). Click handlers and
disabled-state behavior unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: KPI tooltips — wire the `hint` prop

**Files:**
- Modify: `web/src/components/selector-health/selector-health-page.tsx` (KpiStrip `<KpiTile />` calls + KPI_HINTS map)
- Modify: `web/src/components/selector-health/selector-health.css` (`.sh-kpi__info`)

- [ ] **Step 5.1: Add a hint constant and wire into KpiStrip**

In `selector-health-page.tsx`, just above the `KpiStrip` component definition (around line 130), add a constant:

```tsx
const KPI_HINTS = {
  brittle: 'Distinct selectors that needed at least one heal in the window. Lower is better.',
  totalHeals: "Number of times Xenon's self-heal kicked in within the selected window.",
  llm: 'Heals that escalated all the way to an LLM. The most expensive tier — keep this small.',
  cost: 'Estimated dollar spend on LLM heals in the window.',
} as const;
```

Then in the `KpiStrip` JSX (already touched in Task 1), pass `hint` to four of the tiles. Modify only the four marked below; leave Sessions Touched and Resolved without a hint.

```tsx
<KpiTile
  size="hero"
  label="Brittle selectors"
  hint={KPI_HINTS.brittle}                             {/* ← add */}
  value={loading ? '—' : cur.distinctSelectors.toLocaleString()}
  ...
/>
<KpiTile
  label="Total heals"
  hint={KPI_HINTS.totalHeals}                          {/* ← add */}
  value={loading ? '—' : cur.totalHeals.toLocaleString()}
  ...
/>
<KpiTile
  label="LLM heals"
  hint={KPI_HINTS.llm}                                 {/* ← add */}
  value={loading ? '—' : llmHeals.toLocaleString()}
  ...
/>
<KpiTile
  label="Est. cost"
  hint={KPI_HINTS.cost}                                {/* ← add */}
  value={loading ? '—' : formatCost(cur.estCostUsd)}
  ...
/>
```

- [ ] **Step 5.2: Refine the Info icon — use `title` for hover, not `aria-label`**

The `KpiTile` definition from Task 1 currently passes `aria-label={hint}`. Native browser tooltip-on-hover only fires for `title`, not `aria-label`. Update the `KpiTile` definition (around line 117) so the `Info` icon uses both:

```tsx
const KpiTile: React.FC<KpiTileProps> = ({ label, value, sub, delta, tone = 'neutral', size = 'md', hint }) => (
  <div className={`sh-kpi sh-kpi--${tone} sh-kpi--${size}`}>
    <div className="sh-kpi__label">
      {label}
      {hint && (
        <span className="sh-kpi__info" title={hint} aria-label={hint} role="img">
          <Info size={11} />
        </span>
      )}
    </div>
    ...
  </div>
);
```

The wrapping `<span>` is needed because Lucide icons don't accept `title` as a prop reliably across versions; setting it on the wrapper is portable.

- [ ] **Step 5.3: CSS — Info icon styling**

In `selector-health.css`, add a new rule next to `.sh-kpi__label` (~line 64):

```css
.sh-kpi__info {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  color: var(--text-dim);
  cursor: help;
  vertical-align: middle;
}

.sh-kpi__info:hover {
  color: var(--text);
}
```

- [ ] **Step 5.4: Type-check**

`cd web && npx tsc --noEmit && cd ..`
Expected: no output.

- [ ] **Step 5.5: Rebuild + visual smoke**

`npm run build:xenon && npm run build:copy`

Hard-refresh. Confirm:
- A small `Info` icon appears next to the labels of: Brittle selectors, Total heals, LLM heals, Est. cost
- No icon appears next to: Sessions touched, Resolved
- Hovering the icon shows a native browser tooltip with the hint text after ~1s

- [ ] **Step 5.6: Commit**

```bash
git add web/src/components/selector-health/selector-health-page.tsx \
        web/src/components/selector-health/selector-health.css
git commit -m "$(cat <<'EOF'
feat(web): KPI tooltips via Info icon + native title

Adds a small Info icon next to KPI labels whose meaning isn't
self-evident (Brittle, Total heals, LLM heals, Est. cost). Hover text
uses the native title attribute — zero new components, zero state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Guided empty state — replace ad-hoc div with shared `EmptyState`

**Files:**
- Modify: `web/src/components/selector-health/selector-health-page.tsx` (empty-state branch ~lines 467-486)
- Modify: `web/src/components/selector-health/selector-health.css` (`.sh-empty` trim)

- [ ] **Step 6.1: Import EmptyState + ExternalLink icon**

At the top of `selector-health-page.tsx`, add:

```tsx
import { EmptyState } from '../ui/EmptyState';
```

…and add `ExternalLink` to the existing lucide-react import block from Task 1.5. The full import becomes:

```tsx
import {
  HeartPulse,
  RefreshCw,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ChevronRight,
  Filter,
  Send,
  Info,
  ExternalLink,
} from 'lucide-react';
```

- [ ] **Step 6.2: Replace the empty-state branch**

In `selector-health-page.tsx`, find the existing empty-state branch (~lines 467-486 in the current file, the `<div className="sh-empty sh-empty--clean">...</div>` block). Replace it with:

```tsx
) : hotspots.length === 0 ? (
  <EmptyState
    icon={
      <HeartPulse
        size={32}
        color={tab === 'active' ? 'var(--green)' : 'var(--text-dim)'}
      />
    }
    title={
      tab === 'pending'
        ? 'Nothing pending'
        : tab === 'resolved'
          ? 'Nothing resolved yet'
          : tab === 'muted'
            ? 'No muted selectors'
            : 'Locator hygiene is clean'
    }
    description={
      tab === 'pending'
        ? 'When you mark a selector fixed, it shows here while we watch for 3 clean CI builds.'
        : tab === 'resolved'
          ? 'Fix a hot selector and Xenon will track its verification here.'
          : tab === 'muted'
            ? 'Selectors you mute appear here. Unmuting brings them back to the Active list.'
            : `No selectors required healing in the last ${windowDays} days${filtersActive ? ' for the active filters' : ''}.`
    }
    action={
      <div className="sh-empty-actions">
        {filtersActive && (tab === 'active') && (
          <button
            type="button"
            className="sh-ghost-btn sh-ghost-btn--inline"
            onClick={() => { setTier(''); setPlatform(''); }}
          >
            <Filter size={12} /> Reset filters
          </button>
        )}
        <a
          href="/xenon/api-docs"
          target="_blank"
          rel="noreferrer"
          className="sh-ghost-btn sh-ghost-btn--inline"
        >
          <ExternalLink size={12} /> View API docs
        </a>
      </div>
    }
  />
) : tab === 'pending' ? (
```

(The trailing `) : tab === 'pending' ? (` is the start of the next existing branch — keep it as-is.)

- [ ] **Step 6.3: CSS — adjust empty container + inline action button**

In `selector-health.css`, the existing `.sh-empty` rule (~line 222) is now only used by the loading spinner branch (`<div className="sh-empty"><RefreshCw />Loading hotspots…</div>`). Tighten its padding so it doesn't stretch:

```css
.sh-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px 24px;       /* was 60px 24px */
  color: var(--text-dim);
  font-size: 12px;
  border-radius: var(--radius-md);
  background: var(--surface);
  border: 1px dashed var(--border);
}
```

The `.sh-empty--clean` and `.sh-empty__title` / `.sh-empty__subtitle` rules become orphan classes — they're no longer applied anywhere, but leaving them in for now is fine (a dead-code sweep is out of scope for this PR).

Add the inline ghost-button variant (so the empty state's action row uses thin pill buttons instead of 32px squares):

```css
.sh-empty-actions {
  display: inline-flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.sh-ghost-btn--inline {
  width: auto;
  height: auto;
  padding: 6px 10px;
  gap: 6px;
  font-size: 12px;
  text-decoration: none;
}
```

- [ ] **Step 6.4: Type-check**

`cd web && npx tsc --noEmit && cd ..`
Expected: no output. If errors mention `EmptyState` not found, recheck the import path.

- [ ] **Step 6.5: Rebuild + visual smoke**

`npm run build:xenon && npm run build:copy`

Hard-refresh. Confirm on the **Active** tab (with no data):
- HeartPulse icon is green
- Title and description are tab-specific
- A `View API docs` button appears below the description, opens `/xenon/api-docs` in a new tab when clicked
- If you select a Tier filter (e.g., "LLM"), a `Reset filters` button also appears

Switch to the **Pending** and **Resolved** tabs (also empty if no data):
- HeartPulse icon is muted (text-dim color)
- Tab-specific copy renders

Switch to **Muted**:
- The `MutedList` component renders its own empty state (untouched by this task — it's a different code path).

- [ ] **Step 6.6: Commit**

```bash
git add web/src/components/selector-health/selector-health-page.tsx \
        web/src/components/selector-health/selector-health.css
git commit -m "$(cat <<'EOF'
feat(web): guided empty state on selector-health tabs

Replace the ad-hoc sh-empty--clean block with the shared EmptyState
primitive. Adds context-appropriate copy per tab plus action buttons:
"Reset filters" (when filters are active on the Active tab) and
"View API docs" (always, opens /xenon/api-docs in a new tab). Empty
container no longer stretches to dominate the viewport.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: End-to-end visual verification + push + PR

**Files:** none (verification only)

- [ ] **Step 7.1: Final TypeScript check**

`cd web && npx tsc --noEmit && cd ..`
Expected: no output.

- [ ] **Step 7.2: Final rebuild**

`npm run build:xenon && npm run build:copy`
Expected last line: `+ schema.json` (no errors above).

- [ ] **Step 7.3: Manual smoke checklist**

Visit `http://localhost:4723/xenon/selector-health` (hard refresh) and tick:

- [ ] Brittle Selectors tile is the largest in the strip
- [ ] All 6 tiles render across mobile / tablet / desktop widths (resize browser to verify)
- [ ] KPI tile borders look stronger than before
- [ ] Active tab underline reads as 3px / fully accented
- [ ] Filter bar pins to the top when scrolling a long table
- [ ] "FILTER RESULTS" lead label is visible to the left of the dropdowns
- [ ] Send digest / Refresh are 32px ghost icon-only squares with hover tooltips
- [ ] Info icons appear next to Brittle, Total heals, LLM heals, Est. cost — and only those four
- [ ] Hovering an Info icon shows a browser tooltip after ~1s
- [ ] Empty state on the Active tab renders the green HeartPulse + "View API docs" button
- [ ] Empty state on Pending / Resolved renders muted icon + tab-appropriate copy
- [ ] No React console errors in browser devtools

- [ ] **Step 7.4: Push branch**

```bash
git push -u origin feat/selector-health-polish-phase-1
```

- [ ] **Step 7.5: Open PR against main**

```bash
gh pr create --base main --head feat/selector-health-polish-phase-1 \
  --title "feat(web): selector-health Phase 1 polish" \
  --body "$(cat <<'EOF'
## Summary

Phase 1 visual polish for `/selector-health`. Spec at
`docs/superpowers/specs/2026-04-26-selector-health-polish-design.md`.

- **Item 1** Hero KPI: Brittle Selectors becomes a 2× hero tile; other 5 unchanged
- **Item 3** Guided empty state via shared `EmptyState` with `View API docs` + `Reset filters` actions
- **Item 4** Contrast lift: KPI tile borders → `--border-strong`; tab indicator 2 px → 3 px
- **Item 5** Tiny Info icons next to KPI labels with native `title` hover tooltips
- **Item 6** Filter bar pinned (`position: sticky`) with a "Filter results" lead label
- **Item 9** Send digest / Refresh swapped for 32 px ghost icon-only buttons (handlers unchanged)
- **Item 10** Empty container padding trimmed so it no longer dominates the viewport

## Explicitly NOT in this PR (deferred)

- Health Score / severity tags — Phase 2
- Sparklines / trend charts — Phase 3 (needs a backend timeseries endpoint)

## Test plan

- [x] `tsc --noEmit` clean
- [x] `npm run build:xenon` clean
- [x] Manual visual smoke per checklist in the plan doc
- [ ] Reviewer hard-refreshes `http://localhost:4723/xenon/selector-health` and confirms the 11 visual checks above

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7.6: Final commit message audit**

Run: `git log --oneline main..HEAD`
Expected: 6 commits with `feat(web)` / `fix(web)` prefixes plus the design-spec commit. Each describes a single concern.

If any commit message is wrong or duplicated, **do not amend** — note it for follow-up. Amend would lose the granular history that makes the PR easy to review.

---

## Self-review notes

- Spec coverage: items 1, 3, 4, 5, 6, 9, 10 — Tasks 1, 6, 2, 5, 3, 4 (in spec-feedback order) cover them. Item 10 (vertical space) is delivered as a side effect of Tasks 6 (`padding 60→32`) and 1 (no min-height stretch on hero tile).
- Type consistency: `KpiTileProps.size` and `KpiTileProps.hint` are introduced in Task 1 and used in Task 5 — names match.
- No placeholders: every step has concrete code or a concrete command + expected output. No "appropriate error handling" hand-waving.
