# Devices filters and search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Devices page filters by platform (Android / iOS / tvOS) and type (real / virtual), searches everything the card shows, and keeps all filters in the link.

**Architecture:** A pure module, `deviceFilters.ts`, owns the filter model:
- reading filters from the link and writing them back;
- matching a device;
- computing the counts for each control.

The page reads its filters from the URL (`useSearchParams` in its function wrapper) instead of component state, and writes them back with `replace`. The card's open path, device control's tab sync and the dialog's close all carry `location.search`.

**Tech Stack:** React 17, React Router 6.30, Vitest + Testing Library, Playwright (viewport suite and ad-hoc scripts).

Spec: `docs/superpowers/specs/2026-09-26-devices-filters-design.md`

## Global Constraints

- Platform segments: All · Android · iOS, plus tvOS only when `hasTvos(devices)` or `filters.platform === 'tvos'`.
- Type segments: All · Real · Virtual. Virtual's `title` is "Simulators and emulators".
- Control names (`aria-label` on the tablist): "Status", "Platform", "Device type".
- URL keys: `status`, `platform`, `type`, `q`. Defaults are omitted. Unknown values count as All. Every change uses `{ replace: true }`.
- Search placeholder: "Search name, model or UDID…".
- Empty state: heading "No devices match these filters"; text "Try another filter or search, or clear them to see every device."; button "Clear filters".
- No raw hex or `rgba()` literals (the colour ratchet). Supported widths are 1280–1440.
- Never run `eslint --fix` on whole files. Compare lint counts against main. Stage explicit paths.

---

### Task 1: The filter model (`deviceFilters.ts`)

**Files:**
- Create: `web/src/components/device-explorer/deviceFilters.ts`
- Test: `web/src/components/device-explorer/deviceFilters.test.ts`

**Interfaces:**
- Consumes: `deviceState`, `DEVICE_STATES` and `DeviceState` from `../device-card/device-card/deviceState`; `deviceTitle` from `../device-card/device-card/deviceIdentity`; `platformLabel` from `../../lib/labels`; `IDevice`.
- Produces:
  - `type StatusFilter = 'all' | DeviceState`
  - `type PlatformFilter = 'all' | 'android' | 'ios' | 'tvos'`
  - `type TypeFilter = 'all' | 'real' | 'virtual'`
  - `interface DeviceFilters { status: StatusFilter; platform: PlatformFilter; type: TypeFilter; q: string }`
  - `const NO_FILTERS: DeviceFilters`
  - `parseFilters(params: URLSearchParams): DeviceFilters`
  - `filtersToParams(f: DeviceFilters): URLSearchParams`
  - `isVirtual(d: Pick<IDevice, 'deviceType' | 'realDevice'>): boolean`
  - `searchText(d: IDevice): string`
  - `deviceMatches(d: IDevice, f: DeviceFilters, now: number, ignore?: 'status' | 'platform' | 'type'): boolean`
  - `interface FacetCounts { status: Record<StatusFilter, number>; platform: Record<PlatformFilter, number>; type: Record<TypeFilter, number> }`
  - `facetCounts(devices: IDevice[], f: DeviceFilters, now: number): FacetCounts`
  - `hasTvos(devices: IDevice[]): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';
import {
  deviceMatches,
  facetCounts,
  filtersToParams,
  hasTvos,
  isVirtual,
  NO_FILTERS,
  parseFilters,
  type DeviceFilters,
} from './deviceFilters';

const NOW = 1_700_000_000_000;
const dev = (over: Partial<IDevice>): IDevice => ({
  name: 'x',
  host: 'http://127.0.0.1:4723',
  udid: 'U',
  sdk: '14',
  deviceType: 'real',
  offline: false,
  userBlocked: false,
  busy: false,
  platform: 'android',
  realDevice: true,
  ...over,
});

const S9 = dev({
  udid: '381103b720057ece',
  name: 'star2ltexx',
  marketingName: 'Galaxy S9+',
  model: 'SM-G965F',
  manufacturer: 'samsung',
  sdk: '10',
  teamName: 'Payments',
});
const IPHONE = dev({
  udid: '00008150-000E78612168C01C',
  name: 'iPhone',
  marketingName: 'iPhone 17 Pro',
  platform: 'ios',
  sdk: '26.1',
  busy: true,
  session_id: 'sess-1',
});
const SIM = dev({
  udid: 'SIM-1',
  name: 'iPhone 16 Simulator',
  platform: 'ios',
  deviceType: 'simulator',
  realDevice: false,
  sdk: '18.2',
});
const EMU = dev({
  udid: 'emulator-5554',
  name: 'Pixel 8 API 34',
  deviceType: 'emulator',
  realDevice: false,
  offline: true,
});
const TV = dev({ udid: 'TV-1', name: 'Living Room', platform: 'tvos', sdk: '18.0' });
const ALL = [S9, IPHONE, SIM, EMU];

const f = (over: Partial<DeviceFilters>): DeviceFilters => ({ ...NO_FILTERS, ...over });
const shown = (filters: DeviceFilters) =>
  ALL.filter((d) => deviceMatches(d, filters, NOW)).map((d) => d.udid);

describe('parseFilters / filtersToParams', () => {
  it('round-trips every filter through the link', () => {
    const filters = f({ status: 'ready', platform: 'ios', type: 'real', q: 'galaxy' });
    const params = filtersToParams(filters);
    expect(params.toString()).toBe('status=ready&platform=ios&type=real&q=galaxy');
    expect(parseFilters(params)).toEqual(filters);
  });

  it('leaves defaults out, so plain /devices shows everything', () => {
    expect(filtersToParams(NO_FILTERS).toString()).toBe('');
    expect(filtersToParams(f({ q: '   ' })).toString()).toBe('');
    expect(parseFilters(new URLSearchParams(''))).toEqual(NO_FILTERS);
  });

  it('treats an unknown value as All', () => {
    expect(parseFilters(new URLSearchParams('status=banana&platform=windows&type=robot'))).toEqual(
      NO_FILTERS,
    );
  });

  it('accepts tvOS', () => {
    expect(parseFilters(new URLSearchParams('platform=tvos')).platform).toBe('tvos');
  });

  // The box is filled from the link: trimming there would eat the space typed
  // before the next word.
  it('keeps a trailing space while you type', () => {
    expect(parseFilters(filtersToParams(f({ q: 'samsung ' }))).q).toBe('samsung ');
  });
});

describe('isVirtual', () => {
  it('counts simulators and emulators as virtual', () => {
    expect(isVirtual({ deviceType: 'simulator', realDevice: false })).toBe(true);
    expect(isVirtual({ deviceType: 'emulator', realDevice: false })).toBe(true);
    expect(isVirtual({ deviceType: 'real', realDevice: true })).toBe(false);
  });

  it('falls back to realDevice when the type is missing', () => {
    expect(isVirtual({ deviceType: undefined as any, realDevice: false })).toBe(true);
    expect(isVirtual({ deviceType: undefined as any, realDevice: true })).toBe(false);
  });
});

describe('deviceMatches', () => {
  it('filters by platform', () => {
    expect(shown(f({ platform: 'ios' }))).toEqual([IPHONE.udid, SIM.udid]);
    expect(shown(f({ platform: 'android' }))).toEqual([S9.udid, EMU.udid]);
  });

  it('filters by type', () => {
    expect(shown(f({ type: 'real' }))).toEqual([S9.udid, IPHONE.udid]);
    expect(shown(f({ type: 'virtual' }))).toEqual([SIM.udid, EMU.udid]);
  });

  it('filters by status', () => {
    expect(shown(f({ status: 'busy' }))).toEqual([IPHONE.udid]);
    expect(shown(f({ status: 'offline' }))).toEqual([EMU.udid]);
  });

  it('combines the filters', () => {
    expect(shown(f({ platform: 'ios', type: 'virtual' }))).toEqual([SIM.udid]);
    expect(shown(f({ platform: 'android', type: 'real', status: 'ready' }))).toEqual([S9.udid]);
  });
});

describe('search', () => {
  // The card shows "Galaxy S9+"; search used to match only name and udid.
  it('finds the name the card shows, and the codename', () => {
    expect(shown(f({ q: 'Galaxy' }))).toEqual([S9.udid]);
    expect(shown(f({ q: 'star2' }))).toEqual([S9.udid]);
  });

  it('needs every word, in any order, across maker, model and OS version', () => {
    expect(shown(f({ q: '10 samsung' }))).toEqual([S9.udid]);
    expect(shown(f({ q: 'sm-g965f' }))).toEqual([S9.udid]);
    expect(shown(f({ q: 'samsung 26' }))).toEqual([]);
  });

  it('finds a UDID fragment, the kind of virtual device and the team', () => {
    expect(shown(f({ q: '000e7861' }))).toEqual([IPHONE.udid]);
    expect(shown(f({ q: 'emulator' }))).toEqual([EMU.udid]);
    expect(shown(f({ q: 'payments' }))).toEqual([S9.udid]);
  });

  it('matches everything for an empty or blank query', () => {
    expect(shown(f({ q: '  ' }))).toHaveLength(4);
  });
});

describe('facetCounts', () => {
  it("counts each control with the other filters but not its own", () => {
    const c = facetCounts(ALL, f({ platform: 'ios' }), NOW);
    expect(c.status).toEqual({ all: 2, ready: 1, busy: 1, reserved: 0, maintenance: 0, offline: 0 });
    expect(c.platform).toEqual({ all: 4, android: 2, ios: 2, tvos: 0 });
    expect(c.type).toEqual({ all: 2, real: 1, virtual: 1 });
  });

  it('applies the search to every control', () => {
    const c = facetCounts(ALL, f({ q: 'iphone' }), NOW);
    expect(c.platform).toEqual({ all: 2, android: 0, ios: 2, tvos: 0 });
    expect(c.status.all).toBe(2);
    expect(c.type.all).toBe(2);
  });

  it('adds each control up to its All', () => {
    const c = facetCounts([...ALL, TV], f({ status: 'ready' }), NOW);
    const sum = (r: Record<string, number>) =>
      Object.entries(r).reduce((n, [k, v]) => (k === 'all' ? n : n + v), 0);
    expect(sum(c.status)).toBe(c.status.all);
    expect(sum(c.platform)).toBe(c.platform.all);
    expect(sum(c.type)).toBe(c.type.all);
  });
});

describe('hasTvos', () => {
  it('is true only when the list has a tvOS device', () => {
    expect(hasTvos(ALL)).toBe(false);
    expect(hasTvos([...ALL, TV])).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd web && npx vitest run src/components/device-explorer/deviceFilters.test.ts`
Expected: FAIL, "Failed to resolve import './deviceFilters'".

- [ ] **Step 3: Implement**

```ts
import type { IDevice } from '../../interfaces/IDevice';
import { platformLabel } from '../../lib/labels';
import { deviceTitle } from '../device-card/device-card/deviceIdentity';
import {
  DEVICE_STATES,
  deviceState,
  type DeviceState,
} from '../device-card/device-card/deviceState';

// One state per device, shared with the cards, so the filters add up to All.
export type StatusFilter = 'all' | DeviceState;
export type PlatformFilter = 'all' | 'android' | 'ios' | 'tvos';
export type TypeFilter = 'all' | 'real' | 'virtual';

export interface DeviceFilters {
  status: StatusFilter;
  platform: PlatformFilter;
  type: TypeFilter;
  /** As typed: the box is filled from the link, so it keeps a trailing space. */
  q: string;
}

export const NO_FILTERS: DeviceFilters = { status: 'all', platform: 'all', type: 'all', q: '' };

const STATUSES: StatusFilter[] = ['all', ...DEVICE_STATES];
const PLATFORMS: PlatformFilter[] = ['all', 'android', 'ios', 'tvos'];
const TYPES: TypeFilter[] = ['all', 'real', 'virtual'];

// An unknown value (an old link, a typo) counts as All.
function pick<T extends string>(value: string | null, allowed: T[]): T {
  return allowed.includes(value as T) ? (value as T) : allowed[0];
}

export function parseFilters(params: URLSearchParams): DeviceFilters {
  const q = params.get('q') ?? '';
  return {
    status: pick(params.get('status'), STATUSES),
    platform: pick(params.get('platform'), PLATFORMS),
    type: pick(params.get('type'), TYPES),
    q: q.trim() ? q : '',
  };
}

/** Defaults are left out, so plain /devices shows everything. */
export function filtersToParams(f: DeviceFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.status !== 'all') params.set('status', f.status);
  if (f.platform !== 'all') params.set('platform', f.platform);
  if (f.type !== 'all') params.set('type', f.type);
  if (f.q.trim()) params.set('q', f.q);
  return params;
}

export function isVirtual(d: Pick<IDevice, 'deviceType' | 'realDevice'>): boolean {
  if (d.deviceType === 'simulator' || d.deviceType === 'emulator') return true;
  return !d.deviceType && d.realDevice === false;
}

function platformOf(d: IDevice): PlatformFilter | null {
  const p = (d.platform || '').toLowerCase();
  return p === 'android' || p === 'ios' || p === 'tvos' ? p : null;
}

/** Everything the card shows, so any of it can be searched. */
export function searchText(d: IDevice): string {
  const kind =
    d.deviceType === 'emulator' ? 'Emulator' : d.deviceType === 'simulator' ? 'Simulator' : '';
  return [
    deviceTitle(d),
    d.name,
    d.manufacturer,
    d.model,
    platformLabel(d.platform),
    d.sdk,
    kind,
    d.teamName,
    d.udid,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** `ignore` leaves one filter out, for that control's own counts. */
export function deviceMatches(
  d: IDevice,
  f: DeviceFilters,
  now: number,
  ignore?: 'status' | 'platform' | 'type',
): boolean {
  if (ignore !== 'status' && f.status !== 'all' && deviceState(d, now) !== f.status) return false;
  if (ignore !== 'platform' && f.platform !== 'all' && platformOf(d) !== f.platform) return false;
  if (ignore !== 'type' && f.type !== 'all') {
    if ((f.type === 'virtual') !== isVirtual(d)) return false;
  }
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = searchText(d);
  return words.every((w) => text.includes(w));
}

export interface FacetCounts {
  status: Record<StatusFilter, number>;
  platform: Record<PlatformFilter, number>;
  type: Record<TypeFilter, number>;
}

const zeros = <T extends string>(keys: T[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;

/**
 * Each control's counts apply the other filters and the search but not its
 * own selection, so a number is what clicking it would show.
 */
export function facetCounts(devices: IDevice[], f: DeviceFilters, now: number): FacetCounts {
  const status = zeros(STATUSES);
  const platform = zeros(PLATFORMS);
  const type = zeros(TYPES);
  for (const d of devices) {
    if (deviceMatches(d, f, now, 'status')) {
      status.all += 1;
      status[deviceState(d, now)] += 1;
    }
    if (deviceMatches(d, f, now, 'platform')) {
      platform.all += 1;
      const p = platformOf(d);
      if (p) platform[p] += 1;
    }
    if (deviceMatches(d, f, now, 'type')) {
      type.all += 1;
      type[isVirtual(d) ? 'virtual' : 'real'] += 1;
    }
  }
  return { status, platform, type };
}

/** tvOS gets a segment only when the lab has one: an always-empty one is noise. */
export function hasTvos(devices: IDevice[]): boolean {
  return devices.some((d) => platformOf(d) === 'tvos');
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run src/components/device-explorer/deviceFilters.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-explorer/deviceFilters.ts web/src/components/device-explorer/deviceFilters.test.ts
git commit -m "feat(devices): filter model — platform, type, status, search, link round trip, counts"
```

### Task 2: Name a `SegmentedControl` for screen readers

**Files:**
- Modify: `web/src/components/ui/SegmentedControl.tsx`
- Test: `web/src/components/ui/segmented-control.test.tsx`

**Interfaces:**
- Produces: `SegmentedControlProps.label?: string`, which sets `aria-label` on the `role="tablist"` element.

- [ ] **Step 1: Write the failing test** (append inside `describe('SegmentedControl')`)

```tsx
  // Devices has three filter controls; unnamed, a screen reader hears three
  // identical tab lists.
  it('names the control when given a label', () => {
    render(
      <SegmentedControl
        label="Platform"
        segments={[{ value: 'a', label: 'A' }]}
        value="a"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Platform' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/components/ui/segmented-control.test.tsx`
Expected: FAIL, "Unable to find role 'tablist' with name 'Platform'" (plus a TS complaint about `label`).

- [ ] **Step 3: Implement.** In `SegmentedControlProps`, add:

```ts
  /** Names the control for screen readers, e.g. "Platform". */
  label?: string;
```

Destructure `label` and render `<div className={`seg seg-${size}`} role="tablist" aria-label={label}>`.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd web && npx vitest run src/components/ui/segmented-control.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui/SegmentedControl.tsx web/src/components/ui/segmented-control.test.tsx
git commit -m "feat(ui): SegmentedControl label names the control for screen readers"
```

### Task 3: The Devices page reads its filters from the link

**Files:**
- Modify: `web/src/components/device-explorer/device-explorer.tsx`
- Modify: `web/src/components/device-explorer/device-explorer.css` (the second toolbar row)
- Modify: `web/src/components/device-card/device-card/device-card.tsx` (`DeviceCardWrapper`: open keeps the query)
- Modify: `web/src/components/device-control/device-control.tsx` (the tab sync keeps the query)
- Test: `web/src/components/device-explorer/device-explorer.test.tsx` (new)

**Interfaces:**
- Consumes: everything Task 1 produces; `SegmentedControl` `label` (Task 2).
- Produces: `DeviceExplorer` props gain `filters: DeviceFilters`, `onFiltersChange: (f: DeviceFilters) => void` and `locationSearch: string`.

- [ ] **Step 1: Write the failing page tests**

```tsx
import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';

vi.mock('../../hooks/useSocket', () => ({ useSocket: () => ({ on: () => () => {} }) }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ me: { userId: 'me', role: 'MEMBER', teams: [] } }),
}));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
// Device control streams video; the page only needs its close button.
vi.mock('../device-control/device-control', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      Close device
    </button>
  ),
}));

const base = {
  host: 'http://127.0.0.1:4723',
  sdk: '14',
  offline: false,
  userBlocked: false,
  busy: false,
  session_id: null,
} as const;
const DEVICES: IDevice[] = [
  { ...base, udid: 'U-S9', name: 'star2ltexx', marketingName: 'Galaxy S9+', platform: 'android', deviceType: 'real', realDevice: true },
  { ...base, udid: 'U-IOS', name: 'iPhone', marketingName: 'iPhone 17 Pro', platform: 'ios', deviceType: 'real', realDevice: true },
  { ...base, udid: 'U-SIM', name: 'iPhone 16 Simulator', platform: 'ios', deviceType: 'simulator', realDevice: false },
];
vi.mock('../../api-service', () => ({
  default: {
    getDevices: async () => DEVICES,
    getPendingSessionsCount: async () => 0,
    getQueueSummary: async () => null,
    listTeams: async () => [],
  },
}));

import DeviceExplorerWrapper from './device-explorer';

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const page = (
  <>
    <DeviceExplorerWrapper />
    <Where />
  </>
);
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/devices" element={page} />
        <Route path="/devices/:udid/control/:tab?" element={page} />
      </Routes>
    </MemoryRouter>,
  );
const where = () => screen.getByTestId('where').textContent;
const tab = (control: string, name: RegExp) =>
  within(screen.getByRole('tablist', { name: control })).getByRole('tab', { name });

describe('Devices page filters', () => {
  it('opens pre-filtered from the link', async () => {
    renderAt('/devices?platform=ios');
    expect(await screen.findByText('iPhone 17 Pro')).toBeInTheDocument();
    expect(screen.getByText('iPhone 16 Simulator')).toBeInTheDocument();
    expect(screen.queryByText('Galaxy S9+')).toBeNull();
  });

  it('writes a clicked filter into the link', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    fireEvent.click(tab('Platform', /^Android/));
    expect(where()).toBe('/devices?platform=android');
    expect(screen.queryByText('iPhone 17 Pro')).toBeNull();
    fireEvent.click(tab('Device type', /^Virtual/));
    expect(where()).toBe('/devices?platform=android&type=virtual');
  });

  it('searches the name the card shows', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search devices' }), {
      target: { value: 'galaxy' },
    });
    expect(where()).toBe('/devices?q=galaxy');
    expect(screen.getByText('Galaxy S9+')).toBeInTheDocument();
    expect(screen.queryByText('iPhone 17 Pro')).toBeNull();
  });

  it('says when nothing matches, and Clear filters shows every device', async () => {
    renderAt('/devices?platform=ios&q=nothing-like-this');
    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByText('No devices match these filters')).toBeNull();
    expect(where()).toBe('/devices');
    expect(await screen.findByText('Galaxy S9+')).toBeInTheDocument();
  });

  it('keeps the filters when a device is opened and closed', async () => {
    renderAt('/devices?platform=ios');
    await screen.findByText('iPhone 17 Pro');
    const card = screen.getByText('iPhone 17 Pro').closest('.dc2') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Control' }));
    expect(where()).toBe('/devices/U-IOS/control?platform=ios');
    fireEvent.click(await screen.findByRole('button', { name: 'Close device' }));
    expect(where()).toBe('/devices?platform=ios');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npx vitest run src/components/device-explorer/device-explorer.test.tsx`
Expected: FAIL. There is no tablist named "Platform", the link isn't read, and the close goes to `/devices`.

- [ ] **Step 3: Implement the page**

In `device-explorer.tsx`:

1. Imports: add `useLocation` and `useSearchParams` from `react-router-dom`, and:
   ```ts
   import {
     facetCounts,
     filtersToParams,
     hasTvos,
     NO_FILTERS,
     parseFilters,
     deviceMatches,
     type DeviceFilters,
     type PlatformFilter,
     type StatusFilter,
     type TypeFilter,
   } from './deviceFilters';
   import type { Segment } from '../ui/SegmentedControl';
   ```
   Remove the local `type StatusFilter` and the now-unused `deviceState` and `DeviceState` import.
2. State: remove `statusFilter` and `search` from `IDeviceExplorerState` and from the constructor.
3. Props: add
   ```ts
   filters: DeviceFilters;
   onFiltersChange: (filters: DeviceFilters) => void;
   /** The current query string, kept when a device is closed. */
   locationSearch: string;
   ```
4. Replace `getFiltered` and `statusCount` with:
   ```ts
   setFilters(patch: Partial<DeviceFilters>) {
     this.props.onFiltersChange({ ...this.props.filters, ...patch });
   }

   getFiltered(): IDevice[] {
     const now = Date.now();
     return this.state.devices.filter((d) => deviceMatches(d, this.props.filters, now));
   }
   ```
5. In `render()`, compute:
   ```ts
   const { filters } = this.props;
   const counts = facetCounts(this.state.devices, filters, Date.now());
   const platformSegments: Segment<PlatformFilter>[] = [
     { value: 'all', label: 'All', count: counts.platform.all },
     { value: 'android', label: 'Android', count: counts.platform.android },
     { value: 'ios', label: 'iOS', count: counts.platform.ios },
   ];
   if (hasTvos(this.state.devices) || filters.platform === 'tvos') {
     platformSegments.push({ value: 'tvos', label: 'tvOS', count: counts.platform.tvos });
   }
   const closeTo = `/devices${this.props.locationSearch}`;
   ```
6. The toolbar becomes:
   ```tsx
   <div className="de2-toolbar">
     <SegmentedControl<StatusFilter>
       size="sm"
       label="Status"
       value={filters.status}
       onChange={(v) => this.setFilters({ status: v })}
       segments={[
         { value: 'all', label: 'All', count: counts.status.all },
         // Each dot is the colour of that state's cards.
         { value: 'ready', label: 'Ready', tone: 'ready', count: counts.status.ready },
         { value: 'busy', label: 'Busy', tone: 'busy', count: counts.status.busy },
         { value: 'reserved', label: 'Reserved', tone: 'reserved', count: counts.status.reserved },
         {
           value: 'maintenance',
           label: 'Maintenance',
           tone: 'maintenance',
           count: counts.status.maintenance,
         },
         { value: 'offline', label: 'Offline', tone: 'offline', count: counts.status.offline },
       ]}
     />
     {/* Platform and type sit with the search on a row of their own. */}
     <div className="de2-toolbar-row">
       <SegmentedControl<PlatformFilter>
         size="sm"
         label="Platform"
         value={filters.platform}
         onChange={(v) => this.setFilters({ platform: v })}
         segments={platformSegments}
       />
       <SegmentedControl<TypeFilter>
         size="sm"
         label="Device type"
         value={filters.type}
         onChange={(v) => this.setFilters({ type: v })}
         segments={[
           { value: 'all', label: 'All', count: counts.type.all },
           { value: 'real', label: 'Real', count: counts.type.real },
           {
             value: 'virtual',
             label: 'Virtual',
             title: 'Simulators and emulators',
             count: counts.type.virtual,
           },
         ]}
       />
       {/* Search and Refresh wrap together: alone on a line, Refresh looked
           stranded. */}
       <div className="de2-find">
         <input
           type="text"
           className="de2-search"
           aria-label="Search devices"
           placeholder="Search name, model or UDID…"
           value={filters.q}
           onChange={(e) => this.setFilters({ q: e.target.value })}
         />
         <Button variant="secondary" size="sm" onClick={() => this.fetchDevices()}>
           <RefreshCw size={12} /> Refresh
         </Button>
       </div>
     </div>
   </div>
   ```
7. The "filters hide everything" branch becomes:
   ```tsx
   <>
     <h3>No devices match these filters</h3>
     <p>Try another filter or search, or clear them to see every device.</p>
     <Button variant="secondary" onClick={() => this.props.onFiltersChange(NO_FILTERS)}>
       Clear filters
     </Button>
   </>
   ```
8. Both `onClose` handlers become `() => this.props.navigate(closeTo)`.
9. The wrapper:
   ```tsx
   export default function DeviceExplorerWrapper() {
     const params = useParams();
     const navigate = useNavigate();
     const location = useLocation();
     const [searchParams, setSearchParams] = useSearchParams();
     const { on } = useSocket();
     return (
       <DeviceExplorer
         params={params}
         navigate={navigate}
         onSocketEvent={on}
         filters={parseFilters(searchParams)}
         // Replace, so Back leaves the page instead of replaying every keystroke.
         onFiltersChange={(next) => setSearchParams(filtersToParams(next), { replace: true })}
         locationSearch={location.search}
       />
     );
   }
   ```

In `device-explorer.css`, after `.de2-toolbar`:

```css
/* Takes a line of its own inside the wrapping toolbar, under the statuses. */
.de2-toolbar-row {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
```

In `device-card.tsx`, `DeviceCardWrapper`:

```tsx
  const navigate = useNavigate();
  // Opening a device keeps the Devices filters, so closing it returns to them.
  const { search } = useLocation();
  return (
    <DeviceCard
      device={props.device}
      reloadDevices={props.reloadDevices}
      navigate={(path) => navigate(`${path}${search}`)}
      teams={props.teams}
    />
  );
```

Also add `useLocation` to its `react-router-dom` import.

In `device-control.tsx`, add `useLocation` to the import and `const location = useLocation();` after `const { tab } = useParams();`. The tab sync becomes:

```ts
      navigate(`/devices/${device.udid}/control/${activeTab}${location.search}`, { replace: true });
    }
  }, [activeTab, tab, device.udid, navigate, location.search]);
```

DeviceControl has no unit harness (it starts a stream on mount), so this path is checked live in Task 5.

- [ ] **Step 4: Run the page tests and the whole web suite**

Run: `cd web && npx vitest run src/components/device-explorer/ && npx vitest run && npx tsc --noEmit -p .`
Expected: the 5 page tests pass; the whole web suite passes; tsc is clean.

- [ ] **Step 5: Lint the changed files against main**

Run: `cd web && npx eslint src/components/device-explorer/ src/components/device-card/device-card/device-card.tsx src/components/device-control/device-control.tsx src/components/ui/SegmentedControl.tsx`, then on main's copies of the same files (`git show main:<path>` into the scratchpad, linted with the same config) to compare counts.
Expected: no new problems. Fix any in my own lines by hand, never with `--fix`.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/device-explorer/device-explorer.tsx web/src/components/device-explorer/device-explorer.css web/src/components/device-explorer/device-explorer.test.tsx web/src/components/device-card/device-card/device-card.tsx web/src/components/device-control/device-control.tsx
git commit -m "feat(devices): platform and type filters, search everything the card shows, filters kept in the link"
```

### Task 4: The viewport suite covers the new toolbar

**Files:**
- Modify: `web/test/viewport/overflow.spec.ts` (the `/xenon/devices` mock and content check)

- [ ] **Step 1: Give the mocked devices types, and add an iOS simulator.** In the `'/xenon/devices'` entry of `ROUTE_DATA_MOCKS`:
  - add `deviceType: 'real', realDevice: true` to the iPhone;
  - add `deviceType: 'emulator', realDevice: false` to the Pixel Tablet;
  - append:

```ts
          {
            udid: '5C2E7A31-9F7B-4D2B-8E7A-1B2C3D4E5F60',
            name: 'iPhone 16 Pro Max Simulator (Xcode 26, CI Node 3 — Shared Pool)',
            platform: 'ios',
            sdk: '26.0',
            deviceType: 'simulator',
            realDevice: false,
            state: 'Booted',
            busy: false,
            offline: false,
            userBlocked: false,
            teamId: null,
            tags: [],
            session_id: null,
            host: 'http://127.0.0.1:4723',
            screenWidth: '440',
            screenHeight: '956',
          },
```

- [ ] **Step 2: Prove that the toolbar under test is the new one.** In `ROUTE_CONTENT_CHECKS['/xenon/devices']`, add:

```ts
    // The two-row toolbar is what's being measured.
    await expect(page.getByRole('tablist', { name: 'Platform' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Device type' })).toBeVisible();
```

- [ ] **Step 3: Build, restart and run.** Run `npm run build:xenon && npm run build:copy`, then restart the lab server with `scratchpad/restart.sh`, then `cd web && npx playwright test -g devices`.
  - Expected: PASS at 1280, 1281, 1399, 1400 and 1440.
  - If the lab server's auth redirects the suite to `/login`, measure the same thing with an ad-hoc Playwright script that also mocks `/xenon/api/auth/me` (the pattern in `scratchpad/filters.mjs`). It must check that no element in `.de2-toolbar` has `rect.left < 0` or `rect.right > innerWidth` at 1280 and 1440, and that the platform, type and search controls sit on one row below the statuses.

- [ ] **Step 4: Commit**

```bash
git add web/test/viewport/overflow.spec.ts
git commit -m "test(viewport): Devices mock gains virtual devices; the filter toolbar is measured"
```

### Task 5: Live verification and the PR

- [ ] **Step 1:** With the built bundle on the lab server, as the real user at `/xenon/devices`:
  - Android shows only the S9+; iOS only the iPhone, if it's connected.
  - "Galaxy" and "SM-G965F" find the S9+.
  - The link reads `?platform=android&q=galaxy`, and a reload keeps it.
  - Control on the S9+ opens `/devices/381103b720057ece/control/screen?platform=android…`. That's the tab sync. Closing returns to the filtered list.
- [ ] **Step 2:** Check contrast via computed styles in dark and light: the new segments (active, inactive and zero count) and the placeholder. Take screenshots at 1280 in both themes.
- [ ] **Step 3:** Push `feat/devices-filters` and open the PR with the evidence.
