# Server-Side Lease API (Phase 2)

**Status:** Draft — pending approval
**Author:** Rabindra Biswal
**Date:** 2026-05-14
**Scope:** Xenon Appium plugin (Node.js) only. Kotlin SDK adoption is a separate spec/plan cycle in the SDK repo.
**Target version:** plugin `1.7.0` for the new endpoints; legacy `/reservation` removal targeted for plugin `2.0.0`.

---

## 1. Context

The Kotlin SDK 2.0 cycle (shipped May 2026) introduced a client-side
`XenonLease` primitive plus race-aware allocation via snapshot-walking 409s.
The SDK design spec explicitly deferred four mechanisms to a server-side
Phase 2:

1. **Atomic claim** — eliminate the SDK-side list-then-reserve race.
2. **Server-allocated ports on the device's host** — close the
   `PortAllocator` TOCTOU window for hub-node deployments where the test
   runner and the Appium server live on different machines.
3. **Server-issued reservation token** — possession-based auth so a worker
   that knows another worker's `udid+host` can't release its device.
4. **Heartbeat-based TTL** — sub-2-minute recovery when a worker crashes,
   instead of the existing 30-minute wall-clock leak.

This spec specifies the Node-side endpoints, data model, port-allocation
RPC, lifecycle, and backward-compat story to deliver all four.

---

## 2. Goals

- **G1.** New atomic endpoint `POST /xenon/api/sdk/leases` that returns a
  ready-to-use Appium capability bag (with ports pre-allocated on the
  device's host) and a possession token in a single round-trip.
- **G2.** Heartbeat-based lease lifecycle: missed heartbeats reap leases
  within `3 × heartbeatSeconds`.
- **G3.** Server-allocated ports via a hub-to-node RPC that uses
  `get-port` on the device's actual host. Backed by a `PortLease` table
  for visibility + cleanup.
- **G4.** Legacy `POST /reservation` endpoints continue to work, with
  `Deprecation` / `Sunset` response headers signaling removal in plugin
  `2.0.0`.
- **G5.** Version probe `GET /xenon/api/sdk/version` so the Kotlin SDK
  can feature-detect and dispatch correctly on heterogeneous hub
  versions.

## 3. Non-goals

- Kotlin SDK changes. Adoption of the new endpoints in the SDK is a
  separate spec/plan cycle.
- Lease transfer between actors. No use case yet.
- Lease priority / SLA tiers.
- Cross-hub federated leases.
- Auto-release tied to Appium session-end. The lease ↔ session binding
  stays loose; the SDK is responsible for `lease.close()`. The Appium
  session is a separate entity tracked by the existing `Session` model.
- Per-lease metrics in the dashboard. Covered by existing device-usage
  metrics.
- Soft-delete / lease history beyond what the existing `Session` history
  provides. Released and expired leases get hard-deleted by the orphan
  sweeper after a short grace period.

---

## 4. Design

### 4.1 Data model

Two Prisma models. The existing `PortLease` model (currently orphan in
the schema with no service code behind it) is repurposed.

```prisma
model Lease {
  id                String   @id @default(cuid())            // "lse_..."
  tokenHash         String                                    // SHA-256(token), 64-char hex
  deviceUdid        String
  deviceHost        String
  actorId           String                                    // req.apiKey.id
  teamId            String?                                   // for visibility filtering
  buildId           String?
  reason            String?
  status            String   @default("active")               // "active" | "released" | "expired"
  createdAt         DateTime @default(now())
  expiresAt         Float                                     // ms timestamp
  heartbeatSeconds  Int      @default(30)
  lastHeartbeatAt   Float                                     // ms timestamp
  allocatedPorts    String                                    // JSON-encoded { systemPort?, wdaLocalPort?, chromedriverPort?, mjpegServerPort? }
  capabilityBag     String                                    // JSON-encoded W3C-ready Appium caps

  @@index([status, expiresAt])
  @@index([status, lastHeartbeatAt, heartbeatSeconds])
  @@index([actorId])
  @@index([deviceUdid, deviceHost])
}

model PortLease {        // existing; gains leasedToHost + leaseId
  port          Int      @id
  purpose       String                                        // "systemPort" | "wdaLocalPort" | "chromedriverPort" | "mjpegServerPort"
  leasedToUdid  String
  leasedToHost  String                                        // NEW: host where this port is reserved
  leaseId       String?                                       // NEW: FK to Lease.id; null for legacy ad-hoc allocations
  leasedToPid   Int?
  leasedAt      Float
  expiresAt     Float

  @@index([purpose, expiresAt])
  @@index([leasedToUdid])
  @@index([leaseId])
  @@index([expiresAt])
}
```

`Device.reservedBy` / `Device.reservedUntil` stay unchanged — the legacy
`/reservation` endpoint keeps writing them. The new `findAndLockDevice`
query considers both paths when computing "is this device free?" (see
§4.6).

### 4.2 REST surface — `/xenon/api/sdk/leases`

All endpoints gated by the existing `roleGuard('MEMBER')` plus
`mutationScopeGuard(['devices'])` (mutations only; GETs pass through
auth without scope enforcement). Team-visibility filtering matches the
existing `/devices` endpoint.

```
POST /xenon/api/sdk/leases
Body: {
  filters: {
    platform: "android" | "ios",     // required
    sdk?: string,
    deviceName?: string,
    udid?: string,
    deviceType?: "real" | "simulator" | "both",
    tags?: string[]                  // AND-match
  },
  durationMs?: number,               // default 1_800_000 (30m); clamped [60_000, 86_400_000]
  heartbeatSeconds?: number,         // default 30; clamped [10, 300]
  reason?: string,
  buildId?: string
}
201 {
  leaseId: "lse_01HX...",
  leaseToken: "tok_...",             // cleartext — returned only once
  device: {
    udid, host, platform, sdk, name,
    screen: { width, height },
    realDevice
  },
  expiresAt: number,                 // ms timestamp
  heartbeatSeconds: number,
  allocatedPorts: {
    systemPort?, chromedriverPort?, mjpegServerPort?, wdaLocalPort?
  },
  appiumCapabilities: {              // W3C-ready, hand directly to AppiumDriver
    platformName, "appium:automationName", "appium:udid",
    "appium:deviceName", "appium:platformVersion",
    "appium:systemPort"?, "appium:chromedriverPort"?,
    "appium:wdaLocalPort"?, "appium:mjpegServerPort"?,
    "appium:newCommandTimeout",
    "xenon:options": { leaseId, buildId }
  },
  control: {
    streamUrl, controlBaseUrl, dashboardUrl
  }
}
404 { error: "no_matching_device", filter: {...} }
409 { error: "all_matching_busy", retryAfterMs: number }
503 { error: "device_unhealthy", details: {...} }

GET /xenon/api/sdk/leases/:leaseId
200 { ...lease minus leaseToken... }
404 if missing or not visible to caller's team

POST /xenon/api/sdk/leases/:leaseId/heartbeat
Header: x-xenon-lease-token: <cleartext>
200 { heartbeatedAt, expiresAt }
403 token mismatch
410 Gone — lease expired or released

POST /xenon/api/sdk/leases/:leaseId/extend
Header: x-xenon-lease-token: <cleartext>
Body: { durationMs: number }
200 { expiresAt }
403 token mismatch
410 Gone

DELETE /xenon/api/sdk/leases/:leaseId
Header: x-xenon-lease-token: <cleartext>
204
403 token mismatch
404 if already released/expired (idempotent — release is best-effort)

GET /xenon/api/sdk/leases?actor=&buildId=&status=
200 [ ...lease summaries... ]      // team-visibility filtered

GET /xenon/api/sdk/version
200 { pluginVersion, supports: ["leases", "ports", "heartbeat"] }
```

### 4.3 Port-allocation RPC — `/xenon/api/ports/allocate`

New endpoint on every plugin instance (both hub and nodes). Carries the
node-pair auth token already used for node registration. Internal —
external clients should not call it.

```
POST /xenon/api/ports/allocate
Headers: x-xenon-node-pair-token: <hub-issued at node registration>
Body: {
  udid: string,
  host: string,                      // logical sanity check; the receiving node binds locally
  purposes: ("systemPort" | "wdaLocalPort" | "chromedriverPort" | "mjpegServerPort")[]
}
200 {
  ports: { [purpose]: number }       // only the keys requested
}
```

The receiving instance calls `getPort()` once per purpose, inserts a
`PortLease` row per port with `leaseId=null` initially (set by the hub
after the parent `Lease` is created), `leasedToUdid`, `leasedToHost =
this_instance_host`, `expiresAt = now + durationMs + grace`. Returns
the port map.

If the hub's `LeaseService.create` then fails to insert the parent
`Lease` (rare — database errors only), it deletes the orphan
`PortLease` rows it just created. If the hub crashes between RPC and
DB-insert, the `PortLease` rows expire naturally via their own TTL
(grace period: durationMs + 5 min).

### 4.4 Hub-side lease creation flow

`LeaseService.create(req, res)`:

```
within an explicit transaction (or single-call atomic ops where Prisma allows):
  1. device = await DeviceStore.findAndLockDevice(filters)  // existing atomic lock
  2. if !device → throw 404 { no_matching_device }  or 409 { all_matching_busy }
                  depending on whether snapshot was empty or contended
  3. token = crypto.randomBytes(32).toString('hex')
  4. tokenHash = createHash('sha256').update(token).digest('hex')
  5. ports = await PortAllocatorClient.allocate(
       node = device.host,
       udid = device.udid,
       purposes = portPurposesForPlatform(device.platform)
     )
     // platform-specific:
     // android → [systemPort, chromedriverPort, mjpegServerPort]
     // ios     → [wdaLocalPort, mjpegServerPort]
  6. on RPC failure:
       await DeviceStore.unlockDevice(device.udid, device.host)  // rollback
       throw 503 { device_unhealthy, details }
  7. capabilityBag = buildAppiumCapabilityBag(device, ports, leaseIdPlaceholder)
  8. lease = await prisma.lease.create({
       data: {
         id, tokenHash, deviceUdid, deviceHost, actorId, teamId, buildId, reason,
         expiresAt, heartbeatSeconds, lastHeartbeatAt: now,
         allocatedPorts: JSON.stringify(ports),
         capabilityBag: JSON.stringify(capabilityBag),
       }
     })
  9. await prisma.portLease.updateMany({
       where: { port: { in: Object.values(ports) } },
       data: { leaseId: lease.id }
     })
  10. return { leaseId, leaseToken: token, ...lease, allocatedPorts: ports, appiumCapabilities: capabilityBag }
```

Step 1 already handles concurrent contention via the existing
`findAndLockDevice` semantics. Steps 5–6 handle the rare RPC failure.
Steps 8–9 are the only DB writes after device locking; if step 8 fails
(constraint violation, transient error), steps 1 (unlock) and 5 (orphan
PortLease rows expire on their own TTL) cover the rollback.

### 4.5 Lifecycle — tokens, heartbeats, sweeper

- **Token issuance**: 32 random bytes hex-encoded. SHA-256 hash stored.
  Cleartext returned in the 201 response and never persisted.
- **Token validation**: middleware
  `verifyLeaseToken(req, res, next)` reads `x-xenon-lease-token`,
  looks up the lease by `:leaseId` path param, constant-time-compares
  `sha256(headerToken) === lease.tokenHash`. 403 on mismatch.
- **Heartbeat**: bumps `lastHeartbeatAt = now`. Does **not** extend
  `expiresAt`. A worker that only heartbeats but doesn't extend will
  hit `expiresAt` and 410 Gone.
- **Extend**: bumps `expiresAt = min(now + durationMs, createdAt +
  MAX_LEASE_MS)` where `MAX_LEASE_MS = 24 * 60 * 60 * 1000`. Also bumps
  `lastHeartbeatAt = now` (implicit liveness signal).
- **Release** (`DELETE`): sets `status='released'`, cascades:
  `prisma.portLease.deleteMany({ where: { leaseId } })`,
  `DeviceStore.unlockDevice(deviceUdid, deviceHost)`. Idempotent —
  second DELETE returns 404, doesn't error.
- **Orphan sweep** — new `LeaseOrphanSweeper` service. Schedule pattern
  matches the existing `OrphanSweeper` (per-30s tick). On each tick:
  ```typescript
  const stale = await prisma.lease.findMany({
    where: {
      status: 'active',
      // last heartbeat older than 3× heartbeatSeconds
      lastHeartbeatAt: { lt: Date.now() - /* 3 * heartbeatSeconds */ }
    }
  })
  for (const lease of stale) {
    await prisma.lease.update({ where: { id: lease.id }, data: { status: 'expired' } })
    await prisma.portLease.deleteMany({ where: { leaseId: lease.id } })
    await DeviceStore.unlockDevice(lease.deviceUdid, lease.deviceHost)
    log.info(`lease ${lease.id} expired: missed heartbeats; device unblocked`)
  }
  ```
  Use a parameterized Prisma query for the per-row TTL comparison since
  `heartbeatSeconds` varies per lease.

  The existing wall-clock `ReservationOrphanSweeper` keeps running for
  legacy `/reservation`-style locks on `Device.reservedUntil`.

### 4.6 Backward compatibility

Legacy `POST /reservation`, `DELETE /reservation/:udid/:host`,
`POST /reservation/:udid/:host/extend`, and `GET /reservation`
endpoints remain functional unchanged through the plugin `1.x` line.

Two changes affect the legacy endpoints:

1. **Response headers** on every legacy `/reservation` response
   (success or error):
   ```
   Deprecation: true
   Sunset: 2027-01-01T00:00:00Z         // adjust target after plugin 2.0 release date is set
   Link: <https://github.com/qasecret/xenon/blob/main/docs/superpowers/specs/2026-05-14-server-side-lease-api-design.md>; rel="alternate"
   ```
   Per RFC 8594. Clients that respect these headers surface migration
   warnings to operators.

2. **`findAndLockDevice` read-merge**. The filter currently checks
   `busy=false` and reservation timestamps on the Device row. It must
   also check whether any active `Lease` row exists for the device.
   The filter becomes (in SQL-ish terms):
   ```
   Device.busy = false
   AND (Device.reservedUntil IS NULL OR Device.reservedUntil < now)
   AND NOT EXISTS (
     SELECT 1 FROM Lease
     WHERE Lease.deviceUdid = Device.udid
       AND Lease.deviceHost = Device.host
       AND Lease.status = 'active'
   )
   ```
   Both code paths (legacy reservation, new lease) now contribute to
   "device is busy." No new code reads `Device.reservedBy` /
   `Device.reservedUntil` beyond this read-merge.

Plugin `2.0.0` removes the legacy endpoints and the legacy fields from
`Device`. Migration script copies any in-flight `Device.reservedBy` /
`Device.reservedUntil` into synthetic `Lease` rows so live sessions
aren't disrupted.

### 4.7 Version detection — `/xenon/api/sdk/version`

A new GET endpoint, gated by API key + `MEMBER` role (matches the
`/devices` baseline). Returns:

```json
{
  "pluginVersion": "1.7.0",
  "supports": ["leases", "ports", "heartbeat"]
}
```

The `supports` array is the source of truth for feature detection. The
Kotlin SDK calls this once per `XenonClient` lifetime (cached), and
dispatches `DeviceManager.lease(...)` either to the new endpoint (when
`"leases"` is present) or to the current list-then-reserve walk
(legacy fallback). Migration is transparent — the Kotlin API
`xenon.allocator.lease(platform, xenonClient = xenon)` works against
either path.

Plugin `1.7.0` ships with `supports: ["leases", "ports", "heartbeat"]`.
Plugin `2.0.0` drops `"ports"` from the array (the legacy endpoint is
gone; ports are always allocated server-side now).

### 4.8 Appium session-create integration

When the Kotlin SDK acquires a lease and then opens an Appium session,
the W3C session-create POST carries `appium:capabilities` that include
`xenon:options.leaseId`. The `CommandInterceptor` (in `handleInContext`)
recognizes the leaseId and routes:

```
if firstMatch['xenon:options']?.leaseId:
  lease = await LeaseService.resolve(leaseId, /* no token — server trusts session-create flow */)
  if !lease or lease.status != 'active':
    throw 400 { lease_not_active }
  device = await DeviceStore.findByUdidHost(lease.deviceUdid, lease.deviceHost)
  // skip the standard findAndLockDevice — device is already locked by the lease
  // skip XenonCapabilityManager port injection — ports are already in firstMatch from the SDK
  return device
else:
  // legacy flow — unchanged
  return await allocateDeviceForSession(...)
```

`XenonCapabilityManager.androidCapabilities` and `.iOSCapabilities`
gain a guard: if `appium:systemPort` (Android) or `appium:wdaLocalPort`
(iOS) is already set in `firstMatch`, do not overwrite. This means the
lease-issued ports flow through unchanged.

### 4.9 Authentication summary

| Endpoint | Auth required |
|---|---|
| `POST /xenon/api/sdk/leases` | API key + `MEMBER` role + `devices` scope (mutation) |
| `GET /xenon/api/sdk/leases/:id` | API key + `MEMBER` role |
| `POST /xenon/api/sdk/leases/:id/heartbeat` | API key + `MEMBER` role + `x-xenon-lease-token` header |
| `POST /xenon/api/sdk/leases/:id/extend` | API key + `MEMBER` role + `x-xenon-lease-token` header |
| `DELETE /xenon/api/sdk/leases/:id` | API key + `MEMBER` role + `x-xenon-lease-token` header |
| `GET /xenon/api/sdk/leases` | API key + `MEMBER` role (team-visibility filtered) |
| `GET /xenon/api/sdk/version` | API key + `MEMBER` role |
| `POST /xenon/api/ports/allocate` | Node-pair token (hub → node only; not exposed to external clients via Express routing — registered only on internal mount) |

The `x-xenon-lease-token` requirement is in addition to the API-key
auth, not instead of. Two parallel workers sharing one API key still
can't release each other's leases because each lease has its own
random token.

---

## 5. Migration plan

### Plugin `1.6.x` → `1.7.0` (this work)

- Additive: new endpoints + `Lease` model + `PortLease` field
  additions. No public API removals.
- Existing tests pass without modification (verified via integration
  tests in this PR cycle).
- Kotlin SDK `2.0.x` continues to work — the legacy `/reservation`
  endpoints stay functional; the SDK's existing fallback path is the
  only thing exercised until a future SDK version adopts `/sdk/leases`.

### Plugin `1.7.0` → `2.0.0` (future, separate PR cycle)

- Drop legacy `/reservation` endpoints.
- Remove `Device.reservedBy` / `Device.reservedUntil` columns. A Prisma
  migration copies any live row into a synthetic `Lease` row.
- Kotlin SDK `2.1+` should bump its `minPluginVersion` to `2.0.0` so
  the fallback path can be deleted.

---

## 6. Testing strategy

### 6.1 Unit

- `LeaseService.create` happy path (mocked DB + RPC client).
- `LeaseService.create` rolls back the device lock on port-RPC failure.
- `verifyLeaseToken` middleware: success (200), mismatch (403),
  unknown lease (404).
- `LeaseOrphanSweeper.tick` reaps expired leases, cascades to
  `PortLease` and `Device.busy`.
- Port purposes per platform: Android emits 3 (system / chromedriver /
  mjpeg); iOS emits 2 (wdaLocal / mjpeg).
- Token cleartext is returned exactly once (never re-fetchable via
  `GET /sdk/leases/:id`).

### 6.2 Integration (Express + Prisma SQLite)

- `POST /sdk/leases` happy path against a fixture device pool.
- `POST /sdk/leases` race: two concurrent posts against a 1-device
  pool. One returns 201; the other 409 with `retryAfterMs`.
- `POST /sdk/leases` with empty pool: 404.
- `POST /sdk/leases/:id/heartbeat` valid token: 200; invalid: 403.
- `DELETE /sdk/leases/:id` after `expiresAt`: 410 Gone (then 404 on
  retry).
- Legacy-coexistence: device A reserved via legacy `/reservation`,
  device B via new `/sdk/leases`. A `findAndLockDevice` call respects
  both blocks; only an unblocked device C is allocatable.
- `/version` returns the expected `supports` array.
- `Deprecation` / `Sunset` headers present on legacy `/reservation`
  responses.

### 6.3 Hub-node RPC

- Mock the node's `/ports/allocate` endpoint with a test fixture.
- Verify the hub's PortAllocatorClient sends the right body and headers.
- Verify rollback (`DeviceStore.unlockDevice`) on RPC failure.

### 6.4 End-to-end (contract test in the Kotlin SDK repo)

A follow-up commit in `xenon-kotlin-sdk` will flip its `HubContractTest`
to call the new `/sdk/leases` endpoint when `pluginVersion` supports
`"leases"`. This validates the full wire path against a real plugin
instance.

---

## 7. Rollout plan

Five PRs against the plugin repo, all targeting `chore/release-1.7.0`
(a new release branch forked from `main`):

1. **PR 1** — Prisma migration: `Lease` model + `PortLease` field
   additions. No service code yet; tables are unused at this point.
2. **PR 2** — `PortAllocatorRouter` (the node-side
   `/xenon/api/ports/allocate` endpoint) + `PortAllocatorClient`
   (the hub-side wrapper that calls it). Integration test against an
   in-process node.
3. **PR 3** — `LeaseService` + `LeaseRouter` (`/sdk/leases` endpoints).
   Unit + integration tests for §6.1 + §6.2.
4. **PR 4** — `LeaseOrphanSweeper` + `findAndLockDevice` read-merge +
   `CommandInterceptor` lease-aware session-create. Integration test
   for the full Appium session create → lease bind → release flow.
5. **PR 5** — `Deprecation` / `Sunset` headers on legacy `/reservation`
   responses; new `/xenon/api/sdk/version` endpoint; README +
   changelog updates. Version bump `1.6.0 → 1.7.0`.

Each PR is independently reviewable. PR 5 includes the version-bump
trigger for the publish workflow.

---

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Port-RPC adds latency on every lease (~50-100ms per port) | Medium | Acceptable for the correctness gain. Optionally batch — single RPC requests all purposes at once (already in §4.3 contract). |
| Hub-node-pair token rotation breaks port-RPC mid-flight | Low | Token rotation is rare (admin operation). If it happens during a `LeaseService.create`, the hub gets a 401 from the node, rolls back the device lock, returns 503 to the caller. |
| Migration to plugin 2.0 leaks live legacy reservations | Medium | Migration script in §5 copies live `Device.reservedBy/reservedUntil` rows to synthetic `Lease` rows. Acceptance gate: zero `Device.reservedBy IS NOT NULL` rows after migration. |
| Heartbeat sweeper races with extend (lease expires between extend's read and write) | Low | Use transaction with `WHERE status='active'` on the update. Sweeper sees `status='expired'`, extend sees no rows updated → returns 410. |
| Stale `PortLease` rows accumulate if a lease is orphaned before its `leaseId` FK is set | Low | `PortLease.expiresAt = leaseDurationMs + 5min grace`. Separate sweeper (or extend the existing one) deletes rows where `expiresAt < now` AND `leaseId IS NULL`. |
| Two leases for the same device via parallel session-creates | Negligible | `DeviceStore.findAndLockDevice` already serializes via `busy=false → busy=true` write. Concurrent leases for the same device are not possible. |

---

## 9. Out of scope (revisit later)

- Lease transfer between actors.
- Lease priority / SLA tiers.
- Cross-hub federated leases.
- Lease ↔ Appium-session tight binding (auto-release on session-end).
- Per-lease dashboard metrics.
- Soft-delete / lease history retention.
- Streaming heartbeats over Socket.io (current design uses HTTP POST).
- Lease-scoped audit log distinct from the existing API-key audit log.

---

## 10. Open questions

| # | Question | Default if not resolved |
|---|---|---|
| Q1 | ~~Should `GET /xenon/api/sdk/version` require auth, or be open?~~ Resolved §4.7: API key + `MEMBER` role (matches `/devices` floor). | — |
| Q2 | What's the right value for the legacy `Sunset` date? | `2027-01-01` placeholder; adjust when the plugin 2.0 release date is committed. |
| Q3 | Should `POST /sdk/leases` accept a `priorityHint` field for queue ordering? | No (deferred to a future priority/SLA feature). |
| Q4 | Should `LeaseOrphanSweeper` emit Socket.io events for expired leases (so the dashboard can show a "reaped" badge)? | Yes — fire `lease:expired` on `EventManager`. Matches the existing `device:released` event pattern. |
| Q5 | Should `Lease` rows be soft-deleted (kept with `status='released'` for N hours) or hard-deleted? | Hard-delete on release; soft-expire (status='expired') only for the sweeper's reap path. Keep `Lease` table small. |

---

## 11. Acceptance criteria

This phase ships when all of the following are true:

- `Lease` and updated `PortLease` Prisma models exist with migrations.
- `POST /xenon/api/sdk/leases` returns a working capability bag against
  a connected device.
- `POST /xenon/api/sdk/leases/:id/heartbeat` extends `lastHeartbeatAt`
  with correct token validation; 403 on mismatch; 410 on expired
  leases.
- `LeaseOrphanSweeper` reaps leases within `3 × heartbeatSeconds` of
  the last heartbeat.
- `findAndLockDevice` correctly considers BOTH legacy and new locks
  when computing availability.
- Legacy `/reservation` endpoints emit `Deprecation` + `Sunset` headers.
- `GET /xenon/api/sdk/version` reports the new `supports` array.
- Hub → node port-RPC fully exercised in integration tests (mocked
  node) and on a real two-instance deployment.
- README + changelog updated. Plugin `1.7.0` published.
