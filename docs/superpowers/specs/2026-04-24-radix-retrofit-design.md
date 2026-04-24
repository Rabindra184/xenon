# Radix Primitive Retrofit — Design Spec

**Date:** 2026-04-24
**Status:** Drafted — awaiting user review before implementation planning
**Scope:** `web/src/components/ui/Modal.tsx`, `Popover.tsx`, `Menu.tsx`
**Target branch:** `refactor/web-radix-primitives` (off `main`)

---

## 1. Goals, non-goals, success criteria

### Goal

Fix the accessibility and behavioral gaps in the three hand-rolled UI primitives that do the most work in the dashboard — `Modal`, `Popover`, and `Menu` — by replacing their internals with Radix UI substrate packages, without changing the component APIs their consumers see.

### In scope

- Swap internals of `web/src/components/ui/Modal.tsx` to `@radix-ui/react-dialog`.
- Swap internals of `web/src/components/ui/Popover.tsx` to `@radix-ui/react-popper` + `@radix-ui/react-dismissable-layer`.
- Swap internals of `web/src/components/ui/Menu.tsx` to `@radix-ui/react-roving-focus`.
- Preserve all existing class names and CSS; rewrite a small number of selectors to key off Radix `data-state` / `data-side` / `data-align` attributes where animations or placement styles depend on them.
- Keep `popover.test.tsx` green unmodified.
- Add a new `modal.test.tsx` and a new `menu.test.tsx` covering the new a11y behaviors.
- Extend `popover.test.tsx` with one additional case for layered dismissal.

### Out of scope

- Changing the public prop shape of any primitive. Consumers are not touched.
- Adding new primitives (Tooltip, Select, Combobox, full Dialog-with-trigger, DropdownMenu-with-trigger).
- Bumping React 17 → 18.
- Migrating other primitives (`Button`, `Card`, `Pill`, `StatusDot`, `Table`, `FieldGroup`, `SegmentedControl`, `Toast`, `Input`, `KeyValueRow`, `EmptyState`, `ErrorBoundary`).
- Typeahead ("type `d` to jump to `delete`") in `Menu`.
- Visual regression automation.
- The dirty `temp-appium/*.json` / untracked `xenon.db` tree state. Orthogonal.
- The `chore/adopt-field-group` branch's pending FieldGroup migration targets (`webhook-settings`, `reservation-modal`, `tag-manager-modal`, `maintenance-settings`, `settings.tsx:230`, `session-dashboard.tsx` filter checkboxes, `api-keys.tsx:318`). Tracked separately.
- The pending `session-dashboard` / `ProfilingView` Table-primitive migration. Tracked separately.

### Success criteria

1. Every existing call site of `Modal`, `Popover`, `Menu`, `MenuItem`, `MenuDivider` compiles and renders without source changes.
2. `popover.test.tsx` passes without any edit to its existing three test bodies.
3. New tests added in this spec all pass: focus trap, focus restore, `aria-labelledby`, layered dismissal, arrow-key navigation, `role="menu"` / `role="menuitem"`.
4. `npm run lint` and `npm test` clean.
5. `npm run build:xenon` produces a frontend bundle with no new runtime errors.
6. Manual browser walkthrough of each consumer (see Section 6) confirms no visual or behavioral regressions.
7. Net added bundle weight from Radix substrate packages is ≤ 40 KB gzipped.

---

## 2. Strategy

**Wrapper approach.** The three components keep their current exports and prop shapes byte-identical. Radix lives *inside* them. No call site changes. Rollback is a single-commit revert per primitive.

**Substrate packages, not high-level components.** Radix's `@radix-ui/react-dialog`, `@radix-ui/react-popover`, and `@radix-ui/react-dropdown-menu` all assume a trigger-as-child composition pattern. The existing APIs here are imperative (`open`/`onClose`/`anchorRef`) and cannot be mapped to a trigger-child pattern without breaking every consumer. Radix's substrate packages — the building blocks those higher-level components are themselves built from — accept imperative inputs and compose cleanly.

**Dependencies added:**

| Package | Used by | Approx gzipped |
|---|---|---|
| `@radix-ui/react-dialog` | `Modal` | ~8 KB |
| `@radix-ui/react-popper` | `Popover` | ~12 KB (incl. `@floating-ui/react-dom`) |
| `@radix-ui/react-dismissable-layer` | `Popover` | ~3 KB |
| `@radix-ui/react-portal` | `Popover` | ~1 KB |
| `@radix-ui/react-roving-focus` | `Menu` | ~3 KB |

`@radix-ui/react-portal` is a transitive dep of the other Radix packages but is listed explicitly in `package.json` so the `Popover` implementation can import it directly rather than reaching through a sibling package's internals.

All four packages declare React 17 in their peer-dependency range (`^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc`) as of the latest published versions; verified via `npm view` on 2026-04-24.

---

## 3. Per-primitive design

### 3.1 Modal → `@radix-ui/react-dialog`

**API (unchanged):**

```ts
interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
}
```

**Internal structure:**

```tsx
<Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
  <Dialog.Portal>
    <Dialog.Overlay className="modal-overlay" />
    <Dialog.Content className="modal" style={{ width }}>
      <Dialog.Title asChild><div className="modal-header">{title}</div></Dialog.Title>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

**Gaps closed:**

- Focus trap within dialog on open.
- Focus restore to the opener on close.
- `aria-labelledby` correctly wired to the title id, including when `title` is JSX (current implementation only emits `aria-label` when title is a string).
- Body scroll lock while open. The current comment punts this to the caller.
- Portal rendering into `document.body`, so ancestor `overflow: hidden` / stacking contexts cannot clip the modal.

**Behavior preserved:**

- ESC closes.
- Clicking the overlay closes. Radix's default for `Dialog.Content` is to close on pointerdown-outside, which includes the overlay.
- `role="dialog"`, `aria-modal` on the content node (Radix adds both).

**Known-change to watch:**

- Radix blocks pointer events on body while the dialog is open. Any consumer relying on background interactivity during an open modal breaks. Since the primitive is marked `aria-modal`, such a consumer would already be a bug. Mitigation: grep every call site in Section 6 and confirm none rely on background interaction.

### 3.2 Popover → `@radix-ui/react-popper` + `@radix-ui/react-dismissable-layer`

**API (unchanged):**

```ts
interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
  placement?: 'bottom-start' | 'bottom-end' | 'top-end';
  children: React.ReactNode;
}
```

**Internal structure:**

```tsx
<Popper.Root>
  <Popper.Anchor virtualRef={anchorRef} />
  {open && (
    <Portal>
      <DismissableLayer
        onEscapeKeyDown={onClose}
        onPointerDownOutside={onClose}
      >
        <Popper.Content
          side={placement.startsWith('top') ? 'top' : 'bottom'}
          align={placement.endsWith('end') ? 'end' : 'start'}
          sideOffset={placement.startsWith('top') ? 8 : 4}
          className={`popover popover-${placement}`}
          role="dialog"
        >
          {children}
        </Popper.Content>
      </DismissableLayer>
    </Portal>
  )}
</Popper.Root>
```

`Portal` is `@radix-ui/react-portal`.

**Gaps closed:**

- Collision detection — flip to the other side and shift within viewport when the content would clip (currently the popover overflows).
- Portaling to `document.body` — no more z-index / `overflow: hidden` clipping surprises.
- Layered dismissal — when multiple popovers are open, ESC closes only the top one (currently closes all, since each listens on `document`).

**Behavior preserved:**

- Imperative `anchorRef` input (via `Popper.Anchor virtualRef`).
- ESC closes.
- Outside-pointerdown closes, with anchor and content treated as "inside".
- Three placement values render to the same visual positions. `placement="bottom-start"` → `side=bottom, align=start`; `bottom-end` → `side=bottom, align=end`; `top-end` → `side=top, align=end` with `sideOffset=8` (matches current `r.top - 8`).
- `role="dialog"`.

**CSS impact:**

- `popover.css` placement selectors (`.popover-bottom-start`, `.popover-bottom-end`, `.popover-top-end`) remain and continue to drive corner-radius and border-edge tweaks. Positioning itself moves to Radix Popper's CSS-transform output. If the current CSS has `top:`/`left:` overrides that fight Radix's transform, those rules get deleted.
- Any enter/exit transition keyed off mount is rewritten to key off `[data-state="open"]` / `[data-state="closed"]` on the content element.

### 3.3 Menu → `@radix-ui/react-roving-focus`

**API (unchanged):**

```ts
interface MenuItemProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}
// exports: Menu, MenuItem, MenuDivider
```

**Internal structure:**

```tsx
<RovingFocusGroup.Root
  orientation="vertical"
  loop
  asChild
>
  <div className="menu" role="menu">{children}</div>
</RovingFocusGroup.Root>
```

Each `MenuItem` wraps its `<button>` in a `RovingFocusGroup.Item`, passes `focusable={!disabled}`, and adds `role="menuitem"`. Which item holds the initial tab stop is left to the implementation plan — the expected behavior is "first non-disabled item" per standard menu semantics, and the exact prop(s) on `RovingFocusGroup.Root` / `RovingFocusGroup.Item` that achieve this are an implementation detail to verify against the current Radix version at plan-execution time.

**Gaps closed:**

- `ArrowDown` / `ArrowUp` move focus between items.
- `Home` / `End` jump to first / last.
- Roving tabindex — only the currently focused item is tabbable, so `Shift-Tab` exits cleanly to the element before the menu.
- `role="menu"` on the container and `role="menuitem"` on each item.
- Disabled items are skipped on arrow navigation.

**Behavior preserved:**

- All visual styling and class names.
- `onClick` semantics on items — Enter and Space still activate via the underlying `<button>`.

**Non-goal for this retrofit:** typeahead (type a letter to jump). Not included; can be a follow-up.

---

## 4. Styling contract

Radix substrate packages render unstyled — they expose `data-*` attributes as hooks, and the consumer brings CSS.

- **Class names preserved verbatim:** `.modal-overlay`, `.modal`, `.modal-header`, `.modal-body`, `.modal-footer`, `.popover`, `.popover-bottom-start`, `.popover-bottom-end`, `.popover-top-end`, `.menu`, `.menu-item`, `.menu-item-danger`, `.menu-item-icon`, `.menu-item-label`, `.menu-divider`.
- **Tokens:** `modal.css` and `popover.css` are not rewritten. Only the rules that conflict with Radix-controlled positioning or that need to animate on `data-state` are edited.
- **Transitions:** Rewrite to key off `[data-state="open"]` / `[data-state="closed"]` instead of the mount/unmount pattern. Radix keeps the content element mounted briefly to allow exit animations.
- **Placement-driven CSS:** Existing placement class names remain. Radix's `data-side` / `data-align` attributes are used only if new styling hooks become necessary — not in this scope.
- **`asChild` usage:** Used wherever the existing class needs to land on the semantic DOM element Radix would otherwise wrap. Prevents wrapper-div pollution.

---

## 5. Testing

### 5.1 Existing tests

`web/src/components/ui/popover.test.tsx` — all three current cases (renders-when-open, closes-on-Escape, closes-on-outside-click) must pass with zero edits to the assertions. The only permitted edit is adding new `describe`/`it` blocks for the new layered-dismissal case.

### 5.2 New tests

`web/src/components/ui/modal.test.tsx` (new):

1. Renders children when `open=true`.
2. Does not render when `open=false`.
3. Pressing ESC fires `onClose`.
4. Clicking the overlay fires `onClose`.
5. Clicking inside the content does not fire `onClose`.
6. On open, focus moves inside the dialog (assertion: `document.activeElement` is inside the content).
7. On close, focus returns to the opener element.
8. `aria-labelledby` on the content resolves to the title element's id, including when `title` is a JSX fragment (not just a string).

`web/src/components/ui/menu.test.tsx` (new):

1. `role="menu"` on the container.
2. `role="menuitem"` on each `MenuItem`.
3. ArrowDown from the first item moves focus to the second.
4. ArrowUp from the first item loops to the last.
5. Home / End jump to first / last.
6. Disabled items are skipped on arrow navigation.
7. Enter on a focused item invokes its `onClick`.

`web/src/components/ui/popover.test.tsx` (extended): a new `describe` block asserting that when two popovers are open and ESC is pressed, only the top one closes.

### 5.3 Test style

Match the existing `popover.test.tsx` conventions: Vitest + `@testing-library/react` + `fireEvent`, a `Harness` wrapper for state, no async unless truly needed.

---

## 6. Rollout & verification

### 6.1 Branch and commits

- Branch: `refactor/web-radix-primitives`, cut from current `origin/main` (not from `chore/adopt-field-group`).
- Commit sequence:
  1. `chore(web): add radix substrate deps` — package.json + lockfile only.
  2. `refactor(web): route Modal through radix-dialog` — `Modal.tsx` + `modal.css` tweaks + `modal.test.tsx`.
  3. `refactor(web): route Popover through radix-popper` — `Popover.tsx` + `popover.css` tweaks + extended `popover.test.tsx`.
  4. `refactor(web): route Menu through radix-roving-focus` — `Menu.tsx` + `menu.test.tsx`.

Each refactor commit is independently revertable.

### 6.2 Consumer walkthrough checklist

Manual browser walkthrough, per CLAUDE.md's "UI changes require using the feature in a browser" rule. Every consumer of the three primitives gets opened, driven, and keyboard-exercised (Tab, Shift-Tab, Escape, arrow keys):

- **Modal consumers:** `settings/api-keys.tsx` (create-key), `settings/teams.tsx` (create-team), `reservation-modal.tsx`, `tag-manager-modal.tsx`, any other call site surfaced by `grep -rn "from.*ui/Modal" web/src`.
- **Popover consumers:** `header.tsx`, `session-dashboard.tsx`, `omni-inspector.tsx`, `device-control.tsx`, `omni-inspector/PomWorkbench.tsx`, and any other call site surfaced by `grep -rn "from.*ui/Popover" web/src`.
- **Menu consumers:** same files — `Menu` is always rendered inside `Popover`.

A final consumer list is produced as the first step of the implementation plan (grep once, freeze it, walk through in order).

### 6.3 Verification gates (all must pass before PR open)

- `npm run lint` clean.
- `npm test` passes (includes new a11y tests).
- `npm run build:xenon` produces a bundle.
- Every consumer in 6.2 opened and exercised in the browser.
- Bundle size delta confirmed ≤ 40 KB gzipped. Measured by running `npm run build:xenon` on `main` and on the retrofit branch and comparing the gzipped size Vite reports for the main JS chunk.

### 6.4 Rollback plan

If any regression surfaces post-merge, revert the three refactor commits individually in reverse order (`Menu` → `Popover` → `Modal`). The deps commit can stay; orphaned deps do no harm until the next cleanup pass.

---

## 7. Open questions

None at spec-approval time. Typeahead for `Menu` and adoption of Radix's higher-level `Dialog` / `Popover` / `DropdownMenu` (which would require consumer-level API changes) are explicit non-goals and tracked as potential follow-up PRs, not open questions on this spec.
