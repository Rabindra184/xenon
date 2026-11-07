# Group Leases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lease can hold 1 to 8 phones as one unit, granted all or nothing from one first-come-first-served queue on the server.

**Architecture:** The `Lease` row becomes the group and a new `LeaseMember` row holds each phone. Every "is this phone leased?" reader goes through member rows, so held phones are skipped everywhere a leased phone is. A `LeaseQueue` runs grant passes under the allocation lock: the oldest waiter holds a maximum matching of its members to free phones, later requests are granted only from what is left, and `LeaseGranter` reserves each member's ports on its phone's server with full rollback.

**Tech Stack:** TypeScript 5.5, Express, Prisma 5 (SQLite and Postgres), TypeDI, Mocha + Chai + Sinon, React 17 + Vitest for the one dashboard label.

**Spec:** `docs/superpowers/specs/2026-11-07-group-leases-design.md`

**Precondition:** branch `feat/group-leases` from `main` once Rabindra184/xenon#557 has merged (Task 4 uses its `PhoneServerPorts.free` and `POST /ports/release`). Until then, branch from `fix/lease-release-node-ports`.

## Global Constraints

- Members per lease: 1 to 8. A request sends `filters` (one member) or `members`, never both.
- `waitMs`: integer 0 to 3,600,000; 0 (the default) means try once, exactly as today.
- `GET /sdk/leases/:id?waitMs=`: at most 25,000; it counts as a heartbeat.
- Grant-pass backstop timer: every 5,000 ms. A phone whose port reservation failed is skipped by passes for 60,000 ms.
- `LeaseOrphanSweeper` keeps its 30 s interval; three missed heartbeats end a waiting or active lease.
- Lease statuses: `waiting`, `active`, `released`, `expired`, `ended`. A waiter that gives up is `expired`; a group that lost a member is `ended`.
- Error answers: `400 bad_request`, `404 no_matching_device` (today's fixed sentence), `409 all_matching_busy` with `retryAfterMs`, `409 lease_waiting` (extend on a waiting lease), `410 gone` (with `reason` when ended), `503 device_unhealthy`, `403 token_mismatch`.
- Session refusal for a group session that names no member: exactly `name the lease member: xe:options.leaseMember`.
- `GET /sdk/version` `supports` adds `lease-groups` and `lease-queue`.
- Dashboard label for a held phone: exactly `Held for a waiting lease`.
- Schema changes are additive only: no column or table dropped (the startup `db push` must lose nothing).
- Every new spec follows CLAUDE.md's `test:all` rules: `useScratchDatabase()` first in the describe, `useOwnNodeId()` fixture phones, `request` from `test/helpers/loopbackRequest`, no root-level hooks, `usePrismaStores()` / `useLokiStores()` where a store matters.
- New routes and changed answers go in `src/app/openapi/grid.yaml` in the same task, then `npm run build:openapi`.
- Never `eslint --fix`; a changed file may not end with more lint errors than on `main`.

## Review Focus

1. **A group no set of phones can satisfy** (e.g. two members both filtered to `udid: X`): answer `404 no_matching_device` at once, never wait forever. Test in Task 6.
2. **A waiter that expires while its grant is reserving ports:** the grant's conditional activation finds no `waiting` row, and every port and lock it took, holds included, is rolled back. Test in Task 4.
3. **Two `waitMs: 0` requests racing for the last free phone:** exactly one `201`, the other `409`. Test in Task 6.
4. **Someone else starting a preview on a held phone:** `409 device_held_by_another_user` saying it is held for a waiting lease. Test in Task 2.
5. **A grant pass that throws** (database error mid-pass): it is logged, the request that triggered it still gets an answer, and the next pass runs normally. Test in Task 5.

---

### Task 1: Schema, and member rows for leases that exist at upgrade

**Files:**
- Modify: `prisma/schema.prisma` (models `Lease`, `Session`; new `LeaseMember`)
- Create: `prisma/migrations/<timestamp>_group_leases/migration.sql` (via `npm run db:generate`)
- Create: `src/services/lease/leaseMembers.ts`
- Modify: `src/services/ServerManager.ts` (call the backfill at boot, before the lease sweeper starts)
- Test: `test/unit/lease/lease-members-backfill.spec.ts`

**Interfaces:**
- Produces: model `LeaseMember { id String @id @default(cuid()), leaseId String, index Int, udid String, host String, allocatedPorts String @default("{}"), capabilityBag String @default(""), heldAt Float, lease Lease @relation(fields: [leaseId], references: [id], onDelete: Cascade) }` with `@@unique([leaseId, index])`, `@@index([udid, host])`, `@@index([leaseId])`.
- Produces: new nullable `Lease` columns `requestedMembers String?` (JSON array of each member's filters), `waitUntil Float?`, `callerTeamIds String?` (JSON array, or null for unscoped), `endReason String?`, `durationMs Float?` (the duration a waiting lease is granted with), and relation `members LeaseMember[]`.
- Produces: `Session.lease_id String?` with `@@index([lease_id])`.
- Produces: `backfillLeaseMembers(db = prisma): Promise<number>` in `leaseMembers.ts`, returning how many member rows it wrote.

- [ ] **Step 1: Write the failing test** `lease-members-backfill.spec.ts` (scratch database, whole suite):
  - `it('gives an active lease from before the upgrade its member 0, from its own columns')`: seed an `active` lease with `deviceUdid: 'u1'`, `deviceHost: 'http://h:4723'`, `allocatedPorts: '{"systemPort":9001}'`, `capabilityBag: '{"x":1}'` and no members; after `backfillLeaseMembers()` there is one member with `index: 0`, `udid: 'u1'`, `host: 'http://h:4723'`, the same ports and bag, and `heldAt` equal to the lease's `createdAt` in ms; the call returns 1.
  - `it('leaves ended leases and leases that have members alone')`: a `released` lease and an `active` lease that already has member 0 get nothing; returns 0.
  - `it('writes nothing the second time')`: two calls; the second returns 0.
- [ ] **Step 2: Run it to see it fail:** `npx mocha test/unit/lease/lease-members-backfill.spec.ts` — fails: `leaseMember` is not a model / `backfillLeaseMembers` not found.
- [ ] **Step 3: Change `prisma/schema.prisma`** as in Interfaces, then `npm run db:generate` (creates the migration) and `npx prisma generate`.
- [ ] **Step 4: Implement `backfillLeaseMembers`**: find `active` leases with no members, create member 0 from each one's own columns.
- [ ] **Step 5: Call it in `ServerManager`** once the database is ready, before `LeaseOrphanSweeper`'s interval is set up; log the count at info when it is above 0; a failure is logged as a warning, not fatal.
- [ ] **Step 6: Run the test and the existing lease specs:** `npx mocha test/unit/lease/*.spec.ts` — PASS.
- [ ] **Step 7: Check the startup schema sync on a real database copy:** copy `~/.cache/xenon/xenon.db` to the scratchpad, `DATABASE_URL=file:<copy> node lib/src/scripts/run-migrations.js` after `npm run build` — it finishes with no data-loss prompt. Note the result in the commit message.
- [ ] **Step 8: Commit** `feat(leases): lease member rows, and member 0 for leases from before the upgrade`

### Task 2: Every lease reader reads member rows

**Files:**
- Modify: `src/services/lease/activeLeases.ts`
- Modify: `src/data-service/prisma-store.ts:455-480` and `src/data-service/device-store.ts:290-300` (`findAndLockDevice`'s lease query)
- Modify: `src/services/lease/LeaseService.ts` (`create` writes member 0 in the same `lease.create`)
- Modify: `src/services/device-access/deviceAccessPolicy.ts` (`denyBody`'s `heldBy`), `src/middleware/deviceAccessGuard.ts` (passes the lease's status)
- Test: `test/unit/lease/lease-members-readers.spec.ts`, `test/unit/lease/LeaseService.spec.ts`

**Interfaces:**
- Consumes: `LeaseMember` (Task 1).
- Produces: `ActiveLease { id: string; deviceUdid: string; deviceHost: string; actorId: string; status: 'waiting' | 'active' }`. `activeLeasesByDevice(db, now)` and `activeLeaseOn(udid, host, db, now)` keep their signatures and read member rows of a lease that is `active` with `expiresAt >= now`, or `waiting` with `waitUntil >= now`.
- Produces: `leasedDeviceKeys(db = prisma): Promise<Set<string>>` in `activeLeases.ts`: `leaseKey(udid, host)` of every member of a lease whose status is `active` or `waiting`, with no time check (the stores' rule today, which ignores expiry).
- Produces: `denyBody(..., heldBy?: 'lease' | 'waiting-lease')`; `'waiting-lease'` says `Device is held for a waiting lease of ${who}. It is free again when that lease is granted and ends, or gives up.`

- [ ] **Step 1: Write the failing tests** in `lease-members-readers.spec.ts` (scratch database; run the store cases under `usePrismaStores()` and again under `useLokiStores()`; fixture phones with `useOwnNodeId()`):
  - `it("a waiting lease's held phone reads as leased, with status waiting")`: lease `waiting`, `waitUntil` in an hour, member on phone A → `activeLeaseOn(A).status === 'waiting'`, and `activeLeasesByDevice()` has A's key.
  - `it('a waiting lease past its waitUntil holds nothing')`: `activeLeaseOn(A)` is null.
  - `it('findAndLockDevice skips a held phone')`: with phones A (held) and B free, matching both, it locks B.
  - `it("someone else's stream/start on a held phone is refused, saying it is held for a waiting lease")` (Review Focus 4): through the `/control` router with the ownership guard, a member who isn't the lease's actor gets `409`, `error: 'device_held_by_another_user'`, message containing `held for a waiting lease`.
- [ ] **Step 2: Add to `LeaseService.spec.ts`** `it('create writes member 0 with the lease')`: `prismaStub.lease.create.firstCall.args[0].data.members.create` deep-includes `{ index: 0, udid: 'u1', host: 'h1' }` with `allocatedPorts` equal to the lease's.
- [ ] **Step 3: Run them to see them fail:** `npx mocha test/unit/lease/lease-members-readers.spec.ts test/unit/lease/LeaseService.spec.ts`.
- [ ] **Step 4: Implement** the readers on `leaseMember.findMany` (select `udid`, `host` and `lease { id, actorId, status }`), `leasedDeviceKeys`, both stores' `findAndLockDevice` on `leasedDeviceKeys`, member 0 in `create` (`members: { create: [{ index: 0, udid, host, allocatedPorts, capabilityBag: '', heldAt: now }] }`, with the bag written by the existing step-5 update to both the lease and member 0), and `heldBy: 'waiting-lease'` when the guard's lease has `status: 'waiting'`.
- [ ] **Step 5: Run the whole suite:** `npm run test:all` — PASS (every existing lease, guard, recording and sweeper spec still green).
- [ ] **Step 6: Commit** `feat(leases): a phone is leased through its member row, held phones included`

### Task 3: Matching members to phones

**Files:**
- Create: `src/services/lease/memberMatch.ts`
- Test: `test/unit/lease/memberMatch.spec.ts`

**Interfaces:**
- Produces: `maxMatching(candidates: string[][], prefer?: (string | null)[]): (string | null)[]` — `candidates[i]` is the phone keys member `i` accepts, in preference order; the result gives each member a distinct key or null, with as many members filled as possible. `prefer[i]` is kept for member `i` whenever a maximum matching allows it (so holds don't move needlessly).
- Produces: `filledCount(match: (string | null)[]): number`.

- [ ] **Step 1: Write the failing tests:**
  - `[['A','B'],['A']]` → `['B','A']`.
  - `[['A'],['A']]` → exactly one null, `filledCount` 1.
  - eight members, each accepting all of eight keys → eight distinct keys.
  - `maxMatching([['A','B'],['A','B']], ['B', null])` → `['B','A']`.
  - `maxMatching([[], ['A']])` → `[null, 'A']`.
- [ ] **Step 2: Run to fail:** `npx mocha test/unit/lease/memberMatch.spec.ts`.
- [ ] **Step 3: Implement** with augmenting paths (Kuhn's algorithm): first seat each member on its `prefer` key where present in its candidates, then augment members in index order trying keys in candidate order. Pure, no imports.
- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** `feat(leases): match a group's members to phones`

### Task 4: Granting a group

**Files:**
- Create: `src/services/lease/leaseFilters.ts` (moved from `LeaseService.ts`: `clientFilters`, `teamScope`, `nameMatches`, `leasable`, exported)
- Create: `src/services/lease/LeaseGranter.ts`
- Modify: `src/services/lease/buildCapabilityBag.ts` (`memberIndex`)
- Modify: `src/services/lease/LeaseService.ts` (imports the moved helpers)
- Test: `test/unit/lease/LeaseGranter.spec.ts`

**Interfaces:**
- Consumes: `PhoneServerPorts` (#557: `free(lease, deletedHere)`), `PortAllocatorClient.allocate`, `leasedDeviceKeys` (Task 2).
- Produces: `buildCapabilityBag(device, ports, leaseId, buildId?, memberIndex?)`: with `memberIndex` it adds `xe:options.leaseMember: memberIndex`.
- Produces: `class LeaseGranter { constructor(db, store, portClient, authProvider); grant(lease: GroupLeaseRow, phones: IDevice[]): Promise<'granted' | 'failed' | 'gone'>; isSkipped(key: string, now?: number): boolean }`.
  `GroupLeaseRow` (exported from `LeaseGranter.ts`): `{ id, status: 'waiting' | 'trying', durationMs, buildId, heldKeys: Set<string> }`. `phones[i]` fills member `i`. `status: 'trying'` is a `waitMs: 0` request not yet written (Task 6 creates its row only on grant).
- Produces: `SKIP_FAILED_PHONE_MS = 60_000`.

- [ ] **Step 1: Write the failing tests** (stub db, store, port client; two phones on two hosts):
  - `it('reserves each member\'s ports on its own server and activates the lease')`: `allocate` is called once per host with `leaseId`; `lease.updateMany` is called with `where: { id, status: 'waiting' }` and data `status: 'active'`, `expiresAt ≈ now + durationMs`, and member 0's `deviceUdid`/`deviceHost`/`allocatedPorts`/`capabilityBag`; member rows are upserted with each member's ports and a bag whose `xe:options.leaseMember` is its index; returns `'granted'`.
  - `it('rolls back what it took when one member\'s ports fail, keeps the holds, and skips that phone for 60 s')`: second `allocate` rejects → `PhoneServerPorts.free` for member 0's new ports, the lock it took on a new phone released with `releaseLeaseLock`, held phones' locks untouched, `isSkipped(phone2Key)` true and false after 60,001 ms; returns `'failed'`.
  - `it('rolls back everything, holds included, when the lease is no longer waiting')` (Review Focus 2): `lease.updateMany` resolves `{ count: 0 }` → every port freed and every lock released, held ones too; returns `'gone'`.
- [ ] **Step 2: Run to fail:** `npx mocha test/unit/lease/LeaseGranter.spec.ts`.
- [ ] **Step 3: Move the four helpers** to `leaseFilters.ts` unchanged; `LeaseService.ts` imports them. Run `npx mocha test/unit/lease/*.spec.ts` — still PASS.
- [ ] **Step 4: Implement `grant`**: lock each phone not in `heldKeys` with `store.findAndLockDevice({ udid: [udid], filterByHost: host })` as `create` does today, allocate ports per member, activate with the conditional update, write members and backfill `PortLease.leaseId`; on failure roll back only what this call took (on `'gone'`, also the holds). For `status: 'trying'` the conditional update is a `lease.create` of an `active` row instead.
- [ ] **Step 5: Run to pass.**
- [ ] **Step 6: Commit** `feat(leases): grant a group, all members or none`

### Task 5: The queue and its grant passes

**Files:**
- Modify: `src/device-utils.ts` (export `withAllocationLock<T>(fn: () => Promise<T>): Promise<T>` over the existing `ALLOCATION_LOCK`/`ALLOCATION_LOCK_KEY`; `allocateDeviceForSession` uses it)
- Create: `src/services/lease/leaseQueueKick.ts`
- Create: `src/services/lease/LeaseQueue.ts`
- Test: `test/unit/lease/LeaseQueue.spec.ts`

**Interfaces:**
- Consumes: `maxMatching` (Task 3), `LeaseGranter` (Task 4), `leaseFilters.ts` helpers, `activeLeasesByDevice`.
- Produces: `leaseQueueKick.ts` (no imports, so any module can call it without a cycle): `phoneFreed(): void`, `onPhoneFreed(fn: () => void): () => void`.
- Produces: `@Service() class LeaseQueue`:
  - `pass(): Promise<void>` — one grant pass under `withAllocationLock`; never throws (logs a warning and returns).
  - `kick(): void` — runs one pass soon; kicks before it starts collapse into that one pass.
  - `start(intervalMs = 5_000): void` / `stop(): void` — the backstop timer, and the `onPhoneFreed` subscription.
  - `tryNow(request: { members: MemberRequest[]; callerTeamIds?: string[]; durationMs: number; buildId?: string; actorId: string; teamId: string | null; reason?: string; heartbeatSeconds: number }): Promise<{ leaseId: string } | 'busy' | 'unhealthy'>` — a `waitMs: 0` attempt under the lock, by the backfill rule.
  - `positionOf(leaseId: string): Promise<number | null>` — 1 for the head.
  - `onChange(leaseId: string, fn: () => void): () => void` — called after a pass changes that lease's status or holds.
  - `MemberRequest = { filters: LeaseFilters }`, `LeaseFilters` being today's `CreateLeaseRequest['filters']`.

- [ ] **Step 1: Write the failing tests** (scratch database, `usePrismaStores()`, fixture phones A, B, C with `useOwnNodeId()`, a stub port client that answers `allocate` with fixed ports):
  - `it('grants the head when every member can be filled')`.
  - `it('lets the head hold a maximum matching and nothing more')`: head wants `[platform android, udid A]` and `[platform android, udid B]`, B busy → after a pass, A has the head's member row with `heldAt`, A is `busy`, B isn't held.
  - `it('backfills a later request only from phones the head cannot use')`: head as above; a second waiting lease wanting `udid C` is granted; a third wanting `udid A` stays waiting.
  - `it('serves waiters first come, first served')`: two waiters wanting `udid A`; A frees; the older is granted.
  - `it('shows each waiter only phones its teams can see')`: a waiter with `callerTeamIds: []` never holds a phone of team T.
  - `it('logs a pass that throws, and the next pass works')` (Review Focus 5): stub `lease.findMany` to reject once → `pass()` resolves, a warning is logged; the next `pass()` grants.
  - `it('collapses kicks into one pass')`: three `kick()` calls → `pass` runs once (spy).
- [ ] **Step 2: Run to fail:** `npx mocha test/unit/lease/LeaseQueue.spec.ts`.
- [ ] **Step 3: Export `withAllocationLock`** and route `allocateDeviceForSession`'s lock through it. Run `npx mocha test/unit/allocate*.spec.ts test/unit/lease/*.spec.ts` — PASS.
- [ ] **Step 4: Implement `LeaseQueue.pass`** as the spec's *Queue and grants* section: waiters by `createdAt`, then `id`; each member's candidates are the store's `getDevices({ ...clientFilters(f), ...teamScope(callerTeamIds), busy: false })` filtered by `nameMatches`, `leasable`, `!granter.isSkipped(key)` and not in another lease's members, plus the waiter's own held keys; the head gets `maxMatching(candidates, itsCurrentHolds)`; a full match goes to `granter.grant`; else new holds are locked with `findAndLockDevice` and written as member rows (a moved hold updates its row's `index`); every later waiter is granted only on a full match from keys the head neither holds nor matched.
- [ ] **Step 5: Implement `kick`, `start`, `stop`, `tryNow`, `positionOf`, `onChange`.**
- [ ] **Step 6: Run to pass.**
- [ ] **Step 7: Commit** `feat(leases): a first-come-first-served queue with grant passes`

### Task 6: Creating a group lease

**Files:**
- Modify: `src/services/lease/LeaseService.ts` (`create` takes `members` and `waitMs`)
- Create: `src/services/lease/leaseResponse.ts`
- Modify: `src/app/routers/sdk-leases.ts` (`POST /`)
- Modify: `src/app/openapi/grid.yaml` (create operation), then `npm run build:openapi`
- Test: `test/integration/sdk-leases-router.spec.ts`, `test/integration/lease-groups-create.spec.ts`

**Interfaces:**
- Consumes: `LeaseQueue.tryNow`, `pass`, `positionOf` (Task 5); `maxMatching` (Task 3).
- Produces: `CreateLeaseRequest` gains `members?: MemberRequest[]` and `waitMs?: number`; `filters` stays for one member.
- Produces: `LeaseService.create(req)` returns `{ status: 'granted', body: GrantedBody } | { status: 'waiting', body: WaitingBody }`.
- Produces: `leaseResponse.ts`: `grantedBody(lease, members, token): GrantedBody` (`leaseId`, `leaseToken`, `expiresAt`, `heartbeatSeconds`, `members[{ index, device, allocatedPorts, appiumCapabilities }]`, and member 0 as today's top-level `device`, `allocatedPorts`, `appiumCapabilities`, each `appiumCapabilities` through `withLeaseToken`), `waitingBody(lease, token, position): WaitingBody` (`leaseId`, `leaseToken`, `status: 'waiting'`, `position`, `waitUntil`, `heartbeatSeconds`).

- [ ] **Step 1: Write the failing router tests** (stub service):
  - `400` for each of: both `filters` and `members`; `members: []`; 9 members; a member without `filters.platform`; `waitMs: -1`; `waitMs: 3_600_001`.
  - `202` with the waiting body when the service answers `waiting`.
  - `201` with `members[0]` equal to the top-level `device` when the service answers `granted`.
- [ ] **Step 2: Write the failing integration tests** `lease-groups-create.spec.ts` (scratch database, Prisma stores, stub port client):
  - `it('grants a two-member group at once with both members\' capabilities')`: two free phones → `201`, each member's `appiumCapabilities['xe:options']` has `leaseId`, `leaseToken` and its `leaseMember`.
  - `it('answers 404 for a group no phones could ever fill')` (Review Focus 1): two members both `udid: A` → `404 no_matching_device`, nothing written.
  - `it('answers 409 with waitMs 0 when the group can\'t be granted now')`, with `retryAfterMs`.
  - `it('joins the queue with waitMs and answers 202 with its position')`.
  - `it('grants exactly one of two waitMs-0 requests racing for the last phone')` (Review Focus 3): `Promise.all` of two creates for one free phone → one `201`, one `409`.
  - `it('answers a single lease exactly as before')`: `{ filters }` only → today's `201` body, plus `members` of one.
- [ ] **Step 3: Run to fail:** `npx mocha test/integration/sdk-leases-router.spec.ts test/integration/lease-groups-create.spec.ts`.
- [ ] **Step 4: Implement `create`**: normalise `filters` to one member; for each member, the visible phones regardless of busy; `filledCount(maxMatching(...)) < members.length` → `NoMatchingDevice`; `waitMs` 0 → `tryNow` (`'busy'` → `AllMatchingBusy`, `'unhealthy'` → `DeviceUnhealthy`); else insert the `waiting` row (`tokenHash`, `requestedMembers`, `callerTeamIds`, `waitUntil = now + waitMs`, `durationMs`, `lastHeartbeatAt = now`, empty device columns), `await queue.pass()`, then answer granted or waiting.
- [ ] **Step 5: Implement the router** answers and **update `grid.yaml`**'s create operation (both request shapes, `waitMs`, `201`, `202`, `404`, `409`, `503`, `400`); `npm run build:openapi`.
- [ ] **Step 6: Run to pass,** plus `npx mocha test/unit/openapi-coverage.spec.ts`.
- [ ] **Step 7: Commit** `feat(leases): create a lease of several phones, at once or in the queue`

### Task 7: Waiting, heartbeat, extend and release for a group

**Files:**
- Modify: `src/services/lease/LeaseService.ts` (`get`, `heartbeat`, `extend`, `release`)
- Modify: `src/app/routers/sdk-leases.ts` (`GET /:id`; existing routes' new answers)
- Modify: `src/app/openapi/grid.yaml`, then `npm run build:openapi`
- Test: `test/integration/lease-groups-lifecycle.spec.ts`

**Interfaces:**
- Consumes: `LeaseQueue.onChange`, `positionOf`, `kick`; `PhoneServerPorts.hold` / `free`; `grantedBody` / `waitingBody`.
- Produces: `LeaseService.get(leaseId, token, waitMs = 0): Promise<{ status: 'granted', body } | { status: 'waiting', body }>`; throws `LeaseGone` (with `reason` from `endReason`) once released, expired or ended, and `LeaseTokenMismatch` as today.
- Produces: `class LeaseWaiting extends Error {}`, thrown by `extend` on a waiting lease.
- Produces: `GET_WAIT_MAX_MS = 25_000`, `MAX_WAIT_MS = 3_600_000`, `MAX_MEMBERS = 8` (exported from `LeaseService.ts`).
- `PhoneServerPorts.hold` and `free` take one lease-shaped row per call; for a member pass `{ id: lease.id, deviceUdid: member.udid, deviceHost: member.host, allocatedPorts: member.allocatedPorts }`, once per member.

- [ ] **Step 1: Write the failing tests** (scratch database, Prisma stores):
  - `it('GET answers waiting with its position, then the granted body once granted')`.
  - `it('GET with waitMs answers as soon as the lease is granted')`: a waiting lease, GET with `waitMs: 5000`, free its phone 200 ms later → the answer is `granted` before 5 s.
  - `it('GET with waitMs answers waiting at the limit')`: `waitMs: 300` → waiting after ~300 ms.
  - `it('GET counts as a heartbeat')`: `lastHeartbeatAt` moves.
  - `it('heartbeat keeps a waiter in the queue')`.
  - `it('extend on a waiting lease answers 409 lease_waiting')`.
  - `it("extend on a group holds every member's ports")`: `PhoneServerPorts.hold` per member.
  - `it('DELETE gives up a wait and releases its held phones')`: the held phone is free and its member row gone.
  - `it('DELETE releases every member of a group, and a later waiter is then granted')`.
  - `it('answers 410 with the reason for an ended group')`.
- [ ] **Step 2: Run to fail:** `npx mocha test/integration/lease-groups-lifecycle.spec.ts`.
- [ ] **Step 3: Implement** `get` (with `onChange` and a timer of `min(waitMs, GET_WAIT_MAX_MS)`), `heartbeat` for `waiting` too, `extend` (`LeaseWaiting`; `hold` per member), `release` for every member (delete local port rows, `PhoneServerPorts.free` per member, `releaseLeaseLock` per member, delete a waiter's member rows), then `queue.kick()`.
- [ ] **Step 4: Router:** `GET /:id` with `waitMs` 0..25,000 (else `400`); `409 lease_waiting`; `410 { error: 'gone', reason }`. **Update `grid.yaml`** for `GET /api/sdk/leases/{id}` and the changed answers; `npm run build:openapi`.
- [ ] **Step 5: Run to pass,** plus `npx mocha test/unit/openapi-coverage.spec.ts test/unit/lease/*.spec.ts`.
- [ ] **Step 6: Commit** `feat(leases): wait for, keep, extend and release a group lease`

### Task 8: The sweeper ends waiters and groups that lost a member

**Files:**
- Modify: `src/services/lease/LeaseOrphanSweeper.ts`
- Test: `test/unit/lease/LeaseOrphanSweeper.spec.ts`, `test/unit/lease/lease-groups-sweeper.spec.ts`

**Interfaces:**
- Consumes: `leaseReapReason` (exists), `PhoneServerPorts.free`, `phoneFreed()` (Task 5).
- Produces: `memberLossReason(member: { index: number; udid: string; host: string }, device: IDevice | null): string | null` — `member <index> (<udid>) disconnected` when the row is gone, `... is unhealthy` when `healthStatus === 'Unhealthy'`, `... was blocked by an admin` when `userBlocked`, else null.

- [ ] **Step 1: Write the failing tests:**
  - `it('expires a waiter past its waitUntil and releases its held phones')`.
  - `it('expires a waiter that missed three heartbeats')`.
  - `it('ends a group whose member\'s phone is gone, with that reason, and releases the rest')`: `status: 'ended'`, `endReason` `member 1 (u2) disconnected`, member 0's lock released and its ports freed.
  - `it('ends a group whose member is unhealthy or blocked')` (one case each).
  - `it('drops a lost held phone and keeps the waiter waiting')`.
  - `it('kicks the queue after it frees phones')`: `phoneFreed` called once per sweep that freed something.
- [ ] **Step 2: Run to fail:** `npx mocha test/unit/lease/lease-groups-sweeper.spec.ts`.
- [ ] **Step 3: Implement:** the sweep selects `waiting` and `active` leases with their members; for `waiting`, `waitUntil < now` or missed heartbeats → `expired`, holds released; for `active`, `leaseReapReason`, then each member's `memberLossReason` against `store.findDevice({ udid, host })` → `ended` with `endReason`; release every member as Task 7's release does; a waiter's lost held phone → delete that member row.
- [ ] **Step 4: Run to pass,** with the existing sweeper specs.
- [ ] **Step 5: Commit** `feat(leases): the sweeper ends waiters and groups that lost a phone`

### Task 9: Sessions on a member, and the session's lease

**Files:**
- Modify: `src/services/lease/leaseSessionCaps.ts` (`leaseMemberOf`)
- Modify: `src/services/lease/LeaseService.ts` (`authorizeSessionUse`)
- Modify: `src/device-utils.ts` (`findLeasedDevice` passes the member; refusal message)
- Modify: `src/dashboard/event-manager.ts` (`onSessionStarted`'s `session.create`), `src/services/SessionLifecycleService.ts` (`recordRoutedSession`)
- Test: `test/unit/lease/allocate-lease-branch.spec.ts`, `test/unit/lease/session-lease-member.spec.ts`

**Interfaces:**
- Produces: `leaseMemberOf(caps: ISessionCapability): number | undefined` (`xe:options.leaseMember`, a non-negative integer, else undefined).
- Produces: `authorizeSessionUse(leaseId, proof, memberIndex?: number): Promise<ResolvedLease | null>`; throws `new LeaseMemberRequired()` (message exactly `name the lease member: xe:options.leaseMember`) when the lease has more than one member and `memberIndex` is undefined; resolves that member's `udid`, `host` and `capabilityBag`.
- Produces: the Session row's `lease_id` = `leaseIdOf(caps)` in both writers.

- [ ] **Step 1: Write the failing tests:**
  - `it('allocates the named member\'s phone')`.
  - `it('refuses a group session that names no member, with that message')`: the create fails with `name the lease member: xe:options.leaseMember`.
  - `it('needs no member for a single lease')`.
  - `it('records the lease on the session row')`: both `onSessionStarted` and `recordRoutedSession` write `lease_id`.
  - `it('keeps leaseMember in the stored capabilities')`.
- [ ] **Step 2: Run to fail:** `npx mocha test/unit/lease/session-lease-member.spec.ts test/unit/lease/allocate-lease-branch.spec.ts`.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run to pass,** then `npm run test:all`.
- [ ] **Step 5: Commit** `feat(leases): a session runs on its member's phone and records its lease`

### Task 10: Grant passes when phones free, the timer, and the version flags

**Files:**
- Modify: `src/data-service/device-service.ts` (`releaseClaimOn` at :454, `forceRelease` at :392), `src/data-service/prisma-store.ts` (`addNodeReport` when the report clears `busy`; `addDevices`), `src/data-service/device-store.ts` (the same two), `src/services/lease/LeaseService.ts` and `LeaseOrphanSweeper.ts` (after a release or end)
- Modify: `src/services/ServerManager.ts` (`Container.get(LeaseQueue).start(5_000)` after the sweeper interval)
- Modify: `src/app/routers/sdk-version.ts` (`SUPPORTS`)
- Test: `test/unit/lease/lease-queue-kicks.spec.ts`, `test/unit/sdk-version.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `phoneFreed()` (Task 5).

- [ ] **Step 1: Write the failing tests:**
  - `it('a session release that frees a phone kicks the queue')`, and the same for `forceRelease`, a node report that clears `busy`, and a phone added.
  - `it('GET /sdk/version lists lease-groups and lease-queue')`.
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement:** call `phoneFreed()` where each of those writes frees or adds a phone; `SUPPORTS = ['leases', 'ports', 'heartbeat', 'lease-groups', 'lease-queue']`; start the queue at boot.
- [ ] **Step 4: Run to pass,** then `npm run test:all`.
- [ ] **Step 5: Commit** `feat(leases): run the queue when a phone frees up`

### Task 11: The dashboard shows held and leased phones

**Files:**
- Modify: `src/app/routers/grid.ts` (`getDevices` adds `leaseState`)
- Modify: `web/src/components/device-card/device-card/deviceState.ts` (`DeviceStateInput.leaseState`, `activityLabel`)
- Test: `web/src/components/device-card/device-card/deviceState.test.ts`, `test/integration/grid-devices-lease-state.spec.ts`

**Interfaces:**
- Consumes: `activeLeasesByDevice` (Task 2).
- Produces: each device in `GET /devices` / `GET /device` carries `leaseState: 'held' | 'leased' | null` (`held` for a `waiting` lease's member).

- [ ] **Step 1: Write the failing tests:**
  - web: `activityLabel({ ...busyDevice, leaseState: 'held' }, viewer, now)` is `Held for a waiting lease`; `leaseState: 'leased'` with no session is `Leased`; a session on a leased phone still reads `Test session …`.
  - server: a held phone's row in `GET /devices` has `leaseState: 'held'`; a free one `null`.
- [ ] **Step 2: Run to fail:** `cd web && npx vitest run src/components/device-card/device-card/deviceState.test.ts`, and `npx mocha test/integration/grid-devices-lease-state.spec.ts`.
- [ ] **Step 3: Implement**, with one `activeLeasesByDevice` call per listing (not per phone). Update `grid.yaml`'s device schema with `leaseState`; `npm run build:openapi`.
- [ ] **Step 4: Run to pass,** plus `cd web && npx vitest run src/design` (the wording and literal ratchets).
- [ ] **Step 5: Commit** `feat(web): show phones held for a waiting lease`

### Task 12: End-to-end scenarios and the docs

**Files:**
- Create: `test/integration/lease-groups-scenarios.spec.ts`
- Modify: `website/docs/leases.md` (new section "Several phones at once"), `CLAUDE.md` (the "Device leases" paragraphs)

- [ ] **Step 1: Write the scenario tests** (scratch database, both stores via `usePrismaStores()` then `useLokiStores()`, stub port client):
  - `it('two 2-phone groups and two free phones: one is granted, the other when it is released')` — the review's deadlock.
  - `it('a 4-phone group at the head is granted although single leases keep arriving')`: four phones in use, freed one at a time while single `waitMs: 0` leases keep arriving → the group gets all four; every single lease got `409`.
  - `it('a plain session skips a held phone')`: `allocateDeviceForSession` picks the other phone.
  - `it('a restart keeps the queue and its holds')`: new `LeaseQueue` and `LeaseService` instances over the same database; the waiter keeps its position and held phone, and is granted when the rest frees.
- [ ] **Step 2: Run to pass:** `npx mocha test/integration/lease-groups-scenarios.spec.ts` (they exercise Tasks 1–11; any failure is a bug in those tasks, fixed there).
- [ ] **Step 3: Write the docs:** `leases.md` gets a "Several phones at once" section (the `members` body, `waitMs`, `202` and `GET` waiting, `leaseMember` in sessions, a lost member ending the group, held phones on the dashboard, first come first served among leases, plain sessions outside it); `CLAUDE.md` gets the group lease paragraphs (member rows as the one source, the queue and its head rule, the grant's rollback, the sweeper's member loss, the restart rule).
- [ ] **Step 4: Full check:** `npm run test:all`, `cd web && npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, `cd website && npm run build`, and lint per changed file against `main`.
- [ ] **Step 5: Live check** on a hub and a node (auth-enabled scratch servers, per the memory notes): one group of an Android phone and an iPhone, two sessions with `leaseMember`, release; then unplug one member and see the next heartbeat answer `410` with its reason.
- [ ] **Step 6: Commit** `test(leases): group lease scenarios, and the docs`
