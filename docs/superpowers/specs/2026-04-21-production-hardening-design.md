# Xenon Production Hardening — Design Spec

**Status:** Draft
**Date:** 2026-04-21
**Scope:** Five bounded changes that harden Xenon for 24/7 multi-team operation on real mobile devices. Each change is independently testable and ships under one Prisma migration.

## Motivation

Recent incidents surfaced repeatable production failure patterns:

- **Schema drift** (cpuArchitecture, ip) reached published npm versions and broke device discovery on install.
- **Orphaned sessions** remain locked indefinitely when the Appium process crashes, holding devices out of the pool.
- **Port races** between concurrent sessions cause intermittent "WDA failed to bind" and MJPEG stream failures.
- **Child-process leaks** (WDA, ffmpeg, adb reverse tunnels) accumulate across crashes until the host is rebooted.
- **Unauthenticated REST endpoints** on `/xenon/api/*` expose reservation, block, app, and webhook mutation to anyone reachable on the network.

Other improvements (smart healing, new capabilities, K8s deployment) are deferred until this floor is stable. No work here adds user-visible features; all work reduces flakiness, leakage, and attack surface.

## Non-goals

- Changes to the 5-tier healing cascade.
- Dashboard UX changes (except a dashboard API-key flow for §5).
- Performance tuning of the video pipeline.
- Postgres-specific optimisations. (Postgres must continue to work; no regressions.)
- RBAC beyond coarse scopes (`read | sessions | devices | admin`). Fine-grained per-device ACLs are future work.

---

## §1. Schema Integrity Guard

### Problem

Prisma schema and checked-in migration files drift from each other. The generated Prisma client embeds the drifted schema and ships to npm, where runtime upserts throw `PrismaClientValidationError: Unknown argument <field>` on user machines. The cpuArchitecture and ip fields each hit this path.

### Design

Two independent gates:

1. **CI drift check** (`.github/workflows/ci.yml`, new step before publish):
   - Run `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code`.
   - Non-zero exit → fail job. Author must commit a migration before merge.
2. **Generated-client freshness check** (same workflow):
   - Run `prisma generate` into a throwaway directory.
   - Diff its `index.d.ts` against the committed `src/generated/client/index.d.ts`.
   - Mismatch → fail job.

Runtime `prisma db push` inside `src/scripts/run-migrations.ts` (already shipped in 1.1.28) stays in place as a safety net for users whose DB predates new fields.

### Deliverables

- `.github/workflows/ci.yml` — new `schema-drift-check` job. Run on every PR and push to main.
- `scripts/check-client-freshness.js` — helper that shells out to `prisma generate --output <tmp>` and diffs.
- Docs update: `CONTRIBUTING.md` section on "schema changes" that tells authors to run `npm run db:generate` locally.

### Testing

- PR with schema change but no migration → CI red.
- PR with schema change + matching migration but stale `src/generated/client` → CI red.
- PR with both correct → CI green.

---

## §2. Session & Device Crash Recovery

### Problem

When the Appium process crashes or is killed, sessions in the `running` state remain in the database. Their allocated devices stay flagged `busy`, blocking future sessions. Today's recovery path (`SessionManager.recoverActiveSessions`) attempts to reattach to remote sessions but does not release devices when reattach fails, and does not detect stale sessions from other Appium PIDs sharing a DB (hub-node).

### Design

**New `Session` columns** (Prisma migration):

| column | type | purpose |
|---|---|---|
| `last_heartbeat_at` | DateTime? | last write by `SessionHeartbeatService` |
| `heartbeat_pid` | Int? | OS PID of the process that owns this session |
| `heartbeat_host` | String? | hostname, for hub-node disambiguation |

**New `Device` columns**:

| column | type | purpose |
|---|---|---|
| `owning_session_id` | String? | inverse of `Session.device_udid` for fast release |
| `locked_at` | Float? | epoch ms; used by watchdog for "stuck >1h" alerts |

### Flow

1. **Heartbeat writer** (extends existing `SessionHeartbeatService`): every `sessionHeartbeatIntervalMs` (default 30s), for each in-memory session, UPSERT `{last_heartbeat_at: now, heartbeat_pid: process.pid, heartbeat_host: os.hostname()}`.
2. **Orphan sweeper** (new cron, `setupCronSweepOrphanSessions`, 60s period):
   - Find sessions where `status = 'running'` AND `last_heartbeat_at < now - 3 × heartbeatIntervalMs`.
   - For each: mark `status = 'failed'`, set `failure_reason = 'Session heartbeat timeout'`, set `endTime = now`, release device (`busy = false`, `owning_session_id = null`, `locked_at = null`). Emit `session.failed` webhook and socket event.
3. **Startup reconciliation** (in `ServerManager.updateServer`, after existing `recoverActiveSessions`):
   - Find sessions with `heartbeat_pid != process.pid` AND `heartbeat_host = os.hostname()` AND stale → sweep immediately (same path as #2).
   - For sessions on a different host but stale, let the sweeper on that host handle it; do not touch.
4. **Process shutdown** (`src/index.ts` signal handlers, already exist): before exit, mark all in-memory sessions as `failed` with reason `'Server shutdown'`. Feeds §4 for process teardown.

### Testing

- Unit: sweeper finds and releases a stale session; leaves fresh sessions alone.
- Unit: startup reconciliation handles crashed-PID case without touching other hosts' sessions.
- Integration: spawn plugin subprocess, start session against a fake driver, SIGKILL the subprocess, restart plugin, assert device returns to pool within one sweep cycle.

---

## §3. Deterministic Port Allocation

### Problem

`getFreePort()` asks the OS for an ephemeral port, releases it, and returns the number. Between release and the caller binding, another process (often another Xenon session) can take the same port. Under concurrency, WDA and MJPEG bind failures are the dominant cause of retry storms.

### Design

**New Prisma model:**

```prisma
model PortLease {
  port          Int      @id
  purpose       String   // 'wda' | 'mjpeg' | 'system' | 'proxy'
  leasedToUdid  String
  leasedToPid   Int?
  leasedAt      Float
  expiresAt     Float
}

@@index([purpose, expiresAt])
```

**New service `PortAllocator` (`src/services/PortAllocator.ts`):**

```ts
acquire(purpose: 'wda' | 'mjpeg' | 'system' | 'proxy', udid: string, opts?: { pid?: number; ttlMs?: number }): Promise<number>
release(port: number): Promise<void>
releaseForSession(sessionId: string): Promise<void>  // joins via Session.device_udid → all leases for that UDID
```

### Algorithm (acquire)

1. Determine range for purpose from config (defaults: wda 8100–8199, mjpeg 9100–9199, system 10100–10199, proxy 11100–11199).
2. Query `PortLease` for active (unexpired) ports in range; compute free set.
3. Iterate free set; for each candidate, attempt `INSERT INTO PortLease` with candidate as PK. Collision (unique constraint) → try next. Success → verify OS-level availability via a quick `net.createServer().listen(port).close()` probe; if OS says busy, delete lease and try next.
4. Return allocated port. If range exhausted, throw `PortRangeExhaustedError`.

### Wiring

- `IOSDiscoveryService`, `AndroidDeviceManager`, `WDAClient`, `IOSStreamService`, `AndroidStreamService` switch from `getFreePort()` to `PortAllocator.acquire()`.
- On session end (`SessionLifecycleService.finishSession`), call `releaseForSession`.
- On startup, purge expired leases (`DELETE FROM PortLease WHERE expiresAt < now`).
- Default TTL: session duration (use `sessionHeartbeatIntervalMs × 10` as fallback for crashed-before-release cases).

### Config

New plugin CLI args (schema.json):

- `--plugin-xenon-port-range-wda` (default `8100-8199`)
- `--plugin-xenon-port-range-mjpeg` (default `9100-9199`)
- `--plugin-xenon-port-range-system` (default `10100-10199`)
- `--plugin-xenon-port-range-proxy` (default `11100-11199`)

### Testing

- Unit: two concurrent `acquire('wda', udid)` calls return distinct ports.
- Unit: range exhausted throws typed error.
- Unit: `releaseForSession` deletes all leases for that UDID.
- Integration: kill allocator mid-acquire (simulated) → lease row cleaned up by TTL sweep.

---

## §4. Child-Process Lifecycle

### Problem

Spawned children (WDA, ffmpeg, adb reverse, ios-mjpeg, Appium log tailer) live as long as the parent stays alive. On crash, SIGKILL, or uncaught exception, these children become orphans. They hold ports, USB tunnels, and simulators, forcing operator to run `pkill` scripts between test runs.

### Design

**New service `ProcessRegistry` (`src/services/ProcessRegistry.ts`):**

```ts
interface TrackedProcess {
  id: string;               // uuid
  sessionId?: string;
  udid?: string;
  kind: 'wda' | 'ffmpeg' | 'adb-reverse' | 'ios-mjpeg' | 'log-tailer' | 'other';
  pid: number;
  process: ChildProcess;
  startedAt: number;
}

track(opts: Omit<TrackedProcess, 'id' | 'pid' | 'startedAt'> & { process: ChildProcess }): string
untrack(id: string): void
terminate(id: string, { gracefulMs = 5000 } = {}): Promise<void>
terminateForSession(sessionId: string): Promise<void>
terminateForUdid(udid: string): Promise<void>
terminateAll(): Promise<void>       // invoked on shutdown
snapshot(): TrackedProcess[]         // for dashboard
```

### Behaviour

- `spawn(...)` callers use `{ detached: true }` on POSIX so `process.kill(-pid)` reaches the whole group. Immediately after spawn, register with `ProcessRegistry`.
- `terminate`: send SIGTERM (to `-pid` on POSIX, `pid` on Windows). Wait up to `gracefulMs`. If still alive, SIGKILL. Emit `process.terminated` socket event with duration + exit code.
- On `process.on('SIGINT' | 'SIGTERM' | 'uncaughtException' | 'unhandledRejection')` (already wired in `src/index.ts`): call `terminateAll` before `process.exit`.
- Hub-node: each node has its own registry; hub does not cross-supervise.

### Wiring

Replace direct `child_process.spawn` and `execa` calls in:

- `src/device-managers/ios/WDAClient.ts`
- `src/device-managers/ios/IOSStreamService.ts`
- `src/device-managers/android/AndroidStreamService.ts`
- `src/services/VideoPipelineService.ts`
- `src/services/DeviceLogService.ts`
- Any others surfaced during implementation (`grep -r spawn src/`).

Each call site gets a `ProcessRegistry.track` immediately after spawn and an `untrack` on clean exit. Teardown paths (session end) call `terminateForSession`.

### Dashboard integration

- `GET /xenon/api/processes` (admin-scoped, see §5) returns `snapshot()` for ops debugging.
- No UI in this spec; API only.

### Testing

- Unit: `terminate` sends SIGTERM then SIGKILL when process ignores SIGTERM (fake `ChildProcess` that stays alive).
- Unit: `terminateForSession` kills only the targeted session's children.
- Integration: spawn a real `sleep 60` via `ProcessRegistry`; call `terminateAll`; assert `ps` no longer shows it within 6s.
- Crash test: `process.exit(1)` from inside a tracked child's owner; restart plugin; assert registry rehydrates nothing (children already gone; no fake ghosts).

---

## §5. REST Auth + Rate Limit

### Problem

Every REST route under `/xenon/api/*` — reservations, device block/unblock, app uploads, webhook mutations — accepts unauthenticated requests from anyone who can reach the port. The dashboard UI calls these same endpoints with no credentials. There is no rate limit; a rogue script can overwhelm the queue in seconds.

### Design

**New Prisma model:**

```prisma
model ApiKey {
  id          String    @id @default(uuid())
  name        String
  keyHash     String    @unique                 // sha256 hex of raw key
  scopes      String                            // comma-separated: 'read' | 'sessions' | 'devices' | 'admin'
  rateLimit   Int       @default(60)            // requests per minute
  createdAt   DateTime  @default(now())
  revokedAt   DateTime?
  lastUsedAt  DateTime?
}
```

### Middleware chain

On `/xenon/api/*` (registered in `src/app/index.ts`, before route handlers):

1. **`apiKeyMiddleware`** — reads `X-Xenon-API-Key` header or `?apiKey=` query (for dashboard socket handshake). SHA-256, look up by `keyHash`, reject 401 if missing/revoked. Attach `req.apiKey = { id, scopes, rateLimit }`. Update `lastUsedAt` async (no await).
2. **`scopeGuard(required: Scope[])`** — route-level decorator. 403 if `req.apiKey.scopes` does not include any of required. Scope map:
   - `read`: `GET /sessions`, `GET /devices`, `GET /logs/*`, `GET /apps`
   - `sessions`: `POST/DELETE /sessions/*`, `POST /reservations`
   - `devices`: `POST /devices/:udid/block`, `POST /devices/:udid/tags`, `POST /apps` (install)
   - `admin`: `POST/DELETE /apikeys`, `POST /webhooks`, `POST /nodes`, `GET /processes`
3. **`rateLimitMiddleware`** — in-memory token bucket per `apiKey.id`. Refill `rateLimit / 60` tokens per second, capacity `rateLimit`. Exhausted → 429 with `Retry-After` header.

### Exemptions

- `/xenon/` (dashboard static assets) — no auth.
- `/xenon/api/health` — no auth, no rate limit (load balancer probe).
- `/xenon/api/nodes/register` — uses existing hub-node shared secret (verify in implementation whether `pluginArgs.nodeSecret` exists; if not, introduce it in this spec's scope).

### Bootstrap flow

On first plugin start, if `ApiKey` table is empty:

- Generate `crypto.randomBytes(32).toString('hex')`.
- Write to `${cacheDir}/bootstrap-key.txt` with 0600 permissions. This is the authoritative location.
- Log a WARN-level banner pointing at the file path (not the key value) and instructing the operator to rotate within 24h.
- Insert row with `name='bootstrap'`, `scopes='admin'`.
- Operator rotates via `POST /xenon/api/apikeys` (admin-scoped) then revokes bootstrap via `DELETE /xenon/api/apikeys/bootstrap`.
- Rationale for not logging the raw key: log aggregation pipelines (Datadog, CloudWatch, Splunk) often store logs longer than the key should live, and are read by more people than the filesystem.

### Dashboard authentication

- First-load flow: dashboard reads `document.cookie` for `xenon_dashboard_key`.
- If missing, show a "Paste your API key" screen. On submit, POST to `/xenon/api/auth/dashboard-session` (unauth, rate-limited separately, accepts key in body) → returns a short-lived (24h) HttpOnly cookie bound to the key's scopes.
- Socket.io connection upgrades with that cookie.
- No changes to dashboard visual design.

### Config

New plugin CLI args:

- `--plugin-xenon-auth-disabled` (default `false`) — for local dev only; logs a WARN every 60s when enabled.
- `--plugin-xenon-bootstrap-key-path` (default `${cacheDir}/bootstrap-key.txt`).

### Testing

- Unit: middleware rejects missing/wrong/revoked keys.
- Unit: scopeGuard rejects insufficient scopes.
- Unit: token bucket enforces rate limit and refills correctly.
- Integration: full dashboard login flow with a real API key.
- Migration test: upgrading a node that had no auth adds bootstrap key and logs it.

---

## Cross-cutting

### Migration ordering

One Prisma migration per section, applied in this order:

1. `add_session_heartbeat_columns` (§2)
2. `add_device_lock_columns` (§2)
3. `add_port_lease_table` (§3)
4. `add_api_key_table` (§5)

§1 and §4 do not require schema changes.

### Feature flags

None. Every change is a compatible default. `--plugin-xenon-auth-disabled` is the one opt-out, and only for §5.

### Metrics (OpenTelemetry)

Each section registers counters/histograms on the existing `TracingService` metrics provider:

- §2: `xenon.sessions.orphaned`, `xenon.sessions.reconciled`
- §3: `xenon.ports.acquired`, `xenon.ports.exhausted`, `xenon.ports.active{purpose}`
- §4: `xenon.processes.tracked`, `xenon.processes.terminated{kind,reason}`
- §5: `xenon.api.requests{scope,outcome}`, `xenon.api.rate_limited`

No new exporter configuration; uses whatever exporter is already configured.

### Docs

- `README.md` — new "Authentication" section pointing at §5.
- `CONTRIBUTING.md` — new "Database changes" section covering §1 gate.
- `docs/internal/operations.md` — runbook for orphan-session alerts, port exhaustion, bootstrap key rotation.

### Rollout

Single minor version bump (1.2.0). No staged rollout; no feature flag. Release notes must call out:

1. Auth enabled by default — operators must grab the bootstrap key from startup logs.
2. New `PortLease`, `ApiKey` tables added by auto-migrate (existing DB safe).

---

## Open questions for reviewer

1. **Scope of `nodeSecret`** — confirm whether hub-node handshake today has a shared-secret concept to reuse, or whether §5 needs to introduce it.
2. **Dashboard auth UX** — OK with a paste-key screen on first load? Or prefer a Google-SSO-style deferred design (not in scope here)?
3. **Rate limit default of 60/min** — reasonable for most CI pipelines? Adjust via `ApiKey.rateLimit`.
4. **Sweeper interval** — 60s acceptable, or should orphan detection be sub-minute for tighter device turnaround?

---

## Success criteria

- Zero schema-drift bugs reach a published version (§1 guard catches pre-merge).
- Any session interrupted by crash / SIGKILL / host reboot releases its device within 2× heartbeat interval (§2).
- No "port already in use" errors in 1k consecutive sessions across 8 parallel devices (§3).
- `pgrep -f 'WebDriverAgent|ffmpeg|adb reverse'` returns zero after `pkill -9 appium` and restart (§4).
- All `/xenon/api/*` endpoints return 401 without `X-Xenon-API-Key` (§5).
