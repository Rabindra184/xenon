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
| How the new filters appear | Revised after the first build (see below): status tabs plus filter menus |
| Whether filters are remembered | In the link: they survive a reload and opening and closing a device, and the link shares the view |

**Revision.** The first build used three segmented controls of equal weight,
with 15 counts and "All" three times. Platform and Type had no visible label,
search came last, and a Team or Tags filter would add yet more pill groups.
Reviewed in the browser, it read as busy. The toolbar below replaces it:
Status keeps its one-click tabs, and Platform and Type become filter menus.

## Behaviour

### The toolbar

At laptop width (1280–1440) the toolbar has two rows. A wrapper with
`flex-basis: 100%` forces the second row. Left to right:

1. **Status**, unchanged: one-click segments, with a coloured dot and a count
   for All · Ready · Busy · Reserved · Maintenance · Offline. It is named
   "Status" for screen readers (`SegmentedControl`'s new `label` prop sets
   `aria-label` on its tablist). Status is the question people ask most
   ("what's free?"), so it keeps the most prominent spot.
2. **Search**, **Platform**, **Type**, **Clear**, then the result count and
   Refresh on the right.

#### Search

- About 320px wide (`flex: 0 1 320px`), shrinking before anything else
  wraps. It is named "Search devices" for screen readers.
- The placeholder is "Search name, model or UDID…", and a small `/` key hint
  sits inside the box's right edge.
- **Pressing `/` focuses the search box** and `preventDefault`s the key, so
  no "/" is typed. It doesn't when:
  - focus is already in an `input`, a `textarea`, a `select` or a
    contenteditable;
  - a modifier key is held;
  - a device is open (`params.udid` is set), since device control sends
    keys to the phone.

#### Platform and Type menus

A new `FilterMenu` component draws each one as a button that opens a menu.

- **Unset:** a quiet button with a dashed outline, a plus icon and the name:
  "Platform" or "Type".
- **Set:** a chip in the same accent tint as the active status segment,
  reading "Platform: iOS" or "Type: Virtual".
  - The chip is a wrapper holding two sibling buttons, the trigger and the ×,
    since one button can't sit inside another.
  - Clicking the chip reopens the menu.
  - The × button clears just that filter. It is named
    "Clear platform filter" or "Clear type filter".
- **The trigger** is a `button` with `aria-haspopup="menu"` and
  `aria-expanded`. It is named "Platform" when unset, and "Platform: iOS"
  when set.
- **The menu** is the existing `Popover` holding the existing `Menu`, opened
  below the button and aligned to its left edge.
  - Items are single choices: `role="menuitemradio"` with `aria-checked`,
    and a check mark on the current one.
  - Each item shows its count, from the same counts as before.
  - **Platform:** Any platform · Android · iOS, plus tvOS only when the list
    has a tvOS device or the link already asks for `platform=tvos`.
  - **Type:** Any type · Real devices · Virtual. Virtual carries the note
    "Simulators and emulators" under its label.
- **Keyboard and focus:**
  - Opening moves focus to the checked item.
  - Arrow keys move between items (the Menu's roving focus).
  - Choosing an item closes the menu and puts focus back on the trigger.
  - Esc closes the menu (the Popover's dismissable layer) and returns focus
    the same way.
  - An outside click closes it without moving focus.
- A device is **virtual** when `deviceType` is `simulator` or `emulator`,
  or when `deviceType` is missing and `realDevice` is `false`. Otherwise it
  is **real**. A device with a platform other than Android, iOS or tvOS
  appears under Any platform only.

#### Clear

A text button, "Clear", shown only while something is filtered: a status
other than All, a platform, a type, or search text. It resets all four, the
same as the empty state's **Clear filters**, and then focuses the search box
so focus isn't lost.

#### Result count and Refresh

- On the right: "5 devices" when every device is shown, and "2 of 5
  devices" otherwise. The wording comes from `resultLabel`, including the
  singular "1 device". It is `aria-live="polite"`, so a screen reader hears
  the new count after a change.
- **Refresh** becomes an icon-only secondary button named "Refresh devices",
  with a "Refresh" tooltip. The page also refreshes every 10 seconds, so it
  no longer needs a full-width label.

### Counts

Each control's counts account for the **other** filters and the search, but
not for the control's own selection.

- With Platform = iOS, "Ready 3" means 3 ready iOS devices.
- With Status = Ready, the Platform menu's "Android 2" means 2 ready Android
  devices.
- So a number is always what you get by clicking it. Each control's options
  still add up to its All (the menus' "Any" item).

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
| `deviceFilters.ts`, added | `isFiltered(f): boolean` (anything other than all/empty); `resultLabel(shown: number, total: number): string`: "N devices" (or "1 device") when `shown === total`, else "shown of total devices" |
| `web/src/components/device-explorer/FilterMenu.tsx` (new) | `FilterMenu<T extends string>` with props `{ name: string; value: T; anyValue: T; options: { value: T; label: string; note?: string; count: number }[]; onChange: (v: T) => void }`. `name` is "Platform" or "Type". It renders the trigger (dashed when `value === anyValue`, a chip otherwise), the × clear button, and the `Popover` + `Menu` of radio items. It moves focus into the menu on open and back to the trigger on choose or Esc. |
| `web/src/components/ui/Menu.tsx` | `MenuItem` gains optional `checked?: boolean`. When it is defined, the role is `menuitemradio` with `aria-checked`, and a check icon is reserved on the left. It also gains optional `note?: string` and `trailing?: React.ReactNode` (for the count). Existing callers are unchanged. |
| `web/src/components/device-explorer/device-explorer.tsx` | `statusFilter` and `search` leave component state. The wrapper reads `useSearchParams`, passes `filters` and `onFiltersChange` (which calls `setSearchParams(filtersToParams(next), { replace: true })`) and the query string for the close paths. Row 2 is search, the two `FilterMenu`s, Clear, the result count and the icon Refresh. It adds the `/` keydown listener (added on mount, removed on unmount), the new empty state and the new placeholder. |
| `web/src/components/device-explorer/device-explorer.css` | The row, the search width and key hint, the dashed trigger, the chip (reusing the `.seg-btn-active` accent tint: `rgb(var(--rgb-accent) / 0.12)` with a `0.35` inset ring and `--color-accent` text), the × button, the result count. No raw colour literals. |
| `web/src/components/ui/SegmentedControl.tsx` | Optional `label` sets `aria-label` on the tablist (Status) |
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
  - `isFiltered`: false for no filters or a blank search; true for each
    filter on its own.
  - `resultLabel`: "5 devices", "2 of 5 devices", "1 device", "0 of 5
    devices".
- **`SegmentedControl`:** `label` names the tablist.
- **`MenuItem`:** with `checked` it is a `menuitemradio` with the right
  `aria-checked`. Without it, it is still a plain `menuitem`.
- **`FilterMenu`:**
  - unset, the trigger is named "Platform" and shows no × button;
  - set, it reads "Platform: iOS", and × calls `onChange(anyValue)`;
  - opening lists the options with their counts, and the checked one has
    `aria-checked="true"` and focus;
  - choosing calls `onChange`, closes the menu and returns focus to the
    trigger;
  - Esc closes it and returns focus.
- **Devices page** (Testing Library, `MemoryRouter`):
  - a link with `?platform=ios` shows only iOS cards, and the trigger reads
    "Platform: iOS";
  - choosing Android in the Platform menu updates the link;
  - the platform chip's × removes `platform` from the link;
  - Clear appears only when filtered, and resets the link;
  - the result count reads "2 of 3 devices" and "3 devices";
  - `/` focuses the search box, but not while typing in it;
  - the empty state's Clear filters empties the query and shows every card;
  - opening and closing a device keeps the query.
- **Viewport suite** (`web/test/viewport/overflow.spec.ts`): the Devices
  mock gains an iOS simulator and an Android emulator. The content check
  requires the Status tablist and the Platform and Type buttons. Nothing may
  overflow at 1280 or 1440.
- **Live**, as the real user, on the lab S9+ and iPhone:
  - filter by Android and by iOS;
  - search "Galaxy" and "SM-G965F";
  - reload, and open and close a device, with the filters kept each time;
  - use the menus with the keyboard only (Tab, Enter, the arrow keys, Esc)
    and with `/`;
  - check contrast in both themes via computed styles: the dashed trigger,
    the chip and its ×, menu items with their counts, Clear, the result
    count and the placeholder.

  Virtual is covered by the mocks unless a simulator or emulator is
  available to the lab server.

## Out of scope

- Team or tag filters, and saved views.
- The Live Devices picker's own list and filter.
- Server-side filtering: the page already loads the whole list.
