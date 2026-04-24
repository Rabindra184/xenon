# Adopt `ui/Modal` Primitive Across Standalone Dialogs — Design

**Status:** Draft
**Date:** 2026-04-24
**Branch:** `refactor/web-adopt-modal-primitive`

## Goal

Retire five hand-rolled dialog implementations by migrating them onto the Radix-backed `ui/Modal` primitive, and give the primitive a medium-polish visual refresh in the same change. Every adopted modal inherits focus trap, focus restore, Escape handling, overlay dismissal, and `aria-labelledby` for free.

## Scope

**In scope — 5 modal instances across 4 files:**
1. `web/src/components/reservation-modal/reservation-modal.tsx`
2. `web/src/components/tag-manager-modal/tag-manager-modal.tsx`
3. `web/src/components/settings/api-keys.tsx` — Create API key modal
4. `web/src/components/settings/api-keys.tsx` — Reveal key modal
5. `web/src/components/settings/teams.tsx` — Create team modal

**In scope — primitive polish:** `web/src/components/ui/Modal.tsx` and `web/src/components/ui/modal.css`.

**In scope — test additions:** `web/src/components/ui/modal.test.tsx` gains 3 cases covering the new behavior.

## Non-Goals

- No redesign of form-body styling inside any modal (device badges, duration selector, tag pills, form groups remain as-is).
- No new Modal variants (`Modal.Confirm`, `Modal.Alert`, destructive variant) — YAGNI.
- No migration of other modal-shaped surfaces (profiling dialogs, session-dashboard overlays) — they are not in the 5-instance list.
- No removal of `autoFocus` on form inputs — Radix `FocusScope` honors it and field-first focus is the desired behavior.
- No removal of tag-manager's `inputRef.current.focus()` on mount — same reason; it produces the correct initial focus target.
- Scanline visual motif is dropped as a side effect of the polish. If it returns later, it belongs in the primitive (optional decoration slot), not per-consumer.

## Background

Prior PR (#22) retrofitted `ui/Modal` onto `@radix-ui/react-dialog`, so focus trap / Escape / overlay / `aria-labelledby` behavior already lives in the primitive. However, four of the four modal components targeted here still render their own overlay and card DOM by hand:

- `reservation-modal.tsx` (178 LOC) uses `createPortal` with a hand-rolled overlay and a custom `.reservation-modal` card.
- `tag-manager-modal.tsx` (146 LOC) renders an overlay in-tree with inline `handleKeyDown` ESC handling.
- `settings/api-keys.tsx` defines a local `Modal` (lines 434–484) and uses it twice — including once with `closeOnBackdrop={false}` to protect a one-time secret.
- `settings/teams.tsx` defines a separate local `Modal` (lines 530–577) and uses it once.

None of the five call sites trap focus, restore focus, or wire `aria-labelledby`. The Reveal modal in `api-keys.tsx` requires the overlay-dismissal-off behavior; losing it would silently discard a secret on an accidental click.

## Design

### Primitive: `ui/Modal` API & Behavior

Public API gains exactly one optional prop; existing consumers keep working unchanged:

```tsx
interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  width?: number;                     // unchanged, default 480
  closeOnOverlayClick?: boolean;      // NEW, default true
}
```

**`closeOnOverlayClick={false}`** translates to `onPointerDownOutside={(e) => e.preventDefault()}` on `DialogPrimitive.Content`. Escape key still closes — ESC is a deliberate user action, not an accidental click, and the Reveal modal's primary dismissal path is the "I've saved it" button.

**Close-X button (always rendered).** A right-aligned ghost icon button lives in `.modal-header`, wired via `DialogPrimitive.Close asChild`. Uses the Lucide `X` icon at `size={18}`, `aria-label="Close"`, transparent background, `color: var(--text-secondary)` with a `var(--text-primary)` hover, and a small rounded hover backdrop (`background: rgba(255,255,255,0.06)`) to match the rest of the app's ghost buttons. No prop to hide it — every current consumer wants one and YAGNI rules out the escape hatch until a concrete need appears.

**Visual polish (medium):**

| Surface | Change |
|---|---|
| Overlay | `background: rgba(0,0,0,0.55)`, `backdrop-filter: blur(4px)` |
| Card | `border-radius: 12px`, `box-shadow: 0 20px 50px rgba(0,0,0,0.45)` |
| Header | `padding: 16px 20px`, `font-size: 15px`, `font-weight: 600`; close button on the right |
| Body | `padding: 20px` |
| Footer | `padding: 14px 20px`, unchanged flex/gap |
| Motion | 150ms fade+scale (`scale(0.97) → scale(1)`) driven by Radix `data-state="open"/"closed"` attrs |

**Header DOM structure.** `.modal-header` becomes a flex row: title on the left (wrapped in `DialogPrimitive.Title asChild`), close button on the right (`DialogPrimitive.Close asChild`). The existing test that asserts `aria-labelledby` resolves to an element containing the title text continues to pass because `DialogPrimitive.Title` still owns the title subtree — only the surrounding flex wrapper is new.

### Call-Site Adoption

| # | File | Replaced | Preserved | `closeOnOverlayClick` | `width` |
|---|------|----------|-----------|----------------------|---------|
| 1 | `reservation-modal.tsx` | `createPortal`, `.reservation-modal-overlay`, `.reservation-modal`, `.reservation-modal-header`, close X, scanline div | device badge, duration-selector, form groups with icon-tinted labels; Cancel/Confirm → `footer` | default | `520` |
| 2 | `tag-manager-modal.tsx` | outer overlay, `.tag-modal-container`, `.tag-modal-header`, close X, scanline, inline `handleKeyDown` ESC branch | device badge, tag input row, editable tag pills, `inputRef` autofocus; Cancel/Apply → `footer` | default | `520` |
| 3 | `settings/api-keys.tsx` Create | usage of local `Modal` | `<FieldGroup>` tree; Create/Cancel → `footer` | default | `520` |
| 4 | `settings/api-keys.tsx` Reveal | usage of local `Modal` with `closeOnBackdrop={false}` | warning banner, monospace key display; Copy/"I've saved it" → `footer` | **`false`** | `560` |
| 5 | `settings/teams.tsx` Create | usage of local `Modal` | single `<FieldGroup>`; Create/Cancel → `footer` | default | default (`480`) |

**Title icons preserved.** `title` already accepts `React.ReactNode`, so reservation and tag-manager keep their Calendar/Tag icons inline with the label:

```tsx
title={<><CalendarPlus size={16} /> Reserve Device</>}
```

**Deletions:**
- Local `Modal` component in `settings/api-keys.tsx` (lines 434–484).
- Local `Modal` component in `settings/teams.tsx` (lines 530–577).
- Overlay/container/scanline rules in `reservation-modal.css` and `tag-manager-modal.css`. Form-body styles (`.device-id-badge`, `.duration-option`, `.tag-pill-editable`, etc.) stay.
- Per-modal `.close-btn` and header-chrome CSS rules.

### Styling Contract

`ui/Modal` owns `.modal-overlay`, `.modal`, `.modal-header`, `.modal-body`, `.modal-footer`. Consumer stylesheets must not target those classes. Consumer-specific form content keeps its own class names (`.reservation-form-group`, `.tag-input-section`, etc.) which are scoped inside the body.

The Reveal modal needs no special class — `closeOnOverlayClick={false}` is the only differentiator. The large explicit "I've saved it" button is the deliberate dismissal path.

## Testing

**New unit tests in `web/src/components/ui/modal.test.tsx`:**
1. Close-X button is present in the header and calls `onClose` when clicked.
2. `closeOnOverlayClick={false}` — clicking `.modal-overlay` does NOT call `onClose`, and the `.modal` remains in the DOM.
3. `closeOnOverlayClick={false}` — pressing Escape STILL calls `onClose` (prop does not gate ESC).

Existing 7 tests stay unchanged. TDD order: write the 3 new tests first, confirm they fail, then edit `Modal.tsx`.

**No new tests at the call sites.** The primitive is the trust boundary; call-site tests would duplicate what the primitive's tests already cover.

**Manual verification walkthrough (in a browser on the dev server):**
1. Open a device kebab menu → "Reserve" → confirm focus lands in the first field, ESC closes, overlay click closes, focus returns to the kebab trigger. Title shows calendar icon.
2. Same flow for "Manage Tags".
3. Settings → API Keys → "Create API key" → confirm focus trap and overlay/ESC dismissal.
4. Complete create flow → Reveal modal appears → click the overlay: modal stays. Press ESC: modal closes (acceptable; ESC is deliberate). Click "I've saved it": modal closes normally.
5. Settings → Teams → "New team" → confirm focus/ESC/overlay behavior.

**Bundle budget:** expected delta near zero. Radix Dialog is already in the main bundle from PR #22; this PR removes more hand-rolled DOM than it adds.

## Rollout

Single PR on branch `refactor/web-adopt-modal-primitive`:
1. Primitive changes + 3 new tests first, committed independently.
2. Five call-site adoptions, each committed as its own logical step where practical (primitive polish → reservation → tag-manager → api-keys create → api-keys reveal → teams create).
3. CSS cleanup commits alongside the call sites that trigger them.
4. Manual walkthrough before PR open.

## Risks & Trade-offs

- **Scanline motif disappears** — a visible change to reservation/tag-manager. Acceptable per the "modern and beautiful" direction chosen in brainstorming.
- **Header typography shifts** across existing consumers (CreateKeyModal, CreateTeamModal). Small and consistent; no existing tests assert on it.
- **Entrance transition introduces a 150ms delay before content is interactive.** Radix FocusScope waits for the transition to end before focusing, so tests that use `fireEvent` without flushing a macrotask could regress. Existing tests already use `await new Promise((r) => setTimeout(r, 0))` for similar reasons; the new tests follow the same pattern.
- **`closeOnOverlayClick` is a one-directional switch.** If a future modal needs ESC disabled too, we'll revisit — not today.

## Success Criteria

- `ui/Modal.tsx` exports the same component; `ModalProps` gains `closeOnOverlayClick?: boolean`. All existing consumers compile without changes.
- The five modal instances listed above render through `<Modal>` with no hand-rolled overlay/card DOM. Focus trap, focus restore, ESC, overlay dismissal, and `aria-labelledby` all work in the browser.
- The Reveal modal does not dismiss on overlay click.
- Local `Modal` definitions in `api-keys.tsx` and `teams.tsx` are deleted.
- Scanline and overlay-chrome CSS deleted from `reservation-modal.css` and `tag-manager-modal.css`; form-body CSS untouched.
- `modal.test.tsx` gains 3 passing tests; the original 7 still pass unchanged.
- `npm run build:xenon` produces a bundle within ~2 kB gzipped of baseline.
