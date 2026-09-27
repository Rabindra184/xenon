# Devices table view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cards / Table switch to the Devices page, with a sortable table whose rows carry the card's own actions.

**Architecture:**
- Two pure modules own the logic: `deviceSort.ts` for ordering and `deviceView.ts` for the choice of view.
- The card's actions move, unchanged in behaviour, into `DeviceActions.tsx`: a hook plus small components, rendered by both the card and the table row, so the two can't disagree.
- `DeviceExplorer` keeps the filters, the view and the sort in the URL together.

**Tech Stack:** React 17 (the explorer is a class component; the new parts are function components), react-router 6 `useSearchParams`, the shared `ui/Table`, `ui/StatusDot`, `ui/SegmentedControl`, `ui/Menu`, `ui/Popover` and `ui/button`, and Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-09-27-devices-table-view-design.md`

## Global Constraints

- **Default view:** cards. The view is stored in `localStorage['xenon.devices.view']` and carried in the URL as `?view=table`; the URL wins, and storage that throws means cards.
- **Columns, in order:** Status, Device, Platform, Type, Team, Tags, Host (only with more than one host), Actions.
- **Sort:**
  - The keys are `status`, `device`, `platform`, `type`, `team` and `host`.
  - The default is `status` ascending; the first click on a header sorts ascending, the second descending.
  - Ties fall back to the device title, then the UDID.
  - "Shared" (no team) sorts last in both directions.
  - The sort goes in the URL (`sort`, and `dir=desc`) only when it isn't the default.
- **Header semantics:** a sortable header is a `<button>` inside a `<th scope="col" aria-sort=…>`. The table has an sr-only caption: "Devices, N shown".
- **Rows:** about 44 px high, and an offline row is dimmed. It fits 1280–1440 px without sideways scrolling, and long text truncates with `title`.
- **Behaviour must not change on the card**, and every existing `device-card.test.tsx` test keeps passing.
- **Styling and tools:**
  - tokens only: `web/src/design/color-literals.test.ts` ratchets literals, and `button-classes.test.ts` forbids rules on shared Button classes;
  - never run `eslint --fix` or `prettier --write` on an existing file; compare lint counts with main;
  - stage explicit paths;
  - the web tsconfig targets ES5, so never spread or `for-of` a Set or Map (use `Array.from`).

**Adjustment to the spec, made here on purpose:** the Platform column shows the platform's name and version ("Android 10", "iOS 26.5.2"), not an icon. The app has no platform icons (the Devices page uses a generic phone icon), and the name reads more clearly.

---

### Task 1: `deviceSort` and `deviceView` (TDD)

**Files:**
- Create: `web/src/components/device-explorer/deviceSort.ts`, `web/src/components/device-explorer/deviceView.ts`
- Modify: `web/src/components/device-card/device-card/deviceIdentity.ts` (add `deviceTeamName`)
- Test: `web/src/components/device-explorer/deviceSort.test.ts`, `web/src/components/device-explorer/deviceView.test.ts`, `web/src/components/device-card/device-card/deviceIdentity.test.ts` (add cases)

**Interfaces (produces):**

```ts
// deviceIdentity.ts
export function deviceTeamName(d: Pick<IDevice, 'teamId' | 'teamName'>, teams?: Map<string, string>): string | null;
// deviceSort.ts
export type SortKey = 'status' | 'device' | 'platform' | 'type' | 'team' | 'host';
export type SortDir = 'asc' | 'desc';
export interface DeviceSort { key: SortKey; dir: SortDir }
export const DEFAULT_SORT: DeviceSort; // { key: 'status', dir: 'asc' }
export interface SortContext { now: number; teams?: Map<string, string> }
export function sortDevices(list: IDevice[], sort: DeviceSort, ctx: SortContext): IDevice[];
export function parseSort(params: URLSearchParams): DeviceSort;
export function sortToParams(params: URLSearchParams, sort: DeviceSort): void;
// deviceView.ts
export type DeviceView = 'cards' | 'table';
export const VIEW_KEY = 'xenon.devices.view';
export function parseView(params: URLSearchParams, stored: DeviceView): DeviceView;
export function viewToParams(params: URLSearchParams, view: DeviceView): void;
export function loadView(storage?: Pick<Storage, 'getItem'> | null): DeviceView;
export function saveView(view: DeviceView, storage?: Pick<Storage, 'setItem'> | null): void;
```

- [ ] **Step 1: Write the failing tests.**

`deviceIdentity.test.ts`: add

```ts
describe('deviceTeamName', () => {
  it('names a device’s team from the map, then its own name, then an id prefix', () => {
    const teams = new Map([['t1', 'QA']]);
    expect(deviceTeamName({ teamId: 't1', teamName: 'Old' }, teams)).toBe('QA');
    expect(deviceTeamName({ teamId: 't2', teamName: 'Mobile' }, teams)).toBe('Mobile');
    expect(deviceTeamName({ teamId: 'abcdef123', teamName: null }, teams)).toBe('Team abcdef');
    expect(deviceTeamName({ teamId: null, teamName: null }, teams)).toBeNull();
  });
});
```

`deviceSort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';
import { DEFAULT_SORT, parseSort, sortDevices, sortToParams } from './deviceSort';

const d = (udid: string, over: Partial<IDevice> = {}): IDevice =>
  ({
    udid,
    name: udid,
    host: 'http://127.0.0.1:4723',
    sdk: '14',
    deviceType: 'real',
    platform: 'android',
    realDevice: true,
    offline: false,
    userBlocked: false,
    busy: false,
    ...over,
  }) as IDevice;
const ids = (list: IDevice[]) => list.map((x) => x.udid);
const ctx = { now: Date.now() };

describe('sortDevices', () => {
  it('orders by status (ready, busy, reserved, maintenance, offline), then name', () => {
    const list = [
      d('off', { offline: true }),
      d('b', { busy: true, session_id: 'appium-1' }),
      d('maint', { userBlocked: true }),
      d('rdy-z', { name: 'Zeta' }),
      d('rdy-a', { name: 'Alpha' }),
    ];
    expect(ids(sortDevices(list, DEFAULT_SORT, ctx))).toEqual(['rdy-a', 'rdy-z', 'b', 'maint', 'off']);
  });

  it('reverses on desc but keeps the name tie-break ascending', () => {
    const list = [d('a', { name: 'A' }), d('b', { name: 'B' }), d('x', { offline: true })];
    expect(ids(sortDevices(list, { key: 'status', dir: 'desc' }, ctx))).toEqual(['x', 'a', 'b']);
  });

  it('sorts by device title, ignoring case', () => {
    const list = [d('1', { name: 'beta' }), d('2', { name: 'Alpha' }), d('3', { name: 'gamma' })];
    expect(ids(sortDevices(list, { key: 'device', dir: 'asc' }, ctx))).toEqual(['2', '1', '3']);
  });

  it('sorts by platform, then by OS version numerically (9 before 10)', () => {
    const list = [
      d('i', { platform: 'ios', sdk: '17.0' }),
      d('a10', { sdk: '10' }),
      d('a9', { sdk: '9' }),
    ];
    expect(ids(sortDevices(list, { key: 'platform', dir: 'asc' }, ctx))).toEqual(['a9', 'a10', 'i']);
  });

  it('puts real before virtual', () => {
    const list = [d('emu', { deviceType: 'emulator', realDevice: false }), d('phone')];
    expect(ids(sortDevices(list, { key: 'type', dir: 'asc' }, ctx))).toEqual(['phone', 'emu']);
  });

  it('sorts teams by name, with Shared last in both directions', () => {
    const teams = new Map([['t1', 'QA'], ['t2', 'Mobile']]);
    const list = [d('shared'), d('qa', { teamId: 't1' }), d('mob', { teamId: 't2' })];
    expect(ids(sortDevices(list, { key: 'team', dir: 'asc' }, { ...ctx, teams }))).toEqual([
      'mob',
      'qa',
      'shared',
    ]);
    expect(ids(sortDevices(list, { key: 'team', dir: 'desc' }, { ...ctx, teams }))).toEqual([
      'qa',
      'mob',
      'shared',
    ]);
  });

  it('sorts by host', () => {
    const list = [d('n2', { host: 'http://node-b:4723' }), d('n1', { host: 'http://node-a:4723' })];
    expect(ids(sortDevices(list, { key: 'host', dir: 'asc' }, ctx))).toEqual(['n1', 'n2']);
  });

  it('breaks ties by title, then UDID, so the order is stable', () => {
    const list = [d('u2', { name: 'Same' }), d('u1', { name: 'Same' })];
    expect(ids(sortDevices(list, { key: 'type', dir: 'asc' }, ctx))).toEqual(['u1', 'u2']);
  });

  it('does not change the list it was given', () => {
    const list = [d('b', { name: 'B' }), d('a', { name: 'A' })];
    sortDevices(list, { key: 'device', dir: 'asc' }, ctx);
    expect(ids(list)).toEqual(['b', 'a']);
  });
});

describe('sort in the URL', () => {
  it('reads a sort, and falls back to the default for anything else', () => {
    expect(parseSort(new URLSearchParams('sort=team&dir=desc'))).toEqual({ key: 'team', dir: 'desc' });
    expect(parseSort(new URLSearchParams('sort=team'))).toEqual({ key: 'team', dir: 'asc' });
    expect(parseSort(new URLSearchParams('sort=nope&dir=desc'))).toEqual(DEFAULT_SORT);
    expect(parseSort(new URLSearchParams(''))).toEqual(DEFAULT_SORT);
  });

  it('writes only what isn’t the default', () => {
    const p = new URLSearchParams('status=busy');
    sortToParams(p, DEFAULT_SORT);
    expect(p.toString()).toBe('status=busy');
    sortToParams(p, { key: 'device', dir: 'desc' });
    expect(p.toString()).toBe('status=busy&sort=device&dir=desc');
    sortToParams(p, { key: 'device', dir: 'asc' });
    expect(p.toString()).toBe('status=busy&sort=device');
  });
});
```

`deviceView.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadView, parseView, saveView, VIEW_KEY, viewToParams } from './deviceView';

describe('device view', () => {
  it('lets the URL win over the stored choice', () => {
    expect(parseView(new URLSearchParams('view=table'), 'cards')).toBe('table');
    expect(parseView(new URLSearchParams('view=cards'), 'table')).toBe('cards');
    expect(parseView(new URLSearchParams(''), 'table')).toBe('table');
    expect(parseView(new URLSearchParams('view=grid'), 'cards')).toBe('cards');
  });

  it('puts only the table in the URL', () => {
    const p = new URLSearchParams('q=pixel');
    viewToParams(p, 'table');
    expect(p.toString()).toBe('q=pixel&view=table');
    viewToParams(p, 'cards');
    expect(p.toString()).toBe('q=pixel');
  });

  it('remembers the choice, and treats broken storage as cards', () => {
    const saved: Record<string, string> = {};
    saveView('table', { setItem: (k: string, v: string) => void (saved[k] = v) });
    expect(saved[VIEW_KEY]).toBe('table');
    expect(loadView({ getItem: () => 'table' })).toBe('table');
    expect(loadView({ getItem: () => 'nonsense' })).toBe('cards');
    expect(loadView({ getItem: () => { throw new Error('blocked'); } })).toBe('cards');
    expect(() => saveView('table', { setItem: () => { throw new Error('full'); } })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run** from `web/`: `npx vitest run src/components/device-explorer/deviceSort.test.ts src/components/device-explorer/deviceView.test.ts src/components/device-card/device-card/deviceIdentity.test.ts`. They FAIL, because the modules and the function are missing.
- [ ] **Step 3: Implement.**

`deviceIdentity.ts` (append):

```ts
/** The team a device belongs to, as the card names it, or null for the shared pool. */
export function deviceTeamName(
  d: Pick<IDevice, 'teamId' | 'teamName'>,
  teams?: Map<string, string>,
): string | null {
  if (!d.teamId) return null;
  return teams?.get(d.teamId) ?? d.teamName ?? `Team ${d.teamId.slice(0, 6)}`;
}
```

(import `IDevice` if the file doesn't already).

`deviceSort.ts`:

```ts
import type { IDevice } from '../../interfaces/IDevice';
import { deviceTeamName, deviceTitle } from '../device-card/device-card/deviceIdentity';
import { DEVICE_STATES, deviceState } from '../device-card/device-card/deviceState';
import { isVirtual } from './deviceFilters';

export type SortKey = 'status' | 'device' | 'platform' | 'type' | 'team' | 'host';
export type SortDir = 'asc' | 'desc';
export interface DeviceSort {
  key: SortKey;
  dir: SortDir;
}
export interface SortContext {
  now: number;
  teams?: Map<string, string>;
}

export const DEFAULT_SORT: DeviceSort = { key: 'status', dir: 'asc' };
const KEYS: SortKey[] = ['status', 'device', 'platform', 'type', 'team', 'host'];

// Case-insensitive, and numeric-aware so "9" sorts before "10".
const text = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

function compareBy(a: IDevice, b: IDevice, key: SortKey, ctx: SortContext): number {
  switch (key) {
    case 'status':
      return (
        DEVICE_STATES.indexOf(deviceState(a, ctx.now)) - DEVICE_STATES.indexOf(deviceState(b, ctx.now))
      );
    case 'device':
      return text(deviceTitle(a), deviceTitle(b));
    case 'platform':
      return text(a.platform || '', b.platform || '') || text(a.sdk || '', b.sdk || '');
    case 'type':
      return Number(isVirtual(a)) - Number(isVirtual(b));
    case 'team':
      return text(deviceTeamName(a, ctx.teams) ?? '', deviceTeamName(b, ctx.teams) ?? '');
    case 'host':
      return text(a.host || '', b.host || '');
  }
}

/** A sorted copy. Ties fall back to the title, then the UDID, always ascending. */
export function sortDevices(list: IDevice[], sort: DeviceSort, ctx: SortContext): IDevice[] {
  const sign = sort.dir === 'desc' ? -1 : 1;
  return list.slice().sort((a, b) => {
    if (sort.key === 'team') {
      // Shared (no team) goes last whichever way the column is sorted.
      const sa = deviceTeamName(a, ctx.teams) === null;
      const sb = deviceTeamName(b, ctx.teams) === null;
      if (sa !== sb) return sa ? 1 : -1;
    }
    return (
      sign * compareBy(a, b, sort.key, ctx) ||
      text(deviceTitle(a), deviceTitle(b)) ||
      text(a.udid, b.udid)
    );
  });
}

export function parseSort(params: URLSearchParams): DeviceSort {
  const key = params.get('sort') as SortKey | null;
  if (!key || !KEYS.includes(key)) return DEFAULT_SORT;
  return { key, dir: params.get('dir') === 'desc' ? 'desc' : 'asc' };
}

/** Writes the sort into `params`, leaving the default out so plain links stay plain. */
export function sortToParams(params: URLSearchParams, sort: DeviceSort): void {
  params.delete('sort');
  params.delete('dir');
  if (sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir) return;
  params.set('sort', sort.key);
  if (sort.dir === 'desc') params.set('dir', 'desc');
}
```

`deviceView.ts`:

```ts
export type DeviceView = 'cards' | 'table';
export const VIEW_KEY = 'xenon.devices.view';

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The URL's view if it names one, else the stored choice. */
export function parseView(params: URLSearchParams, stored: DeviceView): DeviceView {
  const v = params.get('view');
  return v === 'table' || v === 'cards' ? v : stored;
}

/** Only the table goes in the URL; cards is the default. */
export function viewToParams(params: URLSearchParams, view: DeviceView): void {
  if (view === 'table') params.set('view', 'table');
  else params.delete('view');
}

export function loadView(storage: Pick<Storage, 'getItem'> | null = browserStorage()): DeviceView {
  try {
    return storage?.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards';
  } catch {
    return 'cards';
  }
}

export function saveView(
  view: DeviceView,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): void {
  try {
    storage?.setItem(VIEW_KEY, view);
  } catch {
    // Blocked or full storage: the choice holds for this visit only.
  }
}
```

- [ ] **Step 4: Run** the three test files; they PASS.
- [ ] **Step 5: Commit** `feat(devices): sort and view rules for a table view`, staging the five files.

---

### Task 2: Share the card's actions (refactor; no behaviour change)

**Files:**
- Create: `web/src/components/device-card/device-card/DeviceActions.tsx`
- Modify: `web/src/components/device-card/device-card/device-card.tsx`, `web/src/components/device-card/device-card/deviceState.ts` (export `STATE_LABEL`)
- Test: `web/src/components/device-card/device-card/device-card.test.tsx` (unchanged; must still pass), `web/src/components/device-card/device-card/DeviceActions.test.tsx` (new)

**Interfaces (produces):**

```ts
// deviceState.ts
export const STATE_LABEL: Record<DeviceState, string>;
// DeviceActions.tsx
export interface DeviceActionsState {
  kind: DeviceState;
  reserved: boolean;
  activity: string | null;
  control: { enabled: true } | { enabled: false; reason: string };
  isAdmin: boolean;
  editingTeam: boolean;
  setEditingTeam: (v: boolean) => void;
  openReservation: () => void;
  openTagManager: () => void;
  release: () => Promise<void>;
  toggleMaintenance: () => Promise<void>;
  copy: (text: string, successMsg: string) => Promise<void>;
  serverUrl: string;
  ip: string | null;
  dialogs: React.ReactNode; // the reservation and tag dialogs, when open
}
export function useDeviceActions(device: IDevice, reloadDevices: () => void): DeviceActionsState;
export const DeviceControlButtons: React.FC<{ device: IDevice; actions: DeviceActionsState; navigate: (path: string) => void; reasonId?: string }>;
export const DeviceMoreMenu: React.FC<{ device: IDevice; actions: DeviceActionsState; triggerClassName?: string }>;
export const TeamPicker: React.FC<{ udid: string; currentTeamId: string | null; teams: Map<string, string>; onDone: (changed: boolean) => void }>;
```

- [ ] **Step 1: Write `DeviceActions.test.tsx`**, pinning the shared behaviour through a tiny host component, so the extraction is covered where it lives:

```tsx
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../../interfaces/IDevice';

const MEMBER = { userId: 'me', email: 'me@acme.com', name: 'Me', role: 'MEMBER', teams: [] };
const ADMIN = { ...MEMBER, role: 'ADMIN' };
const auth = vi.hoisted(() => ({ me: null as any }));
vi.mock('../../../auth/auth-context', () => ({ useAuth: () => ({ me: auth.me ?? MEMBER }) }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const api = vi.hoisted(() => ({ releaseReservation: vi.fn(), blockDevice: vi.fn(), unblockDevice: vi.fn() }));
vi.mock('../../../api-service', () => ({ default: api }));

import { DeviceControlButtons, DeviceMoreMenu, useDeviceActions } from './DeviceActions';

const device = (over: Partial<IDevice> = {}): IDevice =>
  ({
    name: 'Galaxy', host: 'http://127.0.0.1:4723', udid: 'U1', sdk: '14', deviceType: 'real',
    offline: false, userBlocked: false, busy: false, platform: 'android', realDevice: true,
    session_id: null, ...over,
  }) as IDevice;

function Host({ d, navigate = vi.fn(), reload = vi.fn() }: { d: IDevice; navigate?: any; reload?: any }) {
  const actions = useDeviceActions(d, reload);
  return (
    <>
      <DeviceControlButtons device={d} actions={actions} navigate={navigate} />
      <DeviceMoreMenu device={d} actions={actions} />
      {actions.dialogs}
    </>
  );
}

describe('DeviceActions', () => {
  it('opens a ready device and offers Reserve', () => {
    const navigate = vi.fn();
    render(<Host d={device()} navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    expect(navigate).toHaveBeenCalledWith('/devices/U1/control');
    expect(screen.getByRole('button', { name: 'Reserve' })).toBeInTheDocument();
  });

  it('offers Release on a reserved device', () => {
    render(<Host d={device({ reservedUntil: Date.now() + 60_000, reservedBy: 'x' } as any)} />);
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
  });

  it('disables Control with the reason on an offline device', () => {
    render(<Host d={device({ offline: true })} />);
    expect(screen.getByRole('button', { name: 'Control' })).toBeDisabled();
  });

  it('shows the admin items in More only to admins', () => {
    auth.me = MEMBER;
    const { unmount } = render(<Host d={device()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: /Copy UDID/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Manage tags/ })).toBeNull();
    unmount();
    auth.me = ADMIN;
    render(<Host d={device()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: /Manage tags/ })).toBeInTheDocument();
    auth.me = null;
  });
});
```

If the exact accessible roles used by `ui/Menu` differ (`menuitem` is the expectation), read `web/src/components/ui/Menu.tsx` and match what it renders.

- [ ] **Step 2: Run** `npx vitest run src/components/device-card`. The new file FAILS because the module is missing; `device-card.test.tsx` still passes.
- [ ] **Step 3: Implement `DeviceActions.tsx`** by moving code out of `device-card.tsx`, **verbatim where possible**:
  - `TeamPicker` moves as it is, and is exported.
  - `useDeviceActions`:
    - holds the state `showReservation`, `showTagManager` and `editingTeam`;
    - derives `kind`, `reserved`, `activity`, `control` and `isAdmin` exactly as the card does today (`deviceState(device, now)`, `activityLabel(device, me, now)`, `controlAvailability(device, me)`, and `me?.role === 'ADMIN' || me?.role === 'SUPER_ADMIN'`);
    - provides `release` and `toggleMaintenance`, which calls `unblockDevice` if `device.userBlocked` else `blockDevice`, then `reloadDevices()`;
    - provides `copy`, the card's `copyText`;
    - provides `serverUrl` (`formatAppiumServerUrl(device.host)`) and `ip` (`deviceNetworkIp(device)`);
    - provides `dialogs`: the `ReservationModal` and `TagManagerModal` JSX the card renders today, each when open.
  - `DeviceControlButtons` renders the card's **Control** button, then **Release** or **Reserve** (for `reserved` and `kind === 'ready'`), with identical classes, variants, sizes and `aria-describedby={control.enabled ? undefined : reasonId}`.
  - `DeviceMoreMenu` renders the ⋯ trigger (`<button type="button" className={triggerClassName ?? 'dc2-more'} aria-label="More actions">`) with its own `menuOpen` state and ref, and the same `Popover` + `Menu`: Copy UDID, Copy server URL (when `serverUrl !== '—'`), Copy IP address (when `ip`) and Copy capabilities. For admins it adds a divider, Manage tags… (`openTagManager`), Assign team… (`setEditingTeam(true)`), and Enter maintenance or Exit maintenance (`toggleMaintenance`).

  Then **`device-card.tsx`** uses them:

  ```tsx
  const actions = useDeviceActions(device, reloadDevices);
  const { kind, activity, control } = actions;
  // band: STATE_LABEL[kind] and activity, as today
  // meta: actions.editingTeam ? <TeamPicker … onDone={(changed) => { actions.setEditingTeam(false); if (changed) reloadDevices(); }} /> : teamName && <Pill …>
  // foot:
  <DeviceControlButtons device={device} actions={actions} navigate={navigate} reasonId={reasonId} />
  {!control.enabled && <span id={reasonId} className="dc2-unavailable" title={control.reason}>{control.reason}</span>}
  <span className="dc2-spacer" />
  <DeviceMoreMenu device={device} actions={actions} />
  // end: {actions.dialogs}
  ```

  - `teamName` becomes `deviceTeamName(device, teams)` (Task 1).
  - `STATE_LABEL` moves to `deviceState.ts`, exported.
  - Keep every class name and element order of the card's DOM as it is today.
- [ ] **Step 4: Run** `npx vitest run src/components/device-card src/components/device-explorer`: everything passes, including every existing `device-card.test.tsx` test, unchanged. Also run `npx tsc --noEmit -p . ; echo tsc=$?` (expect 0), and `npx eslint` on `device-card.tsx`, which must not exceed main's count. New files have 0 problems.
- [ ] **Step 5: Commit** `refactor(devices): share the card's actions`, staging `DeviceActions.tsx`, `DeviceActions.test.tsx`, `device-card.tsx` and `deviceState.ts`.

---

### Task 3: `DeviceTable` (TDD)

**Files:**
- Create: `web/src/components/device-explorer/table-view/DeviceTable.tsx`, `web/src/components/device-explorer/table-view/device-table.css`
- Test: `web/src/components/device-explorer/table-view/DeviceTable.test.tsx`

**Interfaces:**
- Consumes: `sortDevices`, `DeviceSort` (Task 1); `useDeviceActions`, `DeviceControlButtons`, `DeviceMoreMenu`, `TeamPicker` (Task 2); `deviceTeamName`, `deviceTitle`, `deviceSubtitle`, `STATE_LABEL`, `isVirtual`, `platformLabel`.
- Produces: `export function DeviceTable(props: { devices: IDevice[]; reloadDevices: () => void; sort: DeviceSort; onSortChange: (s: DeviceSort) => void; navigate: (path: string) => void; teams: Map<string, string> })`, and `export default function DeviceTableWrapper(props: { devices; reloadDevices; sort; onSortChange })`, which supplies `navigate` (keeping the query string, as the card wrapper does) and fetches `teams` once (`XenonApiService.listTeams()`, as `CardView` does).

- [ ] **Step 1: Write `DeviceTable.test.tsx`** (mocks as in `DeviceActions.test.tsx`):

```tsx
// …mocks for auth-context, toast, api-service as in DeviceActions.test.tsx…
import { DeviceTable } from './DeviceTable';
import { DEFAULT_SORT } from '../deviceSort';

const list = [
  device({ udid: 'A', name: 'Alpha' }),
  device({ udid: 'B', name: 'Beta', offline: true }),
  device({ udid: 'C', name: 'Gamma', platform: 'ios', sdk: '17.0', teamId: 't1', tags: ['a', 'b', 'c'] }),
];
const table = (over: Partial<React.ComponentProps<typeof DeviceTable>> = {}) =>
  render(
    <DeviceTable devices={list} reloadDevices={vi.fn()} sort={DEFAULT_SORT} onSortChange={vi.fn()}
      navigate={vi.fn()} teams={new Map([['t1', 'QA']])} {...over} />,
  );
const rows = () => screen.getAllByRole('row').slice(1); // minus the header row

describe('DeviceTable', () => {
  it('has the columns in order and a caption with the count', () => {
    table();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual([
      'Status', 'Device', 'Platform', 'Type', 'Team', 'Tags', 'Actions',
    ]);
    expect(screen.getByRole('table', { name: 'Devices, 3 shown' })).toBeInTheDocument();
  });

  it('shows Host only when devices come from more than one host', () => {
    table({ devices: [...list, device({ udid: 'D', host: 'http://node-b:4723' })] });
    expect(screen.getByRole('columnheader', { name: /Host/ })).toBeInTheDocument();
  });

  it('marks the sorted column and reverses it on a second click', () => {
    const onSortChange = vi.fn();
    table({ onSortChange });
    expect(screen.getByRole('columnheader', { name: /Status/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: /Device/ })).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(screen.getByRole('button', { name: /Status/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'status', dir: 'desc' });
    fireEvent.click(screen.getByRole('button', { name: /Device/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'device', dir: 'asc' });
  });

  it('orders rows by the sort (offline last by status)', () => {
    table();
    expect(rows().map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual([
      expect.stringContaining('Alpha'), expect.stringContaining('Gamma'), expect.stringContaining('Beta'),
    ]);
  });

  it('shows the card’s status, team, platform, type and tags', () => {
    table();
    const gamma = rows().find((r) => r.textContent?.includes('Gamma'))!;
    const cells = within(gamma).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Ready');
    expect(cells[2]).toHaveTextContent('iOS 17.0');
    expect(cells[3]).toHaveTextContent('Real');
    expect(cells[4]).toHaveTextContent('QA');
    expect(cells[5]).toHaveTextContent('#a');
    expect(cells[5]).toHaveTextContent('+1');
    const alpha = rows().find((r) => r.textContent?.includes('Alpha'))!;
    expect(within(alpha).getAllByRole('cell')[4]).toHaveTextContent('Shared');
  });

  it('gives each row the card’s actions, with the reason on a disabled Control', () => {
    const navigate = vi.fn();
    table({ navigate });
    const beta = rows().find((r) => r.textContent?.includes('Beta'))!;
    const control = within(beta).getByRole('button', { name: 'Control' });
    expect(control).toBeDisabled();
    expect(control).toHaveAccessibleDescription('Device is offline');
    const alpha = rows().find((r) => r.textContent?.includes('Alpha'))!;
    fireEvent.click(within(alpha).getByRole('button', { name: 'Control' }));
    expect(navigate).toHaveBeenCalledWith('/devices/A/control');
    expect(within(alpha).getByRole('button', { name: 'Reserve' })).toBeInTheDocument();
    expect(within(alpha).getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });

  it('dims an offline row', () => {
    table();
    const beta = rows().find((r) => r.textContent?.includes('Beta'))!;
    expect(beta).toHaveClass('is-offline');
  });
});
```

- [ ] **Step 2: Run** it; it FAILS because the module is missing.
- [ ] **Step 3: Implement `DeviceTable.tsx`:**
  - Use `ui/Table` (`Table`, `THead`, `TBody`, `TR`, `TH`, `TD`) and a `<caption className="sr-only">Devices, {n} shown</caption>`.
  - **Headers:**
    - Status, Device, Platform, Type, Team and Host (when `new Set(devices.map((d) => d.host)).size > 1`) are sortable: `<TH scope="col" aria-sort={…}><button type="button" className="devtable-sort" onClick={…}>{label}{active && (dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}</button></TH>`.
    - Clicking the active column flips its direction; clicking another column sorts it `asc`.
    - Tags and Actions are plain `<TH scope="col">`.
  - **Rows:** `sortDevices(devices, sort, { now: Date.now(), teams })`, one `DeviceRow` each.
  - **`DeviceRow`** calls `useDeviceActions(device, reloadDevices)` and renders:
    - **Status:** `<StatusDot kind={kind} />` + `STATE_LABEL[kind]`, with `activity` below it in `.devtable-muted` and `title={activity}`.
    - **Device:** `deviceTitle` (`title={\`${title}\n${device.udid}\`}`), with `deviceSubtitle` below it in `.devtable-muted`.
    - **Platform:** `${platformLabel(device.platform)} ${device.sdk ?? ''}`.
    - **Type:** `isVirtual(device) ? 'Virtual' : 'Real'`.
    - **Team:** `actions.editingTeam ? <TeamPicker …/> : (deviceTeamName(device, teams) ?? 'Shared')`.
    - **Tags:** the first two as `#tag` chips and `+N`, with every tag in `title`.
    - **Host:** only in multi-host mode.
    - **Actions:** `<DeviceControlButtons device reasonId={\`devtable-reason-${device.udid}\`} …/>`. When Control is disabled, add an sr-only `<span id=…>{control.reason}</span>` so `aria-describedby` resolves, and a visible `title` on the cell. Then `<DeviceMoreMenu device actions triggerClassName="devtable-more" />`.
    - Then `{actions.dialogs}`.
    - `className={\`devtable-row${kind === 'offline' ? ' is-offline' : ''}\`}`.
  - **The wrapper** mirrors `DeviceCardWrapper`'s `navigate` (keep `location.search`) and `CardView`'s teams fetch.

  **`device-table.css`** (tokens only):
  - `.devtable` gets `table-layout: fixed; width: 100%`.
  - Column widths go on a `<colgroup>`: Status 150px, Device auto, Platform 120px, Type 80px, Team 120px, Tags 150px, Host 150px, Actions 220px.
  - Row height is `min-height` 44px via cell padding `8px 12px`.
  - `.devtable-muted` is `color: var(--text-muted); font-size: 11px`.
  - Cells truncate: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`, except the Actions cell.
  - The header is sticky: `thead th { position: sticky; top: 0; background: var(--surface); z-index: 1 }`.
  - `.devtable-row.is-offline` is `opacity: 0.6`.
  - `.devtable-sort` is a reset button: font inherit, color inherit, a gap for the arrow, and `:focus-visible` outline `var(--color-focus-ring)`.
  - `.devtable-more` is a 28px icon button matching `.dc2-more`'s look, using the same tokens.
  - No rule may target the shared Button classes.
- [ ] **Step 4: Run** the test file; it PASSES. Then run `npx vitest run src/design src/components/device-card src/components/device-explorer` and `npx tsc --noEmit -p . ; echo tsc=$?` (0), and lint the new files (0).
- [ ] **Step 5: Commit** `feat(devices): a sortable device table`, staging the three files.

---

### Task 4: The switch in the Devices page (TDD)

**Files:**
- Modify: `web/src/components/device-explorer/device-explorer.tsx`, `web/src/components/device-explorer/device-explorer.css`
- Test: `web/src/components/device-explorer/device-explorer.test.tsx`

**Interfaces:**
- Consumes: `DeviceView`, `parseView`, `viewToParams`, `loadView` and `saveView`, plus `DeviceSort`, `parseSort` and `sortToParams` (Task 1); `DeviceTableWrapper` (Task 3).

- [ ] **Step 1: Add failing tests to `device-explorer.test.tsx`.** Follow the file's existing render harness: a router at `/devices` with the device API mocked. The tests:
  - the default is cards;
  - clicking **Table** in the "View" segmented control shows a `table` named "Devices, N shown", puts `view=table` in the URL (read from the router location), and calls `localStorage.setItem('xenon.devices.view', 'table')`;
  - starting at `/devices?view=table` shows the table;
  - a stored `table` preference with no URL param shows the table;
  - clicking the Device header in the table puts `sort=device` in the URL;
  - changing a filter keeps `view=table` and the sort in the URL. This last one is the regression the wrapper change prevents, since `filtersToParams` rebuilds the query string.
- [ ] **Step 2: Run** them; they FAIL.
- [ ] **Step 3: Implement.**
  - **New props:** `view: DeviceView`, `onViewChange(v)`, `sort: DeviceSort` and `onSortChange(s)`.
  - **The switch:** a `SegmentedControl<DeviceView>` with `size="sm"`, `label="View"` and segments Cards and Table, placed in `.de2-result` before the result count.
  - **Render:** `view === 'table' ? <DeviceTableWrapper devices={devices} reloadDevices={…} sort={sort} onSortChange={onSortChange} /> : <CardView …/>` for the same filtered `devices`; the empty state is unchanged.
  - **`DeviceExplorerWrapper`:**

  ```tsx
  const filters = parseFilters(searchParams);
  const view = parseView(searchParams, loadView());
  const sort = parseSort(searchParams);
  const write = (f: DeviceFilters, v: DeviceView, s: DeviceSort) => {
    const params = filtersToParams(f);
    viewToParams(params, v);
    sortToParams(params, s);
    // Replace, so Back leaves the page instead of replaying every keystroke.
    setSearchParams(params, { replace: true });
  };
  // filters={filters} onFiltersChange={(next) => write(next, view, sort)}
  // view={view} onViewChange={(v) => { saveView(v); write(filters, v, sort); }}
  // sort={sort} onSortChange={(s) => write(filters, view, s)}
  ```

  - **CSS:** only if the toolbar needs spacing for the new control; tokens only.
- [ ] **Step 4: Run** the whole web suite (`npx vitest run`) and `npx tsc --noEmit -p . ; echo tsc=$?` (0). Lint `device-explorer.tsx` (≤ main).
- [ ] **Step 5: Commit** `feat(devices): Cards / Table switch, remembered and kept in the link`, staging the changed files.

---

### Task 5: Viewport coverage, live check, PR (controller)

- [ ] **Viewport:** in `web/test/viewport/overflow.spec.ts`, add `'/xenon/devices?view=table'` to `ROUTES`. In `ROUTE_DATA_MOCKS` it gets the same mock function as `'/xenon/devices'`. In `ROUTE_CONTENT_CHECKS` it asserts that the table renders rows (`page.locator('.devtable tbody tr')` `not.toHaveCount(0)`) and that the View control is visible. Run `npm run test:viewport` against the rebuilt lab server.
- [ ] **Card unchanged:** a threshold-0 screenshot of the card grid on the mocked `/xenon/devices` route, taken before and after the branch, must be identical.
- [ ] **Live**, lab server, both themes:
  - the S9+ and the iPhone in the table;
  - sort by every column;
  - Control opens device control;
  - Reserve and then Release the S9+;
  - More → Copy UDID;
  - contrast of the muted lines and the header against their backgrounds.
- [ ] **Suites:** the whole web suite, `tsc`, lint compared with main.
- [ ] **PR:** push, open the PR with `--body-file`, bind it, report.
