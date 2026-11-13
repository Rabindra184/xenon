# Phone identity by udid and host, part 2: the dashboard and live events

Status: approved design, 2026-11-13. Builds on part 1
(`2026-11-13-phone-host-identity-design.md`, shipped in 2.34.0).

## Problem

Since 2.34.0 the server finds a phone by udid and an optional `host`, and a
udid two servers report, asked without a host, answers `409 ambiguous_phone`.
The dashboard sends no host, so in a lab with same-named phones (a hub's
`emulator-5554` and a node's) it shows the "Two servers have a phone named …"
message and opens neither. Three more places still pick a phone by udid alone:

- **Live events** carry no host for sessions, heals and recordings, and are
  delivered by `DeviceTeamResolver`, which looks a udid up with `findFirst`:
  an event about one phone can reach the other same-named phone's team.
- **`blockDevice`** reads the phone's current hold by udid only.
- **Recording answers** (start, add-device, stop, active, the group summary)
  name each recording's phone by udid only.

And one dashboard bug from part 1: a `409 ambiguous_phone` (or
`duplicate_phone`) from `POST /recordings` is shown as "Server-wide recording
cap reached (undefined/undefined)", since every 409 that isn't `device_busy`
is read as the cap.

## Goal

In a lab where two servers report a phone of one udid, the dashboard treats
them as two phones: Live devices, device control, the Logs tab, recordings,
team changes and the Devices page each act on the one picked. A lab where
every udid is on one server sees no change, old bookmarked links included.

Scope: Xenon (the dashboard, and the server's events and answers). Xenon
Studio is a later change in its own repository, using the hosts these
answers and the device list already give it.

## The phone in the dashboard

`web/src/lib/phone.ts`:

- `interface PhoneRef { udid: string; host: string }`
- `phoneKey(p: PhoneRef): string` → `` `${udid}@${host}` ``, the one key for
  sets, maps, React keys, drag data and ids.
- `samePhone(a, b)`.

`host` is required wherever the dashboard holds a phone (`MosaicTile`,
`PickerDevice`, `DeviceTile`'s props, the mosaic's `DeviceRow`, Teams
settings' `DeviceRow`, `TeamPicker`, device control's children), so the type
checker finds a call that forgets it. Every device object the dashboard has
comes from `GET /device`, which always carries `host`.

## Requests

- **`XenonApiService`**: every `/control/<udid>/...` method takes a
  `PhoneRef`, percent-encodes the udid and sends `?host=` (`controlPath(p,
  action)`, one helper). `setDeviceTeam` sends `host` in its body. Methods
  with no callers (`stopStream`, `omniScanControl`, `testAiLocatorControl`,
  `installApp`, `getLogs`, `extendReservation`) are removed rather than
  migrated.
- **The calls outside the service** send `?host=` too, through the same
  helper: `stream/status` (tiles, liveness, rehydration, device control),
  `stream/leave` (the tile's ×, `releaseAll`'s `sendBeacon` and its fetch
  fallback), `stream/ticket` (H.264 and logcat), and the MJPEG `<img>` URLs
  (a tile, device control, Omni's inspector). The H.264 and logcat sockets
  need nothing more: the ticket carries the host.
- **Teams settings** (`PUT /device/:udid/team`, assign and unassign) send
  `host`; its select and table key by `phoneKey`.
- **The Apps page's "install on"** select carries the phone's key and sends
  its host.
- **Recordings**: `startRecording(phones: PhoneRef[])` sends `{ udid, host }`
  entries. A 409 is told apart by its `error`: `device_busy` lists the busy
  phones by name and server, `ambiguous_phone` and `duplicate_phone` show the
  server's message, and only the cap's own answer reads as the cap.
  `addDevice` (no callers) is removed.

## State and pages

- **Device control** (`/devices/:udid/control/:tab?`): the phone is the udid
  and `?host=` from the address.
  - Every link to it adds `?host=` (`deviceControlPath(p, tab?)`): device
    cards, the table, the overview's fleet status, the command palette (whose
    entries are keyed by `phoneKey`), and the tab switch, which keeps it.
  - A link with no host opens the phone when one listed phone has the udid.
    When two or more do, the page lists them (name, server's host, status),
    each a link with its host, and opens none. A host that matches no listed
    phone is the existing "device not found" state.
  - The device refresh finds its phone by `samePhone`; its children
    (inspector, actions, apps, clipboard, screenshots, logs, display state)
    get the `PhoneRef`.
- **Live devices**:
  - The store (`recording-group-store.ts`): tiles carry `host`; `selected`,
    the duplicate check, `TOGGLE_SELECTED`, `PATCH_TILE_DIMS`, `REMOVE_TILE`
    and the recording-id maps are keyed by `phoneKey`.
  - The picker, the grid's keys, the drag data
    (`application/x-xenon-phone`, carrying the key), `inMosaic`,
    `testsRunning`, the dimension backfill and `planRestore` use `phoneKey`.
  - Rehydration needs no change of format: a preview hold
    (`manual_<user>_<udid>`) is on its own phone's row, so each row with the
    caller's hold restores its own tile; its `stream/status` sends the host.
  - Recording group tiles are bound to recordings by the host each recording
    now carries (see Answers).
- **The Devices page**: card keys and the "why it's busy" element ids use
  `phoneKey`. Search and sort stay textual, by udid and name.
- **Screenshots** (IndexedDB): new ones are stored with `host`; the store
  reads a phone's as those with its host plus those stored before this change
  with none. No migration.
- **The page title's** device names are keyed by `phoneKey` and read the
  route's `?host=`.
- **Logcat file names** add the host's port when two listed phones share the
  udid.

## Live events

- **Every event about a phone names it**: `host` beside `udid`, or
  `device_host` beside `device_udid`. Fields are only added:
  - `session_started` (the session record) gets `device_host`;
  - `healing_event` gets `deviceHost`;
  - `recording_started`, `recording_stopped` entries and `recording_failed`
    get `host`;
  - device events already carry `host`.
- **Delivery is by the exact phone.** A scope is `{ udid, host, teamId? }`
  or `{ phones: { udid, host }[], strip }`; each phone's events have their own
  delivery chain, keyed by `phoneKey`.
  - Every emitter has the host in hand, or reads it from the row it already
    reads: recordings from the recording's `device_host`, sessions from their
    phone's row, a heal from its session's phone.
  - A scope that only has a udid (an emitter with no phone row to hand) is
    resolved as `findPhone` resolves it: one row is that phone, and two or
    more rows send the event to admins only.
- **`DeviceTeamResolver`** is keyed by `phoneKey`: `resolve(udid, host)`,
  `note(udid, host, teamId)`, a lookup by the exact pair, and the same 5 s TTL
  and 2 s timeout. `grid.ts` notes every listed phone's team, since the note
  no longer has to be skipped when a udid repeats.
- `recording_bookmark_added` and `recording_annotation_added` are scoped by
  the recording's own `device_udid` and `device_host`.

## Answers

- **Recordings**: `POST /recordings` (202), `add-device` (201), `stop`, and
  `GET /recordings/active` name each recording's phone with `host` beside
  `udid`. The group's `summary.phones[]` gets `host`, and its names are read
  per phone.
- **The library**: `GET /recordings?udid=` takes an optional `host`; facets
  are per phone (udid and host), named with the host when a udid repeats.
- **`video.mp4?udid=`** takes an optional `host`; a udid two of the group's
  recordings share, asked without a host, answers `409 ambiguous_phone`.
- **`blockDevice`** reads the existing hold by udid and host.

## Reported

- `/sdk/version` lists `phone-host-events`; `features.phoneIdentity` gains
  `events: true`.
- `website/docs/real-time-events.md` lists `host` on every phone event; the
  recording and devices docs drop "the dashboard handles them in a later
  release" and say how the dashboard shows two same-named phones; the API
  reference documents the new `host` fields and parameters.
- CLAUDE.md's "Phone identity" and "Live events" paragraphs say events are
  delivered by the exact phone.

## Not in scope

Xenon Studio and its MCP plugin. Appium session allocation by `appium:udid`.
The preview hold's format. Search and sort by host.

## Tests

- Web (vitest): `phoneKey` and `samePhone`; each `XenonApiService` method's
  URL and body (host sent, udid encoded); the store's actions with two tiles
  of one udid; the device-control chooser (no host with one phone, with two,
  an unknown host); recording start's 409 messages; the screenshot store's
  old-row fallback.
- Server (mocha): `DeviceTeamResolver` with two rows of one udid in two teams;
  each emitter's payload carries the host; an event about each same-named
  phone reaches only its team's sockets; a udid-only scope with two rows
  reaches admins only; the recording answers' `host`; the library's `host`
  filter and per-phone facets; `video.mp4` with and without `host`;
  `blockDevice` reading the hold of the named phone.
- Viewport and control sweep: the mocked device list gains a pair of
  same-named phones on two hosts, and the device-control chooser route is
  added to the overflow matrix.
- Lab: the dashboard (built from the branch) against a scratch hub and node
  sharing the lab's `emulator-5554`, as in part 1: from the pages themselves,
  open each phone's device control, preview both in Live devices, tap each
  (the node's log shows only its own), record both, change each one's team,
  and open an old link with no host (the chooser).
