# Device card redesign — design

Date: 2026-09-26
Status: approved in brainstorming, awaiting spec review

## Why

The Devices page review (after 1.22.3) found the cards were correct only
after #307, and still hard to use at lab scale:

- Status is small text in a corner while seven bright green Control buttons
  are the loudest thing on the page.
- Names are codenames: `star2ltexx`, `SM-S918B`, `Pixel_6_API_34`.
- Every card repeats the same shortened server URL, "Real" and "Shared".
- Cards are 320 px tall, so about 8 fit on screen.
- Copy buttons are 16×16 px, under the 24×24 px WCAG 2.2 target size.

Decisions made while brainstorming:

| Question | Decision |
|---|---|
| Where friendly names come from | Read from each device by the server |
| Device image | Form-factor outline (phone / tablet), no screenshots |
| Layout | Design A, the status band (mockup `card-states-v3.html`) |
| UDID | In the ⋯ menu and the name's tooltip only, not on the card face |

Mockups: `.superpowers/brainstorm/72515-1790412840/content/card-layout-v3.html`
(the three layouts) and `card-states-v3.html` (design A in every state).

The work ships as two PRs: the server first (part 1), then the card (part 2).

## Part 1 — device identity (server)

### New fields

Four nullable columns on `Device` (Prisma), and the same optional fields on
`IDevice` (server and web):

| Field | Example | Meaning |
|---|---|---|
| `marketingName` | `Galaxy S9+`, `iPhone 17 Pro Max`, `Pixel 6 API 34` | What people call the device |
| `model` | `SM-G965F`, `iPhone18,2` | Manufacturer's model id |
| `manufacturer` | `samsung`, `Apple` | As the device reports it; the card capitalises it |
| `formFactor` | `phone` \| `tablet` \| `tv` | Chooses the outline on the card |

All four are nullable, so existing rows, older nodes and older configs keep
working. Nothing in `schema.json` changes, so no plugin argument changes.
SQLite applies the change with `db push` at startup. Postgres gets a
migration in `prisma/migrations/<timestamp>_device_identity/`, the same way
`20260925120000_annotation_end_timecode` did.

### Android (real devices and emulators)

`AndroidDeviceManager.deviceInfo()` already runs for each device when it is
discovered, including after a server restart. It gains one more lookup,
**one** `adb shell` call that prints each value on its own line:

```
getprop ro.product.model
getprop ro.product.manufacturer
getprop ro.build.characteristics
settings get global device_name
getprop ro.boot.qemu.avd_name
```

A pure parser, `parseAndroidIdentity(stdout, { realDevice })`, turns the
output into the four fields:

- `marketingName`:
  - Real device: `settings global device_name`. It defaults to the marketing
    name ("Galaxy S9+" on the S9+, measured) and follows a user's rename, so a
    lab can call a device "Rack 4 · S9+".
  - Emulator: `ro.boot.qemu.avd_name` with `_` replaced by spaces
    ("Pixel_6_API_34" → "Pixel 6 API 34").
  - `null` if the value is empty or the literal `null`.
- `model` / `manufacturer`: the two properties, trimmed; empty → `null`.
- `formFactor`: `tablet` if the characteristics list contains `tablet`,
  `tv` if it contains `tv`, otherwise `phone`.

Failure never blocks discovery. The call has a 5 s timeout. An error, a
timeout or unparseable output gives all-null fields, and the device registers
exactly as it does today. The mandatory "base info" (sdk, realDevice, name)
is unchanged.

The parser is the unit under test. Fixtures are the real output captured from
the S9+ (SM-G965F, samsung, `phone`, "Galaxy S9+") and a synthetic emulator.

### iOS real devices

`IOSDiscoveryService` already calls `IOSUtils.getOSVersion` and
`IOSUtils.getDeviceName` (appium-ios-device). It adds
`IOSUtils.getDeviceInfo(udid)` in the same `Promise.all`, which returns
lockdown values including `ProductType` (`iPhone18,2`) and `DeviceClass`
(`iPhone` / `iPad` / `AppleTV`).

- `model` = `ProductType`; `manufacturer` = `Apple`.
- `formFactor`: `iPhone` → phone, `iPad` → tablet, `AppleTV` → tv.
- `marketingName`: a lookup in a new built-in table,
  `src/device-managers/ios/appleModelNames.ts` (`ProductType` → name). It
  covers iPhone 11 through iPhone 17 and the iPads released in the same
  years. An unknown code gives `null`. It never guesses from the code's
  numbers.
- A failed `getDeviceInfo` gives all-null fields. The existing name and OS
  lookups are unaffected.

### iOS simulators

The simulator's name is already friendly ("iPhone 16 Pro"). `marketingName`
= that name. `formFactor` = `tablet` if the name contains "iPad", `tv` if it
contains "TV", otherwise `phone`. `model` and `manufacturer` stay `null`.

### Hub and nodes

A node sends its devices to the hub through `POST /xenon/api/register`, which
calls `addNewDevice` and then `PrismaStore.addDevices`. That passes every
field straight into `prisma.device.upsert`, so a hub rejects any field its
schema lacks.

- New hub + old node: fine. The new fields are simply absent (`null`).
- Old hub + new node: the old hub would reject the registration. The old
  hub's code can't be changed, so the release notes say to **upgrade the hub
  before its nodes**.
- So that this can't happen again with the next new column,
  `PrismaStore.fromIDevice` drops keys that are not `Device` model fields.
  The field list comes from the generated client's DMMF, so it can't drift
  from the schema. A dropped key is logged once per key at debug level.

### Part 1 acceptance

- Unit tests:
  - the Android parser, with the real S9+ output, emulator output, empty
    values, the literal `null` and garbage input;
  - the Apple table (known codes, unknown code);
  - the iOS mapping (`DeviceClass` → form factor);
  - `fromIDevice` dropping an unknown key.
- `npm run test:all` green; `tsc` clean.
- Live check after restarting the server with the branch build:
  - the S9+ row has `Galaxy S9+` / `SM-G965F` / `samsung` / `phone`;
  - the iPhone row has its model name / `iPhone…` / `Apple` / `phone`;
  - both are shown by `GET /xenon/api/device`.
- A config file from before this change still boots. No `schema.json`
  change, checked by a real startup.

## Part 2 — the card (web), design A

### Anatomy (top to bottom)

1. **Status band.** Full width, about 30 px tall. The left side has a dot and
   the state label; the right side has the activity text, cut off with an
   ellipsis, with the full text in a tooltip.

   | State | Band colour | Label | Activity (right) |
   |---|---|---|---|
   | ready | neutral `--surface-2`, teal text | Ready | — |
   | busy, test session | amber tint (`--status-busy-*`) | Busy | `Test session · 12m` / `Test session running` |
   | busy, live control | amber tint | Busy | `Live control by you` / `Live control by another user` |
   | reserved | blue tint | Reserved | `46m left · by priya@acme.com` / `46m left · by you` |
   | maintenance | grey tint | Maintenance | — |
   | offline | grey tint | Offline | — |

   Ready is deliberately quiet, so the unusual states stand out. The reserved
   text leads with the time left, so a long name is what gets cut off, not
   the time. This changes `activityLabel` for reservations: the band already
   says "Reserved", so the text is `<time> left · by <who>`.

2. **Name block.** A 44×56 px tile with the form-factor outline:
   - lucide `Smartphone`, `Tablet` or `Tv`;
   - a dashed stroke for emulators and simulators;
   - when `formFactor` is null, the outline follows the device type's usual
     shape, which is `Smartphone`.

   Beside it:
   - **Title** (15 px, 600): `marketingName ?? name`. The tooltip gives the
     full title and the UDID.
   - **Subtitle** (12 px, muted):
     - real device: `<Manufacturer> <model> · <Platform> <sdk>`, for example
       `Samsung SM-G965F · Android 10`;
     - emulator: `Emulator · Android 14`;
     - simulator: `Simulator · iOS 18.2`;
     - missing parts are left out, so with neither maker nor model it reads
       `Android 10`.

3. **Meta row.**
   - The battery and temperature badges, with the #307 rules (amber
     warnings; none for emulators or offline devices).
   - The team pill, in accent green, when a team is assigned.
   - Up to two tags as quiet `#tag` text, then `+N`.
   - "Real" and "Shared" are no longer shown.

4. **Footer** (divider above it):
   - an outline **Control**, plus a text **Reserve** (ready only) or
     **Release** (reserved);
   - when Control is disabled, the #307 reason text inline, linked by
     `aria-describedby`;
   - the ⋯ button at the right, 28×28 px.

5. **Offline:** the name block and meta row are dimmed (opacity 0.55). The
   band and footer are not.

Height: about 190 px (today 320). The grid keeps
`repeat(auto-fill, minmax(280px, 1fr))`.

### The ⋯ menu

| Item | Who | Notes |
|---|---|---|
| Copy UDID | everyone | |
| Copy server URL | everyone | replaces the Server row |
| Copy IP address | everyone, when `ip` is known | replaces the Network row |
| Copy capabilities | everyone | as today ("Copy caps…") |
| Manage tags… | admins | today everyone sees it, and the server refuses members (403) |
| Assign team… | admins | replaces the clickable team chip; opens the same team picker as today |
| Enter / Exit maintenance | admins | today everyone sees it, and the server refuses members (403) |

Tags, maintenance and team changes are `roleGuard('ADMIN')` routes in
`src/app/routers/grid.ts`. Offering them to members only led to a 403, the
same "action that can't work" #307 removed from the buttons. A member's menu
therefore holds the four copy actions only.

Menu items are full-size rows, which retires the 16 px copy buttons.
"Time in use" leaves the card: the server can't say over what period, so the
number was ambiguous.

### Styling rules

- Tokens only. No new hex or `rgba()` literals (the colour-literal ratchet in
  `web/src/design/color-literals.test.ts` must pass). The band tints use the
  existing `--status-*-bg` / `--status-*-fg` tokens.
- Light theme works through the tokens; it needs no light-specific rules
  beyond what the tokens give.
- Unchanged: the explorer's filters and the "one state per device" rule from
  #307 (`deviceState.ts`).

### Part 2 acceptance

- Tests written first:
  - each state's band label and colour class and its activity text;
  - title and subtitle fallbacks (all identity fields null gives today's
    name; emulator; simulator);
  - no Server / Network / UDID rows on the card face;
  - the menu's items for a member (the four copy actions only) and for an
    admin (plus Manage tags…, Assign team… and Enter / Exit maintenance);
  - the offline dimming class;
  - the name tooltip includes the UDID.
- Web suite green; `tsc` clean; no new lint problems in touched files.
- Playwright viewport suite passes (the Devices route is in its matrix with
  long names and a long XPath).
- The Playwright member/admin render from #307 re-run against the new card:
  all seven states look like `card-states-v3.html`.
- Light and dark contrast measured on the band text, title, subtitle and
  reason (every pair at least 4.5:1).

## Out of scope

- Table view, sorting, grouping and bulk actions. These need a separate
  design discussion.
- A "last seen" time for offline devices. It needs a server field; `updatedAt`
  also changes on unrelated writes.
- Screenshot thumbnails.
- Admin-editable display names. A device-name rename on Android already
  covers the common case.
