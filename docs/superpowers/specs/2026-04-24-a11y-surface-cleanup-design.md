# A11y + Surface Cleanup After Primitive Adoption Design

**Date:** 2026-04-24
**Branch:** `fix/web-a11y-surface-cleanup`
**Status:** Proposed

## Goal

Close out three polish items deliberately deferred from today's three primitive-adoption PRs, so the `ui/*` primitive landscape is fully coherent and the remaining `.setting-card` CSS in `settings.css` can be deleted.

## Scope

In scope:

1. Introduce a minimal `.surface-card` class for generic elevated-surface wrappers, migrate the 6 hand-rolled `className="setting-card"` usages in `teams.tsx` + `api-keys.tsx` to it, and delete the orphan `.setting-card*` rules from `settings.css`.
2. Make the webhook "Trigger Events" checkbox grid keyboard-operable and screen-reader-legible.
3. Clear the Reserved By validation error in reservation modal as the user types, instead of only on next submit attempt.

Out of scope:

- Any change to the existing `Card` primitive at `web/src/components/ui/Card.tsx` (its `header`/`footer` slots are richer than what the 6 call sites need; its mandatory `.card-body` div would break the table-wrapper usages that set `padding: 0; overflowX: auto`)
- Any change to `FieldGroup` API (the webhook fix uses a `<fieldset>` for a11y, sidestepping the FieldGroup label)
- Visual redesign of empty states, tables, or modals
- New tests — all three are existing-behavior fixes with no new surface area

## Non-goals

- Do not turn `.event-checkbox` divs into native `<input type="checkbox">`. That changes visual rendering and selection behavior enough to risk regressions. Keep them as styled divs with ARIA + keyboard support — that's the minimum-blast-radius fix.
- Do not migrate every empty-state-like usage across the codebase to `.surface-card`. Only the 6 places currently using `className="setting-card"` outside the settings-card pattern.
- Do not add focus styles to `.surface-card`. It's a static surface, not a focusable element.

## Background

Three PRs merged today introduced the Modal, FieldGroup, SettingCard, and Table primitives across the web dashboard. Each PR deferred one minor item to keep scope honest:

- **Modal PR** left inline error placement heuristics in reservation-modal (later fixed to per-field routing in a follow-up commit, but `nameError` clearing on next-submit-only remained).
- **FieldGroup/SettingCard PR (Task 9)** scoped down CSS cleanup because `teams.tsx` and `api-keys.tsx` still consumed `.setting-card` as a generic surface — not the settings-card pattern. The scoped-down commit left `.setting-card` + `:hover` + `::after` scanline + `::before` gradient rules in `settings.css`, each now applied to 6 unrelated surfaces in teams/api-keys.
- **FieldGroup/SettingCard PR Task 5** wrapped the webhook events grid in a FieldGroup but noted (and left) the pre-existing a11y gap: clickable divs styled as checkboxes with no keyboard or screen-reader support.

This PR closes all three.

## Architecture

### 1. `.surface-card` class

Minimal elevated-surface styling, no padding, no decorations. Used by call sites that need a card-shaped container around empty states or tables without the settings-card-specific chrome (scanline, gradient, 20px padding).

**Location:** `web/src/components/ui/surface.css` (new file), imported once from `web/src/index.tsx` so the class is globally available without requiring a component wrapper.

```css
.surface-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}
```

No hover state — these surfaces aren't interactive. No pseudo-elements — the scanline was a deliberate settings-page flourish, not a generic surface treatment. No padding — each call site already specifies via inline style (48 for empty states, 12 for list panels, 0 for tables with overflow).

### 2. Webhook events a11y

Wrap the `.events-grid` in a `<fieldset>` with `role="group"` and `aria-label="Trigger Events"`. This eliminates the need to wire a label id; the fieldset's aria-label provides the group name to screen readers.

Each `.event-checkbox` div gets:
- `role="checkbox"`
- `aria-checked={selectedEvents.includes(event.id)}`
- `tabIndex={0}`
- `onKeyDown` handler: `if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleEvent(event.id); }`

The existing `onClick` stays. The `<fieldset>` gets `border: none; margin: 0; padding: 0;` via inline style to preserve the current visual layout (browsers give fieldsets default chrome that we don't want).

The FieldGroup wrapper stays — it provides the visible "Trigger Events" label; the fieldset provides the programmatic group semantics. Both serve different purposes.

### 3. Reservation nameError reset

Two-line addition to the Reserved By input's onChange:

```tsx
onChange={(e) => {
  setReservedBy(e.target.value);
  if (nameError) setNameError(null);
}}
```

No new state, no debouncing — just clear the error as soon as the user starts correcting it.

## Per-call-site changes

### `web/src/components/settings/teams.tsx`

Four `className="setting-card"` usages (lines 140, 148, 416, 475), all rename to `className="surface-card"`. Inline `style` overrides stay unchanged.

### `web/src/components/settings/api-keys.tsx`

Two `className="setting-card"` usages (lines 220, 228), rename to `className="surface-card"`.

### `web/src/components/settings/settings.css`

Delete the remaining `.setting-card` rule blocks that Task 9 of the prior PR deferred:

- `.setting-card { background...padding: 20px... }` (first copy, around line 68-79)
- `.setting-card:hover { border-color...background: var(--bg-elevated)... }` (around line 81-84)
- `.setting-card { ... }` (second copy around line 184-195, basically identical)
- `.setting-card:hover` (second copy, around line 197-200)
- `.setting-card { background: var(--bg-surface); border: ...; position: relative; }` (third copy under "Premium UX" comment)
- `.setting-card::after` (scanline pseudo-element)
- `.setting-card::before` (gradient border pseudo-element)

Keep everything else. The orphan comment blocks (`/* Hardened Container Architecture */`, `/* --- Premium UX: Obsidian Glassmorphism --- */`, `/* Scanline texture overlay */`) go too since their rules are gone.

### `web/src/components/webhook-settings/webhook-settings.tsx`

Replace `<div className="events-grid">` with a `<fieldset>` wrapper:

```tsx
<fieldset
  role="group"
  aria-label="Trigger Events"
  style={{ border: 'none', margin: 0, padding: 0 }}
>
  <div className="events-grid">
    {AVAILABLE_EVENTS.map((event) => (
      <div
        key={event.id}
        role="checkbox"
        aria-checked={selectedEvents.includes(event.id)}
        tabIndex={0}
        className={`event-checkbox ${selectedEvents.includes(event.id) ? 'selected' : ''}`}
        onClick={() => toggleEvent(event.id)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            toggleEvent(event.id);
          }
        }}
      >
        {event.icon}
        <span>{event.label}</span>
        {selectedEvents.includes(event.id) && (
          <CheckCircle size={14} className="check-icon" />
        )}
      </div>
    ))}
  </div>
</fieldset>
```

Note: we keep the `.events-grid` div inside the fieldset because its CSS (grid-template-columns) targets that class directly.

### `web/src/components/reservation-modal/reservation-modal.tsx`

Change the Reserved By input's `onChange` to clear `nameError` when the user types.

### `web/src/index.tsx`

Add one import: `import './components/ui/surface.css';` alongside the other global CSS imports. This keeps `.surface-card` available without requiring a component or wrapper.

## Rollout

- Branch: `fix/web-a11y-surface-cleanup` (already created from main)
- 4 commits for review granularity:
  1. `feat(web): add surface-card class for generic elevated surfaces` — create `surface.css`, import in `index.tsx`
  2. `refactor(web): migrate generic setting-card usages to surface-card` — rename the 6 classNames in teams/api-keys
  3. `refactor(web): remove remaining orphan setting-card CSS` — delete `.setting-card`, `:hover`, `::after`, `::before`, orphan comments from `settings.css`
  4. `fix(web): make webhook events grid keyboard-operable; clear reservation name error on input` — a11y + nameError reset bundled since both are small
- Single PR titled `fix(web): a11y + surface cleanup after primitive adoption`

## Tests

No new tests. The 75 existing tests must still pass, and the build must still succeed. Visual smoke test is the verification for the CSS deletion (teams empty state, api-keys empty state, teams detail page, etc. should render identically).

## Risks

- **`.surface-card` vs `.setting-card` visual parity.** The old `.setting-card` class applied the scanline (`::after`) and gradient border (`::before`) to the 6 generic-surface usages in teams/api-keys. After migration, those decorations go away. Intentional — they were never meant for generic surfaces, just the settings-card pattern. Mitigation: visual check during smoke test.
- **Fieldset default spacing.** Browsers give `<fieldset>` built-in padding and border. The inline `style` zeros these out, but different browser engines may render `fieldset` slightly differently (e.g., Safari margins). Mitigation: the inline style is explicit enough to cover the common cases.
- **Role="checkbox" on a div.** Screen readers may handle it differently from native `<input type="checkbox">` (e.g., space key announces "select" vs "press to check"). Acceptable per WAI-ARIA Authoring Practices — the role + aria-checked + keyboard support is the standard pattern for styled checkboxes.
- **nameError race condition.** If the user clicks Reserve mid-type, the handleReserve guard runs before the onChange has cleared the error. Harmless — handleReserve's own trim check sets nameError again if needed.

## Success criteria

- `grep -rn '"setting-card"' web/src` returns empty
- `grep -rn '\.setting-card' web/src/components/settings/settings.css` returns empty (including for pseudo-elements)
- `.surface-card` used at exactly 6 call sites: 4 in teams.tsx, 2 in api-keys.tsx
- Webhook "Trigger Events" grid: Tab lands on each event box, Space/Enter toggles selection, screen reader announces the group label and each event's checked state
- Reservation modal: type at least 1 character in Reserved By after seeing "Please enter your name/ID" and the error message disappears
- `npm test` passes (75/75)
- `npm run build` succeeds with no new warnings
