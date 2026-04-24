# FieldGroup Broad Adoption Design

**Date:** 2026-04-24
**Branch:** `chore/adopt-field-group-broad`
**Status:** Proposed

## Goal

Finish the "adopt primitives in forms" track by migrating every remaining hand-rolled `label + input + hint/error` markup in `web/src/` onto a small set of focused primitives. Land a two-primitive split — `FieldGroup` for modal fields, new `SettingCard` for grid-of-settings cards — so each primitive has one visual job and neither absorbs awkward patterns.

## Scope

In scope:

- New primitive `SettingCard` under `web/src/components/ui/` (with `setting-card.css`)
- Migrate 13 call-site fields across 5 files:
  - `reservation-modal.tsx` → `FieldGroup` × 3
  - `tag-manager-modal.tsx` → `FieldGroup` × 1
  - `webhook-settings.tsx` → `FieldGroup` × 2
  - `maintenance-settings.tsx` → `SettingCard` × 4
  - `settings.tsx` → `SettingCard` × 3
- CSS cleanup in each call site's stylesheet (delete rules the primitive now owns)
- New unit tests for both primitives (`field-group.test.tsx` — new; `setting-card.test.tsx` — new)

Out of scope:

- Any change to `FieldGroup`'s public API
- Visual redesign of toggle switches, cron-preset chips, input-with-suffix, error styling, or the settings grid layout
- Accessibility audit beyond `htmlFor` wiring
- Webhook template section (collapsible JSON editor stays as-is)
- Storybook stories (project doesn't use Storybook)

## Non-goals

- Absorbing every imaginable form pattern into a single primitive. Two primitives are fine when they each have one visual job.
- Deleting existing `.input-group` / `.toggle-group` / `.cron-presets` / `.switch` / `.code-font` styles. These are call-site visual concerns that stay put.
- Converting the "Current Tags" display region in `tag-manager-modal` (not a form control).

## Background

Prior PRs adopted `FieldGroup` in two modals (create-key in `api-keys.tsx`, create-team in `teams.tsx`). The primitive has four responsibilities: render a `<label>` with optional `htmlFor`, an optional description, a control slot, and an optional error. It is a clean fit for single-column modal fields.

The remaining forms split into three flavors:

1. **Modal fields** (reservation, tag-manager): straightforward label + input + hint/error. Directly fits `FieldGroup`.
2. **Settings cards** (maintenance, infrastructure): icon + `<h4>` title + prose description + input-with-suffix or toggle + hint below the control. Different visual language; does not fit `FieldGroup` without distorting either the primitive or the call site.
3. **Webhook form**: heterogeneous. URL field lacks a label, events grid is a group control, template section is collapsible. URL and events can take `FieldGroup`; template is left alone.

This spec splits the problem: `FieldGroup` stays lean for flavor (1) and parts of (3); a new `SettingCard` primitive owns flavor (2).

## Architecture

Two sibling primitives under `web/src/components/ui/`, no shared imports between them:

- `FieldGroup.tsx` + `field-group.css` — unchanged from today
- `SettingCard.tsx` + `setting-card.css` — new

Call sites decide which primitive to use based on their visual pattern. No abstraction on top that picks between them.

## SettingCard API

```tsx
export interface SettingCardProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  staggerIndex?: 1 | 2 | 3 | 4;
}
```

Render shape:

```tsx
<div className={`setting-card${staggerIndex ? ` stagger-${staggerIndex}` : ''}`}>
  <div className="setting-card-header">
    {icon}
    <h4>{title}</h4>
  </div>
  {description && <p className="setting-card-description">{description}</p>}
  <div className="setting-card-field">{children}</div>
  {hint && <div className="setting-card-hint">{hint}</div>}
</div>
```

Design notes:

- `children` spans everything between description and hint. Cron-preview, cron-presets, input-with-suffix, toggle rows, etc. all live inside `children` — the primitive does not know about them.
- `staggerIndex` is optional. Pass it only where the existing design uses `.stagger-N` for a cascade-in animation (all current settings cards do).
- The primitive owns `.setting-card`, `.setting-card-header`, `.setting-card-description`, `.setting-card-field`, `.setting-card-hint`. It renames `section-description-dense` → `setting-card-description` and `setting-hint-clean` → `setting-card-hint` (both were orphan class names scattered across files).
- Stagger animation keyframes (`@keyframes stagger-in`) move from the settings pages' CSS into `setting-card.css` so the animation travels with the primitive.

## Per-call-site migration

### `reservation-modal.tsx` (FieldGroup × 3)

- Wrap "Your Name", "Duration", and "Reason" fields in `<FieldGroup>`.
- Duration is a button-group selector (not a native `<select>`) — pass the existing `.duration-selector` as children.
- The single bottom-of-form `error` message becomes the `error` prop on the last FieldGroup (reason textarea) — this is the most natural anchor since the error is shown after user hits Confirm.

CSS cleanup in `reservation-modal.css`: delete `.reservation-form-group`, any `.reservation-modal-body label` rules, and `.error-message`. Keep `.duration-selector`, `.duration-option`, `.reservation-input`, `.btn-cancel`, `.btn-reserve`.

### `tag-manager-modal.tsx` (FieldGroup × 1)

- Wrap the "Add New Tag" input in `<FieldGroup label="Add New Tag" description="Press Enter to add multiple tags" htmlFor="tag-input">`.
- "Current Tags" region (label + `.tags-list`) is not a form control — stays as-is with its existing `<label>`.

CSS cleanup in `tag-manager-modal.css`: delete the `.tag-input-section label` block and `.input-hint` rule. Keep input styling (`.tag-input-section input`), `.input-with-button`, `.add-inline-btn`, `.tags-list`, `.tag-pill-editable`, `.remove-tag`.

### `webhook-settings.tsx` (FieldGroup × 2)

- Wrap the URL text input in `<FieldGroup label="Webhook URL" description="The endpoint we POST webhook events to." htmlFor="webhook-url">`. Add `id="webhook-url"` to the input.
- Wrap the `.events-grid` in `<FieldGroup label="Trigger Events">` — the grid is the child. Delete the existing `<label>Trigger Events:</label>` inside `.events-selection`.
- Template section (collapsible) stays untouched.

CSS cleanup in `webhook-settings.css`: delete `.events-selection label` rule if it only targeted the removed label. Keep `.add-webhook-form`, `.form-group`, `.webhook-input`, `.events-grid`, `.event-checkbox`, `.template-section` block.

### `maintenance-settings.tsx` (SettingCard × 4)

Four cards: Retention Window (input + DAYS), Max Build Capacity (input + BUILDS), Asset Purge Strategy (toggle), Cleanup Orchestration (input + presets grid). Each becomes a `<SettingCard>` with the icon, title, description, hint, and stagger index pulled from the existing markup.

Example (Retention Window):

```tsx
<SettingCard
  staggerIndex={1}
  icon={<History size={16} />}
  title="Retention Window"
  description="Number of days to preserve builds and sessions before automatic purging from the system."
  hint="Standard enterprise retention is typically 30-90 days."
>
  <div className="input-group">
    <input
      type="number"
      value={config.buildCleanupDays}
      onChange={(e) => setConfig({ ...config, buildCleanupDays: parseInt(e.target.value) })}
      min={1}
    />
    <span className="code-font">DAYS</span>
  </div>
</SettingCard>
```

CSS cleanup in `maintenance-settings.css`: delete `.setting-card`, `.setting-card-header`, `.setting-card-header h4`, `.section-description-dense`, `.setting-hint-clean`, and any `@keyframes stagger-in` (now owned by `setting-card.css`). Keep `.settings-grid`, `.input-group`, `.toggle-group`, `.switch`, `.slider`, `.toggle-label`, `.cron-presets`, `.preset-chip`, `.setting-field`, `.setting-input-wrapper`, `.code-font`, `.health-monitor-alert`.

### `settings.tsx` (SettingCard × 3)

Three cards: Idle Health Frequency, Deep Diagnostic Schedule, AI Self-Healing. Same migration pattern as maintenance-settings. The cron-preview strip on the Deep Diagnostic Schedule card is a sibling of the input inside `children`.

CSS cleanup in `settings.css`: same as maintenance-settings — delete duplicate `.setting-card` / `.section-description-dense` / `.setting-hint-clean` rules; keep grid + control styles.

## Tests

New file `web/src/components/ui/field-group.test.tsx` — `FieldGroup` is currently untested. Tests:

1. renders label text
2. renders description when provided, omits when not
3. renders error when provided, omits when not
4. wires `htmlFor` to the label element

New file `web/src/components/ui/setting-card.test.tsx`. Tests:

1. renders icon and title
2. renders description when provided, omits when not
3. renders children inside `.setting-card-field`
4. renders hint when provided, omits when not
5. applies `stagger-N` class when `staggerIndex` is passed, no stagger class when omitted

No new tests for migrated call sites — their behavior is unchanged; existing page tests (none today for these files) remain as-is.

## Rollout

- Branch: `chore/adopt-field-group-broad` (already created from `main`)
- TDD order:
  1. `SettingCard` primitive: failing tests → implementation → passing
  2. `FieldGroup` tests added (cover existing behavior)
  3. Modal migrations (reservation, tag-manager)
  4. Webhook migration (URL + events)
  5. Settings-card migrations (maintenance, infrastructure)
  6. CSS cleanup per file
- Commits per primitive and per call-site for review granularity
- Single PR titled `refactor(web): broad FieldGroup + SettingCard adoption`

## Risks

- **Stagger animation drift.** Moving `@keyframes stagger-in` into `setting-card.css` could change the animation's computed delay if the old CSS used file-local delays. Mitigation: copy the animation rule verbatim including any `animation-delay` that the `.stagger-N` classes set.
- **Shared class name collision.** `.setting-card` exists today in both `maintenance-settings.css` and `settings.css`. After primitive owns the class, the two page-local copies must be deleted fully — leaving one copy risks specificity wars. Mitigation: grep for the class in both files and delete all matches in the cleanup step.
- **Webhook URL `htmlFor`.** Adding `id="webhook-url"` is a new DOM attribute that could collide with an existing element. Mitigation: grep for the id before adding.
- **Reservation error anchor.** Attaching the form-level error to the last FieldGroup is a new location (was a bottom-of-form banner). Mitigation: spot-check the rendered output; if it reads worse, revert to a bottom-of-form `.error-message` sibling of the FieldGroups.

## Success criteria

- `npm run test` passes with 9 new assertions (4 FieldGroup + 5 SettingCard)
- `npm run build:xenon` succeeds with no warnings newly introduced
- `grep -r "section-description-dense\|setting-hint-clean" web/src` returns nothing
- Manually rendered reservation modal, tag manager modal, and both settings pages look visually unchanged (stagger animation still cascades; input suffixes still render; toggles still read ENABLED/DISABLED)
- Webhook form has two intentional visual deltas: a new "Webhook URL" label renders above the URL input (previously placeholder-only), and the "Trigger Events" label adopts `.fg-label` styling (uppercase, muted). Both align with the modal form language.
- Net LOC across modified files is negative (primitives replace duplicated markup in 5 places)
