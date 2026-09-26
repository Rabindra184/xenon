# Devices page: platform and type filters, search by name — design

Date: 2026-09-26
Status: approved in brainstorming, awaiting spec review

## Why

The Devices page (`/devices`) can filter by status only. Nobody can ask for
"the iOS devices" or "the real Android phones", although every device already
records both:

- `platform`: `android`, `ios` or `tvos`;
- `deviceType`: `real`, `simulator` or `emulator`, with a `realDevice` boolean.

The cards use these already for the subtitle ("Emulator · Android 14") and
for the dashed outline on virtual devices.

Search can't find the name the card shows. It matches `name` and `udid`
only (`getFiltered` in `device-explorer.tsx`). Since #309 the card's title is
`marketingName`. On the lab Galaxy S9+, `name` is `star2ltexx`, so typing
"Galaxy" finds nothing. The model (SM-G965F) and the maker aren't searchable
either.

Decisions made in brainstorming:

| Question | Decision |
|---|---|
| How the new filters appear | Segmented controls in the toolbar, in the same style as the status filter |
| Whether filters are remembered | In the link: they survive a reload and opening and closing a device, and the link shares the view |

## Behaviour

### The toolbar

At laptop width (1280–1440) the toolbar has two rows:

1. **Status**, unchanged: All · Ready · Busy · Reserved · Maintenance · Offline.
2. **Platform**, **Type**, the search box, and Refresh.

The rows come from the existing `flex-wrap` in `.de2-toolbar`. Nothing forces
a break. The search box takes the remaining width of its row.

- **Platform:** All · Android · iOS.
  - A **tvOS** segment is added only when the device list has a tvOS device,
    or when the link already asks for `platform=tvos`. Most labs have none,
    and an always-empty segment is noise.
  - A device with any other platform value appears under All only.
- **Type:** All · Real · Virtual.
  - Virtual's tooltip reads "Simulators and emulators".
  - A device is **virtual** when `deviceType` is `simulator` or `emulator`,
    or when `deviceType` is missing and `realDevice` is `false`. Otherwise it
    is **real**.
- **Accessible names.** Each control is named "Status", "Platform" and
  "Device type" through a new optional `label` prop on `SegmentedControl`,
  which sets `aria-label` on its tablist. Without names, a screen reader
  hears three identical unnamed tab lists.
- Segments show counts, and a zero count fades (`.seg-count-zero`), as
  today.

### Counts

Each control's counts account for the **other** filters and the search, but
not for the control's own selection.

- With Platform = iOS, "Ready 3" means 3 ready iOS devices.
- With Status = Ready, "Android 2" means 2 ready Android devices.
- So a number is always what you get by clicking it, and each control's
  segments still add up to its All.

### Search

- Case-insensitive. The query is split on whitespace, and **every word** must
  appear somewhere in the device's search text.
- The search text holds, space-separated:
  - the shown name (`deviceTitle`) and `name` (the codename);
  - `manufacturer` and `model`;
  - the platform label and the OS version, for example "Android 10";
  - "Emulator" or "Simulator" for a virtual device;
  - `teamName`;
  - `udid`.
- So "galaxy", "SM-G965F", "samsung 10", "iphone" and a UDID fragment all
  find the device.
- An empty or whitespace-only query matches everything.
- The placeholder becomes "Search name, model or UDID…".

### The link

- Filters live in the query string:
  `/devices?status=ready&platform=ios&type=real&q=galaxy`.
- The page reads its filters from the link. It does not keep its own copy,
  so there is one source of truth.
- Defaults are left out: All is never written, and neither is an empty or
  whitespace-only search. Plain `/devices` shows everything.
- An unknown value is ignored and counts as All, for example
  `status=banana` or `platform=windows`. `platform=tvos` is always accepted.
- Every change **replaces** the history entry. Back leaves the page instead
  of stepping through each keystroke or click.
- **Opening and closing a device keeps the filters.** Today all three paths
  drop the query:
  - the card opens `/devices/<udid>/control`, in `device-card.tsx`;
  - device control syncs its tab into the URL (`/devices/<udid>/control/<tab>`,
    with `replace`), in `device-control.tsx`;
  - closing goes to `/devices`, in both `onClose` handlers of
    `device-explorer.tsx`.

  Each carries the current query string (`location.search`) instead.
  Links from elsewhere, such as the Overview page's fleet status, have no
  query, and nothing changes for them.

### Nothing matches

When the filters hide every device, the empty state reads:

- Heading: "No devices match these filters"
- Text: "Try another filter or search, or clear them to see every device."
- Button: **Clear filters**, which resets status, platform, type and search.

This replaces "No Devices Found / Deployment configuration mismatch…". The
empty-registry and loading states are unchanged.

## Code

| File | Change |
|---|---|
| `web/src/components/device-explorer/deviceFilters.ts` (new) | Pure. Types: `StatusFilter = 'all' \| DeviceState`, `PlatformFilter = 'all' \| 'android' \| 'ios' \| 'tvos'`, `TypeFilter = 'all' \| 'real' \| 'virtual'`, `DeviceFilters = { status; platform; type; q: string }`. Functions: `parseFilters(params: URLSearchParams): DeviceFilters`; `filtersToParams(f): URLSearchParams`; `isVirtual(d): boolean`; `searchText(d): string`; `deviceMatches(d, f, now): boolean`; `facetCounts(devices, f, now)`, which returns `{ status: Record<StatusFilter, number>; platform: Record<PlatformFilter, number>; type: Record<TypeFilter, number> }`; `hasTvos(devices): boolean` |
| `web/src/components/device-explorer/device-explorer.tsx` | `statusFilter` and `search` leave component state. The wrapper reads `useSearchParams`, passes `filters` and `onFiltersChange` (which calls `setSearchParams(filtersToParams(next), { replace: true })`) and the query string for the close paths. It renders the Platform and Type controls, the new empty state and the new placeholder. |
| `web/src/components/ui/SegmentedControl.tsx` | Optional `label` sets `aria-label` on the tablist |
| `web/src/components/device-card/device-card/device-card.tsx` | Open keeps `location.search` |
| `web/src/components/device-control/device-control.tsx` | The tab sync keeps `location.search` |

No server changes. `GET /device` already returns every field used here.

## Testing

Tests written first:

- **`deviceFilters`:**
  - `parseFilters` and `filtersToParams`: a round trip; defaults omitted;
    unknown values give All; a whitespace-only `q` is dropped.
  - `isVirtual`: simulator, emulator, real, and a missing `deviceType` with
    `realDevice: false`.
  - `deviceMatches`: each filter on its own, and all together.
  - Search: the shown name, the codename, maker plus OS version ("samsung
    10"), the model, a UDID fragment, and a word that matches nothing.
  - `facetCounts`: each control's counts ignore its own selection but not
    the others, and add up to its All.
  - `hasTvos`.
- **`SegmentedControl`:** `label` names the tablist.
- **Devices page** (Testing Library, `MemoryRouter`):
  - a link with `?platform=ios` shows only iOS cards;
  - clicking Android updates the link;
  - Clear filters empties the query and shows every card;
  - closing a device keeps the query.
- **Viewport suite** (`web/test/viewport/overflow.spec.ts`): the Devices
  mock gains an iOS simulator and an Android emulator. The two-row toolbar
  must not overflow at 1280 or 1440.
- **Live**, as the real user, on the lab S9+ and iPhone:
  - filter by Android and by iOS;
  - search "Galaxy" and "SM-G965F";
  - reload, and open and close a device, with the filters kept each time;
  - check contrast in both themes via computed styles.

  Virtual is covered by the mocks unless a simulator or emulator is
  available to the lab server.

## Out of scope

- Team or tag filters, and saved views.
- The Live Devices picker's own list and filter.
- Server-side filtering: the page already loads the whole list.
