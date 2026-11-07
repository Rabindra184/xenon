# Group leases: several phones as one lease, granted in turn

Status: design, approved in conversation on 2026-11-07. No code yet.

## Why

A test that needs several phones at once (a call between two phones, a
conference of three or four) can't reserve them as one unit. `POST
/xenon/api/sdk/leases` locks one phone, or answers `409 all_matching_busy`
with `retryAfterMs: 2000`; the server keeps no queue.

The Kotlin SDK's `XenonParallel.acquireInitial` asks for each phone of a run in
parallel, each request waiting up to its own timeout, and keeps the phones it
is granted while it waits for the rest. Two runs that each need two phones,
with two free, can each end up holding one and wait each other out until
their timeouts. A large group also has no turn: single-phone leases take each
phone the moment it frees.

## What success means

- A request gets all of its phones or none, and never holds part of a set in
  a way that can block another request that holds the rest.
- Among leases, requests are served first come, first served: a group of four
  isn't starved by a stream of single leases.
- A group behaves as one lease: one token, one heartbeat, one end.
- A group's sessions can be found together (for grouped results, a later
  piece of work).
- Every client that works today keeps working unchanged.

## Decisions

- **Members have their own filters.** A group is a list of members, each with
  the filters a lease takes today (e.g. one Android 14 phone and one iPhone,
  or two Android phones tagged `sim`). This matches the SDK's existing list
  of `DeviceRequirement`s.
- **The server queues.** A request that can't be granted at once may wait on
  the server, in one first-come-first-served queue shared by every lease.
- **A lost member ends the group.** If one of a running group's phones is
  lost, the whole lease ends and the client learns at its next heartbeat.
- **Groups are leases** (approach A of three; see *Approaches considered*).
  The existing lease API takes members; a single lease is a group of one.

## Data model

The `Lease` row becomes the group. A new `LeaseMember` row holds each phone.

**`Lease`** keeps what the group shares: `tokenHash`, `actorId`, `teamId`,
`buildId`, `reason`, `heartbeatSeconds`, `lastHeartbeatAt`, `expiresAt`,
`createdAt` (the queue order) and `status`.

- `status` gains `waiting`, and `ended` for a group that lost a member:
  `waiting → active → released | expired | ended`. A waiter that gives up, by
  its `waitUntil` or by missed heartbeats, becomes `expired`.
- New nullable columns:
  - `requestedMembers`: JSON, each member's filters, in order;
  - `waitUntil`: when a waiting request gives up (epoch ms);
  - `durationMs`: the duration a waiting request asked for, which its grant
    starts from;
  - `callerTeamIds`: JSON, the caller's teams when the request was made (the
    device boundary every pass applies; null means unscoped, as
    `callerTeamIds: undefined` does today);
  - `endReason`: why an `ended` group ended, e.g. "member 2 (emulator-5556)
    disconnected".
- The existing `deviceUdid`, `deviceHost`, `allocatedPorts` and
  `capabilityBag` columns stay and are filled from member 0 (empty strings
  while waiting). Nothing is dropped, so the startup schema sync is a
  `db push` with no data loss, and code that knows one phone keeps working.

**`LeaseMember`** (new table): `leaseId`, `index`, `udid`, `host`,
`allocatedPorts`, `capabilityBag`, `heldAt`. Indexes on `(udid, host)` and
`leaseId`, unique on `(leaseId, index)`.

- A member row of a `waiting` lease is a phone held for it; of an `active`
  one, a leased phone. Either way that phone belongs to the lease.
- The readers that ask whether a phone is leased (`activeLeases.ts`, used by
  allocation's `findAndLockDevice`, the ownership guard's
  `SessionOwnerResolver.leaseHolderOf`, recordings' `BusyPrecheck` and the
  idle sweeper's `releaseBlockedDevices`) read member rows of a `waiting` or
  `active` lease instead of the `Lease` row's device columns. That one change
  makes plain sessions, previews and recordings skip held phones too.
- A held phone is the waiting lease's for access as well: the ownership
  guard lets that lease's holder use it, as for a leased phone, and refuses
  everyone else (`device_held_by_another_user`, saying it is held for a
  waiting lease).

**Leases that exist at upgrade** have no member rows. At boot, before the
first grant pass, each `active` lease without one gets member 0 written from
its own device columns. From then on every reader relies on member rows.

## API

All under `/xenon/api/sdk/leases`, with today's guards.

### `POST /sdk/leases`

The body takes today's `{ filters }`, or `{ members: [{ filters }, …] }` with
1 to 8 members, plus today's `durationMs`, `heartbeatSeconds`, `reason` and
`buildId`, and a new `waitMs`.

- `waitMs`: 0 by default, meaning try once, exactly as today. Up to
  3,600,000 (60 minutes) means join the queue and wait up to that long.
- **`201` granted:** `{ leaseId, leaseToken, expiresAt, heartbeatSeconds,
  members: [{ index, device, allocatedPorts, appiumCapabilities }] }`, plus
  today's top-level `device`, `allocatedPorts` and `appiumCapabilities`,
  filled from member 0, so existing clients read a single lease unchanged.
- **`202` waiting** (only with `waitMs > 0`): `{ leaseId, leaseToken, status:
  "waiting", position, waitUntil, heartbeatSeconds }`. The token comes now,
  so the client can heartbeat to keep its place and `DELETE` to give up.
- **`404 no_matching_device`:** at request time, some member matches no phone
  the caller can see, busy or not (the same fixed sentence as today, so a
  hidden phone and an unknown one answer alike). A phone unplugged later
  doesn't cancel a waiter; it waits until `waitUntil`.
- **`409 all_matching_busy`:** `waitMs` is 0 and the whole group can't be
  granted now, with `retryAfterMs`, as today.
- **`503 device_unhealthy`:** `waitMs` is 0 and a member's ports couldn't be
  reserved, as today.
- **`400 bad_request`:** both `filters` and `members`, no members, more than
  8, a member without `filters.platform`, or `waitMs` out of range.

One phone fills one member. Choosing phones for members is a bipartite
matching of members to the phones each member's filters accept; at 8 members
or fewer a backtracking search is enough.

### `GET /sdk/leases/:id`

With the lease token (`x-xenon-lease-token`). Answers `{ status, position }`
while waiting, the `201` body once active, and `410 { error: 'gone', reason }`
once ended (with `endReason` when it lost a member).

- `?waitMs=` (up to 25,000) answers as soon as the status changes, or at the
  limit with the current state. That is how a client waits without one long
  request a proxy might cut.
- It counts as a heartbeat.
- An unknown id or wrong token answers `403 token_mismatch`, as heartbeat
  does today.

### The rest

- **`POST /:id/heartbeat`:** also while waiting. A waiter that misses three
  heartbeats leaves the queue (`expired`) and its held phones are released.
- **`POST /:id/extend`:** active only; a waiting lease answers `409
  lease_waiting`. Extends every member's ports (`PhoneServerPorts.hold`).
- **`DELETE /:id`:** gives up a wait, releasing held phones, or releases an
  active group, every member.
- **`GET /sdk/version`:** `supports` adds `lease-groups` and `lease-queue`.

### Sessions on a member

Each member's `appiumCapabilities` carry `xe:options.{ leaseId, leaseToken,
leaseMember }`, `leaseMember` being its index. Allocation
(`allocateDeviceForSession`) resolves the lease as today
(`authorizeSessionUse`) and allocates that member's phone. A group of more
than one member refuses a session that names no member, with one message
("name the lease member: xe:options.leaseMember"). A single lease needs none.
`leaseMember` is not a secret and stays in the stored capabilities.

The session's row records the lease it ran on (`Session.lease_id`, new
nullable column), so a group's sessions can be found together.

## Queue and grants

- **One lock.** Every grant decision runs under `ALLOCATION_LOCK`, the
  in-process lock plain session creates already take for `maxSessions`, so a
  grant and a plain session never pick the same free phone.
- **The queue** is the `waiting` lease rows in `createdAt` order, ties by id.
  It is one server's queue: two hubs sharing one database are not supported
  for leases, and the docs say so.
- **A grant pass runs:**
  - when a lease request arrives;
  - whenever a phone frees up: a lease released, expired or ended, a session
    released, a preview or recording hold dropped, a node reporting a phone
    free, a phone added or healthy again;
  - every 5 s as a backstop, which returns at once when nobody waits.
- **A pass:**
  1. Reads the free, leasable phones: not busy, blocked, reserved, unhealthy,
     leased or held (today's `leasable`, plus member rows). Each request sees
     only phones its stored `callerTeamIds` allow.
  2. **The head** (the oldest waiter) tries a full match from the phones it
     holds plus the free ones. A full match is granted.
  3. Otherwise the head **holds** the free phones of a maximum matching of its
     unfilled members (member rows with `heldAt`), and nothing else. A later
     pass may move a held phone to another member when that grows the
     matching; a member's index and phone are final only at the grant.
  4. **Backfill:** each later request in order, single `waitMs: 0` leases
     included, is granted only if it can be filled completely from the free
     phones the head didn't hold. It never holds anything.

  Because the head's held set is a maximum matching, no leftover free phone
  could have grown it, so backfill never delays the head.
- **No deadlock, no starvation among leases.** Only the head holds, so no two
  waiters each hold half of what the other needs. The head waits only on
  phones in use, which come free: leases end within 24 h, sessions and holds
  end. Among leases the order is first come, first served.
- **The cost of fairness.** While the head waits, its held phones sit idle,
  bounded by `waitMs` (60 minutes at most) and released when the head gives
  up or misses three heartbeats. The dashboard labels them "Held for a
  waiting lease".
- **Plain sessions** (no lease) keep their own per-platform queue
  (`commandsQueueGuard`) and are outside this guarantee. They skip held
  phones, as they skip leased ones.
- **A grant's ports** are reserved per member on each phone's own server
  (`PortAllocatorClient.allocate`). If any member's reservation fails, every
  member's ports and locks are rolled back (`PhoneServerPorts.free` per
  member), and the request goes back to waiting, or with `waitMs: 0`
  answers `503 device_unhealthy`. A phone whose reservation failed is skipped
  by passes for 60 s, so a broken node can't make them loop.

## Lifecycle

- **Active:** one heartbeat and one `expiresAt` for the whole group. Extend
  never shortens it (#546) and holds every member's ports to the new end.
- **Release and expiry** (`DELETE`, or `LeaseOrphanSweeper`: three missed
  heartbeats or past `expiresAt`): for each member, delete this server's port
  rows, free the ports on the phone's server (`PhoneServerPorts.free`, #557)
  and drop the lease lock (`releaseLeaseLock`). Then a grant pass runs.
- **A lost member ends the group.** Every 30 s the sweeper checks each active
  group's members. A phone that is gone (its row deleted: unplugged, its node
  gone), unhealthy, or blocked by an admin ends the lease: status `ended`,
  `endReason` naming the member, every member released as for an expiry. The
  next heartbeat or `GET` answers `410` with the reason, so the SDK fails the
  test at once. Sessions running on the other members aren't ended: as today,
  a session that outlives its lease keeps its phone until it ends.
- **A waiting lease that loses a held phone** drops that member row and keeps
  waiting.
- **Busy where held or leased.** Each held or leased phone gets the lock a
  lease takes today (`findAndLockDevice`, `busy`), so the device list, the
  picker and plain sessions treat it as taken. Release goes through today's
  conditional `releaseLeaseLock`, which never frees a phone a session or a
  hold still has.
- **A hub restart** keeps `waiting` and `active` rows and their members, so
  the queue order and every grant survive. The hub's own device rows are
  cleared at boot and rediscovered; held and leased phones are known from the
  member rows and respected again once rediscovered. As for single leases
  today, an outage longer than three heartbeat intervals means the sweeper
  ends those leases at boot.
- **A node's phone** can be a member like any other: its ports are reserved
  and freed on the node, and sessions on it go through the hub.

## Compatibility and rollout

- A request with `filters` and no `waitMs` behaves exactly as today, so
  every existing client, and the Kotlin SDK's own retries, keep working.
- Plain sessions change in one way: they skip phones held for a waiting
  lease.
- The schema change is additive (a table, nullable columns, new status
  values). Before release, start a real server on a copy of a real database
  (SQLite and Postgres) and check the sync.
- A node older than 2.20 can't free ports through `/ports/release`; its ports
  stay reserved until their own end. Nothing breaks.
- **Follow-ups elsewhere:**
  - the Kotlin SDK: `xenon.leaseGroup(members, wait)`, and
    `XenonParallel.acquireInitial` switched to one group lease per run, which
    is what removes the hold-and-wait deadlock from users' runs;
  - the TypeScript SDK, generated from the API reference;
  - grouped results, read through `Session.lease_id`.

## Testing

- **Unit:**
  - the matcher: mixed filters, one phone per member, no match, 8 members;
  - the grant pass: a full match is granted; otherwise the head holds a
    maximum matching; backfill never takes a phone that could grow the
    head's matching; first come, first served; team scope per request;
  - lifecycle: a lost member ends the group with its reason; a lost held
    phone doesn't end a waiter; missed heartbeats end a waiter and release
    its holds; a failed port reservation rolls back every member and skips
    that phone for 60 s;
  - the boot backfill of member 0 for leases that exist at upgrade;
  - a group session without `leaseMember` is refused with its message.
- **Integration** (scratch database, Prisma and Loki stores, hermetic as
  `test:all` requires):
  - the review's deadlock: two 2-phone groups, two free phones, both
    waiting; one is granted, the other waits and is granted when the first is
    released;
  - a 4-phone group at the head is granted although single leases keep
    arriving;
  - a plain session skips a held phone;
  - a hub restart keeps the queue and its holds;
  - the API reference covers every new route and answer.
- **Live:** a hub and a node, one group of an Android phone and an iPhone,
  two sessions, release; then a lost member (unplug) ending the group.

## Out of scope

- The grouped-results view (it reads `Session.lease_id`).
- Priorities, or any order but first come, first served.
- A queue shared by several hubs on one database.
- Ending other members' sessions when a member is lost.
- A dashboard page listing the queue.

## Approaches considered

- **A. Groups are leases (chosen):** one API, one queue for every lease, a
  single lease is a group of one.
- **B. A separate `/sdk/lease-groups` resource:** simpler to read, but single
  leases would keep answering `409` without queueing and still beat a waiting
  group to every freed phone, so starvation would remain.
- **C. Client-side only:** the SDK releases a partial set and retries with
  random back-off. It removes the deadlock but not the starvation, and every
  client would have to reimplement it.
