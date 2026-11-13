# Phone identity part 2 (dashboard and live events) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard sends each phone's host and keeps phones apart by udid and host, and the server's live events and recording answers name the exact phone, so two servers' same-named phones work as two phones.

**Architecture:** Server first: the live-event team resolver and the event scope become udid-and-host (Task 1), every phone event's payload carries the host (Task 2), recording answers and reads take and give a host (Task 3). Then the dashboard: one `PhoneRef` type and URL helper used by every per-phone request (Task 4), Live devices keyed by phone (Task 5), device control addressed by `?host=` with a chooser for old links (Task 6), the remaining pages (Task 7), docs and the UI test suites (Task 8), and a lab check (Task 9).

**Tech Stack:** TypeScript, Express, socket.io, Prisma (server, mocha/chai/sinon); React 17, Vite, vitest, Playwright (web/).

**Spec:** `docs/superpowers/specs/2026-11-13-phone-host-identity-part2-design.md` (part 1: `docs/superpowers/specs/2026-11-13-phone-host-identity-design.md`).

## Global Constraints

- A phone is `{ udid, host }`; `host` is the Device row's `host` string exactly as `GET /device` reports it.
- A lab where every udid is on one server sees no change, bookmarked links included.
- Event payloads and answers only gain fields; nothing is renamed or removed.
- Event field names: `host` beside `udid`; `device_host` beside `device_udid`; `deviceHost` beside `deviceUdid`.
- `/sdk/version` flag `phone-host-events`; `features.phoneIdentity.events: true`.
- A udid-only live-event scope with two or more rows goes to admins only.
- Wording on screen is for testers (CLAUDE.md "Wording is for testers"); no new colour, size or surface literals (the design ratchets).
- Every spec passes alone and in `npm run test:all` (CLAUDE.md "Testing"); web tests pass with `cd web && npx vitest run`.
- Never `eslint --fix`/`prettier --write` across the repo; `git add` explicit paths; no attribution lines in commits.

## Review Focus

1. **Hosts hold `://`, `:` and `.`.** A host in a query must be percent-encoded, and `phoneKey` must never be used raw as a DOM id or CSS selector (`aria-describedby` breaks on `:`). Task 4 adds `phoneDomId`; Task 7 tests the busy-reason id.
2. **Leaving the page.** The tile ×, `releaseAll`'s `sendBeacon` and its fetch fallback must send the host, or a same-named phone's hold isn't released (409) and stays held until the idle release. Task 5 tests the beacon URL.
3. **A link whose host is gone** (the node went away, or its address changed) is "device not found", never the chooser and never the other same-named phone. Task 6 tests it.
4. **A recording group of two same-named phones** binds each tile to its own recording, on start, rehydration and stop. Task 5 tests it.
5. **Udid-only scopes that remain** (an emitter with no row to hand) with two rows reach admins only, and with one row reach that row's team. Task 1 tests both.

---

### Task 1: Live events delivered by the exact phone

**Files:**
- Modify: `src/services/device-access/DeviceTeamResolver.ts`
- Modify: `src/services/SocketServer.ts` (`DeviceEventScope` ~86, `emitToDashboardForDevices` ~616, `noteRow`, `deliver`)
- Modify: `src/data-service/device-service.ts` (emitters ~34-60, 126, 406, 457, 615; `blockDevice` hold read ~445)
- Modify: `src/app/routers/grid.ts` (~505-512, the `note` call)
- Test: `test/unit/device-team-resolver.spec.ts` (extend), `test/unit/socket-server-phone-scope.spec.ts` (create), `test/unit/block-device-host.spec.ts` (create)

**Interfaces:**
- Produces:
  - `DeviceTeamResolverDeps.findRows?(udid: string): Promise<Array<{ host: string; teamId?: string | null }>>` (replaces `findDevice`; default reads every Device row of the udid from the store, e.g. `findPhoneRowsInStore` from `src/middleware/controlDevice.ts`).
  - `DeviceTeamResolver.resolve(udid: string | null | undefined, host?: string | null): Promise<DeviceTeam>` — with a host: that row's team, or unknown; without: one row → its team, none or two or more → unknown.
  - `DeviceTeamResolver.note(udid: string, host: string, teamId: string | null): void` — also drops the udid's host-less cache entry.
  - Cache key `` `${udid}@${host ?? ''}` ``; TTL, timeout and MAX_ENTRIES unchanged.
  - `DeviceEventScope = ({ udid: string | null | undefined; host?: string | null; teamId?: string | null } | { phones: Array<{ udid: string; host?: string | null }>; strip: (data: any, visible: Array<{ udid: string; host?: string | null }>) => any }) & { adminOnly?: boolean }`.
  - Delivery chains stay keyed by udid (a stricter order than per phone; the spec's per-phone chain is satisfied since each phone's events stay in order).

- [ ] **Step 1: Write failing resolver tests** in `device-team-resolver.spec.ts`: `resolve('emulator-5554', 'http://h1:4723')` → `{ known: true, teamId: 'A' }` and `resolve('emulator-5554', 'http://h2:4723')` → `{ known: true, teamId: 'B' }` with `findRows` returning both rows; `resolve('emulator-5554')` → `{ known: false }` with two rows and `{ known: true, teamId: 'A' }` with one; `note('emulator-5554','http://h1:4723','C')` then `resolve(..., 'http://h1:4723')` → `C` without calling `findRows`, and the host-less entry is reloaded.
- [ ] **Step 2: Write failing delivery tests** in `socket-server-phone-scope.spec.ts` (fake sockets with `teamIds`, as the existing SocketServer specs do): an event scoped `{ udid: 'emulator-5554', host: 'http://h1:4723' }` reaches team A's socket only, `host: 'http://h2:4723'` team B's only; `{ udid: 'emulator-5554' }` with two rows reaches only the unscoped (admin) socket; with one row (team A) reaches team A; a `{ phones, strip }` scope with both phones gives team A's socket `strip(data, [h1 phone])`.
- [ ] **Step 3: Write a failing `blockDevice` test** in `block-device-host.spec.ts`: two rows of `emulator-5554` on two hosts, the h2 row holding another user's `manual_` hold; `blockDevice` of the h1 phone reads the h1 row's hold (not the h2 one) — assert the store lookup was `{ udid, host }` and the block succeeds.
- [ ] **Step 4: Run them** — `npx mocha test/unit/device-team-resolver.spec.ts test/unit/socket-server-phone-scope.spec.ts test/unit/block-device-host.spec.ts`. Expected: FAIL (no host parameter / wrong team).
- [ ] **Step 5: Implement** the resolver and scope changes above; `noteRow` notes `(udid, host, teamId)` when the scope has all three; `deliver` resolves each phone by `(udid, host)`. Update every device-service emitter to pass `host` (each already has the row or the `{udid, host}` it emits). `grid.ts` notes every listed phone (`note(d.udid, d.host, d.teamId ?? null)`) and drops the "same udid" skip and its comment. `blockDevice` reads the hold with `{ udid, host }`.
- [ ] **Step 6: Run** the three specs plus `npx mocha test/unit/device-team-resolver.spec.ts test/integration/team-visibility-control.spec.ts` and any spec that references `DeviceEventScope`, `note(` or `findDevice:` for the resolver (`grep -rln "DeviceTeamResolver" test`). Expected: PASS.
- [ ] **Step 7: Commit** — `fix(events): deliver a phone's live events by its own udid and host`.

### Task 2: Every phone event names its phone

**Files:**
- Modify: `src/dashboard/event-manager.ts` (`session_started` ~122-180, `session_stopped` ~373, `session_command` ~664, `healing_event` ~674, `recording_*` ~769-851)
- Modify: `src/app/routers/commands.ts` (~178), `src/app/routers/bug-report.ts` (~86), `src/services/InterceptorService.ts` (~259-271), `src/services/recording/RecordingOrchestrator.ts` (emit inputs ~616, 668-670, 803, 884, 1332-1344)
- Modify: `website/docs/real-time-events.md` (~87-141)
- Test: `test/unit/live-event-phone-fields.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1's `DeviceEventScope`.
- Produces (payload fields, added only):
  - `session_started` record: `device_host`.
  - `healing_event`: `deviceHost`.
  - `recording_started.recordings[]`, `recording_stopped.recordings[]`: `host`; `recording_failed`: `host`.
- Scopes: every emitter passes the phone's host — the device row it holds (`onSessionStarted`), the recording's `device_host` (bookmark and annotation via `findVideo`, which already selects it), the orchestrator's `RecordedPhone.host`, and for session events the session's phone (the device the session holds in `SESSION_MANAGER`, else the Device row with the session's `device_udid` and `node_id`). An emitter that can find no host passes the udid alone (Task 1's admins-only rule covers two rows).

- [ ] **Step 1: Write failing tests** in `live-event-phone-fields.spec.ts`, stubbing `SocketServer.emitToDashboardForDevices` and asserting each call's payload and scope: `onSessionStarted` with a device `{ udid: 'emulator-5554', host: 'http://h2:4723' }` emits `session_started` with `device_host: 'http://h2:4723'` and scope `host: 'http://h2:4723'`; a heal emits `healing_event` with `deviceHost`; the orchestrator's start of `[{udid:'emulator-5554',host:'http://h1:4723'},{udid:'emulator-5554',host:'http://h2:4723'}]` emits `recording_started` whose `recordings` carry each `host` and whose scope is `{ phones: [both] }`; `recording_failed` carries `host`; a bookmark on the h2 recording is scoped `{ udid, host: 'http://h2:4723' }`.
- [ ] **Step 2: Run** `npx mocha test/unit/live-event-phone-fields.spec.ts`. Expected: FAIL (no host fields).
- [ ] **Step 3: Implement** the fields and scopes listed under Interfaces; `recordingsScope` becomes a `{ phones, strip }` scope whose `strip` keeps the recordings of the visible phones (by udid and host).
- [ ] **Step 4: Update** `website/docs/real-time-events.md`: `host`/`device_host`/`deviceHost` on each event, and one sentence that events are delivered by the exact phone.
- [ ] **Step 5: Run** the new spec and `grep -rln "recording_started\|healing_event\|session_started" test | xargs npx mocha`. Expected: PASS.
- [ ] **Step 6: Commit** — `feat(events): name the phone in every live event`.

### Task 3: Recording answers and reads name the phone

**Files:**
- Modify: `src/services/recording/RecordingOrchestrator.ts` (`StartedRecording` ~155-161, add-device ~1341, stop ~777/867), `src/services/recording/activeRecordings.ts` (~77), `src/services/recording/recordingSummary.ts` (`PhoneSummary` 12-28, `toSummaryRow` ~156, library filter ~232, facets ~253-261, `deviceNames` ~271), `src/services/recording/proof-bundle.ts` (`resolveVideoFile` ~264), `src/app/routers/recordings.ts` (`GET /recordings`, `video.mp4` ~865)
- Modify: `src/app/openapi/platform.yaml` (or whichever file documents recordings), `website/openapi.json` (`npm run build:openapi`), `src/app/routers/` capabilities and `/sdk/version` (where `phone-host` and `features.phoneIdentity` are set in part 1)
- Test: `test/unit/recording-answers-host.spec.ts` (create), extend `test/integration/recording-visibility-phone-host.spec.ts` for the library filter and `video.mp4`

**Interfaces:**
- Produces:
  - `StartedRecording = { id; udid; host; status; sessionId? }`; add-device's `recording` and stop's `recordings[]` gain `host`; `GET /recordings/active` `groups[].recordings[]` gain `host`.
  - `PhoneSummary` gains `host: string`; names come from a per-phone lookup (udid and host).
  - `GET /recordings?udid=&host=`: `host` optional, filters by `device_host` too; facets are per `(udid, host)` with the facet label naming the host when a udid repeats among the facets.
  - `GET /recordings/:groupId/video.mp4?udid=&host=`: with a host, that recording; without, a udid two of the group's recordings share answers `409 { error: 'ambiguous_phone', message, hosts }` (part 1's `ambiguousPhoneBody`).
  - `/sdk/version` `supports` adds `phone-host-events`; `features.phoneIdentity` becomes `{ hostParameter: true, events: true }`.

- [ ] **Step 1: Write failing tests**: the 202 of a two-phone start carries both `host`s; `/recordings/active` and stop carry `host`; the summary's `phones[]` carry `host` and each phone's own name; `?udid=emulator-5554&host=http://h2:4723` lists only h2's recordings; `video.mp4?udid=emulator-5554` on a group of both → 409 `ambiguous_phone` with both hosts, with `&host=` → 200; `/sdk/version` lists `phone-host-events` and `/capabilities` reports `events: true`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the fields, filter, facets, `video.mp4` rule and flags above; document them in the openapi YAML and run `npm run build:openapi`.
- [ ] **Step 4: Run** the new specs, `npx mocha test/unit/openapi-coverage.spec.ts`, and the recording specs (`grep -rln "recordings" test/unit test/integration | grep -i record | xargs npx mocha`). Expected: PASS.
- [ ] **Step 5: Commit** — `feat(recording): name each recording's phone in the answers`.

### Task 4: One phone reference for every dashboard request

**Files:**
- Create: `web/src/lib/phone.ts`, `web/src/lib/phone.test.ts`
- Modify: `web/src/api-service/index.ts` (every `/control/${udid}` method, `setDeviceTeam`, remove `stopStream`, `omniScanControl`, `testAiLocatorControl`, `installApp`, `getLogs`, `extendReservation`), `web/src/components/mosaic/h264Stream.ts`, `web/src/components/device-control/logcat/useLogcatStream.ts`, `web/src/components/mosaic/streamLiveness.ts`, and every caller the type checker then names (device control and its children, `DeviceTile`, `OmniInspector`, `ActionsPanel`, `AppsSection`, `TextClipboardSection`, `useDisplayState`, `useScreenshots`, `apps.tsx`)
- Test: `web/src/api-service/control-paths.test.ts` (create)

**Interfaces:**
- Produces (`web/src/lib/phone.ts`):
  - `export interface PhoneRef { udid: string; host: string }`
  - `export function phoneKey(p: PhoneRef): string` → `` `${p.udid}@${p.host}` ``
  - `export function samePhone(a: PhoneRef, b: PhoneRef): boolean`
  - `export function phoneDomId(prefix: string, p: PhoneRef): string` — `prefix` plus `phoneKey` with every character outside `[A-Za-z0-9_-]` replaced by `-` (a valid id and selector).
  - `export function controlPath(p: PhoneRef, action: string, query?: Record<string, string>): string` → `` `/control/${encodeURIComponent(udid)}/${action}?host=${encodeURIComponent(host)}` `` plus any extra query (relative to `/xenon/api`, as `apiClient` paths are); `controlUrl(p, action, query?)` the same with the `/xenon/api` prefix for raw `fetch`, `<img src>` and `sendBeacon`.
- Every `XenonApiService` per-phone method's first parameter becomes `phone: PhoneRef`. `setDeviceTeam(phone: PhoneRef, teamId: string | null)` sends `{ teamId, host }`.

- [ ] **Step 1: Write failing tests**: `phone.test.ts` — `phoneKey({udid:'emulator-5554',host:'http://192.168.0.2:4723'})` is `'emulator-5554@http://192.168.0.2:4723'`; `phoneDomId('reason-', …)` matches `/^[A-Za-z0-9_-]+$/`; `controlPath(p,'tap')` is `'/control/emulator-5554/tap?host=http%3A%2F%2F192.168.0.2%3A4723'`; a udid with `/` is encoded. `control-paths.test.ts` — mock `apiClient` and assert `tap`, `startStream`, `leaveStream`, `getClipboard`, `installRepositoryApp` and `setDeviceTeam` build those paths (and `setDeviceTeam`'s body has `host`).
- [ ] **Step 2: Run** `cd web && npx vitest run src/lib/phone.test.ts src/api-service/control-paths.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `phone.ts`, switch every service method and the raw-fetch helpers (`stream/status`, `stream/ticket`, MJPEG URLs) to `controlPath`/`controlUrl`, delete the unused methods, and pass a `PhoneRef` at every caller (`tsc` lists them). Where a caller's object lacks `host` in its type (`MosaicTile`, `PickerDevice`, `DeviceTile` props, the mosaic `DeviceRow`, device-control children's props), add `host: string` to the type and fill it from the device row it came from (`tileFromDevice` keeps `host`).
- [ ] **Step 4: Run** `cd web && npx tsc --noEmit -p . && npx vitest run`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** — `feat(web): send the phone's host with every per-phone request`.

### Task 5: Live devices keyed by phone

**Files:**
- Modify: `web/src/components/mosaic/recording-group-store.ts`, `DeviceMosaicView.tsx`, `DevicePicker.tsx`, `DeviceMosaic.tsx`, `DeviceTile.tsx`, `idleRestore.ts`, `mosaicDevices.ts`, `RecordingControls.tsx`, `web/src/api-service/recordings.ts`
- Test: extend `recording-group-store` tests, `idleRestore` tests and the mosaic view tests (existing `*.test.ts(x)` beside them), `web/src/api-service/recordings.test.ts` (create or extend)

**Interfaces:**
- Consumes: Task 4's `PhoneRef`, `phoneKey`, `samePhone`, `controlUrl`; Task 3's `StartedRecording.host` and `/recordings/active` `host`.
- Produces:
  - Store: `selected: Set<string>` of `phoneKey`s; `TOGGLE_SELECTED`, `PATCH_TILE_DIMS`, `REMOVE_TILE` take `key: string` (a `phoneKey`); `BIND_RECORDING_IDS`, `START_RECORDING`, `REHYDRATE_RECORDING` take `Record<phoneKey, recordingId>`; `ADD_TILE` refuses a tile whose `phoneKey` is present.
  - Drag data type `application/x-xenon-phone`, value `phoneKey`.
  - `startRecording(phones: PhoneRef[], opts?)` sends `{ udids: phones.map(({udid,host}) => ({udid,host})), ...opts }`; `addDevice` removed.
  - `RecordingConflict` exposes the body's `error`; `RecordingControls` shows: `device_busy` → each busy phone's name and host; `concurrency_cap` → the cap text with its numbers; any other → the body's `message`.

- [ ] **Step 1: Write failing tests**: two tiles `emulator-5554@h1`, `emulator-5554@h2` coexist in the store; `REMOVE_TILE(phoneKey(h1))` leaves h2; `START_RECORDING` with both keys binds each tile to its own id; rehydrating `/recordings/active` with two same-udid recordings binds by `host`; `planRestore` restores h2's tile from h2's row; `releaseAll` calls `navigator.sendBeacon` with a URL containing `host=` for each tile (and the fetch fallback the same); `startRecording` posts `{udid,host}` entries; a 409 `{error:'ambiguous_phone',message:'Two servers…'}` shows that message, `{error:'concurrency_cap',…}` the cap text, `{error:'device_busy',busyDevices:[{udid,host,reason}]}` the phone and host.
- [ ] **Step 2: Run** `cd web && npx vitest run src/components/mosaic src/api-service/recordings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the keys and messages above; `inMosaic`, `testsRunning`, the dimension backfill, the picker's `key` and toggle, the grid's `key` and drop handler all use `phoneKey`.
- [ ] **Step 4: Run** `cd web && npx tsc --noEmit -p . && npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): keep same-named phones apart in Live devices`.

### Task 6: Device control addressed by host

**Files:**
- Create: `web/src/lib/deviceControlPath.ts` (+ test), `web/src/components/device-control/PhoneChooser.tsx` (+ test)
- Modify: `web/src/components/device-explorer/device-explorer.tsx` (~181-182, 365), `device-control.tsx` (~145, 239), `DeviceActions.tsx` (~193), `fleet-status.tsx` (~106), `command-index.ts` (~44), `command-palette.tsx`, `web/src/lib/document-title.ts` (~30, 48), the screenshot store (`screenshotStore.ts` ~36-118), `logcatRecording.ts` (~111)
- Test: `deviceControlPath.test.ts`, `PhoneChooser.test.tsx`, extend `document-title.test.ts` and the screenshot store's tests

**Interfaces:**
- Consumes: Task 4's `PhoneRef`, `samePhone`, `phoneKey`.
- Produces:
  - `deviceControlPath(p: PhoneRef, tab?: string): string` → `` `/devices/${encodeURIComponent(udid)}/control${tab ? `/${tab}` : ''}?host=${encodeURIComponent(host)}` ``.
  - `pickControlPhone(devices: IDevice[], udid: string, host: string | null): { kind: 'found'; device } | { kind: 'choose'; devices } | { kind: 'none' }` (in `deviceControlPath.ts`): a host → that device or none; no host → one device found, two or more choose, none none.
  - `PhoneChooser` props `{ devices: IDevice[]; tab?: string }`: a list of links (`deviceControlPath`), each showing the device's name, its server's host and its status; heading "Two servers have a phone named <udid>. Choose one."
  - Screenshot rows gain `host`; `listScreenshots(phone: PhoneRef)` returns rows with that host plus rows with no `host`.
  - Command palette entry id `device:${phoneKey(p)}`; `document-title`'s names Map keyed by `phoneKey`, reading `?host=` from the route.
  - Logcat file names add `-<port>` (the host's port, or its host name when it has none) when the device list has two phones of the udid.

- [ ] **Step 1: Write failing tests**: `pickControlPhone` — one device and no host → found; two same-udid and no host → choose; a host matching neither → none (Review Focus 3); a host matching h2 → h2. `PhoneChooser` renders two links whose `href`s carry each `host`. `deviceControlPath` encodes the udid and host and keeps the tab. Switching tabs keeps `?host=`. The screenshot store returns h1's rows plus host-less rows for h1, and not h2's. The page title names the h2 phone for `/devices/emulator-5554/control?host=<h2>`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/lib src/components/device-control src/components/device-explorer`. Expected: FAIL.
- [ ] **Step 3: Implement**: the explorer reads `?host=` (react-router's location) and renders the phone, the chooser, or the existing not-found state from `pickControlPhone`; every link to device control uses `deviceControlPath`; device control's refresh finds its phone with `samePhone`; its tab switch keeps the query; the screenshot store, palette, page title and logcat names as above.
- [ ] **Step 4: Run** `cd web && npx tsc --noEmit -p . && npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): open device control on the phone its link names`.

### Task 7: Teams, Devices page and Apps page by phone

**Files:**
- Modify: `web/src/components/settings/teams.tsx` (`DeviceRow` 37-42, assign/unassign ~405/421, select ~538, table ~563, `assignUdid` ~347), `TeamPicker` and `DeviceActions.tsx` (~55), `device-card.tsx` (~40, ~76), `DeviceTable.tsx` (~84, ~109), `card-view.tsx` (~35-41), `apps.tsx` (~164, ~434), `fleet-status.tsx` (key ~104)
- Test: extend `teams` tests, `device-card`/`DeviceTable` tests, `apps` tests (existing beside them, or create `*.test.tsx`)

**Interfaces:**
- Consumes: Task 4's `PhoneRef`, `phoneKey`, `phoneDomId`, `setDeviceTeam(phone, teamId)`.
- Produces: Teams settings `DeviceRow` has `host: string`; its select's values and the assign state are `phoneKey`s; the PUT bodies send `{ teamId, host }`. `TeamPicker` takes `phone: PhoneRef`. Card and table busy-reason ids are `phoneDomId('dc2-reason-', p)` and `phoneDomId('devtable-reason-', p)`; card keys `phoneKey`. The Apps page's install select values are `phoneKey`s.

- [ ] **Step 1: Write failing tests**: assigning the h2 phone in Teams settings PUTs `/device/emulator-5554/team` with body `{ teamId, host: 'http://h2:4723' }`; two same-udid phones render as two options with distinct values; the card's `aria-describedby` points at an element that exists (`document.getElementById`) for a host with `://` (Review Focus 1); the Apps page installs on the h2 phone with `host` sent.
- [ ] **Step 2: Run** `cd web && npx vitest run src/components/settings src/components/devices src/components/apps` (the directories holding those files). Expected: FAIL.
- [ ] **Step 3: Implement** the changes listed under Interfaces.
- [ ] **Step 4: Run** `cd web && npx tsc --noEmit -p . && npx vitest run`. Expected: PASS (the design ratchet tests included).
- [ ] **Step 5: Commit** — `feat(web): change and install on the phone you picked`.

### Task 8: Docs, reported flags and the UI suites

**Files:**
- Modify: `website/docs/devices.md` ("Phones two servers name alike"), `website/docs/device-control.md`, `website/docs/recordings.md`, `CLAUDE.md` ("Phone identity" paragraph and "Live events are team-scoped at emit time"), `web/test/viewport/overflow.spec.ts` (mocked device list, the matrix), `web/test/sweep/controls.spec.ts` (mocked device list)
- Test: the two Playwright suites

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Update the docs**: the dashboard now shows two same-named phones as two (each card names its server; device control asks which phone an old link means); drop "the dashboard handles them in a later release"; CLAUDE.md says live events are delivered by the exact phone (`DeviceTeamResolver` by udid and host; a udid-only scope with two rows reaches admins only) and that the dashboard sends `host` everywhere through `web/src/lib/phone.ts`.
- [ ] **Step 2: Extend the suites**: the viewport and sweep device mocks add a second `emulator-5554` on another host; the overflow matrix adds `/devices/emulator-5554/control` (no host, the chooser) with a content check that two chooser links mounted.
- [ ] **Step 3: Run** `cd web && npm run build` then, against a running auth-disabled server built from this branch (`npm run build:xenon && npm run build:copy`), `npm run test:viewport`. Expected: PASS. Run `npm run test:sweep` once (about 20 minutes). Expected: PASS.
- [ ] **Step 4: Run** `export ANDROID_HOME=~/Library/Android/sdk; npm run test:all` and `cd web && npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** — `docs(devices): two same-named phones in the dashboard`.

### Task 9: Lab check

**Files:** none (scratch servers under the session scratchpad).

- [ ] **Step 1:** Build this branch (`npm run build:all`), start a scratch hub (sign-in on, one seeded admin; credentials in a mode-600 file) and a scratch node sharing the lab's adb, both on `0.0.0.0`, fake HOMEs, scratch databases (part 1's recipe).
- [ ] **Step 2:** In the browser pane, signed in to the scratch hub: the Devices page shows both `emulator-5554` cards, each naming its server; open each one's device control from its card (the address carries its `host`); tap Home on the node's (the node's log shows the keyevent, the hub ran no adb) and on the hub's (the reverse); open `/devices/emulator-5554/control` (the chooser lists both).
- [ ] **Step 3:** Live devices: add both phones, see both previews, record both, stop; the recording page lists both phones with their servers, and `bundle.zip` keeps both. Close the tab and check both holds released (`GET /device`, no `manual_` hold on either).
- [ ] **Step 4:** Teams settings: put the node's phone in a team; only that row moves.
- [ ] **Step 5:** A member of that team only (seeded) sees the node phone's live events and not the hub phone's (socket frames, or the Live devices tile); stop both servers, delete the databases and credentials.
