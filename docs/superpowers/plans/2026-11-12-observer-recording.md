# Observer-mode Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /xenon/api/recordings { sessionIds }` records the phones of the caller's own running sessions into one group (per-phone videos plus the composite), holding nothing on the phones, and stops the whole group as soon as any of those sessions ends.

**Architecture:** A pure resolver turns session ids into phones (by the claim on the Device row) and checks ownership. The orchestrator gets an `observe` start mode: the busy check lets the named session through, no manual hold is written or released, and an in-memory map from session to group drives `sessionEnded`, called from `forgetSessionMemory` and from a 10 s backstop. The route, the library filter and the session page link sit on top.

**Tech Stack:** TypeScript 5.5, Express, TypeDI, Prisma (SQLite), Mocha/Chai/Sinon; React 17 + Vitest for the web.

**Spec:** `docs/superpowers/specs/2026-11-12-observer-recording-design.md`

## Global Constraints

- Exactly one of `udids` and `sessionIds`; `udids` behaves exactly as in 2.32.
- Every refusal about a session (unknown, ended, another user's, ownerless, on a hidden phone) is `404 { error: 'not_found' }` for the whole request, byte for byte the answer an unknown udid gets.
- Ownership: `SessionOwnerResolver.ownerOf(sessionId) === resolveActor(req).userId`, or `resolveActor(req).isAdmin`. A null owner refuses non-admins.
- A phone runs a session when `holdsClaim(device, { sessionId })` (`src/data-service/deviceClaims.ts`).
- An observer recording never calls `blockDeviceFn`, `unblockDeviceFn` or `leaveDeviceFn`.
- Ending: the whole group stops, every recording `STOPPED` with `fail_reason` `session_ended`. Backstop interval 10 000 ms.
- `Recording.session_id` is written only when the Session row exists (it is a foreign key).
- Errors: both/neither/bad entry/duplicate phone `400`; cloud phone `409 device_busy` with reason `cloud_phone`; `add-device` on an observer group `409 observer_group`.
- Flag `observer-recording`; `features.recording.observer: true`.
- Specs are hermetic (CLAUDE.md): `import 'reflect-metadata'`, hooks inside `describe`, `useScratchDatabase()` where Prisma is touched, `request` from `test/helpers/loopbackRequest`.
- No attribution lines in commits. Surgical `git add`.

## Review Focus

1. A session that ends **while the start is still running** (between resolve and the group being registered): the group must still stop, not record the next test. Test in Task 3.
2. Two sessions on two phones where one is the caller's and one isn't: nothing starts, the answer is the unknown `404`. Test in Task 4.
3. `forgetSessionMemory` called twice, or for a session with no observer group: no throw, no second stop. Test in Task 3/5.
4. On a hub, a node phone's claim is the hub's (`claimSessionId`) while `session_id` may be empty: the resolver and the busy check must both accept it. Test in Task 1 and 2.
5. An observer recording whose ffmpeg ends on its own (`handleSourceEnded`): no hold released, and the group's map entry still cleared when the group is later stopped. Test in Task 3.

---

### Task 1: Resolve session ids to phones

**Files:**
- Create: `src/services/recording/observerSessions.ts`
- Test: `test/unit/observer-sessions.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ObservedPhone { sessionId: string; udid: string; host: string }
  export interface ObserverDeps {
    findClaimedDevices(sessionId: string): Promise<IDevice[]>; // claimSessionId = id, plus session_id = id; filtered by holdsClaim
    ownerOf(sessionId: string): Promise<string | null>;
  }
  export type ObserverResolution =
    | { ok: true; phones: ObservedPhone[] }
    | { ok: false; status: 400; error: string }
    | { ok: false; status: 404 }
    | { ok: false; status: 409; busyDevices: Array<{ udid: string; reason: 'cloud_phone' }> };
  export function parseSessionIds(body: unknown): string[] | { error: string }; // validates sessionIds shape only
  export async function resolveObservedPhones(
    sessionIds: string[], caller: { userId: string | null; isAdmin: boolean }, deps: ObserverDeps,
  ): Promise<ObserverResolution>;
  export function defaultObserverDeps(): ObserverDeps; // DeviceStoreFactory.getStore().findDevices + Container.get(SessionOwnerResolver).ownerOf
  ```

- [ ] **Step 1: Write the failing tests** in `test/unit/observer-sessions.spec.ts`, with fake deps (no database):
  - `resolves each session to the phone its claim names` — two ids, two devices (`claimSessionId` set) → `phones` in request order with `udid`/`host`.
  - `accepts a pre-claim row whose session_id names the session` — `claimSessionId: null, session_id: 'S1'`.
  - `accepts a hub's node phone claimed by claimSessionId with an empty session_id`.
  - `refuses with 404 when no claim names a session` → `{ ok: false, status: 404 }`.
  - `refuses with 404 when another user owns any session` (one own, one other) and `when the owner is null`.
  - `lets an admin through for another user's and an ownerless session`.
  - `refuses two ids naming one phone with 400`.
  - `refuses a cloud phone (device.cloud) with 409 cloud_phone` — after ownership passes.
  - `parseSessionIds`: `[]`, `'S1'`, `[1]`, `['']` → `{ error }`; `['S1','S1']` → `{ error }` (duplicate id).

- [ ] **Step 2: Run** `npx mocha test/unit/observer-sessions.spec.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement** in `src/services/recording/observerSessions.ts`. Check order per id: claim (404) → owner unless admin (404) → then across ids duplicates (400) → cloud (409). All checks before any answer is built, so the answer never depends on which id failed.

- [ ] **Step 4: Run** the spec — Expected: PASS.

- [ ] **Step 5: Commit** `feat(recording): resolve observed sessions to their phones`.

---

### Task 2: Busy check lets the named session through

**Files:**
- Modify: `src/services/recording/busy-precheck.ts` (`findBusy`)
- Test: `test/unit/busy-precheck-observer.spec.ts`

**Interfaces:**
- Produces: `findBusy(udids: string[], actorId?: string, actorApiKeyId?: string, observed?: ReadonlyMap<string, string>): Promise<BusyEntry[]>` — `observed` maps udid → session id.

- [ ] **Step 1: Write the failing tests** (store, recordings and leases injected as the existing busy-precheck specs do):
  - `skips automation when the phone's claim names the observed session` (`busy: true, claimSessionId: 'S1', session_id: 'S1'`, observed `U1→S1`) → `[]`.
  - `skips it for a node phone claimed by claimSessionId with session_id null` → `[]`.
  - `still refuses automation for another session on the phone` (observed `U1→S2`) → reason `automation`.
  - `still refuses a phone with another recording` → `recording_other_group`, and `another user's lease` → `leased`.
  - `without observed, a session's phone is refused as before` → `automation`.

- [ ] **Step 2: Run** `npx mocha test/unit/busy-precheck-observer.spec.ts` — Expected: the skip tests FAIL.

- [ ] **Step 3: Implement**: after the lease block, `if (observed?.has(udid) && holdsClaim(device, { sessionId: observed.get(udid)! })) continue;`.

- [ ] **Step 4: Run** the new spec and every `busy-precheck*` spec — Expected: PASS.

- [ ] **Step 5: Commit** `feat(recording): the busy check lets an observed session's phone through`.

---

### Task 3: The orchestrator's observe mode and `sessionEnded`

**Files:**
- Modify: `src/services/recording/RecordingOrchestrator.ts`
- Test: `test/unit/recording-observer.spec.ts`

**Interfaces:**
- Consumes: `findBusy(..., observed)` (Task 2).
- Produces:
  - `StartInput.observe?: ObservedPhone[]` (Task 1's type). When set, `udids` must equal `observe.map(p => p.udid)`.
  - `StartedRecording.sessionId?: string`.
  - `OrchestratorDeps.sessionRowExistsFn?: (sessionId: string) => Promise<boolean>` (default: `prisma.session.findUnique({ where: { id }, select: { id: true } })` not null), `OrchestratorDeps.claimHoldsFn?: (udid: string, sessionId: string) => Promise<boolean>` (default: device row by udid + `holdsClaim`), `OrchestratorDeps.observerCheckMs?: number` (default `10_000`).
  - `async sessionEnded(sessionId: string): Promise<void>` — stops the group observing it, if any; never throws.
  - `isObserverGroup(groupId: string): boolean`.
  - `RecordingError` code `'observer_group'`, thrown by `addDevice` for an observer group.
  - `stop(groupId, opts?: { failReason?: string })` — `failReason` passed to each `finalizeRecording` (which gains `opts.failReason`, kept when the status stays `STOPPED`).

- [ ] **Step 1: Write the failing tests** with the orchestrator built as `recording-orchestrator.spec.ts` builds it (stubbed `blockDeviceFn`, `unblockDeviceFn`, `ensureMjpegPortFn`, `nodeSourceFn`, `leaveDeviceFn`, fake store and pipeline):
  - `observe start writes no hold`: `blockDeviceFn.callCount === 0`, and the busy check got the observed map.
  - `writes session_id on the rows only when the Session row exists` (two phones, `sessionRowExistsFn` true for one).
  - `answers each recording with its sessionId`.
  - `sessionEnded stops the whole group with session_ended`: both rows finalized `STOPPED`, `fail_reason: 'session_ended'`, composite stopped first; `unblockDeviceFn` and `leaveDeviceFn` never called.
  - `sessionEnded twice, or for an unknown session, stops nothing more and does not throw`.
  - `a session that ends during the start still stops the group`: `sessionEnded('S1')` is called while `ensureMjpegPortFn` is pending; once `start` resolves the group is stopped.
  - `the backstop stops a group whose claim no longer names its session`: `observerCheckMs: 20`, `claimHoldsFn` returns false for S2 after the start → group stopped with `session_ended` within 200 ms; its timer cleared after (no second stop).
  - `an observer recording whose ffmpeg ends on its own releases nothing`, and a later `sessionEnded` stops the rest and clears the map.
  - `addDevice on an observer group throws observer_group`.
  - `a udid start still blocks and leaves as before` (regression).

- [ ] **Step 2: Run** `npx mocha test/unit/recording-observer.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**:
  - Two maps: `observerGroups: Map<groupId, { sessions: ObservedPhone[]; timer: NodeJS.Timeout }>` and `observedBy: Map<sessionId, groupId>`; plus `endedEarly: Set<sessionId>` (bounded to 1 000, oldest dropped) for endings that arrive before the group is registered.
  - Register the session ids **before** the busy check (`pendingSessions`), so `sessionEnded` during the start marks them; after the group is built, stop it at once if any was marked.
  - In observe mode skip the block loop, and in `finalizeRecording` skip `letGoOfDevice` for an observer recording (still `closeNodeSource`, `gate.release`).
  - `stop` clears the group's timer and both maps' entries for it.
  - The backstop timer is `unref()`'d; one tick checks every observed phone with `claimHoldsFn` and calls `sessionEnded` for the first that fails.

- [ ] **Step 4: Run** the new spec and `test/unit/recording-*.spec.ts` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(recording): observe mode: no hold, and the group stops with its first session`.

---

### Task 4: The route takes `sessionIds`

**Files:**
- Modify: `src/app/routers/recordings.ts` (`POST /recordings`, `POST /recordings/:groupId/add-device`)
- Test: `test/unit/recordings-observer-route.spec.ts` (set up like `recordings-write-visibility.spec.ts`: stubbed orchestrator, `filterRowsByVisibleDevice` stub)

**Interfaces:**
- Consumes: `parseSessionIds`, `resolveObservedPhones`, `defaultObserverDeps` (Task 1); `StartInput.observe` and `RecordingError('observer_group')` (Task 3).
- Produces: the route picks `defaultObserverDeps()` through a module-level `observerDeps` that tests replace with `setObserverDepsForTests(deps | undefined)` exported from `recordings.ts`.

- [ ] **Step 1: Write the failing tests**:
  - `starts an observer group for the owner's sessions`: orchestrator `start` called with `udids` = the phones, `observe` = the resolution, `actorId`, `note`; `202` with the orchestrator's answer.
  - `both udids and sessionIds, or neither, is 400` and `a bad sessionIds entry is 400`, before any lookup.
  - `another user's session among the owner's is the unknown 404, nothing started` (`orch.start.callCount === 0`, body `{ error: 'not_found' }`).
  - `an ownerless session is 404 to a member, allowed to an admin`.
  - `a session on a phone the member's teams can't see is 404`.
  - `a cloud phone is 409 device_busy with reason cloud_phone`.
  - `add-device on an observer group is 409 observer_group` (orchestrator stub throws it).
  - `a udids start is unchanged` (one regression).

- [ ] **Step 2: Run** `npx mocha test/unit/recordings-observer-route.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**: branch on which field is present; for `sessionIds`, resolve, then `seesEveryDevice(req, udids)` (404 when not), then `start`. Map `observer_group` to `409 { error: 'observer_group', message: 'An observer recording records the sessions it was started with.' }`.

- [ ] **Step 4: Run** the new spec and `recordings-write-visibility.spec.ts`, `recording-requests.spec.ts` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(recording): POST /recordings takes the caller's session ids`.

---

### Task 5: Every session ending reaches `sessionEnded`

**Files:**
- Modify: `src/sessions/sessionMemory.ts`
- Test: `test/unit/session-memory-recording.spec.ts`

**Interfaces:**
- Consumes: `RecordingOrchestrator.sessionEnded` (Task 3).

- [ ] **Step 1: Write the failing tests**: with `RecordingOrchestrator` registered as a stub in the container (restored after), `forgetSessionMemory('S1')` calls `sessionEnded('S1')` once; a rejecting `sessionEnded` is logged, not thrown (no unhandled rejection: listen on `process` for `unhandledRejection` during the test); `forgetSessionMemory(null)` calls nothing.

- [ ] **Step 2: Run** `npx mocha test/unit/session-memory-recording.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**: `Container.get(RecordingOrchestrator).sessionEnded(sessionId).catch(warn)`, imported statically only if `npx tsc --noEmit -p .` shows no cycle error, else through `import()`.

- [ ] **Step 4: Run** the spec, plus `test/unit/session-memory*.spec.ts` and the lifecycle specs that call `forgetSessionMemory` (`grep -l forgetSessionMemory test/unit`) — Expected: PASS.

- [ ] **Step 5: Commit** `feat(recording): a session's end stops the group observing it`.

---

### Task 6: Find a session's recording, and link it both ways

**Files:**
- Modify: `src/app/routers/recordingRequests.ts` (`parseLibraryQuery`: `sessionId`), `src/services/recording/recordingSummary.ts` (`LibraryFilter.sessionId`, `SummaryRow.session_id`, group phones carry `sessionId`), `src/app/routers/recordings.ts` (`toSummaryRow`, `GET /recordings/:groupId` rows' `sessionId`), the recording store's library select if it omits `session_id`
- Modify: `web/src/components/session-detail/recording-card.tsx` (a link "Recorded with other phones" → `/recordings/<groupId>`, from `GET /recordings?sessionId=<id>&limit=1`), the recording page's phone list (a "Session" link to `/sessions/<id>` where `sessionId` is set; find the component with `grep -rl "recordings/:groupId\|RecordingDetail" web/src`)
- Test: `test/unit/recording-summary.spec.ts` (filter), `web/src/components/session-detail/recording-card.test.tsx`

- [ ] **Step 1: Write the failing tests**: `buildLibrary` with `{ sessionId: 'S1' }` keeps only groups with a row whose `session_id` is `S1`; `parseLibraryQuery({ sessionId: 'S1' })` sets it; the card renders the link when the mocked API returns a group and nothing when it returns none.
- [ ] **Step 2: Run** `npx mocha test/unit/recording-summary.spec.ts` and `cd web && npx vitest run src/components/session-detail/recording-card.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** Wording is for testers (`web/src/design/wording.test.ts`); colours from roles; a link takes the accent from the shared link style.
- [ ] **Step 4: Run** both again plus `cd web && npx vitest run src/design` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(recording): a session's page links to the recording that observed it`.

---

### Task 7: Report it, document it

**Files:**
- Modify: `src/app/routers/capabilities.ts` (`features.recording: { observer: true }`), `src/app/routers/sdk-version.ts` (`observer-recording` with a line in its comment), the OpenAPI YAML that documents `POST /recordings` (`grep -l "/recordings" src/app/openapi/*.yaml`), `website/openapi.json` (`npm run build:openapi`), the website's recordings page (`grep -rl "POST /xenon/api/recordings\|/recordings" website/docs`), `CLAUDE.md` (Recording Subsystem: one bullet on observer groups)
- Test: the existing capabilities and sdk-version specs (`grep -l "lifecycle-webhooks" test/unit`), `test/unit/openapi-coverage.spec.ts`

- [ ] **Step 1: Write the failing assertions**: capabilities answers `features.recording.observer === true`; `/sdk/version` `supports` includes `observer-recording`.
- [ ] **Step 2: Run** those specs — Expected: FAIL.
- [ ] **Step 3: Implement** the two reports; document `sessionIds`, the `404`/`409` answers and `observer_group` in the YAML; regenerate `website/openapi.json`; write the docs page section (what it records, who may, that it holds nothing, that the group stops when the first session ends, the backstop, node phones through the hub, cloud phones refused).
- [ ] **Step 4: Run** `npx mocha test/unit/openapi-coverage.spec.ts` and the two specs; then `npm run test:all > $LOG 2>&1; tail -5 $LOG` — Expected: all passing.
- [ ] **Step 5: Commit** `feat(recording): report and document observer recordings`.

---

### Task 8: Lab check (no commit unless a fix is needed)

Against a scratch server built from this branch (fake HOME, `DATABASE_URL` scratch file, port 4724, auth disabled), with the lab's emulator and iPhone:

- [ ] Start an Android session and an iPhone session (`record_video` on); `POST /recordings { sessionIds: [both] }` → `202`, `compositeEnabled: true`.
- [ ] Drive both for ~30 s (a few finds and taps); every command answers; the iPhone's WDA `/status` answers before and after the start.
- [ ] End the Android session: within a second the group is `STOPPED`, `fail_reason: session_ended`, both mp4s and the composite play (`ffmpeg -i` reads a duration), and the iPhone session still answers commands.
- [ ] The Device rows' `session_id` / `busy` are those of the sessions throughout (no `manual_` value).
- [ ] If the iPhone check fails (its WDA restarted), stop: rule per the spec (`no_picture` refusal when no stream runs) and add that to Task 3/4 with a test.
- [ ] Stop the scratch server; delete its database.
