# Phone Identity by Udid and Host (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every server path that acts on a phone finds it by udid and, when given, host; a udid two visible servers report, named without a host, answers `409 ambiguous_phone` instead of reaching the wrong phone.

**Architecture:** One resolver, `findPhone`, in `src/middleware/controlDevice.ts`, used by the `/control` guards, gate and handlers (through the existing per-request memo), by stream tickets (a signed `host` claim) and their sockets, by recordings (a phone is `{ udid, host }` throughout) and by the team route. On a hub the gate forwards to the resolved row's node without `host`.

**Tech Stack:** TypeScript 5.5, Express, TypeDI, Prisma (SQLite), Mocha/Chai/Sinon.

**Spec:** `docs/superpowers/specs/2026-11-13-phone-host-identity-design.md`

## Global Constraints

- With a host: the row with exactly that udid and host, or none. Without: among rows of the udid the caller can see (`isDeviceVisible`; `teamIds === undefined` sees all): one → it, none → none, two or more → ambiguous.
- Ambiguous answers `409 { error: 'ambiguous_phone', message: 'Two servers have a phone named <udid>. Name the one you mean with its host.', hosts: [<visible hosts>] }`. A hidden row is never returned or named.
- A host that isn't a non-empty string: `400 { error: 'invalid_host' }`.
- A host naming a hidden or unknown phone is the existing unknown answer, byte for byte (the `HIDDEN_DEVICE_UDID` swap).
- On a hub the gate forwards without `host`; nodes of any 2.x keep working.
- A ticket without a `host` claim follows the udid-only rule.
- `shared_udid` is removed (dep, refusal, docs).
- Flag `phone-host`; `features.phoneIdentity: { hostParameter: true }`.
- A lab with unique udids sees no change anywhere: every existing spec stays green unchanged except where it asserts udid-only internals.
- Specs hermetic (CLAUDE.md "Testing"); no attribution lines; surgical `git add`; never `eslint --fix`/`prettier --write` across the repo.

## Review Focus

1. Two rows of one udid where the caller sees only one: resolves to the visible one, and the `409` never fires or names the hidden host. Test in Task 1 and Task 2.
2. A `?host=` naming the hub's own row of a duplicate on a hub: handled locally, not forwarded. Test in Task 2.
3. A ticket minted with one host and redeemed with another (`?host=` or a different socket path): refused. Test in Task 3.
4. A recording group holding two same-named phones on two hosts: each phone's hold, source and `isRecording` are its own; stopping releases both, each once. Test in Task 4.
5. The URL-encoded host (`?host=http%3A%2F%2F192.168.0.102%3A4723`) and a host with a trailing slash or different case: exact string match after decoding, no normalisation; a mismatch is the unknown answer. Test in Task 1.

---

### Task 1: The resolver

**Files:**
- Modify: `src/middleware/controlDevice.ts`
- Test: `test/unit/find-phone.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PhoneLookup =
    | { kind: 'found'; device: ControlDevice }
    | { kind: 'none' }
    | { kind: 'ambiguous'; hosts: string[] };
  export interface FindPhoneOptions { host?: string; teamIds?: string[] }
  export type FindPhoneRows = (udid: string) => Promise<ControlDevice[]>;
  export async function findPhone(udid: string, opts: FindPhoneOptions, rows?: FindPhoneRows): Promise<PhoneLookup>;
  export const findPhoneRowsInStore: FindPhoneRows; // DeviceStoreFactory.getStore().findDevices({ udid })
  export function ambiguousPhoneBody(udid: string, hosts: string[]): { error: 'ambiguous_phone'; message: string; hosts: string[] };
  export function readHostParam(value: unknown): string | undefined | null; // undefined: absent; null: invalid; else the host
  ```
  `ControlDevice` gains `host?: string` if it lacks it.

- [ ] **Step 1: Write the failing tests** (fake `rows`, no database): host matches → found; host of another row → none; host of a hidden row (teamIds excludes its team) → none; no host, one row → found; no host, none → none; no host, two visible → ambiguous with both hosts in row order; two rows, one hidden → found (the visible one); `teamIds` undefined sees every row; exact match only (`http://a:1` vs `http://a:1/` and `HTTP://A:1` → none); `ambiguousPhoneBody('emulator-5554', ['h1','h2'])` deep-equals the constraint's body; `readHostParam`: `undefined` → undefined, `''`/`[]`/`['a','b']`/`5` → null, `'h'` → `'h'`.
- [ ] **Step 2: Run** `npx mocha test/unit/find-phone.spec.ts` — Expected: FAIL, exports missing.
- [ ] **Step 3: Implement** in `controlDevice.ts`. Visibility is `isDeviceVisible(row.teamId ?? null, teamIds)` (`src/services/device-access/deviceVisibility.ts`).
- [ ] **Step 4: Run** it — Expected: PASS.
- [ ] **Step 5: Commit** `feat(device): find a phone by udid and host`.

---

### Task 2: Device control

**Files:**
- Modify: `src/middleware/controlDevice.ts` (`readControlUdid`, `lookupControlDevice`), `src/middleware/deviceTeamGuard.ts`, `src/middleware/deviceAccessGuard.ts`, `src/app/routers/nodePhoneControl.ts`, `src/app/routers/control.ts` (`getDeviceInfo`)
- Test: `test/unit/control-phone-host.spec.ts`; existing `test/integration/team-visibility-control.spec.ts` must stay green unchanged

**Interfaces:**
- Consumes: Task 1's `findPhone`, `ambiguousPhoneBody`, `readHostParam`.
- Produces: `readControlUdid(req, res, who): { udid: string; host?: string } | null` (null after it answered `400 invalid_udid` or `400 invalid_host`); `lookupControlDevice(res, udid, host, teamIds, rows?)` memoized on `res.locals` by udid+host, returning `PhoneLookup`; the resolved row available to handlers as `controlDeviceOf(res): ControlDevice | undefined`. The host a request uses is `req.query.host`, else `req.auth.ticketHost` (Task 3), else none.

- [ ] **Step 1: Write the failing tests** (an app built like `team-visibility-control.spec.ts`'s, fake store with `emulator-5554` on `http://hub:4723` (this server's own host) and `http://node:4723` (a node's), a member who sees both, and one who sees only the node's):
  - `no host, both visible → 409 ambiguous_phone with both hosts`, nothing reaches a handler or the node;
  - `no host, one visible → that phone` (the member who sees only the node's is forwarded to the node);
  - `?host=http://node:4723 → forwarded to the node, the forwarded URL has no host parameter`;
  - `?host=http://hub:4723 → handled here (a stub handler sees the hub's row via controlDeviceOf), not forwarded`;
  - `?host= of a hidden phone → the unknown answer, identical to an unknown udid's` (compare status and body with a request for an unknown udid);
  - `?host=` empty or repeated → `400 { error: 'invalid_host' }`;
  - `getDeviceInfo` (e.g. `GET display`) reads the resolved row, not the first row of the udid.
- [ ] **Step 2: Run** `npx mocha test/unit/control-phone-host.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** The team guard calls `lookupControlDevice` with the caller's `teamIds`; on `ambiguous` it answers the 409 itself; on `none` it swaps in `HIDDEN_DEVICE_UDID` as today. The ownership guard and the gate read the memoized row. The gate's forward strips `host` from the query string it sends (keep every other parameter). `getDeviceInfo(udid)` becomes `getDeviceInfo(res, udid)` reading `controlDeviceOf(res)` (keep the hidden-udid behaviour).
- [ ] **Step 4: Run** the new spec, `team-visibility-control.spec.ts`, every `test/unit/*control*.spec.ts`, `test/unit/*node-phone*.spec.ts`, `test/unit/device-access*.spec.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(control): name a phone by udid and host`.

---

### Task 3: Tickets and sockets

**Files:**
- Modify: `src/services/token/StreamTicketService.ts`, `src/app/routers/control.ts` (`stream/ticket`), `src/middleware/authMiddleware.ts` (ticket path), `src/app/ws/h264StreamWs.ts`, `src/app/ws/logcatWs.ts`, `src/app/ws/nodeSocketRelay.ts`, the auth type where `req.auth` is declared
- Test: `test/unit/stream-ticket-host.spec.ts`

**Interfaces:**
- Consumes: Task 2's `controlDeviceOf(res)`; Task 1's `findPhone`.
- Produces: `mint(udid, actorId, actor?, host?: string)`; `redeem(ticket, udid, host?: string): Promise<StreamTicketActor & { host?: string }>` — a ticket with a `host` claim is refused when `host` is given and differs; the returned `host` is the claim; `req.auth.ticketHost?: string` set by the MJPEG ticket path; `openNodeSocket` request gains `host?: string` and resolves with `findPhone(udid, { host })`.

- [ ] **Step 1: Write the failing tests:** minted through `stream/ticket?host=http://node:4723` → the token's payload has that `host`; `redeem(t, udid, otherHost)` throws; `redeem(t, udid)` returns `host`; a token minted without a host redeems with any or no host (old tickets); the MJPEG `GET stream?ticket=` of a node-host ticket reaches the node's phone (forwarded) and with a conflicting `?host=` is `401 invalid ticket`; the H.264 and logcat sockets pass the ticket's host to the relay, which opens the socket on that host's node; an ambiguous udid with a host-less old ticket closes the socket with `1008`.
- [ ] **Step 2: Run** `npx mocha test/unit/stream-ticket-host.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** `stream/ticket` mints with the resolved row's host. The sockets' `redeem` dep returns the host and the node-socket dep receives it; a resolution that is `ambiguous` or `none` closes with `1008` as an unknown phone does.
- [ ] **Step 4: Run** the new spec plus `test/unit/*ticket*.spec.ts`, `test/unit/*h264*ws*.spec.ts`, `test/unit/*logcat*ws*.spec.ts`, `test/unit/node-socket-relay*.spec.ts`, `test/unit/auth-middleware*.spec.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(control): stream tickets carry the phone's host`.

---

### Task 4: Recordings by udid and host

**Files:**
- Modify: `src/services/recording/busy-precheck.ts`, `recording-store.ts` (`isRecording`, `activeRecordingFor`), `RecordingOrchestrator.ts`, `nodeRecordingSource.ts` (`recordingSourceFor`), `ensureMjpegForRecording.ts`, `observerSessions.ts` (remove `udidIsShared`/`shared_udid`), `src/app/routers/recordings.ts` (parse entries, `add-device`, `/recordings/active`), `src/app/routers/nodePhoneControl.ts` and `control.ts` (`stream/stop`'s recording check)
- Test: `test/unit/recording-phone-host.spec.ts`; update the existing recording specs only where they assert udid-only internals

**Interfaces:**
- Consumes: Task 1's `findPhone`, `ambiguousPhoneBody`.
- Produces: `type RecordedPhone = { udid: string; host: string }`; `StartInput.phones: RecordedPhone[]` (replacing `udids`; `observe` entries already carry hosts); `findBusy(phones: RecordedPhone[], actorId?, actorApiKeyId?, observed?)` with `observed` keyed by `udid@host`; `RecordingStore.isRecording(udid, host)`, `activeRecordingFor(udid, host)`; `recordingSourceFor(device: ControlDevice, actorId)`; `ensureMjpegForRecording(udid, host)`; `addDevice(groupId, phone: RecordedPhone, actorId)`; route helper `parsePhoneEntries(value: unknown): Array<{ udid: string; host?: string }> | { error: string }`.

- [ ] **Step 1: Write the failing tests:**
  - route: `udids: ['emulator-5554']` with the udid on two visible hosts → `409 ambiguous_phone`, nothing started; `udids: [{udid:'emulator-5554', host:'http://node:4723'}, {udid:'emulator-5554', host:'http://hub:4723'}]` → one group of two phones; an entry with a bad host → `400 invalid_host`; a host the caller can't see → the existing `404 not_found`;
  - orchestrator: the two same-named phones each get their own source (node relay for the node's, the hub's own stream for the hub's), their own hold (`blockDeviceFn` called with each host) and their own row's `device_host`; stopping releases each once;
  - `isRecording('emulator-5554', 'http://node:4723')` is true only for that host's RECORDING row;
  - `findBusy` reads each phone by udid and host (a busy hub row doesn't refuse the node's phone);
  - observer recordings: a session on the node's `emulator-5554` while the hub has its own is recorded (no `shared_udid`);
  - `add-device` with `{ udid, host }`; `/recordings/active` reads each phone's hold by udid and host; `stream/stop` refused (`409 device_recording`) only for the host being recorded.
- [ ] **Step 2: Run** `npx mocha test/unit/recording-phone-host.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Key every in-memory map that held a udid by `${udid}@${host}`. Remove the `udidIsShared` dep, its default, the `shared_udid` refusal and its route mapping.
- [ ] **Step 4: Run** the new spec and every `test/unit/recording*.spec.ts`, `recordings-*.spec.ts`, `observer-sessions.spec.ts`, `busy-precheck*.spec.ts`, `stream-stop-recording.spec.ts`, `cross-workflow.spec.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(recording): record phones by udid and host`.

---

### Task 5: The team route

**Files:**
- Modify: `src/app/routers/grid.ts` (`assignDeviceToTeam`, `phonesOfUdid`)
- Test: `test/unit/device-team-host.spec.ts`

**Interfaces:**
- Consumes: Task 1's `readHostParam`, `ambiguousPhoneBody`.

- [ ] **Step 1: Write the failing tests:** with `host` (body or query) only that phone moves (connected or saved); without a host and the udid on one host → moves as today; on two hosts → `409 ambiguous_phone` (hosts listed; admin route, every host is visible); an invalid host → `400 invalid_host`.
- [ ] **Step 2: Run** `npx mocha test/unit/device-team-host.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and the existing team-route specs (`grep -l "device/.*/team" test/unit`) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(device): move one phone's team by host`.

---

### Task 6: Report and document

**Files:**
- Modify: `src/app/routers/capabilities.ts`, `src/app/routers/sdk-version.ts`, `src/app/openapi/control.yaml` and `platform.yaml` (+ `npm run build:openapi`), a website docs page (`website/docs/device-control.md` or `devices.md`: a section "Phones two servers name alike"), `website/docs/recordings.md` (drop `shared_udid`, add `{ udid, host }`), `CLAUDE.md` (a short "Phone identity" paragraph under Device access guard)
- Test: the capabilities and sdk-version specs, `openapi-coverage.spec.ts`

- [ ] **Step 1: Write the failing assertions:** `features.phoneIdentity` deep-equals `{ hostParameter: true }`; `supports` includes `phone-host`.
- [ ] **Step 2: Run** them — Expected: FAIL.
- [ ] **Step 3: Implement** the two reports and the docs: `host` on every `/control` operation (one shared parameter), the ticket route, `POST /recordings` entries and `add-device`, the team route; the `ambiguous_phone` 409 and `invalid_host` 400 as shared responses; the docs section says how to see same-named phones (each listed with its host), how to name one, and that the dashboard handles them in a later release (until then it shows the 409).
- [ ] **Step 4: Run** the three specs, `npx tsc --noEmit -p .`, then `npm run test:all` once — Expected: all passing.
- [ ] **Step 5: Commit** `feat(device): report and document phone identity by host`.

---

### Task 7: Lab check (no commit unless a fix is needed)

A scratch hub (port 4724) and a scratch node (port 4725) built from this branch on the lab Mac, fake HOMEs, their own databases, auth disabled, the node registered to the hub, both listing the shared adb's `emulator-5554` under their own hosts.

- [ ] `GET /control/emulator-5554/display` on the hub without a host → `409 ambiguous_phone` with both hosts.
- [ ] With `?host=<node host>` → forwarded: the node's log shows the request; with `?host=<hub host>` → the node's log doesn't.
- [ ] A stream ticket minted with the node's host opens the H.264 socket through the hub's relay (the node's log shows the socket).
- [ ] `POST /recordings` with both phones as `{ udid, host }` → one group; the node phone's source is the relay (hub log), the hub phone's its own stream; stop → both `STOPPED`, both rows' holds released.
- [ ] Stop both servers, delete their databases.
