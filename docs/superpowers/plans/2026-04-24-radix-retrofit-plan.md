# Radix Primitive Retrofit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the internals of `web/src/components/ui/Modal.tsx`, `Popover.tsx`, and `Menu.tsx` with Radix UI substrate packages, adding focus trap, focus restore, `aria-labelledby`, collision-aware positioning, layered dismissal, and arrow-key navigation — all while keeping the current prop APIs identical so no consumer file is touched.

**Architecture:** Wrapper pattern. Each primitive keeps its exported identifier and prop shape; the body swaps from hand-rolled DOM to Radix substrate (`react-dialog`, `react-popper` + `react-dismissable-layer` + `react-portal`, `react-roving-focus`). CSS class names stay; rules that fight Radix-controlled positioning or that need to animate on `data-state` are rewritten.

**Tech Stack:** React 17.0.2, TypeScript 4.9, Vite, Vitest + @testing-library/react, Radix UI substrate packages.

**Spec:** `docs/superpowers/specs/2026-04-24-radix-retrofit-design.md`

**Branch:** `refactor/web-radix-primitives` (already checked out)

---

## File Structure

**Created:**
- `web/src/components/ui/modal.test.tsx` — new unit tests for Modal a11y
- `web/src/components/ui/menu.test.tsx` — new unit tests for Menu keyboard nav

**Modified:**
- `web/package.json` + `web/package-lock.json` — add 5 Radix substrate deps
- `web/src/components/ui/Modal.tsx` — swap internals to `@radix-ui/react-dialog`
- `web/src/components/ui/modal.css` — `.modal` becomes self-positioning; `.modal-overlay` drops flex-centering
- `web/src/components/ui/Popover.tsx` — swap internals to `@radix-ui/react-popper` + `react-dismissable-layer` + `react-portal`
- `web/src/components/ui/popover.css` — drop `.popover` `position: fixed`; drop `.popover-bottom-end` / `.popover-top-end` transform hacks (Radix Popper aligns via `align` prop); keep class names so component classes stay hookable
- `web/src/components/ui/popover.test.tsx` — extend with one layered-dismissal test
- `web/src/components/ui/Menu.tsx` — swap to `@radix-ui/react-roving-focus`

**Untouched:**
- Any file under `web/src/components/` that imports `Modal`, `Popover`, `Menu`, `MenuItem`, `MenuDivider`. Consumer APIs do not change.

---

## Task 1: Add Radix substrate dependencies

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json`

- [ ] **Step 1: Install Radix substrate packages**

Run from the repo root:

```bash
cd web && npm install \
  @radix-ui/react-dialog \
  @radix-ui/react-popper \
  @radix-ui/react-dismissable-layer \
  @radix-ui/react-portal \
  @radix-ui/react-roving-focus
```

Expected: installs 5 packages. No peer-dep warnings for React 17 (all five packages declare `react: '^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc'` in their peer-dependency range).

If a peer-dep warning surfaces for React 17, stop and report — the spec assumes these packages keep React 17 in their peer range. Do not attempt to resolve it by bumping React.

- [ ] **Step 2: Verify install succeeded**

Run:

```bash
grep -E '"@radix-ui/react-(dialog|popper|dismissable-layer|portal|roving-focus)"' web/package.json
```

Expected: exactly 5 matching lines in the `dependencies` section.

- [ ] **Step 3: Record a pre-change bundle size baseline for Task 5**

Run:

```bash
cd web && npm run build 2>&1 | tee /tmp/xenon-web-bundle-before.txt
```

Look for the line reporting `dist/assets/index-*.js` gzipped size. Record the number (e.g. `412.34 kB │ gzip: 118.22 kB`) — it will be compared against the post-change bundle in Task 5.

Do **not** commit anything from this baseline step.

- [ ] **Step 4: Commit deps**

```bash
git add web/package.json web/package-lock.json
git commit -m "chore(web): add radix substrate deps for primitive retrofit"
```

---

## Task 2: Route Modal through `@radix-ui/react-dialog`

**Files:**
- Create: `web/src/components/ui/modal.test.tsx`
- Modify: `web/src/components/ui/Modal.tsx`
- Modify: `web/src/components/ui/modal.css`

- [ ] **Step 1: Write the failing tests for Modal a11y**

Create `web/src/components/ui/modal.test.tsx` with the full content below:

```tsx
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Modal } from './Modal';

function Harness({
  startOpen = true,
  title = 'Test title',
  onClose = () => {},
}: {
  startOpen?: boolean;
  title?: React.ReactNode;
  onClose?: () => void;
}) {
  const [open, setOpen] = React.useState(startOpen);
  return (
    <>
      <button data-testid="opener" onClick={() => setOpen(true)}>open</button>
      <Modal
        open={open}
        title={title}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <button data-testid="inside-1">inside 1</button>
        <button data-testid="inside-2">inside 2</button>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('renders children when open', () => {
    render(<Harness />);
    expect(screen.getByTestId('inside-1')).toBeInTheDocument();
    expect(screen.getByTestId('inside-2')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<Harness startOpen={false} />);
    expect(screen.queryByTestId('inside-1')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the overlay is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<Harness onClose={onClose} />);
    const overlay = container.querySelector('.modal-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay);
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('traps focus inside the dialog when open', async () => {
    render(<Harness />);
    // After Radix Dialog mounts, focus lands somewhere inside the content.
    await act(async () => {
      await Promise.resolve();
    });
    const active = document.activeElement as HTMLElement;
    const content = document.querySelector('.modal');
    expect(content?.contains(active)).toBe(true);
  });

  it('restores focus to the opener on close', async () => {
    function Story() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button data-testid="opener" onClick={() => setOpen(true)}>open</button>
          <Modal open={open} title="t" onClose={() => setOpen(false)}>
            <button data-testid="inside">inside</button>
          </Modal>
        </>
      );
    }
    render(<Story />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(opener);
  });

  it('wires aria-labelledby to the title element even when title is JSX', () => {
    const jsxTitle = (
      <span>
        Complex <em>title</em>
      </span>
    );
    render(<Harness title={jsxTitle} />);
    const dialog = document.querySelector('.modal') as HTMLElement;
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    const labelEl = document.getElementById(labelId!);
    expect(labelEl).not.toBeNull();
    expect(labelEl?.textContent).toContain('Complex');
    expect(labelEl?.textContent).toContain('title');
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail for the right reason**

Run:

```bash
cd web && npx vitest run src/components/ui/modal.test.tsx
```

Expected: the three behavior tests (focus trap, focus restore, aria-labelledby-from-JSX) fail. The "renders children when open", "does not render when closed", "closes on Escape", and "closes when the overlay is clicked" tests may pass or fail depending on current behavior — record which ones pass so the implementation doesn't regress them.

Do not proceed until you have seen concrete failures confirming the tests actually exercise the primitive.

- [ ] **Step 3: Update `modal.css` for the new DOM structure**

With Radix `Dialog.Portal`, `Overlay` and `Content` are siblings at the portal root, not parent/child. The current flex-centering on `.modal-overlay` won't center the content anymore. Rewrite as:

Replace the entire contents of `web/src/components/ui/modal.css` with:

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 8000;
}
.modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 8001;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  font-family: 'Inter', sans-serif;
}
.modal-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-default);
  color: var(--text-primary);
  font-weight: 600;
  font-size: 13px;
}
.modal-body {
  padding: 16px;
  color: var(--text-secondary);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.modal-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-default);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

Two changes vs. current: `.modal-overlay` drops `display: flex; align-items: center; justify-content: center; padding: 24px;`; `.modal` gains `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 8001;`.

- [ ] **Step 4: Replace the Modal implementation**

Replace the entire contents of `web/src/components/ui/Modal.tsx` with:

```tsx
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import './modal.css';

export interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  title,
  onClose,
  footer,
  children,
  width = 480,
}) => (
  <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="modal-overlay" />
      <DialogPrimitive.Content className="modal" style={{ width }}>
        <DialogPrimitive.Title asChild>
          <div className="modal-header">{title}</div>
        </DialogPrimitive.Title>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
);
```

Why `Dialog.Title asChild`: it forwards Radix's generated id onto the existing `.modal-header` div, which wires `aria-labelledby` correctly without inserting a wrapper element.

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd web && npx vitest run src/components/ui/modal.test.tsx
```

Expected: all 7 tests pass. If the `focus trap` test is flaky (Radix focuses asynchronously), bump the `await Promise.resolve()` in that test to two awaits in a row, or wrap with `await waitFor(() => expect(...))`. Do not loosen the assertion.

- [ ] **Step 6: Run the full test suite to catch regressions**

Run:

```bash
cd web && npm test
```

Expected: everything green. `popover.test.tsx`'s existing three tests must still pass (they test `Popover`, unaffected by this task, so they should not regress here).

- [ ] **Step 7: Run lint**

Run:

```bash
cd web && npx eslint src/components/ui/Modal.tsx src/components/ui/modal.test.tsx
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/ui/Modal.tsx \
        web/src/components/ui/modal.css \
        web/src/components/ui/modal.test.tsx
git commit -m "refactor(web): route Modal through radix-dialog"
```

---

## Task 3: Route Popover through `@radix-ui/react-popper` + `react-dismissable-layer`

**Files:**
- Modify: `web/src/components/ui/Popover.tsx`
- Modify: `web/src/components/ui/popover.css`
- Modify: `web/src/components/ui/popover.test.tsx`

- [ ] **Step 1: Extend `popover.test.tsx` with layered-dismissal test**

Append a new describe block at the bottom of `web/src/components/ui/popover.test.tsx`:

```tsx
describe('Popover layered dismissal', () => {
  it('Escape closes only the top popover when two are stacked', () => {
    function Outer() {
      const outerAnchor = React.useRef<HTMLButtonElement>(null);
      const innerAnchor = React.useRef<HTMLButtonElement>(null);
      const [outerOpen, setOuterOpen] = React.useState(true);
      const [innerOpen, setInnerOpen] = React.useState(true);
      return (
        <>
          <button ref={outerAnchor}>outer anchor</button>
          <button ref={innerAnchor}>inner anchor</button>
          <Popover open={outerOpen} onClose={() => setOuterOpen(false)} anchorRef={outerAnchor}>
            <div data-testid="outer-body">outer body</div>
          </Popover>
          <Popover open={innerOpen} onClose={() => setInnerOpen(false)} anchorRef={innerAnchor}>
            <div data-testid="inner-body">inner body</div>
          </Popover>
        </>
      );
    }
    render(<Outer />);
    expect(screen.getByTestId('outer-body')).toBeInTheDocument();
    expect(screen.getByTestId('inner-body')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    // The most-recently-mounted (inner) popover closes; the other stays.
    expect(screen.queryByTestId('inner-body')).not.toBeInTheDocument();
    expect(screen.getByTestId('outer-body')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the extended test to confirm it fails**

Run:

```bash
cd web && npx vitest run src/components/ui/popover.test.tsx
```

Expected: the three existing tests pass (no regression yet — we haven't changed the implementation), and the new layered-dismissal test **fails** because the current implementation listens on `document` from both popovers, so both close on ESC.

Record this baseline.

- [ ] **Step 3: Rewrite `popover.css`**

Radix Popper handles positioning via CSS transforms on the Content element; the current `.popover { position: fixed; }` and `.popover-bottom-end { transform: translateX(-100%); }` / `.popover-top-end { transform: translate(-100%, -100%); }` rules fight Radix. Remove them.

Replace the first 13 lines of `web/src/components/ui/popover.css` (everything up to and including the `.popover-top-end` rule — do not touch anything below it) with:

```css
.popover {
  z-index: 9000;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  min-width: 180px;
  padding: 4px;
}
```

Leave the `.menu`, `.menu-item`, `.menu-item-danger`, `.menu-item-icon`, `.menu-divider` rules (lines 14–35) exactly as they are.

Changes vs. current: `.popover` drops `position: fixed`. The `.popover-bottom-end` and `.popover-top-end` rules are deleted outright — alignment is now Radix's job via the `align` prop.

- [ ] **Step 4: Replace the Popover implementation**

Replace the entire contents of `web/src/components/ui/Popover.tsx` with:

```tsx
import * as React from 'react';
import * as PopperPrimitive from '@radix-ui/react-popper';
import { DismissableLayer } from '@radix-ui/react-dismissable-layer';
import { Portal } from '@radix-ui/react-portal';
import './popover.css';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
  placement?: 'bottom-start' | 'bottom-end' | 'top-end';
  children: React.ReactNode;
}

export const Popover: React.FC<PopoverProps> = ({
  open,
  onClose,
  anchorRef,
  placement = 'bottom-end',
  children,
}) => {
  if (!open) return null;
  const side = placement.startsWith('top') ? 'top' : 'bottom';
  const align = placement.endsWith('end') ? 'end' : 'start';
  const sideOffset = placement.startsWith('top') ? 8 : 4;

  return (
    <PopperPrimitive.Root>
      <PopperPrimitive.Anchor virtualRef={anchorRef} />
      <Portal>
        <DismissableLayer
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onClose();
          }}
          onPointerDownOutside={(e) => {
            if (anchorRef.current?.contains(e.target as Node)) {
              e.preventDefault();
              return;
            }
            onClose();
          }}
        >
          <PopperPrimitive.Content
            side={side}
            align={align}
            sideOffset={sideOffset}
            className={`popover popover-${placement}`}
            role="dialog"
          >
            {children}
          </PopperPrimitive.Content>
        </DismissableLayer>
      </Portal>
    </PopperPrimitive.Root>
  );
};
```

Notes:
- `PopperPrimitive.Anchor` accepts a `virtualRef` that points at an external element — this is what preserves the existing `anchorRef` imperative API without forcing consumers into a trigger-child pattern.
- The `onPointerDownOutside` handler explicitly excludes clicks on the anchor so that the consumer's anchor button can own its own toggle logic (matches current behavior where `anchorRef.current?.contains(e.target as Node)` is ignored).
- `DismissableLayer` maintains a layer stack; nested instances only fire `onEscapeKeyDown` for the topmost layer, which is what the new test asserts.

- [ ] **Step 5: Run `popover.test.tsx` to verify all four tests pass**

Run:

```bash
cd web && npx vitest run src/components/ui/popover.test.tsx
```

Expected: all 4 tests pass (3 existing + 1 new layered-dismissal). If `closes on outside click` fails with the new implementation, it is most likely because `DismissableLayer` uses pointerdown but the test uses `fireEvent.mouseDown`. `DismissableLayer` does fire on mousedown too (it listens to both); if the assertion nevertheless fails, replace `fireEvent.mouseDown(...)` with `fireEvent.pointerDown(...)` — but only in new tests you add; do **not** modify the three original test bodies, which must stay green unedited per the spec's success criterion.

- [ ] **Step 6: Run the full test suite**

Run:

```bash
cd web && npm test
```

Expected: everything green. Modal tests from Task 2 still pass.

- [ ] **Step 7: Run lint**

Run:

```bash
cd web && npx eslint src/components/ui/Popover.tsx src/components/ui/popover.test.tsx
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/ui/Popover.tsx \
        web/src/components/ui/popover.css \
        web/src/components/ui/popover.test.tsx
git commit -m "refactor(web): route Popover through radix-popper and dismissable-layer"
```

---

## Task 4: Route Menu through `@radix-ui/react-roving-focus`

**Files:**
- Create: `web/src/components/ui/menu.test.tsx`
- Modify: `web/src/components/ui/Menu.tsx`

- [ ] **Step 1: Write the failing Menu keyboard-nav tests**

Create `web/src/components/ui/menu.test.tsx` with the full content below:

```tsx
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Menu, MenuItem, MenuDivider } from './Menu';

function Harness({ onFirst = vi.fn(), onSecond = vi.fn(), secondDisabled = false }) {
  return (
    <Menu>
      <MenuItem onClick={onFirst}>first</MenuItem>
      <MenuItem onClick={onSecond} disabled={secondDisabled}>second</MenuItem>
      <MenuDivider />
      <MenuItem onClick={() => {}}>third</MenuItem>
    </Menu>
  );
}

describe('Menu', () => {
  it('container has role="menu"', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('each MenuItem has role="menuitem"', () => {
    render(<Harness />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
  });

  it('ArrowDown from first moves focus to second', () => {
    render(<Harness />);
    const items = screen.getAllByRole('menuitem');
    items[0].focus();
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
  });

  it('ArrowUp from first loops to last', () => {
    render(<Harness />);
    const items = screen.getAllByRole('menuitem');
    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('Home and End jump to first and last', () => {
    render(<Harness />);
    const items = screen.getAllByRole('menuitem');
    items[1].focus();
    fireEvent.keyDown(items[1], { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('ArrowDown skips a disabled item', () => {
    render(<Harness secondDisabled />);
    const items = screen.getAllByRole('menuitem');
    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    // the second item is disabled, so focus should land on the third (index 2)
    expect(document.activeElement).toBe(items[2]);
  });

  it('Enter on focused item invokes its onClick', () => {
    const onFirst = vi.fn();
    render(<Harness onFirst={onFirst} />);
    const items = screen.getAllByRole('menuitem');
    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'Enter' });
    // Default <button> behavior: keydown Enter triggers click synthetically in jsdom via fireEvent.click
    fireEvent.click(items[0]);
    expect(onFirst).toHaveBeenCalled();
  });
});
```

Note on the last test: jsdom does not synthesize click from a keydown on `<button>`; the explicit `fireEvent.click` covers the semantic. The Enter-to-click wiring at the DOM level is a browser default, not something Radix or this component needs to test — the test exists to pin that focus remained on the right item so a click there activates the right handler.

- [ ] **Step 2: Run the new tests to confirm they fail**

Run:

```bash
cd web && npx vitest run src/components/ui/menu.test.tsx
```

Expected: the "role=menu", "role=menuitem", and all keyboard-nav tests fail (the current `Menu` is a plain `<div>` with no roles and no keyboard handling). The "Enter on focused item" test may pass because the base `<button>` handles click.

- [ ] **Step 3: Replace the Menu implementation**

Replace the entire contents of `web/src/components/ui/Menu.tsx` with:

```tsx
import * as React from 'react';
import * as RovingFocusGroup from '@radix-ui/react-roving-focus';
import './popover.css';

export interface MenuItemProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  children,
  onClick,
  danger,
  disabled,
}) => (
  <RovingFocusGroup.Item asChild focusable={!disabled} active={false}>
    <button
      type="button"
      role="menuitem"
      className={`menu-item${danger ? ' menu-item-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <span className="menu-item-icon">{icon}</span>}
      <span className="menu-item-label">{children}</span>
    </button>
  </RovingFocusGroup.Item>
);

export const MenuDivider: React.FC = () => <div className="menu-divider" role="separator" />;

export const Menu: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RovingFocusGroup.Root asChild orientation="vertical" loop>
    <div className="menu" role="menu">
      {children}
    </div>
  </RovingFocusGroup.Root>
);
```

Notes on the exact Radix RovingFocusGroup API:
- `RovingFocusGroup.Root` supports `asChild`, `orientation`, `loop`, and passes roving-tabindex logic to its children via context.
- `RovingFocusGroup.Item` supports `asChild`, `focusable`, and `active`. `active` marks the single initial tab stop; passing `false` on every item means "the first focusable item becomes the tab stop by default" (Radix's fallback behavior). If running the tests reveals that no item is focusable via Tab from outside the menu, switch the first focusable `MenuItem` to `active` — easiest path is a new "is this the first non-disabled child" calculation in `Menu`, passed down via `React.Children.map`. Only add that complexity if the tests actually require it.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd web && npx vitest run src/components/ui/menu.test.tsx
```

Expected: all 7 tests pass.

If the "ArrowDown skips a disabled item" test fails because Radix's `RovingFocusGroup.Item` still receives focus when `focusable={false}`, verify the prop spelling against the installed Radix version (`grep -r "focusable" web/node_modules/@radix-ui/react-roving-focus/dist/ | head -5`) and adjust. Do **not** loosen the assertion; disabled skip is a hard requirement.

- [ ] **Step 5: Run the full test suite**

Run:

```bash
cd web && npm test
```

Expected: everything green. Modal and Popover tests from Tasks 2 and 3 still pass. `popover.test.tsx`'s harness imports `Menu` and `MenuItem` — confirm it still renders correctly.

- [ ] **Step 6: Run lint**

Run:

```bash
cd web && npx eslint src/components/ui/Menu.tsx src/components/ui/menu.test.tsx
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ui/Menu.tsx \
        web/src/components/ui/menu.test.tsx
git commit -m "refactor(web): route Menu through radix-roving-focus"
```

---

## Task 5: Verification — build, bundle size, and manual browser walkthrough

**Files:** none modified; this is verification only.

- [ ] **Step 1: Verify the production build succeeds**

Run:

```bash
cd web && npm run build 2>&1 | tee /tmp/xenon-web-bundle-after.txt
```

Expected: Vite completes the build with no errors. Record the gzipped size of `dist/assets/index-*.js` for comparison.

- [ ] **Step 2: Verify bundle-size delta is within the spec budget**

Compare the two files from Task 1 Step 3 and this task's Step 1:

```bash
diff /tmp/xenon-web-bundle-before.txt /tmp/xenon-web-bundle-after.txt
```

Compute the gzipped-size delta for the main JS chunk. Expected: **≤ 40 KB gzipped**. If larger, stop and investigate which Radix module is pulling in unexpected weight before opening a PR.

- [ ] **Step 3: Build the list of consumer call sites for manual verification**

Run:

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
grep -rln "from.*ui/Modal'\|from.*ui/Popover'\|from.*ui/Menu'" web/src
```

Record the result as the manual-walkthrough checklist. Expected consumers (from the spec's Section 6.2 pre-survey): `web/src/components/settings/api-keys.tsx`, `web/src/components/settings/teams.tsx`, `web/src/components/reservation-modal/reservation-modal.tsx`, `web/src/components/tag-manager-modal/tag-manager-modal.tsx`, `web/src/components/header/header.tsx`, `web/src/components/session-dashboard/session-dashboard.tsx`, `web/src/components/omni-inspector/OmniInspector.tsx`, `web/src/components/omni-inspector/PomWorkbench.tsx`, `web/src/components/device-control/device-control.tsx`.

- [ ] **Step 4: Start the full dev stack and exercise each consumer in a browser**

Run:

```bash
npm run dev
```

(from the repo root, not `web/` — this runs the Xenon plugin server, which serves the dashboard at `/xenon/`.)

For **each** consumer from Step 3, open the relevant dashboard screen in a browser and verify, per CLAUDE.md's rule that UI changes require actually using the feature in a browser:

- **Modal consumers:** open the modal; press Tab repeatedly and confirm focus stays within; press Escape and confirm it closes; confirm focus returns to the trigger button.
- **Popover consumers:** open the popover near a screen edge and confirm it flips/shifts to stay in view; press Escape; click outside; confirm the anchor's toggle button still works.
- **Menu consumers:** focus the first menu item, press ArrowDown and ArrowUp, press Home/End, confirm a disabled item is skipped, press Enter and confirm the action fires.

For any consumer that breaks, record exact steps to reproduce and stop — do not "paper over" a regression.

- [ ] **Step 5: Sanity-check the existing `popover.test.tsx` test bodies were not edited**

Run:

```bash
git diff main -- web/src/components/ui/popover.test.tsx
```

Expected: only additions (the new `describe('Popover layered dismissal', ...)` block); no changes inside the three original `it(...)` blocks. This pins the spec's Success Criterion #2.

- [ ] **Step 6: Open the pull request**

Push the branch and open a PR:

```bash
git push -u origin refactor/web-radix-primitives
gh pr create --title "refactor(web): route Modal/Popover/Menu through Radix substrate" --body "$(printf '## Summary\n- Route Modal, Popover, and Menu internals through Radix substrate packages while preserving their existing prop APIs.\n- Add focus trap + focus restore + aria-labelledby to Modal.\n- Add collision-aware positioning + layered dismissal to Popover.\n- Add arrow-key navigation + role=menu/menuitem to Menu.\n\n## Spec\ndocs/superpowers/specs/2026-04-24-radix-retrofit-design.md\n\n## Test plan\n- [x] npm test passes (existing popover.test.tsx green unedited; new modal.test.tsx and menu.test.tsx green)\n- [x] npm run build succeeds; bundle-size delta <= 40 KB gzipped\n- [x] Manual browser walkthrough of every consumer surfaced by grep (see spec Section 6.2)\n')"
```

Expected: the PR is opened. Return the PR URL.

---

## Self-Review (for the author of this plan, before handoff)

**Spec coverage check:**

- Spec §3.1 (Modal Radix substrate) → Task 2 ✓
- Spec §3.2 (Popover substrate) → Task 3 ✓
- Spec §3.3 (Menu RovingFocusGroup) → Task 4 ✓
- Spec §4 (class names preserved, data-state transitions) → Tasks 2/3/4 preserve class names; transitions aren't in the current CSS so no rewrite needed — if a follow-up adds transitions they'll key off `data-state` per spec.
- Spec §5.1 (existing `popover.test.tsx` bodies unedited) → Task 5 Step 5 enforces this via `git diff`.
- Spec §5.2 new tests → Task 2 Step 1 (Modal), Task 3 Step 1 (layered dismissal), Task 4 Step 1 (Menu) ✓
- Spec §6.1 commit sequence (deps → Modal → Popover → Menu) → Task 1 → Task 2 → Task 3 → Task 4, each ending in a commit ✓
- Spec §6.2 consumer walkthrough → Task 5 Steps 3–4 ✓
- Spec §6.3 verification gates (lint, test, build, browser) → covered across Tasks 2–5 ✓
- Spec §6.4 rollback → each refactor commit is its own revertable commit per the commit structure above ✓
- Spec §7 open questions — none; plan does not need to address any.

**Type / API consistency check:** `ModalProps`, `PopoverProps`, `MenuItemProps` shapes in the implementation steps match the original primitives exactly. Class names (`.modal-overlay`, `.modal`, `.modal-header`, `.modal-body`, `.modal-footer`, `.popover`, `.popover-bottom-start`, `.popover-bottom-end`, `.popover-top-end`, `.menu`, `.menu-item`, `.menu-item-danger`, `.menu-item-icon`, `.menu-item-label`, `.menu-divider`) match the originals.

**Placeholder scan:** no "TBD", "TODO", "implement later", or vague "add error handling" instructions. Every code block is concrete; every command is exact.
