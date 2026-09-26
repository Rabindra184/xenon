# Devices filter bar: status tabs plus filter menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Platform and Type segmented controls on the Devices page with filter menus. The second row becomes, left to right: search (focused by `/`), the two menus, Clear, a result count and an icon Refresh.

**Architecture:** This builds on branch `feat/devices-filters` (PR #321). `deviceFilters.ts`, the link round trip, the counts and the search are reused unchanged.

New pieces:
- `MenuItem` gains an optional single-choice mode.
- A new `FilterMenu` component combines the trigger, a chip and a Popover with a Menu.
- The page wires them in and adds the `/` shortcut.

**Tech Stack:** React 17, Radix (Popper, DismissableLayer, RovingFocus) via `ui/Popover` and `ui/Menu`, lucide-react, Vitest + Testing Library, Playwright.

Spec: `docs/superpowers/specs/2026-09-26-devices-filters-design.md` ("The toolbar", revised)

## Global Constraints

- Row 2 order: search, Platform, Type, Clear (only while filtered), then on the right the result count and the icon Refresh.
- Trigger names: unset "Platform" / "Type"; set "Platform: iOS". The × button is named "Clear platform filter" / "Clear type filter".
- Menu labels:
  - Platform: "Any platform", "Android", "iOS", and "tvOS" (only when `hasTvos(devices)` or `filters.platform === 'tvos'`).
  - Type: "Any type", "Real devices", and "Virtual" with the note "Simulators and emulators".
- Result count: `resultLabel(shown, total)` gives "N devices" (or "1 device") when `shown === total`, and "shown of total devices" otherwise. It is `aria-live="polite"`.
- Refresh: `Button variant="secondary" size="icon"`, `aria-label="Refresh devices"`, `title="Refresh"`.
- `/` focuses search unless focus is in an input, textarea, select or contenteditable, Ctrl, Alt or Cmd is held, or a device is open (`params.udid`).
- No raw hex or `rgba()` literals. Use the tokens `--rgb-accent`, `--color-accent`, `--color-focus-ring`, `--text-muted`, `--text-dim`, `--border-strong`.
- Never run `eslint --fix` on whole files. Compare lint counts with main. Stage explicit paths.

---

### Task 1: `isFiltered` and `resultLabel`

**Files:**
- Modify: `web/src/components/device-explorer/deviceFilters.ts`
- Test: `web/src/components/device-explorer/deviceFilters.test.ts`

**Interfaces:**
- Produces: `isFiltered(f: DeviceFilters): boolean`, `resultLabel(shown: number, total: number): string`.

- [ ] **Step 1: Write the failing tests.** Add `isFiltered` and `resultLabel` to the import and append:

```ts
describe('isFiltered', () => {
  it('is false with nothing filtered, or only a blank search', () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered(f({ q: '   ' }))).toBe(false);
  });

  it('is true for each filter on its own', () => {
    for (const x of [f({ status: 'ready' }), f({ platform: 'ios' }), f({ type: 'virtual' }), f({ q: 'galaxy' })]) {
      expect(isFiltered(x)).toBe(true);
    }
  });
});

describe('resultLabel', () => {
  it('says how many devices show', () => {
    expect(resultLabel(5, 5)).toBe('5 devices');
    expect(resultLabel(1, 1)).toBe('1 device');
    expect(resultLabel(2, 5)).toBe('2 of 5 devices');
    expect(resultLabel(0, 5)).toBe('0 of 5 devices');
  });
});
```

- [ ] **Step 2: Watch them fail.** Run `cd web && npx vitest run src/components/device-explorer/deviceFilters.test.ts`. Expected: FAIL, "isFiltered is not a function".

- [ ] **Step 3: Implement.** Append to `deviceFilters.ts`:

```ts
/** Anything other than every device: Clear shows only then. */
export function isFiltered(f: DeviceFilters): boolean {
  return f.status !== 'all' || f.platform !== 'all' || f.type !== 'all' || f.q.trim() !== '';
}

/** "5 devices" when every device shows, else "2 of 5 devices". */
export function resultLabel(shown: number, total: number): string {
  const noun = (n: number) => (n === 1 ? 'device' : 'devices');
  return shown === total ? `${total} ${noun(total)}` : `${shown} of ${total} ${noun(total)}`;
}
```

- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS, 22 tests.
- [ ] **Step 5: Commit.** `git add` both files, then `git commit -m "feat(devices): isFiltered and resultLabel"`.

### Task 2: `MenuItem` single-choice mode

**Files:**
- Modify: `web/src/components/ui/Menu.tsx`, `web/src/components/ui/popover.css`
- Test: `web/src/components/ui/menu.test.tsx`

**Interfaces:**
- Produces: `MenuItemProps` gains `checked?: boolean`, `note?: string` and `trailing?: React.ReactNode`. With `checked` defined, the item is `role="menuitemradio"` with `aria-checked`, and a check icon is reserved on the left.

- [ ] **Step 1: Write the failing tests.** Append inside `describe('Menu')`:

```tsx
  // Filter menus: a single choice, with the chosen one marked.
  it('a MenuItem with checked is a single choice', () => {
    render(
      <Menu>
        <MenuItem checked onClick={() => {}}>
          iOS
        </MenuItem>
        <MenuItem checked={false} onClick={() => {}}>
          Android
        </MenuItem>
      </Menu>,
    );
    expect(screen.getByRole('menuitemradio', { name: /iOS/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /Android/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('shows a note and trailing content', () => {
    render(
      <Menu>
        <MenuItem checked={false} note="Simulators and emulators" trailing={<span>2</span>} onClick={() => {}}>
          Virtual
        </MenuItem>
      </Menu>,
    );
    const item = screen.getByRole('menuitemradio');
    expect(item).toHaveTextContent('Virtual');
    expect(item).toHaveTextContent('Simulators and emulators');
    expect(item).toHaveTextContent('2');
  });
```

- [ ] **Step 2: Watch them fail.** Run `cd web && npx vitest run src/components/ui/menu.test.tsx`. Expected: FAIL, no `menuitemradio`.

- [ ] **Step 3: Implement.** In `Menu.tsx`, import `Check` from `lucide-react`, then extend the props and the item:

```tsx
export interface MenuItemProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** A single choice in a list (menuitemradio); true marks the chosen one. */
  checked?: boolean;
  /** A quieter second line under the label. */
  note?: string;
  /** Right-aligned content, such as a count. */
  trailing?: React.ReactNode;
}

export const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  children,
  onClick,
  danger,
  disabled,
  checked,
  note,
  trailing,
}) => (
  <RovingFocusGroup.Item asChild focusable={!disabled} active={false}>
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className={`menu-item${danger ? ' menu-item-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {checked !== undefined && (
        <span className="menu-item-check" aria-hidden="true">
          {checked && <Check size={12} />}
        </span>
      )}
      {icon && <span className="menu-item-icon">{icon}</span>}
      <span className="menu-item-label">
        {children}
        {note && <span className="menu-item-note">{note}</span>}
      </span>
      {trailing !== undefined && <span className="menu-item-trailing">{trailing}</span>}
    </button>
  </RovingFocusGroup.Item>
);
```

Append to `popover.css`:

```css
.menu-item-check { display: inline-flex; width: 12px; flex: none; color: var(--color-accent); }
.menu-item-note { display: block; font-size: 11px; color: var(--text-muted); }
.menu-item-trailing { margin-left: auto; padding-left: 16px; }
```

- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS, and the existing "each MenuItem has role=menuitem" test still passes.
- [ ] **Step 5: Commit.** `git add` the three files, then `git commit -m "feat(ui): MenuItem single-choice mode with a note and trailing content"`.

### Task 3: `FilterMenu`

**Files:**
- Create: `web/src/components/device-explorer/FilterMenu.tsx`, `web/src/components/device-explorer/filter-menu.css`
- Test: `web/src/components/device-explorer/FilterMenu.test.tsx`

**Interfaces:**
- Consumes: `Popover` (`open`, `onClose`, `anchorRef`, `placement`), `Menu`, and `MenuItem` from Task 2.
- Produces:
  - `interface FilterOption<T extends string> { value: T; label: string; note?: string; count: number }`
  - `FilterMenu<T extends string>(props: { name: string; value: T; anyValue: T; options: FilterOption<T>[]; onChange: (v: T) => void })`

- [ ] **Step 1: Write the failing tests** in `FilterMenu.test.tsx`:

```tsx
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterMenu, type FilterOption } from './FilterMenu';

type P = 'all' | 'android' | 'ios';
const OPTIONS: FilterOption<P>[] = [
  { value: 'all', label: 'Any platform', count: 5 },
  { value: 'android', label: 'Android', count: 2 },
  { value: 'ios', label: 'iOS', count: 3 },
];

function Harness({ initial = 'all' as P, onChange = vi.fn() }) {
  const [value, setValue] = React.useState<P>(initial);
  return (
    <FilterMenu<P>
      name="Platform"
      value={value}
      anyValue="all"
      options={OPTIONS}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
    />
  );
}

describe('FilterMenu', () => {
  it('reads as an add-filter button while unset', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Platform' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Clear platform filter' })).toBeNull();
  });

  it('shows the choice once set, and × clears it', () => {
    const onChange = vi.fn();
    render(<Harness initial="ios" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Platform: iOS' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear platform filter' }));
    expect(onChange).toHaveBeenCalledWith('all');
    expect(screen.getByRole('button', { name: 'Platform' })).toHaveFocus();
  });

  it('opens a single-choice menu with counts, focused on the current choice', async () => {
    render(<Harness initial="ios" />);
    fireEvent.click(screen.getByRole('button', { name: 'Platform: iOS' }));
    const ios = await screen.findByRole('menuitemradio', { name: /iOS/ });
    expect(screen.getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual([
      'Any platform5',
      'Android2',
      'iOS3',
    ]);
    expect(ios).toHaveAttribute('aria-checked', 'true');
    expect(ios).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Platform: iOS' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('choosing closes the menu and returns focus to the trigger', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Platform' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Android/ }));
    expect(onChange).toHaveBeenCalledWith('android');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Platform: Android' })).toHaveFocus();
  });

  it('Esc closes the menu and returns focus', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Platform' }));
    const item = await screen.findByRole('menuitemradio', { name: /Any platform/ });
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Platform' })).toHaveFocus();
  });
});
```

- [ ] **Step 2: Watch them fail.** Run `cd web && npx vitest run src/components/device-explorer/FilterMenu.test.tsx`. Expected: FAIL, "Failed to resolve import './FilterMenu'".

- [ ] **Step 3: Implement** `FilterMenu.tsx`:

```tsx
import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { Popover } from '../ui/Popover';
import { Menu, MenuItem } from '../ui/Menu';
import './filter-menu.css';

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  /** A quieter second line, e.g. what "Virtual" covers. */
  note?: string;
  count: number;
}

interface FilterMenuProps<T extends string> {
  /** "Platform": the trigger's name, and "Platform: iOS" once set. */
  name: string;
  value: T;
  /** The option that means "not filtering", e.g. 'all'. */
  anyValue: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
}

/**
 * A filter as a menu: a quiet "+ Platform" button while unset, a tinted
 * "Platform: iOS" chip with its own × once set. Three rows of equal-weight
 * segments read as busy; this keeps the choice visible without the pills.
 */
export function FilterMenu<T extends string>({
  name,
  value,
  anyValue,
  options,
  onChange,
}: FilterMenuProps<T>) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLSpanElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const isSet = value !== anyValue;
  const current = options.find((o) => o.value === value);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // The menu mounts in a portal; focus the current choice as it appears, so
  // the arrow keys work straight away.
  const focusCurrent = React.useCallback((node: HTMLDivElement | null) => {
    const item =
      node?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      node?.querySelector<HTMLElement>('[role="menuitemradio"]');
    item?.focus();
  }, []);

  return (
    <span ref={wrapRef} className={`fm${isSet ? ' fm-set' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="fm-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {isSet ? (
          <>
            <span className="fm-name">{name}:</span> {current?.label ?? value}
          </>
        ) : (
          <>
            <Plus size={12} aria-hidden="true" />
            {name}
          </>
        )}
      </button>
      {isSet && (
        <button
          type="button"
          className="fm-clear"
          aria-label={`Clear ${name.toLowerCase()} filter`}
          onClick={() => {
            onChange(anyValue);
            close();
          }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
      <Popover open={open} onClose={close} anchorRef={wrapRef} placement="bottom-start">
        <div ref={focusCurrent}>
          <Menu>
            {options.map((o) => (
              <MenuItem
                key={o.value}
                checked={o.value === value}
                note={o.note}
                trailing={<span className="fm-count">{o.count}</span>}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                {o.label}
              </MenuItem>
            ))}
          </Menu>
        </div>
      </Popover>
    </span>
  );
}
```

`filter-menu.css`:

```css
/* A filter as a menu button: dashed while unset, the accent chip once set
   (the same tint, text and edge as the selected status segment). */
.fm {
  display: inline-flex;
  align-items: center;
  height: 28px;
  border-radius: var(--radius-md);
}
.fm-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.fm-trigger:hover {
  color: var(--text);
  border-color: var(--text-dim);
}
.fm-set {
  background: rgb(var(--rgb-accent) / 0.12);
  box-shadow: inset 0 0 0 1px rgb(var(--rgb-accent) / 0.35);
}
.fm-set .fm-trigger {
  border: none;
  color: var(--color-accent);
  padding-right: 4px;
}
.fm-name {
  color: var(--text-muted);
}
.fm-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: 3px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-accent);
  cursor: pointer;
}
.fm-clear:hover {
  background: rgb(var(--rgb-accent) / 0.16);
}
.fm-trigger:focus-visible,
.fm-clear:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 1px;
}
.fm-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-muted);
}
```

- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS, 5 tests.
- [ ] **Step 5: Commit.** `git add` the three files, then `git commit -m "feat(devices): FilterMenu — a filter as a menu button and chip"`.

### Task 4: The Devices page uses the new row

**Files:**
- Modify: `web/src/components/device-explorer/device-explorer.tsx`, `web/src/components/device-explorer/device-explorer.css`
- Modify: `web/src/components/device-explorer/device-explorer.test.tsx`
- Modify: `web/test/viewport/overflow.spec.ts` (the content check)

**Interfaces:**
- Consumes: `FilterMenu` and `FilterOption` (Task 3); `isFiltered` and `resultLabel` (Task 1).

- [ ] **Step 1: Update the page tests to the new controls, and add the new behaviour.** In `device-explorer.test.tsx`:
  - Add `const flush = () => new Promise((r) => setTimeout(r, 0));`.
  - Remove the `tab` helper.
  - Replace `'writes a clicked filter into the link'` with:

```tsx
  it('writes a menu choice into the link', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    fireEvent.click(screen.getByRole('button', { name: 'Platform' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Android/ }));
    expect(where()).toBe('/devices?platform=android');
    expect(screen.queryByText('iPhone 17 Pro')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Virtual/ }));
    expect(where()).toBe('/devices?platform=android&type=virtual');
  });

  it('the chip’s × removes that filter from the link', async () => {
    renderAt('/devices?platform=ios&type=real');
    fireEvent.click(await screen.findByRole('button', { name: 'Clear platform filter' }));
    expect(where()).toBe('/devices?type=real');
  });

  it('shows Clear only while filtered, and it resets everything', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    const status = screen.getByRole('tablist', { name: 'Status' });
    fireEvent.click(within(status).getByRole('tab', { name: /^Ready/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(where()).toBe('/devices');
    expect(screen.getByRole('textbox', { name: 'Search devices' })).toHaveFocus();
  });

  it('says how many devices show', async () => {
    renderAt('/devices?platform=ios');
    expect(await screen.findByText('2 of 3 devices')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear platform filter' }));
    expect(screen.getByText('3 devices')).toBeInTheDocument();
  });

  it('focuses the search on /, but not while typing in it', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    const search = screen.getByRole('textbox', { name: 'Search devices' });
    // fireEvent returns false when the handler prevented the default.
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(false);
    expect(search).toHaveFocus();
    expect(fireEvent.keyDown(search, { key: '/' })).toBe(true);
  });
```

  - In `'opens pre-filtered from the link'`, add:
    `expect(screen.getByRole('button', { name: 'Platform: iOS' })).toBeInTheDocument();`

- [ ] **Step 2: Watch them fail.** Run `cd web && npx vitest run src/components/device-explorer/device-explorer.test.tsx`. Expected: the new and changed tests FAIL (no "Platform" button, no Clear, no count, no `/`). Opening and closing a device, and the empty state, still pass.

- [ ] **Step 3: Implement the page.** In `device-explorer.tsx`:

1. Imports:
   - `import { RefreshCw, Search, Smartphone as AndroidIcon } from 'lucide-react';`
   - `import { FilterMenu, type FilterOption } from './FilterMenu';`
   - Add `isFiltered` and `resultLabel` to the `./deviceFilters` import.
   - Drop `type Segment` from the `SegmentedControl` import.
2. Class fields: `private searchRef = React.createRef<HTMLInputElement>();`
3. Mount/unmount: in `componentDidMount`, add `document.addEventListener('keydown', this.onSlash);`. In `componentWillUnmount`, add `document.removeEventListener('keydown', this.onSlash);`.
4. Methods:
   ```ts
   // "/" jumps to search, as in most list tools. Not while typing, not with
   // Ctrl/Alt/Cmd, and not while a device is open: device control sends keys
   // to the phone.
   onSlash = (e: KeyboardEvent) => {
     if (e.key !== '/' || e.ctrlKey || e.altKey || e.metaKey) return;
     if (this.props.params.udid) return;
     const target = e.target as HTMLElement | null;
     if (target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
     e.preventDefault();
     this.searchRef.current?.focus();
   };

   clearFilters = () => {
     this.props.onFiltersChange(NO_FILTERS);
     this.searchRef.current?.focus();
   };
   ```
5. In `render()`, replace `platformSegments` with:
   ```ts
   const platformOptions: FilterOption<PlatformFilter>[] = [
     { value: 'all', label: 'Any platform', count: counts.platform.all },
     { value: 'android', label: 'Android', count: counts.platform.android },
     { value: 'ios', label: 'iOS', count: counts.platform.ios },
   ];
   if (hasTvos(this.state.devices) || filters.platform === 'tvos') {
     platformOptions.push({ value: 'tvos', label: 'tvOS', count: counts.platform.tvos });
   }
   const typeOptions: FilterOption<TypeFilter>[] = [
     { value: 'all', label: 'Any type', count: counts.type.all },
     { value: 'real', label: 'Real devices', count: counts.type.real },
     {
       value: 'virtual',
       label: 'Virtual',
       note: 'Simulators and emulators',
       count: counts.type.virtual,
     },
   ];
   ```
6. Replace the whole `<div className="de2-toolbar-row">…</div>` with:
   ```tsx
   <div className="de2-toolbar-row">
     <div className="de2-search-wrap">
       <Search size={13} className="de2-search-icon" aria-hidden="true" />
       <input
         ref={this.searchRef}
         type="text"
         className="de2-search"
         aria-label="Search devices"
         placeholder="Search name, model or UDID…"
         value={filters.q}
         onChange={(e) => this.setFilters({ q: e.target.value })}
       />
       <kbd className="de2-key" aria-hidden="true">
         /
       </kbd>
     </div>
     <FilterMenu<PlatformFilter>
       name="Platform"
       value={filters.platform}
       anyValue="all"
       options={platformOptions}
       onChange={(v) => this.setFilters({ platform: v })}
     />
     <FilterMenu<TypeFilter>
       name="Type"
       value={filters.type}
       anyValue="all"
       options={typeOptions}
       onChange={(v) => this.setFilters({ type: v })}
     />
     {isFiltered(filters) && (
       <Button variant="ghost" size="sm" onClick={this.clearFilters}>
         Clear
       </Button>
     )}
     <div className="de2-result">
       {this.state.loaded && (
         <span aria-live="polite">{resultLabel(devices.length, this.state.devices.length)}</span>
       )}
       <Button
         variant="secondary"
         size="icon"
         aria-label="Refresh devices"
         title="Refresh"
         onClick={() => this.fetchDevices()}
       >
         <RefreshCw size={13} aria-hidden="true" />
       </Button>
     </div>
   </div>
   ```
7. The empty state's Clear filters button: `onClick={this.clearFilters}`.

In `device-explorer.css`, replace the `.de2-find` rule and change the `.de2-search` sizing:

```css
.de2-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 1 320px;
  min-width: 200px;
}
.de2-search-icon {
  position: absolute;
  left: 9px;
  color: var(--text-dim);
  pointer-events: none;
}
.de2-key {
  position: absolute;
  right: 7px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-dim);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  line-height: 16px;
  pointer-events: none;
}
.de2-result {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}
```

In `.de2-search`, replace `flex: 1; min-width: 200px;` with `width: 100%;` and add `padding: 0 28px;` in place of `padding: 0 10px;`.

In `overflow.spec.ts`, the `/xenon/devices` content check becomes:

```ts
    // The two-row toolbar is what's being measured.
    await expect(page.getByRole('tablist', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Platform' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Type' })).toBeVisible();
```

- [ ] **Step 4: Run everything.** Run `cd web && npx vitest run && npx tsc --noEmit -p .`. Expected: all pass, and tsc is clean.
- [ ] **Step 5: Lint against main.** Compare counts per changed file, piping main's copies through `eslint --stdin --stdin-filename`. Expected: no new problems.
- [ ] **Step 6: Commit.** `git add` the four files, then `git commit -m "feat(devices): filter bar — search first, Platform and Type menus, Clear, result count"`.

### Task 5: Verify and update the PR

- [ ] **Step 1:** `npm run build:xenon && npm run build:copy`, then `cd web && npx playwright test -g devices`. Expected: 14 pass.
- [ ] **Step 2:** Update `scratchpad/devfilters.mjs` to measure the new row: search, Platform, Type, Clear and the count on one row; no overflow at 1280 and 1440; contrast for the dashed trigger, the chip text and ×, the menu items and counts, Clear, the count and the placeholder, in both themes. Take screenshots with a menu open.
- [ ] **Step 3:** Live on the lab server with the S9+, keyboard only:
  - `/` focuses search;
  - Tab to Platform, Enter opens it, the arrow keys choose Android, and Enter applies it with focus back on the trigger;
  - Esc closes the menu;
  - the chip's × clears the filter;
  - Clear resets everything;
  - opening and closing a device keeps the link.
- [ ] **Step 4:** Push, and update PR #321's description with the new evidence.
