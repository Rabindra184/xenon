# Xenon Production Excellence — Design Spec

**Status:** Approved  
**Date:** 2026-04-22  
**Scope:** 20 improvements across Reliability, Maintainability, Performance, and Observability. Each task ships as an independent PR. Tasks within a phase have soft dependencies; phases must complete in order.

**Target:** Multi-team enterprise lab (50+ devices, hub-node topology, CI-hammered) with SQLite-viable defaults for single-node installs.

---

## Phase 1 — Reliability

### T1 · Formal Session State Machine

**Problem**

Session state transitions are scattered across `SessionLifecycleService` (lines 127–371), `SessionHeartbeatService` (lines 37–122), and `DashboardEventManager` (lines 153–281). The heartbeat uses raw failure counters with no guard on illegal transitions. A session can silently re-enter `running` from `finished`, or a double-cleanup can leave state inconsistent between in-memory `sessionMap` and the DB `Session` record.

**Design**

New `src/services/SessionStateMachine.ts` — pure TypeScript FSM, no external library.

States (discriminated union):
```typescript
type SessionState =
  | 'requested'   // session creation initiated
  | 'allocated'   // device locked, caps validated
  | 'running'     // driver alive, commands flowing
  | 'degraded'    // heartbeat failures >= THRESHOLD_DEGRADED (1)
  | 'recovering'  // explicit recovery attempt in progress
  | 'finished'    // clean end (deleteSession called by client)
  | 'failed'      // terminal error, device released
```

Transition table (only listed edges are legal; all others throw `InvalidTransitionError`):
```typescript
const TRANSITIONS: Record<SessionState, SessionState[]> = {
  requested:  ['allocated', 'failed'],
  allocated:  ['running', 'failed'],
  running:    ['degraded', 'finished', 'failed'],
  degraded:   ['recovering', 'running', 'failed'],
  recovering: ['running', 'failed'],
  finished:   [],
  failed:     [],
}
```

API:
```typescript
class SessionStateMachine {
  transition(sessionId: string, to: SessionState, reason?: string): void
  current(sessionId: string): SessionState
  onTransition(from: SessionState, to: SessionState, handler: TransitionHandler): void
  remove(sessionId: string): void
}
```

Side-effect hooks registered at startup (not inside FSM):
- `running → failed` → call `DeviceAllocator.release(udid)`, emit `SESSION_FAILED` socket event
- `running → finished` → same device release, emit `SESSION_STOPPED`
- Any → `degraded` → log WARN with consecutive failure count
- `degraded → failed` (DEAD threshold) → call `SessionLifecycleService.deleteSession`

`SessionHeartbeatService` replaces raw failure count map with FSM events. Failure threshold logic becomes: each failed health check calls `machine.transition(id, 'degraded')` if current is `running`, or `machine.transition(id, 'failed')` if already `degraded` and count >= THRESHOLD_DEAD.

**Files**
- New: `src/services/SessionStateMachine.ts`
- Modify: `src/services/SessionHeartbeatService.ts` (replace counter map with FSM calls)
- Modify: `src/services/SessionLifecycleService.ts` (use machine.transition at session creation/deletion)
- Modify: `src/services/OrphanSweeper.ts` (transition to 'failed' via FSM)
- New test: `test/unit/SessionStateMachine.test.ts`

**Success criteria**
- Attempting `machine.transition(id, 'finished')` from `requested` throws `InvalidTransitionError`
- Double-calling `deleteSession` on the same session is a no-op (second call sees terminal state)
- All session state transitions are logged with `from → to` + reason

---

### T2 · DB-Level Device Locking

**Problem**

`AsyncLock` (`commandsQueueGuard`) serialises device allocation within a single process. Hub restarts, or two hub instances sharing a Postgres DB, can both read `busy=false` and both allocate the same device — the TOCTOU window is the gap between the `DeviceStore.getDevice()` check and the `prisma.device.update({ busy: true })` write.

**Design**

New `src/services/DeviceAllocator.ts` extracts device allocation into a single atomic unit.

```typescript
@Service()
class DeviceAllocator {
  async acquire(criteria: DeviceCriteria, sessionId: string): Promise<IDevice>
  async release(udid: string, host: string): Promise<void>
  async releaseForSession(sessionId: string): Promise<void>
}
```

`acquire` implementation:
```typescript
return prisma.$transaction(async (tx) => {
  const device = await tx.device.findFirst({
    where: { busy: false, platform: criteria.platform, ...otherFilters },
    // PostgreSQL: FOR UPDATE via queryRaw if Prisma version supports it
    // SQLite: Serializable isolation = BEGIN EXCLUSIVE
  });
  if (!device) throw new XenonError(ErrorCode.NO_DEVICE_AVAILABLE, '...');
  return tx.device.update({
    where: { udid_host: { udid: device.udid, host: device.host } },
    data: { busy: true, owningSessionId: sessionId, lockedAt: Date.now() },
  });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

For PostgreSQL, Serializable isolation uses SSI (not table locks), so concurrent reads of different devices are not serialised — only conflicting writes on the same device row contend.

The existing `AsyncLock` in `SessionLifecycleService` is removed. DB transaction provides the guarantee previously attempted in-process.

**Files**
- New: `src/services/DeviceAllocator.ts`
- Modify: `src/services/SessionLifecycleService.ts` (remove AsyncLock, call DeviceAllocator)
- New test: `test/unit/DeviceAllocator.test.ts` (concurrent acquire returns distinct devices)

**Success criteria**
- 50 concurrent `acquire('android')` calls against 10 devices: each device allocated to exactly one session
- Prisma transaction failure on conflict retried up to 3 times before throwing `NO_DEVICE_AVAILABLE`

---

### T3 · Socket.io Event Durability

**Problem**

`SocketServer.emitToDashboard` is fire-and-forget. Critical session lifecycle events (`SESSION_STARTED`, `SESSION_FAILED`, `SESSION_STOPPED`) are lost if the dashboard tab is closed or network drops mid-session. There is no replay mechanism.

**Design**

Classify events:
- **Critical**: `SESSION_STARTED`, `SESSION_STOPPED`, `SESSION_FAILED` — must survive disconnect
- **Volatile**: `SESSION_COMMAND`, heartbeat pings — drop-on-disconnect acceptable

Critical event persistence: before emitting, write to `SessionLog` with `eventType = 'lifecycle'` and `body = JSON.stringify(payload)`. Assign a monotonically increasing `sequence` integer per session (new column: `SessionLog.sequence`).

Replay on reconnect:
1. Dashboard sends `subscribe` event with `{ lastSequence: number | null }` on connect.
2. Server queries `SessionLog WHERE sequence > lastSequence AND eventType = 'lifecycle'` and re-emits each in order.
3. Server sends `replay_complete` after last event.

Volatile events: emitted via `socket.volatile.emit(...)` — socket.io drops them automatically when the buffer is full or the client is disconnected.

```typescript
class SocketServer {
  emitCritical(room: string, event: string, payload: any): Promise<void>  // persists + emits
  emitVolatile(room: string, event: string, payload: any): void           // volatile emit
}
```

**Files**
- Modify: `src/services/SocketServer.ts`
- Modify: `src/dashboard/event-manager.ts` (use emitCritical vs emitVolatile)
- Modify: `prisma/schema.prisma` (add `sequence Int?`, `eventType String?` to SessionLog)
- Modify: `web/src/hooks/useSocket.ts` (send lastSequence on connect, handle replay)
- New migration: `add_session_log_sequence`

**Success criteria**
- Dashboard closed mid-session, reopened: all lifecycle events appear in correct order
- 1000 SESSION_COMMAND events emitted while dashboard disconnected: none replayed on reconnect

---

### T4 · Idempotent Command Middleware

**Problem**

Clients experiencing network timeouts retry mutations (`POST /sessions`, `DELETE /sessions/:id`, `POST /reservations`). Without deduplication, the second request executes a second time — creating a duplicate session or deleting a session that was already cleaned up.

**Design**

`IdempotencyMiddleware` reads optional `X-Idempotency-Key` header (UUID, max 128 chars).

Storage: in-memory LRU map, max 10,000 entries, 24h TTL per key. No persistence needed — idempotency keys are request-scoped and the 24h window exceeds any reasonable retry window.

```typescript
interface IdempotencyEntry {
  statusCode: number
  body: unknown
  expiresAt: number
}

class IdempotencyCache {
  get(key: string): IdempotencyEntry | null
  set(key: string, statusCode: number, body: unknown): void
  // LRU eviction at 10k entries; TTL prune every 5 min
}
```

Middleware applied to `POST` and `DELETE` on mutation routes only. `GET` routes exempt. Routes that must not be idempotent (e.g., `POST /apikeys` where two requests should create two keys) explicitly opt out via `req.skipIdempotency = true`.

**Files**
- New: `src/middleware/idempotencyMiddleware.ts`
- New: `src/services/IdempotencyCache.ts`
- Modify: `src/app/index.ts` (wire middleware after auth, before routes)
- New test: `test/unit/idempotencyMiddleware.test.ts`

**Success criteria**
- `POST /sessions` with same key twice: second response identical to first, session created once
- `DELETE /sessions/:id` with same key twice: second response identical, delete not re-run
- Missing header: middleware is no-op, request proceeds normally

---

### T5 · Cascading Deletes + Referential Integrity

**Problem**

`Device.owningSessionId` references `Session.id` but has no Prisma `@relation`. If session cleanup fails mid-way, device rows survive with stale `owningSessionId` pointing at deleted sessions. Same gap exists for `SessionLog`, `Log`, and `Profiling` → `Session`.

**Design**

Add explicit Prisma relations with `onDelete` semantics:

```prisma
model Device {
  owningSession Session? @relation("DeviceOwner",
    fields: [owningSessionId], references: [id],
    onDelete: SetNull)   // device survives, just freed
}

model SessionLog {
  session Session @relation(fields: [sessionId], references: [id],
    onDelete: Cascade)   // logs die with session
}

model Log {
  session Session @relation(fields: [session_id], references: [id],
    onDelete: Cascade)
}

model Profiling {
  session Session @relation(fields: [session_id], references: [id],
    onDelete: Cascade)
}
```

`Build` → `Session`: keep `SetNull` (build records are valuable for historical reporting even after sessions are purged).

Add migration `add_referential_integrity`. Run `prisma db push` path already handles existing rows safely (SetNull on missing references).

**Files**
- Modify: `prisma/schema.prisma`
- New migration: `add_referential_integrity`

**Success criteria**
- Delete a Session: all SessionLog, Log, Profiling rows for that session are removed
- Delete a Session: owning Device row survives with `owningSessionId = null`, `busy = false`

---

### T6 · Async Graceful Shutdown with Timeout

**Problem**

`src/index.ts` signal handler calls `ProcessRegistry.terminateAll()` then `process.exit()`. Async operations (mark sessions failed, flush pending DB writes, release port leases, close Prisma) are not awaited — they're abandoned mid-flight. In production this leaves zombie PortLease rows and sessions stuck in `running`.

**Design**

Structured async shutdown with 10s hard timeout:

```typescript
let shuttingDown = false;

async function shutdown(signal: string, exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.warn(`[Shutdown] ${signal} received. Graceful shutdown started.`);

  const hardKill = setTimeout(() => {
    log.error('[Shutdown] Timeout exceeded. Forcing exit.');
    process.exit(1);
  }, 10_000);

  try {
    await Promise.allSettled([
      markAllActiveSessionsFailed('Server shutdown: ' + signal),
      Container.get(ProcessRegistry).terminateAll({ gracefulMs: 5000 }),
      Container.get(PortAllocator).releaseAll(),
    ]);
    await prisma.$disconnect();
  } finally {
    clearTimeout(hardKill);
    process.exit(exitCode);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT',  () => shutdown('SIGINT', 0));
process.on('uncaughtException', (err) => {
  log.error('[Shutdown] uncaughtException', err);
  shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  log.error('[Shutdown] unhandledRejection', reason);
  shutdown('unhandledRejection', 1);
});
```

`ServerManager` exposes `setAcceptingSessions(false)` called first to stop new sessions queuing during drain.

**Files**
- Modify: `src/index.ts`
- Modify: `src/services/ServerManager.ts` (add `setAcceptingSessions`)
- Modify: `src/services/PortAllocator.ts` (add `releaseAll`)
- New test: `test/unit/shutdown.test.ts`

**Success criteria**
- `SIGTERM` with 3 active sessions: all sessions marked `failed`, devices freed, port leases deleted before process exits
- Shutdown completes in <6s under normal conditions
- Force-kill scenario: 10s timeout fires, process exits 1, no hung process

---

## Phase 2 — Maintainability

### T7 · Split DashboardEventManager (768 → 4 focused services)

**Problem**

`src/dashboard/event-manager.ts` is 768 lines with 7 stateful Maps, 13 methods, and responsibilities spanning socket broadcasting, command timing, profiling, log tailing, and zombie cleanup. Any change to session handling requires reading this entire file.

**Design**

Split into 4 `@Service()` classes:

**`SessionEventBroadcaster`** (`src/services/SessionEventBroadcaster.ts`, ~120 lines)
- `onSessionStarted(session, device)` — creates DB session record, emits `SESSION_STARTED`, increments `MetricsService.incrementSessionStart()`
- `onSessionStopped(sessionId, status, reason)` — emits `SESSION_STOPPED`, increments success/failure metric
- Injects: `SocketServer`, `MetricsService`, `TracingService`
- State: none (stateless broadcaster)

**`CommandInterceptorService`** (`src/services/CommandInterceptorService.ts`, ~200 lines)
- `beforeCommand(sessionId, command, args)` — records command start time, handles Xenon dashboard commands
- `afterCommand(sessionId, command, result, error)` — creates `SessionLog` DB record, triggers screenshot capture, emits `SESSION_COMMAND` via EventBatcher (T16), records healing metrics
- State: `commandStartTime: Map<string, number>` (one Map, clear purpose)
- Injects: `SocketServer`, `EventBatcher`, `MetricsService`

**`ProfilingCoordinator`** (`src/services/ProfilingCoordinator.ts`, ~150 lines)
- `startProfiling(sessionId, device)` — starts Android `AppProfiler` or iOS profiling
- `stopProfiling(sessionId)` — saves profiling data to `Profiling` table, archives iOS trace
- State: `appProfilers: Map<string, AndroidAppProfiler>`
- Injects: `XenonManager` (to reach AndroidDeviceManager)

**`LogTailCoordinator`** (`src/services/LogTailCoordinator.ts`, ~120 lines)
- `startTailing(sessionId, device)` — starts iOS syslog service if real iOS device
- `stopTailing(sessionId)` — stops syslog service, flushes remaining logs
- `getDeviceLogs(sessionId, driver)` — fetches logs incrementally using `lastLogLine` cursor
- State: `syslogServices: Map<string, any>`, `lastLogLine: Map<string, number>`

Zombie cleanup (`cleanupGlobalZombie`) moves into `OrphanSweeper` where it semantically belongs.

**Transition strategy**: `DashboardEventManager` becomes a thin facade delegating to the 4 services above. Its `@Service()` token and injection points remain unchanged so callers (`SessionLifecycleService`, `XenonPlugin`) don't need simultaneous edits. Remove the facade in T8 once callers are updated.

**Files**
- New: `src/services/SessionEventBroadcaster.ts`
- New: `src/services/CommandInterceptorService.ts`
- New: `src/services/ProfilingCoordinator.ts`
- New: `src/services/LogTailCoordinator.ts`
- Modify: `src/dashboard/event-manager.ts` (thin facade, ~50 lines)
- Modify: `src/services/OrphanSweeper.ts` (absorb zombie cleanup)

---

### T8 · Split SessionLifecycleService (641 → 3 services + thin orchestrator)

**Problem**

641 lines spanning device allocation, capability validation, WDA provisioning, session DB persistence, circuit breaker management, and remote session forwarding. 11 `Container.get()` calls inside method bodies. Impossible to unit test allocation without a live DI container, ADB, and simctl.

**Design**

**`DeviceAllocator`** (`src/services/DeviceAllocator.ts`) — defined in T2. The `acquire(criteria, sessionId)` method from T2 is the allocation entry point used here. Extended in T8 with:
- `release(udid, host)` — set `busy=false`, clear `owningSessionId`, `lockedAt`
- Absorbs the `AsyncLock` (commandsQueueGuard) previously in `SessionLifecycleService`

**`WDAProvisioner`** (`src/services/WDAProvisioner.ts`, ~100 lines)
- `provision(device, caps)` — starts WDA stream for real iOS devices, injects `webDriverAgentUrl` into caps
- `teardown(device)` — stops WDA stream on session end
- Encapsulates `handleLocalWDAProvisioning` and `injectWDAUrl`
- Injects: `IOSStreamService`

**`SessionPersistence`** (`src/services/SessionPersistence.ts`, ~120 lines)
- `create(sessionData)` → Prisma Session row + XenonSession instance (Local/Remote/Cloud)
- `markFailed(sessionId, reason)` → update status, endTime, failure_reason
- `markFinished(sessionId)` → update status, endTime
- Encapsulates all `prisma.session.*` calls currently in `SessionLifecycleService`

**`SessionLifecycleService`** (thin orchestrator, ~150 lines)
- `createSession(caps, driver)` → calls DeviceAllocator → CapabilityValidator → WDAProvisioner → SessionPersistence → SessionEventBroadcaster.onSessionStarted
- `deleteSession(sessionId, driver)` → calls WDAProvisioner.teardown → PortAllocator.releaseForUdid → SessionPersistence.markFinished → DeviceAllocator.release → SessionEventBroadcaster.onSessionStopped

All `Container.get()` calls removed from method bodies. Constructor receives all dependencies.

**Files**
- New: `src/services/WDAProvisioner.ts`
- New: `src/services/SessionPersistence.ts`
- Extend: `src/services/DeviceAllocator.ts`
- Refactor: `src/services/SessionLifecycleService.ts`

---

### T9 · Abstract Device Discovery

**Problem**

`AndroidDeviceManager` (1257 lines) and `IOSDiscoveryService` implement identical discovery logic (fetch raw → enrich with device info → filter by state → sync to DeviceStore) in separate copies. A fix to offline device detection, SDK version parsing, or DeviceStore sync must be applied twice.

**Design**

```typescript
// src/device-managers/AbstractDeviceDiscovery.ts
abstract class AbstractDeviceDiscovery<TRaw> {
  // Template method — concrete implementations override these three
  protected abstract fetchRaw(): Promise<TRaw[]>
  protected abstract enrich(raw: TRaw): Promise<Partial<IDevice>>
  protected abstract toDeviceState(raw: TRaw): 'available' | 'offline' | 'busy'

  // Shared pipeline — not overridden
  async discover(): Promise<IDevice[]> {
    const raw = await this.fetchRaw();
    const enriched = await Promise.allSettled(raw.map(r => this.enrich(r)));
    const devices = enriched
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<Partial<IDevice>>).value);
    return this.filterByState(devices);
  }

  protected filterByState(devices: Partial<IDevice>[]): IDevice[] {
    // shared: exclude offline unless pluginArgs.includeOfflineDevices
  }

  async syncToStore(discovered: IDevice[]): Promise<void> {
    // shared: DeviceStore upsert logic (currently duplicated)
  }
}
```

`AndroidDeviceManager` and `IOSDiscoveryService` extend `AbstractDeviceDiscovery` and implement only the 3 abstract methods. Shared logic (sync, filtering, deduplication by UDID) lives in the base class.

**Files**
- New: `src/device-managers/AbstractDeviceDiscovery.ts`
- Modify: `src/device-managers/AndroidDeviceManager.ts` (extend base, remove duplicated pipeline)
- Modify: `src/device-managers/ios/IOSDiscoveryService.ts` (same)

---

### T10 · Constructor Injection

**Problem**

`Container.get()` appears 15+ times inside service method bodies, making unit tests impossible without a live TypeDI container. This also hides dependencies — a class's constructor signature does not reveal what it needs.

**Design**

TypeDI resolves constructor parameters automatically when a class is decorated with `@Service()` and its dependencies are typed. No `@Inject()` decorator needed for typed dependencies.

Mechanical migration — no behaviour change:

```typescript
// Before
@Service()
class SessionLifecycleService {
  async createSession() {
    const context = Container.get(PluginContext);  // hidden dependency
    const validator = Container.get(CapabilityValidator);
  }
}

// After
@Service()
class SessionLifecycleService {
  constructor(
    private readonly context: PluginContext,
    private readonly validator: CapabilityValidator,
    private readonly deviceAllocator: DeviceAllocator,
    private readonly sessionPersistence: SessionPersistence,
    private readonly wdaProvisioner: WDAProvisioner,
  ) {}
}
```

Services to migrate (identified by audit):
- `SessionLifecycleService` — 11 Container.get() calls
- `DashboardEventManager` / its 4 successors (T7) — 9 calls
- `SessionHeartbeatService` — 1 call
- `OrphanSweeper` — discovered during T1

Rule going forward: `Container.get()` permitted only in: router factory functions, plugin entry point (`XenonPlugin`), and test container setup.

**Files**
- Modify: all services listed above + T7/T8 successors

---

### T11 · Integration Test Infrastructure

**Problem**

`test/integration/testHelpers.js` imports `../../src/Devices` (nonexistent). All integration tests fail before a single assertion runs. No test container or in-memory DB helper exists — integration tests require a real device and a running server.

**Design**

**Fix `testHelpers.js`**: rewrite to import from actual exports (`src/device-utils`, `src/data-service/device-store`). Remove the `src/Devices` import.

**`test/helpers/container.ts`** — isolated TypeDI container per test:
```typescript
export function createTestContainer(overrides: Partial<ServiceOverrides> = {}): Container {
  const container = new ContainerInstance(randomUUID());
  container.set(PrismaService, overrides.prisma ?? createInMemoryPrisma());
  container.set(SocketServer, overrides.socket ?? createMockSocketServer());
  // ... other mockable services
  return container;
}
```

**`test/helpers/db.ts`** — in-memory SQLite Prisma client:
```typescript
export async function createTestDb(): Promise<PrismaClient> {
  const client = new PrismaClient({
    datasources: { db: { url: 'file::memory:?cache=shared' } },
  });
  await client.$executeRaw`PRAGMA journal_mode=WAL`;
  await runMigrations(client);
  return client;
}
```

**Heartbeat → cleanup → recovery integration test** (the highest-value untested path):
1. Create session in DB (`status=running`, `heartbeat_pid=99999` — fake dead PID)
2. Invoke `OrphanSweeper.sweep()`
3. Assert session `status=failed`, device `busy=false`

**Files**
- Modify: `test/integration/testHelpers.js`
- New: `test/helpers/container.ts`
- New: `test/helpers/db.ts`
- New: `test/integration/heartbeat-recovery.test.ts`

---

### T12 · Typed Error System

**Problem**

Errors thrown throughout the codebase are plain `new Error('string message')`. API responses are inconsistent (`{ error: 'string' }` vs `{ error: true, message }` vs just HTTP status). Clients cannot handle specific error conditions programmatically; log aggregators cannot group by error type.

**Design**

```typescript
// src/errors.ts
export enum ErrorCode {
  // Device
  NO_DEVICE_AVAILABLE    = 'NO_DEVICE_AVAILABLE',
  DEVICE_BUSY            = 'DEVICE_BUSY',
  DEVICE_OFFLINE         = 'DEVICE_OFFLINE',
  // Session
  SESSION_NOT_FOUND      = 'SESSION_NOT_FOUND',
  INVALID_TRANSITION     = 'INVALID_STATE_TRANSITION',
  SESSION_CREATE_FAILED  = 'SESSION_CREATE_FAILED',
  // Ports
  PORT_RANGE_EXHAUSTED   = 'PORT_RANGE_EXHAUSTED',
  // Auth
  AUTH_KEY_MISSING       = 'AUTH_KEY_MISSING',
  AUTH_KEY_INVALID       = 'AUTH_KEY_INVALID',
  AUTH_KEY_REVOKED       = 'AUTH_KEY_REVOKED',
  RATE_LIMIT_EXCEEDED    = 'RATE_LIMIT_EXCEEDED',
  INSUFFICIENT_SCOPE     = 'INSUFFICIENT_SCOPE',
  // Infra
  DATABASE_ERROR         = 'DATABASE_ERROR',
  NODE_SECRET_MISMATCH   = 'NODE_SECRET_MISMATCH',
}

export class XenonError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
    public readonly httpStatus: number = 500,
  ) {
    super(message);
    this.name = 'XenonError';
  }
}
```

Global Express error handler (last middleware in `src/app/index.ts`):
```typescript
app.use((err, req, res, next) => {
  if (err instanceof XenonError) {
    return res.status(err.httpStatus).json({
      error: true,
      code: err.code,
      message: err.message,
      ...(err.context && { context: err.context }),
    });
  }
  log.error('[UnhandledError]', err);
  res.status(500).json({ error: true, code: 'INTERNAL_ERROR', message: 'Internal server error' });
});
```

All existing `throw new Error(...)` in service code replaced with `throw new XenonError(ErrorCode.X, '...')`. Existing middleware (`apiKeyMiddleware`, `rateLimitMiddleware`, `nodeSecretMiddleware`) updated to use `XenonError` instead of `res.status(N).json(...)` directly.

**Files**
- New: `src/errors.ts`
- Modify: `src/app/index.ts` (global error handler)
- Modify: all service files and middleware using string errors
- New test: `test/unit/errors.test.ts`

---

## Phase 3 — Performance

### T13 · Fix N+1 on getBuilds

**Problem**

`src/app/routers/dashboard.ts` `getBuilds()` fetches all builds, then for each build fetches all its sessions, then computes status counts in JavaScript. With 10k sessions across 500 builds this is 501 DB queries and 10k rows loaded into Node.js memory.

**Design**

Replace with a single aggregation query:

```typescript
const counts = await prisma.session.groupBy({
  by: ['build_id', 'status'],
  where: { build_id: { not: null } },
  _count: { id: true },
});

// Pivot in JS — O(total distinct build×status combinations), not O(sessions)
const buildStats = new Map<string, Record<string, number>>();
for (const row of counts) {
  const stats = buildStats.get(row.build_id!) ?? {};
  stats[row.status] = row._count.id;
  buildStats.set(row.build_id!, stats);
}

const builds = await prisma.build.findMany({
  where: { id: { in: [...buildStats.keys()] } },
  orderBy: { createdAt: 'desc' },
  take: pageSize,
  skip: offset,
});

return builds.map(b => ({ ...b, sessionCounts: buildStats.get(b.id) ?? {} }));
```

Result: 2 queries regardless of session count.

**Files**
- Modify: `src/app/routers/dashboard.ts`

---

### T14 · Add Missing DB Indexes

**Problem**

Common dashboard and allocation queries filter on unindexed columns. Identified from query patterns in `dashboard.ts`, `SessionLifecycleService`, and `DeviceAllocator`.

**Design**

New indexes (added via Prisma migration `add_performance_indexes`):

```prisma
model Session {
  @@index([status, device_udid])       // device pool queries: "sessions for this device"
  @@index([build_id, status])          // build summary queries (supplements T13)
  @@index([node_id, status])           // hub-node: "running sessions on this node"
}

model Device {
  @@index([busy, platform])            // allocation: "free Android devices"
  @@index([nodeId])                    // hub queries: "devices on this node"
  @@index([userBlocked])               // filter blocked devices in dashboard
}
```

Existing indexes to verify are present (may already exist):
- `Session(status, last_heartbeat_at)` — ✅ confirmed in schema
- `Device(owningSessionId)` — ✅ confirmed in schema
- `ApiKey(keyHash)` — ✅ unique constraint (doubles as index)
- `PortLease(purpose, expiresAt)` — verify in schema

**Files**
- Modify: `prisma/schema.prisma`
- New migration: `add_performance_indexes`

---

### T15 · Frontend — React Query

**Problem**

Each page component fetches data independently on mount with `useEffect(() => { api.getSessions() }, [])`. Navigating between pages triggers redundant fetches of the same data. Socket.io events set local `useState` with no coordination between components — stale data can persist on other tabs.

**Design**

Add `@tanstack/react-query` v5 (`react-query`):

```typescript
// web/src/queryClient.ts
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 2 } },
});

// web/src/App.tsx
<QueryClientProvider client={queryClient}>
  <App />
</QueryClientProvider>
```

New hooks (`web/src/hooks/`):
```typescript
export const useDevices  = () => useQuery({ queryKey: ['devices'],      queryFn: api.getDevices })
export const useSessions = () => useQuery({ queryKey: ['sessions'],     queryFn: api.getSessions })
export const useSession  = (id: string) => useQuery({ queryKey: ['session', id], queryFn: () => api.getSession(id) })
export const useBuilds   = () => useQuery({ queryKey: ['builds'],       queryFn: api.getBuilds })
```

Socket.io events trigger cache invalidation:
```typescript
// web/src/hooks/useSocket.ts
socket.on('SESSION_STARTED', () => queryClient.invalidateQueries({ queryKey: ['sessions'] }))
socket.on('SESSION_STOPPED', () => queryClient.invalidateQueries({ queryKey: ['sessions'] }))
socket.on('DEVICE_UPDATED',  () => queryClient.invalidateQueries({ queryKey: ['devices'] }))
```

Remove all per-component `useState + useEffect fetch` patterns (affects ~8 components). Components become pure presentational consumers of query hooks.

**Files**
- Modify: `web/package.json` (add `@tanstack/react-query`)
- New: `web/src/queryClient.ts`
- New: `web/src/hooks/useDevices.ts`, `useSessions.ts`, `useSession.ts`, `useBuilds.ts`
- Modify: `web/src/hooks/useSocket.ts`
- Modify: `web/src/App.tsx`
- Modify: all page components that use `useEffect` + `fetch` pattern

---

### T16 · Socket Event Batching

**Problem**

`afterSessionCommand` emits one `SESSION_COMMAND` socket event per Appium command. Under load (8 devices × 10 commands/s = 80 events/s), each carrying a full `SessionLog` row serialised as JSON. This creates significant socket frame overhead and can saturate slow dashboard connections.

**Design**

```typescript
// src/services/EventBatcher.ts
@Service()
class EventBatcher {
  private queues = new Map<string, BatchEntry[]>();
  private flushTimer: NodeJS.Timeout;

  constructor(private readonly socket: SocketServer) {
    this.flushTimer = setInterval(() => this.flush(), 100); // 100ms window
  }

  enqueue(room: string, event: string, payload: unknown): void {
    const key = `${room}:${event}`;
    const queue = this.queues.get(key) ?? [];
    queue.push({ event, payload, ts: Date.now() });
    this.queues.set(key, queue);
  }

  private flush(): void {
    for (const [key, entries] of this.queues) {
      const [room] = key.split(':');
      this.socket.emitVolatile(room, 'batch', entries);
    }
    this.queues.clear();
  }
}
```

`CommandInterceptorService.afterCommand` calls `batcher.enqueue(sessionRoom, 'SESSION_COMMAND', payload)` instead of direct socket emit.

Dashboard `useSocket.ts` handles `batch` event: iterate array, apply each entry as if received individually.

Critical events (`SESSION_STARTED`, `SESSION_STOPPED`, `SESSION_FAILED`) bypass the batcher and use `SocketServer.emitCritical` directly (T3).

**Files**
- New: `src/services/EventBatcher.ts`
- Modify: `src/services/CommandInterceptorService.ts` (from T7)
- Modify: `web/src/hooks/useSocket.ts` (handle `batch` event)

---

### T17 · PostgreSQL Connection Pooling

**Problem**

Prisma default connection pool is 10. Under 50+ concurrent sessions all issuing DB writes (heartbeat updates, session logs, port lease operations), the pool exhausts silently. Queries queue in Node.js and latency spikes. No visibility into pool state.

**Design**

Derive pool size from config:
```typescript
// src/prisma.ts
const poolSize = Math.min((config.maxConcurrentSessions ?? 10) * 2, 100);
const url = process.env.DATABASE_URL?.includes('postgresql')
  ? `${process.env.DATABASE_URL}?connection_limit=${poolSize}&pool_timeout=30`
  : process.env.DATABASE_URL; // SQLite: pooling not applicable

export const prisma = new PrismaClient({
  datasources: { db: { url } },
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

prisma.$on('warn', (e) => log.warn('[Prisma]', e.message));
prisma.$on('error', (e) => log.error('[Prisma]', e.message));
```

Add `schema.json` config field `--plugin-xenon-max-concurrent-sessions` (default 25).

Document PgBouncer mode in `docs/internal/operations.md`:
```
DATABASE_URL=postgresql://...?pgbouncer=true&connection_limit=1
```

SQLite users: no change, Prisma serialises SQLite writes natively.

**Files**
- Modify: `src/prisma.ts`
- Modify: `src/config.ts`
- Modify: `schema.json`
- Modify: `docs/internal/operations.md`

---

## Phase 4 — Observability

### T18 · OTel Metrics

**Problem**

`TracingService` handles distributed tracing (spans) only. The §1–§5 production hardening spec called for OTel metrics counters; they were never implemented. No operational visibility into orphan sweep rates, port allocation patterns, process churn, or API request volumes.

**Design**

New `src/services/MetricsProvider.ts` wrapping `@opentelemetry/sdk-metrics`:

```typescript
@Service()
class MetricsProvider {
  private meter: Meter;

  // §2 — session health
  readonly sessionsOrphaned: Counter;
  readonly sessionsReconciled: Counter;

  // §3 — ports
  readonly portsAcquired: Counter;        // attributes: { purpose }
  readonly portsExhausted: Counter;       // attributes: { purpose }
  readonly portsActive: UpDownCounter;    // attributes: { purpose }

  // §4 — processes
  readonly processesTracked: UpDownCounter;    // attributes: { kind }
  readonly processesTerminated: Counter;       // attributes: { kind, reason }

  // §5 — API
  readonly apiRequests: Counter;          // attributes: { scope, outcome }
  readonly apiRateLimited: Counter;       // attributes: { key_id }
}
```

Wiring:
- `OrphanSweeper.sweep()` → increment `sessionsOrphaned` per swept session
- `PortAllocator.acquire()` → increment `portsAcquired` on success, `portsExhausted` on range exhaustion
- `ProcessRegistry.track()` → increment `processesTracked`; `terminate()` → increment `processesTerminated`
- `apiKeyMiddleware` → increment `apiRequests` on every request passing auth
- `rateLimitMiddleware` → increment `apiRateLimited` on 429

Uses existing OTLP exporter from `TracingService` if `OTEL_EXPORTER_OTLP_ENDPOINT` is set. `MeterProvider` shares the same exporter. No new env vars required.

**Files**
- New: `src/services/MetricsProvider.ts`
- Modify: `package.json` (add `@opentelemetry/sdk-metrics`)
- Modify: `src/services/OrphanSweeper.ts`
- Modify: `src/services/PortAllocator.ts`
- Modify: `src/services/ProcessRegistry.ts`
- Modify: `src/middleware/apiKeyMiddleware.ts`
- Modify: `src/middleware/rateLimitMiddleware.ts`

---

### T19 · Rich Health Endpoint

**Problem**

`GET /xenon/api/health` returns `{ ok: true }`. Load balancers and monitoring systems cannot distinguish "server process is alive" from "all components are healthy." A stale sweeper or slow DB goes undetected.

**Design**

```typescript
GET /xenon/api/health
// No auth required (load balancer probe)

Response 200 (healthy):
{
  "status": "healthy",
  "version": "1.2.0",
  "uptime": 3627,
  "components": {
    "database":        { "status": "healthy",  "latencyMs": 2 },
    "deviceStore":     { "status": "healthy",  "total": 12, "busy": 3, "offline": 1 },
    "processRegistry": { "status": "healthy",  "tracked": 8 },
    "orphanSweeper":   { "status": "healthy",  "lastRunAt": "2026-04-22T18:00:00Z", "lastSweptCount": 0 },
    "portAllocator":   { "status": "healthy",  "activeLeases": 16 }
  }
}

Response 200 (degraded — DB slow):
{ "status": "degraded", "components": { "database": { "status": "degraded", "latencyMs": 620 } ... } }

Response 503 (unhealthy — DB unreachable):
{ "status": "unhealthy", "components": { "database": { "status": "unhealthy", "error": "ECONNREFUSED" } ... } }
```

Aggregate status rules:
- `healthy`: all components healthy
- `degraded`: any component degraded (DB latency >500ms, sweeper last-run >2min ago)
- `unhealthy`: any component unreachable (DB `$queryRaw` throws)

DB health check: `await prisma.$queryRaw\`SELECT 1\`` with 2s timeout.

**Files**
- Modify: `src/app/index.ts` (health handler)
- Modify: `src/services/OrphanSweeper.ts` (expose `lastRunAt`, `lastSweptCount`)
- Modify: `src/services/PortAllocator.ts` (expose `activeLeaseCount()`)

---

### T20 · Structured Error Response Format

**Problem**

API error responses are inconsistent across routers. Some routes return `{ error: 'string' }`, others `{ error: true, message: 'string' }`, others just an HTTP status with no body. Clients cannot reliably parse error details.

**Design**

Standardise on a single error envelope. Depends on T12 (`XenonError`) for server-side typed errors, and the global error handler introduced in T12 for automatic serialisation.

Additional work in T20:
- Audit all `res.status(N).json({...})` calls in all router files
- Replace ad-hoc error objects with `throw new XenonError(ErrorCode.X, message, context, httpStatus)`
- Add `formatError` helper for the rare cases where a route must return an error without throwing

```typescript
// src/app/helpers.ts
export function formatError(code: ErrorCode, message: string, context?: object) {
  return { error: true, code, message, ...(context && { context }) };
}
```

The global error handler from T12 covers all thrown `XenonError`s automatically. This task covers the direct `res.json()` error sites that don't throw.

Routes to audit: `dashboard.ts`, `grid.ts`, `control.ts`, `apps.ts`, `webhook.ts`, `reservation.ts`, `config.ts`, `apikeys.ts`, `auth.ts`, `processes.ts`.

**Files**
- New: `src/app/helpers.ts`
- Modify: all router files listed above

---

## Cross-cutting constraints

### Task ordering within phases

Phase 1 soft dependencies:
- T1 (state machine) should precede T6 (shutdown) — shutdown uses FSM to mark sessions failed
- T2 (DB locking) must precede T8 (SessionLifecycleService split) — DeviceAllocator is the extracted service
- T5 (cascading deletes) is independent, can ship any time in Phase 1

Phase 2 soft dependencies:
- T10 (constructor injection) is easiest after T7+T8 — new services can be written with correct injection from the start
- T12 (typed errors) should precede T20 (structured responses) — T20 depends on T12's XenonError

Phase 3:
- T16 (event batching) depends on T7 (CommandInterceptorService exists)
- T15 (React Query) is independent of all server changes

Phase 4:
- T18 (OTel metrics) depends on T1/T2/T3 hooks being in place
- T20 depends on T12

### Schema migrations in order

1. `add_referential_integrity` (T5)
2. `add_session_log_sequence` (T3)
3. `add_performance_indexes` (T14)

### Non-goals

- Replacing SQLite with a different DB engine
- Adding Redis, Kafka, or any mandatory external dependency
- RBAC beyond the existing coarse scopes
- Dashboard visual redesign
- Kubernetes deployment manifests

---

## Success criteria (post-completion)

| Area | Metric | Target |
|------|--------|--------|
| Reliability | Illegal state transitions logged | Zero silent transitions in prod |
| Reliability | Device double-allocation under concurrent load | Zero |
| Reliability | Session lifecycle events lost on disconnect | Zero after reconnect |
| Reliability | Graceful shutdown time | <6s under normal conditions |
| Maintainability | Largest service file | <200 lines |
| Maintainability | Integration tests passing | 100% (currently 0%) |
| Performance | getBuilds query count | 2 regardless of session count |
| Performance | Dashboard initial load (500 sessions) | <800ms |
| Observability | OTel metrics emitted per orphan sweep | `xenon.sessions.orphaned` counter visible in OTLP receiver |
| Observability | Health endpoint component count | ≥5 components reported |
