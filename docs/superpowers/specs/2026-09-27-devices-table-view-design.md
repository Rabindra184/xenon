# Devices table view — design

Date: 2026-09-27
Status: approved in brainstorming ("go").

## Why

The Devices page shows every device as a card: a coloured status band with
what is using the device, then its name, its model and OS, its team and tags,
and the actions **Control**, **Reserve** or **Release**, and **More**. Cards
are easy to read one at a time, but a lab of dozens of devices means
scrolling a grid to compare them. There is also no way to sort (say by
status, platform or team), because a grid has no columns.

Decision made in brainstorming:

| Question | Decision |
|---|---|
| Scope | **Dense, sortable list.** A Cards / Table switch; a table with one row per device, sortable columns, the same filters, and the card's actions on each row. No bulk actions. |

## Behaviour

### The switch

- **Where:** a **Cards / Table** switch (the shared `SegmentedControl`,
  `label="View"`) at the right of the toolbar's second row, before the result
  count and Refresh.
- **Default:** Cards.
- **Remembered** per browser in `localStorage['xenon.devices.view']`, with
  try/catch; storage that fails falls back to Cards.
- **In the URL:** `?view=table` carries the view, beside the existing filter
  parameters, so a shared link opens the same view. The URL wins over the
  stored choice.
- The filters, search and status tabs are unchanged and apply to both views.

### The table

A semantic `<table>` with a `<caption class="sr-only">` naming the view
("Devices, 12 shown").

| Column | Shows | Sort key |
|---|---|---|
| **Status** | The card's dot and word (Ready, Busy, Reserved, Maintenance, Offline), with the card's activity line in muted text under it ("Test by alice · 12 min") | State order (`DEVICE_STATES`), then name |
| **Device** | `deviceTitle`, with `deviceSubtitle` (model · OS) under it; the UDID in `title` | `deviceTitle`, case-insensitive |
| **Platform** | The Android, iOS or tvOS icon and the OS version | Platform, then numeric version |
| **Type** | Real or Virtual (`isVirtual`) | Type |
| **Team** | The team name, or "Shared" | Name, with Shared last |
| **Tags** | The first two tags as the card shows them, then "+N"; every tag in `title` | none |
| **Host** | The host, shown only when the listed devices come from more than one host (hub and nodes) | Host |
| **Actions** | **Control**, **Reserve** or **Release**, and **More**, exactly as on the card | none |

- **Sorting:**
  - A sortable header is a `<button>` inside its `<th>`, which carries
    `aria-sort`.
  - The first click sorts ascending, the second descending.
  - The default order is Status ascending, then name.
  - Ties always fall back to the device name, then the UDID, so the order is
    stable.
  - The sort is kept in the URL (`sort=status`, `dir=asc|desc`) only when it
    isn't the default.
- **Rows:**
  - About 44 px high.
  - An offline row is dimmed, as the card is.
  - Long names, subtitles and tags truncate with an ellipsis, with the full
    text in `title`.
- **The header** stays in view while the table scrolls (`position: sticky`
  inside the page's scroll area).
- **Width:** it fits the supported widths (1280–1440 px) without sideways
  scrolling. The columns have minimum widths, Device takes the free space,
  and Tags gives way first.
- **Empty:** the table shows the page's existing empty state, and says it
  only once.

### Actions

- **Control:** disabled with the card's reason (`controlAvailability`), shown
  as its tooltip and `aria-describedby`.
- **Reserve / Release:** as on the card.
- **More:**
  - Copy UDID, Copy server URL, Copy IP address and Copy capabilities;
  - for admins, Manage tags…, Assign team… and Block or Unblock.
- **Dialogs:** the reservation dialog, the tag manager and the team editor
  open from a row exactly as they do from a card.

## Code

| Unit | Kind | Job |
|---|---|---|
| `device-card/DeviceActions.tsx` | new, extracted | Control, Reserve/Release, the More menu, and the three dialogs, taken from `device-card.tsx` unchanged in behaviour. The card and the row both render it. |
| `device-card.tsx` | changed | uses `DeviceActions`; otherwise unchanged |
| `device-explorer/deviceSort.ts` | new, pure | `SortKey`, `compareDevices(a, b, key, dir, ctx)`, `sortDevices(list, key, dir, ctx)`, `parseSort(params)`, `sortToParams(sort)` |
| `device-explorer/deviceView.ts` | new, pure | `DeviceView = 'cards' \| 'table'`, `parseView(params, stored)`, `loadView()`, `saveView(view)` |
| `device-explorer/table-view/DeviceTable.tsx` | new | the table: headers, sorting, rows, `DeviceActions` per row |
| `device-explorer/table-view/device-table.css` | new | tokens only |
| `device-explorer.tsx` | changed | the switch; renders `CardView` or `DeviceTable` for the same filtered list |

`deviceState`, `activityLabel`, `controlAvailability`, `deviceTitle`,
`deviceSubtitle` and `isVirtual` already exist and are shared as they are, so
a card and its row can't disagree.

## Testing

- **Written first:**
  - `deviceSort.test.ts`: each key in both directions, the stable
    tie-break, Shared last, numeric OS versions ("9" before "10"), and URL
    round-tripping.
  - `deviceView.test.ts`: the URL winning over storage, storage that
    throws, and an unknown value.
  - `DeviceTable.test.tsx`:
    - the headers and `aria-sort`, and clicking to reverse;
    - a row showing the same status, activity and actions as its card;
    - a disabled Control carrying the reason;
    - the Host column appearing only with more than one host.
  - `device-card.test.tsx` keeps passing after the extraction, which is the
    proof that it changed nothing.
  - `device-explorer.test.tsx`: the switch changes the view and the URL, and
    a reload keeps it.
- **Viewport:** the `/devices` route runs again with `?view=table`, with its
  existing wide device mocks, at both sides of every breakpoint, and a
  content check that table rows render.
- **Live**, lab server, both themes:
  - the S9+ and the iPhone in the table;
  - sorting by each column;
  - Control opening device control;
  - Reserve and Release on the S9+;
  - the More menu's copy actions;
  - contrast of the muted activity line and the header.

## Not in this version

- Bulk actions (row checkboxes).
- Choosing, hiding or reordering columns.
