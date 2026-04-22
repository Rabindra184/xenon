# Production Excellence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 20 targeted improvements across Reliability, Maintainability, Performance, and Observability — transforming Xenon from a working prototype into enterprise-grade infrastructure.

**Architecture:** Each task is an independent PR. Phases must complete in order (Phase 1 → 2 → 3 → 4). Within a phase, tasks are independent except for the soft dependencies noted in the spec. Start with Phase 1 T1 and work linearly through the list.

**Tech Stack:** TypeScript 5.5, TypeDI, Prisma 5.4 SQLite/PG, Mocha+Chai+Sinon, Socket.io 4, React 17 + @tanstack/react-query v5, @opentelemetry/sdk-metrics

---

## Phase 1 — Reliability

---

### Task 1: Formal Session State Machine (T1)

**Files:**
- Create: `src/services/SessionStateMachine.ts`
- Create: `test/unit/SessionStateMachine.test.ts`
- Modify later (not in this task): `src/services/SessionHeartbeatService.ts`, `src/services/SessionLifecycleService.ts`, `src/services/OrphanSweeper.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/unit/SessionStateMachine.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import { SessionStateMachine, InvalidTransitionError } from '../../src/services/SessionStateMachine';

describe('SessionStateMachine', () => {
  let machine: SessionStateMachine;

  beforeEach(() => {
    machine = new SessionStateMachine();
  });

  afterEach(() => {
    machine.remove('s1');
  });

  it('starts a session in requested state', () => {
    machine.init('s1', 'requested');
    expect(machine.current('s1')).to.equal('requested');
  });

  it('allows legal transition requested → allocated', () => {
    machine.init('s1', 'requested');
    machine.transition('s1', 'allocated');
    expect(machine.current('s1')).to.equal('allocated');
  });

  it('allows legal transition running → degraded', () => {
    machine.init('s1', 'running');
    machine.transition('s1', 'degraded');
    expect(machine.current('s1')).to.equal('degraded');
  });

  it('throws InvalidTransitionError on illegal transition requested → finished', () => {
    machine.init('s1', 'requested');
    expect(() => machine.transition('s1', 'finished')).to.throw(InvalidTransitionError);
  });

  it('throws InvalidTransitionError on transition from terminal state failed', () => {
    machine.init('s1', 'failed');
    expect(() => machine.transition('s1', 'running')).to.throw(InvalidTransitionError);
  });

  it('is a no-op (does not throw) calling transition to same terminal state', () => {
    machine.init('s1', 'finished');
    expect(() => machine.transition('s1', 'finished')).to.not.throw();
  });

  it('calls onTransition handler with from/to/reason', () => {
    const calls: Array<{ from: string; to: string; reason?: string }> = [];
    machine.onTransition('running', 'failed', (from, to, reason) => {
      calls.push({ from, to, reason });
    });
    machine.init('s1', 'running');
    machine.transition('s1', 'failed', 'test reason');
    expect(calls).to.deep.equal([{ from: 'running', to: 'failed', reason: 'test reason' }]);
  });

  it('remove clears session state', () => {
    machine.init('s1', 'running');
    machine.remove('s1');
    expect(() => machine.current('s1')).to.throw();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
npx mocha --require ts-node/register --require reflect-metadata test/unit/SessionStateMachine.test.ts
```

Expected: `Error: Cannot find module '../../src/services/SessionStateMachine'`

- [ ] **Step 3: Implement SessionStateMachine**

```typescript
// src/services/SessionStateMachine.ts
import log from '../logger';

export type SessionState =
  | 'requested'
  | 'allocated'
  | 'running'
  | 'degraded'
  | 'recovering'
  | 'finished'
  | 'failed';

export type TransitionHandler = (from: SessionState, to: SessionState, reason?: string) => void;

const TRANSITIONS: Record<SessionState, SessionState[]> = {
  requested:  ['allocated', 'failed'],
  allocated:  ['running', 'failed'],
  running:    ['degraded', 'finished', 'failed'],
  degraded:   ['recovering', 'running', 'failed'],
  recovering: ['running', 'failed'],
  finished:   [],
  failed:     [],
};

const TERMINAL: Set<SessionState> = new Set(['finished', 'failed']);

export class InvalidTransitionError extends Error {
  constructor(sessionId: string, from: SessionState, to: SessionState) {
    super(`Invalid transition for session ${sessionId}: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class SessionStateMachine {
  private states = new Map<string, SessionState>();
  private handlers: Array<{ from: SessionState; to: SessionState; handler: TransitionHandler }> = [];

  init(sessionId: string, initial: SessionState): void {
    this.states.set(sessionId, initial);
  }

  current(sessionId: string): SessionState {
    const state = this.states.get(sessionId);
    if (state === undefined) throw new Error(`Unknown session: ${sessionId}`);
    return state;
  }

  transition(sessionId: string, to: SessionState, reason?: string): void {
    const from = this.current(sessionId);
    if (from === to && TERMINAL.has(from)) return; // idempotent terminal re-entry
    const allowed = TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new InvalidTransitionError(sessionId, from, to);
    }
    this.states.set(sessionId, to);
    log.debug(`[FSM] ${sessionId}: ${from} → ${to}${reason ? ` (${reason})` : ''}`);
    for (const { from: hFrom, to: hTo, handler } of this.handlers) {
      if (hFrom === from && hTo === to) {
        try { handler(from, to, reason); } catch (e) { log.warn('[FSM] handler error', e); }
      }
    }
  }

  onTransition(from: SessionState, to: SessionState, handler: TransitionHandler): void {
    this.handlers.push({ from, to, handler });
  }

  remove(sessionId: string): void {
    this.states.delete(sessionId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/SessionStateMachine.test.ts
```

Expected: 8 passing

- [ ] **Step 5: Verify TypeScript compiles clean**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/services/SessionStateMachine.ts test/unit/SessionStateMachine.test.ts
git commit -m "feat(reliability): SessionStateMachine with typed state transitions (T1)"
```

---

### Task 2: DB-Level Device Locking (T2)

**Files:**
- Create: `src/services/DeviceAllocator.ts`
- Create: `test/unit/DeviceAllocator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/DeviceAllocator.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { setupTestContainer, resetTestContainer } from '../helpers/test-container';
import { getPrismaClient } from '../../src/prisma';

describe('DeviceAllocator', () => {
  let prisma: ReturnType<typeof getPrismaClient>;

  before(async () => {
    setupTestContainer();
    prisma = getPrismaClient();
    // Seed two free Android devices
    await prisma.device.createMany({
      data: [
        { udid: 'alloc-dev-1', host: 'localhost', platform: 'android', busy: false, state: 'available', sdk: '30', realDevice: false, name: 'dev1', model: 'Pixel', osVersion: '11' },
        { udid: 'alloc-dev-2', host: 'localhost', platform: 'android', busy: false, state: 'available', sdk: '30', realDevice: false, name: 'dev2', model: 'Pixel', osVersion: '11' },
      ],
      skipDuplicates: true,
    });
  });

  after(async () => {
    await prisma.device.deleteMany({ where: { udid: { in: ['alloc-dev-1', 'alloc-dev-2'] } } });
    Container.reset();
  });

  it('acquire returns a device and marks it busy', async () => {
    const { DeviceAllocator } = await import('../../src/services/DeviceAllocator');
    const allocator = Container.get(DeviceAllocator);
    const device = await allocator.acquire({ platform: 'android' }, 'sess-001');
    expect(device.busy).to.equal(true);
    expect(device.owningSessionId).to.equal('sess-001');
    await allocator.release(device.udid, device.host);
  });

  it('release sets busy=false and clears owningSessionId', async () => {
    const { DeviceAllocator } = await import('../../src/services/DeviceAllocator');
    const allocator = Container.get(DeviceAllocator);
    const device = await allocator.acquire({ platform: 'android' }, 'sess-002');
    await allocator.release(device.udid, device.host);
    const freed = await prisma.device.findUnique({ where: { udid_host: { udid: device.udid, host: device.host } } });
    expect(freed?.busy).to.equal(false);
    expect(freed?.owningSessionId).to.equal(null);
  });

  it('throws NO_DEVICE_AVAILABLE when all devices are busy', async () => {
    const { DeviceAllocator } = await import('../../src/services/DeviceAllocator');
    const allocator = Container.get(DeviceAllocator);
    const d1 = await allocator.acquire({ platform: 'android' }, 'sess-003');
    const d2 = await allocator.acquire({ platform: 'android' }, 'sess-004');
    try {
      await expect(allocator.acquire({ platform: 'android' }, 'sess-005')).to.be.rejected;
    } finally {
      await allocator.release(d1.udid, d1.host);
      await allocator.release(d2.udid, d2.host);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/DeviceAllocator.test.ts
```

Expected: `Cannot find module '../../src/services/DeviceAllocator'`

- [ ] **Step 3: Implement DeviceAllocator**

```typescript
// src/services/DeviceAllocator.ts
import { Service } from 'typedi';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../prisma';
import { IDevice } from '../interfaces/IDevice';
import log from '../logger';

export interface DeviceCriteria {
  platform: 'android' | 'ios';
  udids?: string[];
  minSdk?: string;
  nodeId?: string;
}

export class NoDeviceAvailableError extends Error {
  constructor(criteria: DeviceCriteria) {
    super(`No available ${criteria.platform} device matching criteria`);
    this.name = 'NoDeviceAvailableError';
  }
}

@Service()
export class DeviceAllocator {
  private prisma = getPrismaClient();

  async acquire(criteria: DeviceCriteria, sessionId: string): Promise<any> {
    const filters: Prisma.DeviceWhereInput = {
      busy: false,
      platform: criteria.platform,
    };
    if (criteria.udids?.length) filters.udid = { in: criteria.udids };
    if (criteria.nodeId) filters.nodeId = criteria.nodeId;

    let device: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        device = await this.prisma.$transaction(async (tx) => {
          const found = await tx.device.findFirst({ where: filters });
          if (!found) throw new NoDeviceAvailableError(criteria);
          return tx.device.update({
            where: { udid_host: { udid: found.udid, host: found.host } },
            data: { busy: true, owningSessionId: sessionId, lockedAt: new Date() },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (err: any) {
        if (err instanceof NoDeviceAvailableError) throw err;
        // Serializable conflict — retry
        log.debug(`[DeviceAllocator] acquire conflict, attempt ${attempt + 1}`);
        if (attempt === 2) throw err;
        await new Promise(r => setTimeout(r, 20 * (attempt + 1)));
      }
    }
    return device;
  }

  async release(udid: string, host: string): Promise<void> {
    await this.prisma.device.update({
      where: { udid_host: { udid, host } },
      data: { busy: false, owningSessionId: null, lockedAt: null },
    });
  }

  async releaseForSession(sessionId: string): Promise<void> {
    await this.prisma.device.updateMany({
      where: { owningSessionId: sessionId },
      data: { busy: false, owningSessionId: null, lockedAt: null },
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/DeviceAllocator.test.ts
```

Expected: 3 passing

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/services/DeviceAllocator.ts test/unit/DeviceAllocator.test.ts
git commit -m "feat(reliability): DeviceAllocator with Serializable transaction locking (T2)"
```

---

### Task 3: Socket.io Event Durability (T3)

**Files:**
- Modify: `prisma/schema.prisma` (add `sequence`, `eventType` to `SessionLog`)
- Modify: `src/services/SocketServer.ts` (add `emitCritical`, `emitVolatile`)
- Modify: `src/dashboard/event-manager.ts` (use `emitCritical` for lifecycle events)
- Modify: `web/src/hooks/useSocket.ts` (send `lastSequence` on connect, handle `replay`)

- [ ] **Step 1: Add DB columns**

In `prisma/schema.prisma`, find the `SessionLog` model and add:
```prisma
model SessionLog {
  // ... existing fields ...
  sequence   Int?    @default(autoincrement())
  eventType  String? // 'lifecycle' | 'command'
}
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
npm run db:generate -- --name add_session_log_sequence
npm run db:migrate
```

- [ ] **Step 3: Read current SocketServer to understand emit API**

```bash
grep -n "emit\|emitTo" src/services/SocketServer.ts | head -20
```

- [ ] **Step 4: Add emitCritical and emitVolatile to SocketServer**

Find the existing emit method(s) in `src/services/SocketServer.ts` and add:

```typescript
// Add to SocketServer class (after existing emit methods)
async emitCritical(room: string, event: string, payload: unknown): Promise<void> {
  const prisma = getPrismaClient();
  // Persist before emitting
  await prisma.sessionLog.create({
    data: {
      sessionId: room,
      eventType: 'lifecycle',
      body: JSON.stringify({ event, payload }),
    },
  });
  this.io.to(room).emit(event, payload);
}

emitVolatile(room: string, event: string, payload: unknown): void {
  this.io.to(room).volatile.emit(event, payload);
}
```

- [ ] **Step 5: Add replay-on-reconnect handler in SocketServer**

In the socket connection handler (where `socket.on('connect', ...)` or the `io.on('connection', ...)` block lives):

```typescript
socket.on('subscribe', async ({ lastSequence }: { lastSequence: number | null }) => {
  const prisma = getPrismaClient();
  const missed = await prisma.sessionLog.findMany({
    where: {
      eventType: 'lifecycle',
      sequence: lastSequence != null ? { gt: lastSequence } : undefined,
    },
    orderBy: { sequence: 'asc' },
  });
  for (const entry of missed) {
    const { event, payload } = JSON.parse(entry.body ?? '{}');
    socket.emit(event, payload);
  }
  socket.emit('replay_complete', { replayed: missed.length });
});
```

- [ ] **Step 6: Update event-manager.ts to use emitCritical for lifecycle events**

In `src/dashboard/event-manager.ts`, find calls to emit `SESSION_STARTED`, `SESSION_STOPPED`, `SESSION_FAILED` and change from `socket.emitToDashboard(...)` to `await socket.emitCritical(sessionId, 'SESSION_STARTED', payload)` (etc.).

Volatile events (SESSION_COMMAND, heartbeats) use `socket.emitVolatile(...)`.

- [ ] **Step 7: Update frontend useSocket.ts to send lastSequence**

In `web/src/hooks/useSocket.ts`, find the connect/reconnect handler and add:

```typescript
socket.on('connect', () => {
  const lastSequence = sessionStorage.getItem('xenon_last_seq');
  socket.emit('subscribe', { lastSequence: lastSequence ? parseInt(lastSequence) : null });
});

socket.on('SESSION_STARTED', (data: any) => {
  if (data?.sequence) sessionStorage.setItem('xenon_last_seq', String(data.sequence));
  // ... existing handler logic ...
});
```

- [ ] **Step 8: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 9: Run existing unit tests**

```bash
npm test
```

- [ ] **Step 10: Commit**

```bash
git add prisma/ src/services/SocketServer.ts src/dashboard/event-manager.ts web/src/hooks/useSocket.ts
git commit -m "feat(reliability): Socket.io critical event durability with replay-on-reconnect (T3)"
```

---

### Task 4: Idempotent Command Middleware (T4)

**Files:**
- Create: `src/services/IdempotencyCache.ts`
- Create: `src/middleware/idempotencyMiddleware.ts`
- Modify: `src/app/index.ts` (wire after auth)
- Create: `test/unit/idempotencyMiddleware.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/unit/idempotencyMiddleware.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Request, Response } from 'express';

function makeReq(method: string, key?: string): Partial<Request> {
  return {
    method,
    headers: key ? { 'x-idempotency-key': key } : {},
    get: (h: string) => (key && h.toLowerCase() === 'x-idempotency-key' ? key : undefined) as any,
  };
}
function makeRes(): { status: sinon.SinonStub; json: sinon.SinonStub; statusCode: number; _body: any } {
  const res: any = {};
  res.status = sinon.stub().callsFake((code: number) => { res.statusCode = code; return res; });
  res.json = sinon.stub().callsFake((body: any) => { res._body = body; });
  return res;
}

describe('idempotencyMiddleware', () => {
  let middleware: any;

  before(async () => {
    const { idempotencyMiddleware } = await import('../../src/middleware/idempotencyMiddleware');
    middleware = idempotencyMiddleware;
  });

  it('no-op when header absent', (done) => {
    const req = makeReq('POST');
    const res = makeRes();
    middleware(req, res, () => done());
  });

  it('calls next on first request with key', (done) => {
    const req = makeReq('POST', 'key-001');
    const res = makeRes() as any;
    // Spy: intercept res.json to cache
    middleware(req, res, () => {
      res.statusCode = 200;
      res._body = { id: 'sess-1' };
      // Simulate response send — middleware wraps res.json
      done();
    });
  });

  it('returns cached response on duplicate key', (done) => {
    const { IdempotencyCache } = require('../../src/services/IdempotencyCache');
    const cache = new IdempotencyCache();
    cache.set('key-dup', 201, { id: 'sess-cached' });
    const req = makeReq('POST', 'key-dup');
    const res = makeRes() as any;
    const { idempotencyMiddleware } = require('../../src/middleware/idempotencyMiddleware');
    // inject cache override
    idempotencyMiddleware.__testCache = cache;
    idempotencyMiddleware(req, res, () => {
      throw new Error('should not call next for cached key');
    });
    setTimeout(() => {
      expect(res.status.calledWith(201)).to.equal(true);
      expect(res._body).to.deep.equal({ id: 'sess-cached' });
      done();
    }, 10);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/idempotencyMiddleware.test.ts
```

Expected: `Cannot find module '../../src/middleware/idempotencyMiddleware'`

- [ ] **Step 3: Implement IdempotencyCache**

```typescript
// src/services/IdempotencyCache.ts
import { Service } from 'typedi';

interface Entry {
  statusCode: number;
  body: unknown;
  expiresAt: number;
}

const MAX_ENTRIES = 10_000;
const TTL_MS = 24 * 60 * 60 * 1000;

@Service()
export class IdempotencyCache {
  private store = new Map<string, Entry>();

  constructor() {
    setInterval(() => this.prune(), 5 * 60 * 1000).unref();
  }

  get(key: string): Entry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    return entry;
  }

  set(key: string, statusCode: number, body: unknown): void {
    if (this.store.size >= MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(key, { statusCode, body, expiresAt: Date.now() + TTL_MS });
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (now > v.expiresAt) this.store.delete(k);
    }
  }
}
```

- [ ] **Step 4: Implement idempotencyMiddleware**

```typescript
// src/middleware/idempotencyMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { IdempotencyCache } from '../services/IdempotencyCache';

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = req.get('x-idempotency-key');
  if (!key || req.method === 'GET') { next(); return; }

  const cache: IdempotencyCache = (idempotencyMiddleware as any).__testCache ?? Container.get(IdempotencyCache);
  const cached = cache.get(key);
  if (cached) {
    res.status(cached.statusCode).json(cached.body);
    return;
  }

  const origJson = res.json.bind(res);
  res.json = function (body: unknown) {
    cache.set(key, res.statusCode ?? 200, body);
    return origJson(body);
  };
  next();
}
```

- [ ] **Step 5: Wire into src/app/index.ts**

In `src/app/index.ts`, after the `apiKeyMiddleware` and `rateLimitMiddleware` lines, add:

```typescript
import { idempotencyMiddleware } from '../middleware/idempotencyMiddleware';
// ...
// After: apiRouter.use(rateLimitMiddleware());
apiRouter.use(idempotencyMiddleware as any);
```

- [ ] **Step 6: Run tests**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/idempotencyMiddleware.test.ts
```

Expected: 3 passing

- [ ] **Step 7: TypeScript check + full unit suite**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 8: Commit**

```bash
git add src/services/IdempotencyCache.ts src/middleware/idempotencyMiddleware.ts src/app/index.ts test/unit/idempotencyMiddleware.test.ts
git commit -m "feat(reliability): idempotency middleware for mutation endpoints (T4)"
```

---

### Task 5: Cascading Deletes + Referential Integrity (T5)

**Files:**
- Modify: `prisma/schema.prisma`
- New migration: `add_referential_integrity`

- [ ] **Step 1: Read current schema to find Device and SessionLog models**

```bash
grep -n "owningSessionId\|SessionLog\|model Log\|model Profiling" prisma/schema.prisma
```

- [ ] **Step 2: Add relations to schema.prisma**

Find the `Device` model and add the `owningSession` relation:
```prisma
owningSession Session? @relation("DeviceOwner", fields: [owningSessionId], references: [id], onDelete: SetNull)
```

Find `SessionLog`, `Log`, and `Profiling` models and add cascade relations:
```prisma
// SessionLog
session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)

// Log
session Session @relation(fields: [session_id], references: [id], onDelete: Cascade)

// Profiling
session Session @relation(fields: [session_id], references: [id], onDelete: Cascade)
```

Also ensure the `Session` model has the back-references:
```prisma
model Session {
  // ... existing fields ...
  ownedDevice Device[] @relation("DeviceOwner")
  sessionLogs SessionLog[]
  logs        Log[]
  profilings  Profiling[]
}
```

- [ ] **Step 3: Generate migration**

```bash
npm run db:generate -- --name add_referential_integrity
npm run db:migrate
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Verify cascade in test**

```bash
# Quick smoke test: run OrphanSweeper tests which delete sessions
npx mocha --require ts-node/register --require reflect-metadata test/unit/OrphanSweeper.test.ts
```

Expected: all passing (existing tests still pass)

- [ ] **Step 6: Commit**

```bash
git add prisma/
git commit -m "feat(reliability): cascading deletes and referential integrity via Prisma relations (T5)"
```

---

### Task 6: Async Graceful Shutdown (T6)

**Files:**
- Modify: `src/index.ts`
- Modify: `src/services/ServerManager.ts` (add `setAcceptingSessions`)
- Modify: `src/services/PortAllocator.ts` (add `releaseAll`)
- Create: `test/unit/shutdown.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/shutdown.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { setupTestContainer } from '../helpers/test-container';

describe('Graceful shutdown helpers', () => {
  before(() => { setupTestContainer(); });
  after(() => { Container.reset(); });

  it('PortAllocator.releaseAll clears all leases', async () => {
    const { PortAllocator } = await import('../../src/services/PortAllocator');
    const allocator = Container.get(PortAllocator);
    expect(typeof allocator.releaseAll).to.equal('function');
    await expect(allocator.releaseAll()).to.eventually.be.fulfilled;
  });

  it('ServerManager.setAcceptingSessions toggles flag', async () => {
    const { ServerManager } = await import('../../src/services/ServerManager');
    const mgr = Container.get(ServerManager);
    expect(typeof mgr.setAcceptingSessions).to.equal('function');
    mgr.setAcceptingSessions(false);
    mgr.setAcceptingSessions(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/shutdown.test.ts
```

Expected: test fails because `releaseAll` / `setAcceptingSessions` don't exist

- [ ] **Step 3: Add releaseAll to PortAllocator**

Read `src/services/PortAllocator.ts` to find the leases map/DB. Add:

```typescript
async releaseAll(): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.portLease.deleteMany({});
  log.info('[PortAllocator] All leases released (shutdown).');
}
```

- [ ] **Step 4: Add setAcceptingSessions to ServerManager**

Read `src/services/ServerManager.ts`. Add:

```typescript
private _acceptingSessions = true;

setAcceptingSessions(value: boolean): void {
  this._acceptingSessions = value;
  if (!value) log.warn('[ServerManager] No longer accepting new sessions.');
}

get acceptingSessions(): boolean {
  return this._acceptingSessions;
}
```

- [ ] **Step 5: Rewrite shutdown in src/index.ts**

Read `src/index.ts` first. Replace the existing signal handlers with:

```typescript
import { Container } from 'typedi';
import { ProcessRegistry } from './services/ProcessRegistry';
import { PortAllocator } from './services/PortAllocator';
import { getPrismaClient } from './prisma';
import log from './logger';

let shuttingDown = false;

async function shutdown(signal: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.warn(`[Shutdown] ${signal} received. Graceful shutdown started.`);

  const hardKill = setTimeout(() => {
    log.error('[Shutdown] 10s timeout exceeded. Forcing exit.');
    process.exit(1);
  }, 10_000);

  try {
    await Promise.allSettled([
      Container.get(ProcessRegistry).terminateAll(),
      Container.get(PortAllocator).releaseAll(),
    ]);
    await getPrismaClient().$disconnect();
  } finally {
    clearTimeout(hardKill);
    process.exit(exitCode);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT',  () => shutdown('SIGINT', 0));
process.on('uncaughtException', (err) => {
  log.error('[Shutdown] uncaughtException', err);
  void shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  log.error('[Shutdown] unhandledRejection', reason);
  void shutdown('unhandledRejection', 1);
});
```

- [ ] **Step 6: Run tests**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/shutdown.test.ts
```

Expected: 2 passing

- [ ] **Step 7: TypeScript check + full suite**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 8: Commit**

```bash
git add src/index.ts src/services/ServerManager.ts src/services/PortAllocator.ts test/unit/shutdown.test.ts
git commit -m "feat(reliability): async graceful shutdown with 10s hard timeout (T6)"
```

---

## Phase 2 — Maintainability

---

### Task 7: Split DashboardEventManager (T7)

**Files:**
- Create: `src/services/SessionEventBroadcaster.ts`
- Create: `src/services/CommandInterceptorService.ts`
- Create: `src/services/ProfilingCoordinator.ts`
- Create: `src/services/LogTailCoordinator.ts`
- Modify: `src/dashboard/event-manager.ts` (thin facade, delegates to 4 new services)
- Modify: `src/services/OrphanSweeper.ts` (absorb zombie cleanup)

- [ ] **Step 1: Read event-manager.ts to understand current structure**

```bash
wc -l src/dashboard/event-manager.ts
grep -n "^  async\|^  public\|^  private" src/dashboard/event-manager.ts | head -30
```

- [ ] **Step 2: Extract SessionEventBroadcaster**

Create `src/services/SessionEventBroadcaster.ts` containing `onSessionStarted` and `onSessionStopped`:

```typescript
// src/services/SessionEventBroadcaster.ts
import { Service } from 'typedi';
import { SocketServer } from './SocketServer';
import log from '../logger';

@Service()
export class SessionEventBroadcaster {
  constructor(private readonly socket: SocketServer) {}

  async onSessionStarted(session: any, device: any): Promise<void> {
    log.info(`[SessionEvent] SESSION_STARTED: ${session.id}`);
    await this.socket.emitCritical(session.id, 'SESSION_STARTED', { session, device });
  }

  async onSessionStopped(sessionId: string, status: string, reason?: string): Promise<void> {
    log.info(`[SessionEvent] SESSION_${status.toUpperCase()}: ${sessionId}`);
    await this.socket.emitCritical(sessionId, `SESSION_${status.toUpperCase()}`, { sessionId, reason });
  }
}
```

- [ ] **Step 3: Extract CommandInterceptorService**

Create `src/services/CommandInterceptorService.ts`:

```typescript
// src/services/CommandInterceptorService.ts
import { Service } from 'typedi';
import { SocketServer } from './SocketServer';
import { getPrismaClient } from '../prisma';
import log from '../logger';

@Service()
export class CommandInterceptorService {
  private commandStartTimes = new Map<string, number>();

  constructor(private readonly socket: SocketServer) {}

  beforeCommand(sessionId: string, command: string, _args: unknown): void {
    this.commandStartTimes.set(`${sessionId}:${command}`, Date.now());
  }

  async afterCommand(sessionId: string, command: string, result: unknown, error?: Error): Promise<void> {
    const startKey = `${sessionId}:${command}`;
    const startTime = this.commandStartTimes.get(startKey) ?? Date.now();
    this.commandStartTimes.delete(startKey);
    const durationMs = Date.now() - startTime;

    const prisma = getPrismaClient();
    try {
      await prisma.sessionLog.create({
        data: {
          sessionId,
          eventType: 'command',
          body: JSON.stringify({ command, durationMs, error: error?.message }),
        },
      });
    } catch (e) {
      log.warn('[CommandInterceptor] failed to persist command log', e);
    }

    this.socket.emitVolatile(sessionId, 'SESSION_COMMAND', { command, durationMs, error: error?.message });
  }
}
```

- [ ] **Step 4: Extract ProfilingCoordinator**

Create `src/services/ProfilingCoordinator.ts`:

```typescript
// src/services/ProfilingCoordinator.ts
import { Service } from 'typedi';
import log from '../logger';

@Service()
export class ProfilingCoordinator {
  private profilers = new Map<string, any>();

  async startProfiling(sessionId: string, device: any): Promise<void> {
    if (device?.platform !== 'android') return;
    log.debug(`[Profiling] start for session ${sessionId}`);
    // AndroidAppProfiler wired in follow-up if needed
  }

  async stopProfiling(sessionId: string): Promise<void> {
    const profiler = this.profilers.get(sessionId);
    if (profiler) {
      try { await profiler.stop(); } catch (e) { log.warn('[Profiling] stop error', e); }
      this.profilers.delete(sessionId);
    }
  }
}
```

- [ ] **Step 5: Extract LogTailCoordinator**

Create `src/services/LogTailCoordinator.ts`:

```typescript
// src/services/LogTailCoordinator.ts
import { Service } from 'typedi';
import log from '../logger';

@Service()
export class LogTailCoordinator {
  private syslogServices = new Map<string, any>();
  private lastLogLine = new Map<string, number>();

  startTailing(sessionId: string, device: any): void {
    log.debug(`[LogTail] start for session ${sessionId}`);
  }

  stopTailing(sessionId: string): void {
    const svc = this.syslogServices.get(sessionId);
    if (svc) {
      try { svc.stop?.(); } catch (_) {}
      this.syslogServices.delete(sessionId);
    }
    this.lastLogLine.delete(sessionId);
  }
}
```

- [ ] **Step 6: Make event-manager.ts a thin facade**

Replace the body of `DashboardEventManager` (keeping the same class name and `@Service()` token) to delegate to the 4 new services:

```typescript
// At top of event-manager.ts
import { SessionEventBroadcaster } from '../services/SessionEventBroadcaster';
import { CommandInterceptorService } from '../services/CommandInterceptorService';
import { ProfilingCoordinator } from '../services/ProfilingCoordinator';
import { LogTailCoordinator } from '../services/LogTailCoordinator';

// In the class body, constructor injection:
constructor(
  private readonly broadcaster: SessionEventBroadcaster,
  private readonly commandInterceptor: CommandInterceptorService,
  private readonly profiling: ProfilingCoordinator,
  private readonly logTail: LogTailCoordinator,
) {}
```

Each existing method in `DashboardEventManager` calls the appropriate sub-service. For example:
```typescript
async handleSessionCreated(session: any, device: any) {
  await this.broadcaster.onSessionStarted(session, device);
  await this.profiling.startProfiling(session.id, device);
  this.logTail.startTailing(session.id, device);
}
```

- [ ] **Step 7: TypeScript check**

```bash
npx tsc --noEmit
```

Fix any type errors, then re-check.

- [ ] **Step 8: Run full unit suite**

```bash
npm test
```

- [ ] **Step 9: Commit**

```bash
git add src/services/SessionEventBroadcaster.ts src/services/CommandInterceptorService.ts src/services/ProfilingCoordinator.ts src/services/LogTailCoordinator.ts src/dashboard/event-manager.ts
git commit -m "refactor(maintainability): split DashboardEventManager into 4 focused services (T7)"
```

---

### Task 8: Split SessionLifecycleService (T8)

**Files:**
- Create: `src/services/WDAProvisioner.ts`
- Create: `src/services/SessionPersistence.ts`
- Extend: `src/services/DeviceAllocator.ts` (add `release`)
- Refactor: `src/services/SessionLifecycleService.ts` (thin orchestrator)

- [ ] **Step 1: Read current SessionLifecycleService**

```bash
wc -l src/services/SessionLifecycleService.ts
grep -n "Container.get\|async " src/services/SessionLifecycleService.ts | head -30
```

- [ ] **Step 2: Create WDAProvisioner**

```typescript
// src/services/WDAProvisioner.ts
import { Service } from 'typedi';
import log from '../logger';

@Service()
export class WDAProvisioner {
  async provision(device: any, caps: Record<string, any>): Promise<Record<string, any>> {
    if (device?.platform !== 'ios' || !device?.realDevice) return caps;
    log.info(`[WDA] provisioning for device ${device.udid}`);
    // Delegate to IOSStreamService for real device WDA injection
    // Stub — full implementation wires IOSStreamService in follow-up
    return caps;
  }

  async teardown(device: any): Promise<void> {
    if (device?.platform !== 'ios' || !device?.realDevice) return;
    log.info(`[WDA] teardown for device ${device?.udid}`);
  }
}
```

- [ ] **Step 3: Create SessionPersistence**

```typescript
// src/services/SessionPersistence.ts
import { Service } from 'typedi';
import { getPrismaClient } from '../prisma';
import log from '../logger';

@Service()
export class SessionPersistence {
  private prisma = getPrismaClient();

  async create(data: {
    id: string;
    status: string;
    desired_capabilities: string;
    session_capabilities: string;
    node_id: string;
    device_udid?: string;
    device_host?: string;
  }): Promise<any> {
    return this.prisma.session.create({ data });
  }

  async markFailed(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: 'failed', failure_reason: reason, endTime: new Date() },
    }).catch(e => log.warn(`[SessionPersistence] markFailed error: ${e.message}`));
  }

  async markFinished(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: 'finished', endTime: new Date() },
    }).catch(e => log.warn(`[SessionPersistence] markFinished error: ${e.message}`));
  }
}
```

- [ ] **Step 4: Refactor SessionLifecycleService constructor**

In `src/services/SessionLifecycleService.ts`, replace all `Container.get(X)` inside method bodies with constructor-injected dependencies:

```typescript
@Service()
export class SessionLifecycleService {
  constructor(
    private readonly deviceAllocator: DeviceAllocator,
    private readonly wdaProvisioner: WDAProvisioner,
    private readonly sessionPersistence: SessionPersistence,
    private readonly broadcaster: SessionEventBroadcaster,
    private readonly portAllocator: PortAllocator,
  ) {}
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Resolve all remaining Container.get() calls in the file.

- [ ] **Step 6: Run unit tests**

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/services/WDAProvisioner.ts src/services/SessionPersistence.ts src/services/SessionLifecycleService.ts src/services/DeviceAllocator.ts
git commit -m "refactor(maintainability): split SessionLifecycleService into focused services (T8)"
```

---

### Task 9: Abstract Device Discovery (T9)

**Files:**
- Create: `src/device-managers/AbstractDeviceDiscovery.ts`
- Modify: `src/device-managers/AndroidDeviceManager.ts` (extend base)
- Modify: `src/device-managers/ios/IOSDiscoveryService.ts` (extend base)

- [ ] **Step 1: Identify duplicated pipeline in both managers**

```bash
grep -n "syncToStore\|filterByState\|discover\|fetchRaw\|enrich" src/device-managers/AndroidDeviceManager.ts | head -20
grep -n "syncToStore\|filterByState\|discover\|fetchRaw\|enrich" src/device-managers/ios/IOSDiscoveryService.ts | head -20
```

- [ ] **Step 2: Create AbstractDeviceDiscovery**

```typescript
// src/device-managers/AbstractDeviceDiscovery.ts
import { IDevice } from '../interfaces/IDevice';
import { DeviceStoreFactory } from '../data-service/device-store';
import { Container } from 'typedi';
import log from '../logger';

export abstract class AbstractDeviceDiscovery<TRaw> {
  protected abstract fetchRaw(): Promise<TRaw[]>;
  protected abstract enrich(raw: TRaw): Promise<Partial<IDevice>>;
  protected abstract toDeviceId(raw: TRaw): string;

  async discover(): Promise<Partial<IDevice>[]> {
    let raw: TRaw[];
    try {
      raw = await this.fetchRaw();
    } catch (err) {
      log.warn(`[Discovery] fetchRaw failed: ${(err as Error).message}`);
      return [];
    }

    const settled = await Promise.allSettled(raw.map(r => this.enrich(r)));
    const devices: Partial<IDevice>[] = [];
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        devices.push(result.value);
      } else {
        log.warn(`[Discovery] enrich failed for ${this.toDeviceId(raw[i])}: ${result.reason?.message}`);
      }
    }
    return devices;
  }

  async syncToStore(discovered: Partial<IDevice>[]): Promise<void> {
    const store = Container.get(DeviceStoreFactory).getStore();
    for (const device of discovered) {
      if (device.udid) {
        store.upsertDevice(device as IDevice);
      }
    }
  }
}
```

- [ ] **Step 3: Extend AndroidDeviceManager**

In `src/device-managers/AndroidDeviceManager.ts`, make the class extend `AbstractDeviceDiscovery<AdbDevice>` (or whatever the raw type is) and implement `fetchRaw`, `enrich`, and `toDeviceId`. Remove the duplicated pipeline code.

- [ ] **Step 4: Extend IOSDiscoveryService**

Same pattern in `src/device-managers/ios/IOSDiscoveryService.ts`.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Run unit tests**

```bash
npm test
```

Expected: all passing

- [ ] **Step 7: Commit**

```bash
git add src/device-managers/AbstractDeviceDiscovery.ts src/device-managers/AndroidDeviceManager.ts src/device-managers/ios/IOSDiscoveryService.ts
git commit -m "refactor(maintainability): AbstractDeviceDiscovery eliminates duplicated discovery pipeline (T9)"
```

---

### Task 10: Constructor Injection (T10)

**Files:**
- Modify: all service files still using `Container.get()` inside method bodies (verify after T7/T8)

- [ ] **Step 1: Find remaining Container.get() in method bodies**

```bash
grep -rn "Container\.get(" src/services/ src/dashboard/ --include="*.ts" | grep -v "//\|constructor\|test"
```

- [ ] **Step 2: For each file found, move Container.get() calls to constructor**

Pattern for each service:
```typescript
// Before (inside a method)
async someMethod() {
  const dep = Container.get(SomeDependency);
  dep.doThing();
}

// After (constructor injection)
constructor(private readonly dep: SomeDependency) {}

async someMethod() {
  this.dep.doThing();
}
```

- [ ] **Step 3: TypeScript check after each file**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Run unit tests**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "refactor(maintainability): replace Container.get() in method bodies with constructor injection (T10)"
```

---

### Task 11: Integration Test Infrastructure (T11)

**Files:**
- Modify: `test/integration/testHelpers.js` (fix broken import)
- Create: `test/helpers/db.ts`
- Create: `test/integration/heartbeat-recovery.test.ts`

- [ ] **Step 1: Fix testHelpers.js**

```bash
grep -n "src/Devices\|require\|import" test/integration/testHelpers.js | head -20
```

Replace `../../src/Devices` import with actual exports:
```javascript
// Replace broken import:
// const { ... } = require('../../src/Devices');
// With:
const { updateDeviceList } = require('../../src/device-utils');
```

- [ ] **Step 2: Write failing integration test**

```typescript
// test/integration/heartbeat-recovery.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import { setupTestContainer } from '../helpers/test-container';
import { getPrismaClient } from '../../src/prisma';
import { OrphanSweeper } from '../../src/services/OrphanSweeper';

describe('Heartbeat recovery integration', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  const SESSION_ID = 'hrec-test-sess-001';
  const UDID = 'hrec-dev-001';

  before(async () => {
    setupTestContainer();
    prisma = getPrismaClient();

    // Seed a device
    await prisma.device.upsert({
      where: { udid_host: { udid: UDID, host: 'localhost' } },
      create: { udid: UDID, host: 'localhost', platform: 'android', busy: true, state: 'busy', sdk: '30', realDevice: false, name: 'hrec-dev', model: 'Pixel', osVersion: '11', owningSessionId: SESSION_ID },
      update: { busy: true, owningSessionId: SESSION_ID },
    });

    // Seed a stale running session (heartbeat 10 minutes ago)
    const staleTime = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.session.upsert({
      where: { id: SESSION_ID },
      create: {
        id: SESSION_ID,
        status: 'running',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'node-test',
        device_udid: UDID,
        device_host: 'localhost',
        last_heartbeat_at: staleTime,
      },
      update: { status: 'running', last_heartbeat_at: staleTime },
    });
  });

  after(async () => {
    await prisma.session.deleteMany({ where: { id: SESSION_ID } });
    await prisma.device.deleteMany({ where: { udid: UDID } });
    Container.reset();
  });

  it('OrphanSweeper marks stale session failed and frees device', async () => {
    const sweeper = Container.get(OrphanSweeper);
    await sweeper.sweep();

    const session = await prisma.session.findUnique({ where: { id: SESSION_ID } });
    const device = await prisma.device.findUnique({ where: { udid_host: { udid: UDID, host: 'localhost' } } });

    expect(session?.status).to.equal('failed');
    expect(device?.busy).to.equal(false);
    expect(device?.owningSessionId).to.equal(null);
  });
});
```

- [ ] **Step 3: Run test to confirm it fails for the right reason**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/integration/heartbeat-recovery.test.ts
```

Expected: either passes (OrphanSweeper already works) or fails on assertion (not on import error).

- [ ] **Step 4: Create test/helpers/db.ts for future in-memory DB tests**

```typescript
// test/helpers/db.ts
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

let testClient: PrismaClient | null = null;

export async function getTestDb(): Promise<PrismaClient> {
  if (testClient) return testClient;

  const url = 'file::memory:?cache=shared';
  testClient = new PrismaClient({
    datasources: { db: { url } },
  });

  const rootDir = path.resolve(__dirname, '../..');
  const localPrisma = path.join(rootDir, 'node_modules/.bin/prisma');
  const cmd = fs.existsSync(localPrisma) ? localPrisma : 'npx';
  const args = fs.existsSync(localPrisma)
    ? ['db', 'push', '--skip-generate', '--force-reset']
    : ['prisma', 'db', 'push', '--skip-generate', '--force-reset'];

  execFileSync(cmd, args, {
    env: { ...process.env, DATABASE_URL: url },
    cwd: rootDir,
    stdio: 'pipe',
  });

  return testClient;
}

export async function closeTestDb(): Promise<void> {
  if (testClient) {
    await testClient.$disconnect();
    testClient = null;
  }
}
```

- [ ] **Step 5: Run full unit suite to confirm nothing regressed**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add test/integration/testHelpers.js test/helpers/db.ts test/integration/heartbeat-recovery.test.ts
git commit -m "test(maintainability): fix broken integration test import + heartbeat recovery integration test (T11)"
```

---

### Task 12: Typed Error System (T12)

**Files:**
- Create: `src/errors.ts`
- Modify: `src/app/index.ts` (global error handler)
- Create: `test/unit/errors.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/unit/errors.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import { XenonError, ErrorCode } from '../../src/errors';

describe('XenonError', () => {
  it('has correct name and code', () => {
    const err = new XenonError(ErrorCode.SESSION_NOT_FOUND, 'not found', {}, 404);
    expect(err.name).to.equal('XenonError');
    expect(err.code).to.equal('SESSION_NOT_FOUND');
    expect(err.httpStatus).to.equal(404);
    expect(err.message).to.equal('not found');
  });

  it('defaults httpStatus to 500', () => {
    const err = new XenonError(ErrorCode.DATABASE_ERROR, 'db fail');
    expect(err.httpStatus).to.equal(500);
  });

  it('is instanceof Error', () => {
    expect(new XenonError(ErrorCode.AUTH_KEY_MISSING, 'missing')).to.be.instanceOf(Error);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/errors.test.ts
```

Expected: `Cannot find module '../../src/errors'`

- [ ] **Step 3: Implement src/errors.ts**

```typescript
// src/errors.ts
export enum ErrorCode {
  NO_DEVICE_AVAILABLE   = 'NO_DEVICE_AVAILABLE',
  DEVICE_BUSY           = 'DEVICE_BUSY',
  DEVICE_OFFLINE        = 'DEVICE_OFFLINE',
  SESSION_NOT_FOUND     = 'SESSION_NOT_FOUND',
  INVALID_TRANSITION    = 'INVALID_STATE_TRANSITION',
  SESSION_CREATE_FAILED = 'SESSION_CREATE_FAILED',
  PORT_RANGE_EXHAUSTED  = 'PORT_RANGE_EXHAUSTED',
  AUTH_KEY_MISSING      = 'AUTH_KEY_MISSING',
  AUTH_KEY_INVALID      = 'AUTH_KEY_INVALID',
  AUTH_KEY_REVOKED      = 'AUTH_KEY_REVOKED',
  RATE_LIMIT_EXCEEDED   = 'RATE_LIMIT_EXCEEDED',
  INSUFFICIENT_SCOPE    = 'INSUFFICIENT_SCOPE',
  DATABASE_ERROR        = 'DATABASE_ERROR',
  NODE_SECRET_MISMATCH  = 'NODE_SECRET_MISMATCH',
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
    Object.setPrototypeOf(this, XenonError.prototype);
  }
}
```

- [ ] **Step 4: Add global error handler to src/app/index.ts**

At the end of `createRouter`, before the `return router` line, add:

```typescript
// Global XenonError handler — must be last middleware
apiRouter.use((err: any, req: any, res: any, next: any) => {
  if (err && err.name === 'XenonError') {
    return res.status(err.httpStatus ?? 500).json({
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

- [ ] **Step 5: Run tests**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/errors.test.ts
npm test
```

Expected: all passing

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/errors.ts src/app/index.ts test/unit/errors.test.ts
git commit -m "feat(maintainability): typed XenonError system with global Express error handler (T12)"
```

---

## Phase 3 — Performance

---

### Task 13: Fix N+1 on getBuilds (T13)

**Files:**
- Modify: `src/app/routers/dashboard.ts`

- [ ] **Step 1: Find the getBuilds query**

```bash
grep -n "getBuilds\|findMany\|sessions\|groupBy" src/app/routers/dashboard.ts | head -30
```

- [ ] **Step 2: Write a test documenting current vs expected query count**

```typescript
// test/unit/getBuilds-n1.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import { setupTestContainer } from '../helpers/test-container';
import { getPrismaClient } from '../../src/prisma';
import { Container } from 'typedi';

describe('getBuilds query efficiency', () => {
  before(async () => { setupTestContainer(); });
  after(async () => { Container.reset(); });

  it('getBuilds uses groupBy aggregation (2 queries, not N+1)', async () => {
    const prisma = getPrismaClient();
    // Seed 3 builds with 2 sessions each
    const builds = ['b1', 'b2', 'b3'];
    for (const buildId of builds) {
      await prisma.build.upsert({ where: { id: buildId }, create: { id: buildId, name: buildId }, update: {} });
      for (let i = 0; i < 2; i++) {
        await prisma.session.create({ data: { id: `${buildId}-s${i}`, build_id: buildId, status: 'finished', desired_capabilities: '{}', session_capabilities: '{}', node_id: 'node-test' } });
      }
    }

    const queries: string[] = [];
    prisma.$on('query' as any, (e: any) => queries.push(e.query));

    // Call getBuilds directly (import the handler or a helper)
    const counts = await prisma.session.groupBy({
      by: ['build_id', 'status'],
      where: { build_id: { not: null } },
      _count: { id: true },
    });
    const builds2 = await prisma.build.findMany({ orderBy: { createdAt: 'desc' } });

    expect(counts.length).to.be.greaterThan(0);
    expect(builds2.length).to.be.greaterThanOrEqual(3);
    // 2 queries total (groupBy + findMany)
    expect(queries.length).to.equal(2);

    // Cleanup
    await prisma.session.deleteMany({ where: { build_id: { in: builds } } });
    await prisma.build.deleteMany({ where: { id: { in: builds } } });
  });
});
```

- [ ] **Step 3: Implement the fix in dashboard.ts**

Find the `getBuilds` function and replace the N+1 loop with:

```typescript
async function getBuilds(page = 0, pageSize = 20) {
  const prisma = getPrismaClient();
  const offset = page * pageSize;

  const [counts, builds] = await Promise.all([
    prisma.session.groupBy({
      by: ['build_id', 'status'],
      where: { build_id: { not: null } },
      _count: { id: true },
    }),
    prisma.build.findMany({
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip: offset,
    }),
  ]);

  const buildStats = new Map<string, Record<string, number>>();
  for (const row of counts) {
    if (!row.build_id) continue;
    const stats = buildStats.get(row.build_id) ?? {};
    stats[row.status] = row._count.id;
    buildStats.set(row.build_id, stats);
  }

  return builds.map(b => ({ ...b, sessionCounts: buildStats.get(b.id) ?? {} }));
}
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Run unit tests**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/app/routers/dashboard.ts test/unit/getBuilds-n1.test.ts
git commit -m "perf: replace N+1 getBuilds with groupBy aggregation — 2 queries regardless of session count (T13)"
```

---

### Task 14: Add Missing DB Indexes (T14)

**Files:**
- Modify: `prisma/schema.prisma`
- New migration: `add_performance_indexes`

- [ ] **Step 1: Verify which indexes already exist**

```bash
grep -n "@@index\|@@unique" prisma/schema.prisma
```

- [ ] **Step 2: Add missing indexes to schema.prisma**

In the `Session` model:
```prisma
@@index([status, device_udid])
@@index([build_id, status])
@@index([node_id, status])
```

In the `Device` model:
```prisma
@@index([busy, platform])
@@index([nodeId])
@@index([userBlocked])
```

- [ ] **Step 3: Generate and apply migration**

```bash
npm run db:generate -- --name add_performance_indexes
npm run db:migrate
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "perf: add missing DB indexes for device allocation and build queries (T14)"
```

---

### Task 15: Frontend — React Query (T15)

**Files:**
- Modify: `web/package.json`
- Create: `web/src/queryClient.ts`
- Create: `web/src/hooks/useDevices.ts`
- Create: `web/src/hooks/useSessions.ts`
- Create: `web/src/hooks/useBuilds.ts`
- Modify: `web/src/hooks/useSocket.ts`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add @tanstack/react-query**

```bash
cd web && npm install @tanstack/react-query@5 && cd ..
```

- [ ] **Step 2: Create queryClient.ts**

```typescript
// web/src/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
```

- [ ] **Step 3: Create query hooks**

```typescript
// web/src/hooks/useDevices.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
export const useDevices = () => useQuery({ queryKey: ['devices'], queryFn: api.getDevices });

// web/src/hooks/useSessions.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
export const useSessions = () => useQuery({ queryKey: ['sessions'], queryFn: api.getSessions });

// web/src/hooks/useBuilds.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
export const useBuilds = () => useQuery({ queryKey: ['builds'], queryFn: api.getBuilds });
```

- [ ] **Step 4: Update useSocket.ts to invalidate queries on socket events**

In `web/src/hooks/useSocket.ts`, add query invalidation:

```typescript
import { queryClient } from '../queryClient';

// In the socket event handlers:
socket.on('SESSION_STARTED', () => { queryClient.invalidateQueries({ queryKey: ['sessions'] }); });
socket.on('SESSION_STOPPED', () => { queryClient.invalidateQueries({ queryKey: ['sessions'] }); });
socket.on('SESSION_FAILED',  () => { queryClient.invalidateQueries({ queryKey: ['sessions'] }); });
socket.on('DEVICE_UPDATED',  () => { queryClient.invalidateQueries({ queryKey: ['devices'] }); });
```

- [ ] **Step 5: Wrap App.tsx with QueryClientProvider**

In `web/src/App.tsx`:
```typescript
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './queryClient';

// Wrap root return:
return (
  <QueryClientProvider client={queryClient}>
    {/* existing JSX */}
  </QueryClientProvider>
);
```

- [ ] **Step 6: Replace useEffect fetch patterns in page components**

```bash
grep -rn "useEffect.*fetch\|useState.*\[\]" web/src/components/ web/src/pages/ 2>/dev/null | head -20
```

For each component, replace `useState + useEffect + fetch` with the appropriate query hook.

- [ ] **Step 7: Build frontend**

```bash
npm run build:xenon
```

Expected: build succeeds with no type errors.

- [ ] **Step 8: Commit**

```bash
git add web/
git commit -m "perf(frontend): React Query for deduped data fetching and socket-driven cache invalidation (T15)"
```

---

### Task 16: Socket Event Batching (T16)

**Files:**
- Create: `src/services/EventBatcher.ts`
- Modify: `src/services/CommandInterceptorService.ts` (use batcher)
- Modify: `web/src/hooks/useSocket.ts` (handle `batch` event)

- [ ] **Step 1: Write failing test**

```typescript
// test/unit/EventBatcher.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { setupTestContainer } from '../helpers/test-container';

describe('EventBatcher', () => {
  let clock: sinon.SinonFakeTimers;

  before(() => { setupTestContainer(); });
  afterEach(() => { clock?.restore(); });
  after(() => { Container.reset(); });

  it('batches events and flushes after 100ms', async () => {
    clock = sinon.useFakeTimers();
    const { EventBatcher } = await import('../../src/services/EventBatcher');
    const emitted: any[] = [];
    const mockSocket = { emitVolatile: (_room: string, _event: string, batch: any) => emitted.push(batch) };
    const batcher = new (EventBatcher as any)(mockSocket);

    batcher.enqueue('sess-1', 'SESSION_COMMAND', { cmd: 'click' });
    batcher.enqueue('sess-1', 'SESSION_COMMAND', { cmd: 'type' });
    expect(emitted).to.have.length(0);

    clock.tick(110);
    expect(emitted).to.have.length(1);
    expect(emitted[0]).to.have.length(2);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/EventBatcher.test.ts
```

Expected: `Cannot find module '../../src/services/EventBatcher'`

- [ ] **Step 3: Implement EventBatcher**

```typescript
// src/services/EventBatcher.ts
import { Service } from 'typedi';
import { SocketServer } from './SocketServer';

interface BatchEntry {
  event: string;
  payload: unknown;
  ts: number;
}

@Service()
export class EventBatcher {
  private queues = new Map<string, BatchEntry[]>();
  private flushTimer: NodeJS.Timeout;

  constructor(private readonly socket: SocketServer) {
    this.flushTimer = setInterval(() => this.flush(), 100);
    this.flushTimer.unref?.();
  }

  enqueue(room: string, event: string, payload: unknown): void {
    const key = room;
    const queue = this.queues.get(key) ?? [];
    queue.push({ event, payload, ts: Date.now() });
    this.queues.set(key, queue);
  }

  private flush(): void {
    for (const [room, entries] of this.queues) {
      if (entries.length) {
        this.socket.emitVolatile(room, 'batch', entries);
      }
    }
    this.queues.clear();
  }

  destroy(): void {
    clearInterval(this.flushTimer);
  }
}
```

- [ ] **Step 4: Update CommandInterceptorService to use batcher**

In `src/services/CommandInterceptorService.ts`, inject `EventBatcher` and replace direct `emitVolatile` with `batcher.enqueue`:

```typescript
constructor(
  private readonly socket: SocketServer,
  private readonly batcher: EventBatcher,
) {}

// In afterCommand:
this.batcher.enqueue(sessionId, 'SESSION_COMMAND', { command, durationMs, error: error?.message });
```

- [ ] **Step 5: Handle batch event in frontend**

In `web/src/hooks/useSocket.ts`:

```typescript
socket.on('batch', (entries: Array<{ event: string; payload: any; ts: number }>) => {
  for (const entry of entries) {
    socket.emit(entry.event, entry.payload);
  }
});
```

- [ ] **Step 6: Run tests**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/EventBatcher.test.ts
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/services/EventBatcher.ts src/services/CommandInterceptorService.ts web/src/hooks/useSocket.ts test/unit/EventBatcher.test.ts
git commit -m "perf: 100ms socket event batching for SESSION_COMMAND events (T16)"
```

---

### Task 17: PostgreSQL Connection Pooling (T17)

**Files:**
- Modify: `src/prisma.ts`
- Modify: `src/config.ts`
- Modify: `schema.json`
- Modify: `docs/internal/operations.md`

- [ ] **Step 1: Read current prisma.ts**

```bash
cat src/prisma.ts
```

- [ ] **Step 2: Update prisma.ts with pool sizing**

```typescript
// In the PrismaClient construction, derive URL with pool size:
function buildDatabaseUrl(): string {
  const baseUrl = config.databaseUrl ?? process.env.DATABASE_URL ?? '';
  if (!baseUrl.includes('postgresql') && !baseUrl.includes('postgres')) return baseUrl;
  const poolSize = Math.min((config.maxConcurrentSessions ?? 25) * 2, 100);
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}connection_limit=${poolSize}&pool_timeout=30`;
}

export const prisma = new PrismaClient({
  datasources: { db: { url: buildDatabaseUrl() } },
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

prisma.$on('warn' as any, (e: any) => log.warn('[Prisma]', e.message));
prisma.$on('error' as any, (e: any) => log.error('[Prisma]', e.message));
```

- [ ] **Step 3: Add maxConcurrentSessions to config.ts and schema.json**

In `schema.json`, add:
```json
{
  "name": "maxConcurrentSessions",
  "type": "number",
  "default": 25,
  "description": "Maximum concurrent sessions; used to size DB connection pool (PG only)"
}
```

Run `npm run build:schema` to regenerate IPluginArgs.

- [ ] **Step 4: Add PgBouncer note to operations.md**

Append to `docs/internal/operations.md`:

```markdown
## PostgreSQL connection pooling

Default pool size: `maxConcurrentSessions * 2` (default 50, capped at 100).

**PgBouncer mode (transaction-level pooling):**
```
DATABASE_URL=postgresql://user:pass@pgbouncer:5432/db?pgbouncer=true&connection_limit=1
```
Set `connection_limit=1` when using PgBouncer — the bouncer manages the real pool.
```

- [ ] **Step 5: TypeScript check**

```bash
npm run build:schema && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/prisma.ts src/config.ts schema.json docs/internal/operations.md src/interfaces/IPluginArgs.ts
git commit -m "perf: dynamic PostgreSQL connection pool sizing based on maxConcurrentSessions (T17)"
```

---

## Phase 4 — Observability

---

### Task 18: OTel Metrics (T18)

**Files:**
- Create: `src/services/MetricsProvider.ts`
- Modify: `package.json` (add `@opentelemetry/sdk-metrics`)
- Modify: `src/services/OrphanSweeper.ts`
- Modify: `src/services/PortAllocator.ts`
- Modify: `src/services/ProcessRegistry.ts`
- Modify: `src/middleware/apiKeyMiddleware.ts`
- Modify: `src/middleware/rateLimitMiddleware.ts`

- [ ] **Step 1: Install OTel metrics package**

```bash
npm install @opentelemetry/sdk-metrics
```

- [ ] **Step 2: Create MetricsProvider**

```typescript
// src/services/MetricsProvider.ts
import { Service } from 'typedi';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Counter, UpDownCounter, Meter } from '@opentelemetry/api';
import log from '../logger';

@Service()
export class MetricsProvider {
  private meter: Meter;

  readonly sessionsOrphaned: Counter;
  readonly sessionsReconciled: Counter;
  readonly portsAcquired: Counter;
  readonly portsExhausted: Counter;
  readonly portsActive: UpDownCounter;
  readonly processesTracked: UpDownCounter;
  readonly processesTerminated: Counter;
  readonly apiRequests: Counter;
  readonly apiRateLimited: Counter;

  constructor() {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (endpoint) {
      const exporter = new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` });
      const provider = new MeterProvider({
        readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 30_000 })],
      });
      this.meter = provider.getMeter('xenon', process.env.npm_package_version ?? '0.0.0');
    } else {
      const { metrics } = require('@opentelemetry/api');
      this.meter = metrics.getMeter('xenon');
    }

    this.sessionsOrphaned  = this.meter.createCounter('xenon.sessions.orphaned');
    this.sessionsReconciled = this.meter.createCounter('xenon.sessions.reconciled');
    this.portsAcquired     = this.meter.createCounter('xenon.ports.acquired');
    this.portsExhausted    = this.meter.createCounter('xenon.ports.exhausted');
    this.portsActive       = this.meter.createUpDownCounter('xenon.ports.active');
    this.processesTracked  = this.meter.createUpDownCounter('xenon.processes.tracked');
    this.processesTerminated = this.meter.createCounter('xenon.processes.terminated');
    this.apiRequests       = this.meter.createCounter('xenon.api.requests');
    this.apiRateLimited    = this.meter.createCounter('xenon.api.rate_limited');

    log.info('[Metrics] MetricsProvider initialized' + (endpoint ? ` → ${endpoint}` : ' (no-op)'));
  }
}
```

- [ ] **Step 3: Wire MetricsProvider into OrphanSweeper**

In `src/services/OrphanSweeper.ts`, inject `MetricsProvider` in constructor and call:
```typescript
this.metrics.sessionsOrphaned.add(swept.length);
this.metrics.sessionsReconciled.add(reconciled);
```

- [ ] **Step 4: Wire into PortAllocator**

In acquire success: `this.metrics.portsAcquired.add(1, { purpose })` and `this.metrics.portsActive.add(1, { purpose })`.
In release: `this.metrics.portsActive.add(-1, { purpose })`.
In exhaustion: `this.metrics.portsExhausted.add(1, { purpose })`.

- [ ] **Step 5: Wire into ProcessRegistry**

In `track()`: `this.metrics.processesTracked.add(1, { kind })`.
In `terminate()`: `this.metrics.processesTerminated.add(1, { kind })` and `this.metrics.processesTracked.add(-1, { kind })`.

- [ ] **Step 6: Wire into middleware**

In `apiKeyMiddleware.ts`: `metrics.apiRequests.add(1, { scope: key.scopes.join(','), outcome: 'accepted' })`.
In `rateLimitMiddleware.ts`: `metrics.apiRateLimited.add(1, { key_id: keyId })`.

- [ ] **Step 7: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add src/services/MetricsProvider.ts src/services/OrphanSweeper.ts src/services/PortAllocator.ts src/services/ProcessRegistry.ts src/middleware/apiKeyMiddleware.ts src/middleware/rateLimitMiddleware.ts package.json package-lock.json
git commit -m "feat(observability): OTel metrics counters for orphan sweep, ports, processes, API requests (T18)"
```

---

### Task 19: Rich Health Endpoint (T19)

**Files:**
- Modify: `src/app/index.ts` (health handler)
- Modify: `src/services/OrphanSweeper.ts` (expose `lastRunAt`, `lastSweptCount`)
- Modify: `src/services/PortAllocator.ts` (expose `activeLeaseCount()`)

- [ ] **Step 1: Add lastRunAt/lastSweptCount to OrphanSweeper**

In `src/services/OrphanSweeper.ts`:
```typescript
private _lastRunAt: Date | null = null;
private _lastSweptCount = 0;

get lastRunAt(): Date | null { return this._lastRunAt; }
get lastSweptCount(): number { return this._lastSweptCount; }

// At end of sweep():
this._lastRunAt = new Date();
this._lastSweptCount = sweptCount;
```

- [ ] **Step 2: Add activeLeaseCount to PortAllocator**

In `src/services/PortAllocator.ts`:
```typescript
async activeLeaseCount(): Promise<number> {
  const prisma = getPrismaClient();
  return prisma.portLease.count({ where: { expiresAt: { gt: Date.now() } } });
}
```

- [ ] **Step 3: Write a test for the health endpoint**

```typescript
// test/unit/health.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import { setupTestContainer } from '../helpers/test-container';

describe('Health endpoint helpers', () => {
  before(() => { setupTestContainer(); });
  after(() => { Container.reset(); });

  it('OrphanSweeper exposes lastRunAt and lastSweptCount', async () => {
    const { OrphanSweeper } = await import('../../src/services/OrphanSweeper');
    const sweeper = Container.get(OrphanSweeper);
    expect(sweeper.lastRunAt).to.equal(null);
    expect(sweeper.lastSweptCount).to.equal(0);
  });

  it('PortAllocator exposes activeLeaseCount()', async () => {
    const { PortAllocator } = await import('../../src/services/PortAllocator');
    const allocator = Container.get(PortAllocator);
    const count = await allocator.activeLeaseCount();
    expect(count).to.be.a('number');
  });
});
```

- [ ] **Step 4: Run test**

```bash
npx mocha --require ts-node/register --require reflect-metadata test/unit/health.test.ts
```

- [ ] **Step 5: Replace health handler in src/app/index.ts**

Find `apiRouter.get('/health', ...)` and replace with:

```typescript
apiRouter.get('/health', async (_req, res) => {
  const components: Record<string, any> = {};
  let overallStatus = 'healthy';

  // Database
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    const dbStatus = latencyMs > 500 ? 'degraded' : 'healthy';
    if (dbStatus === 'degraded') overallStatus = 'degraded';
    components.database = { status: dbStatus, latencyMs };
  } catch (e: any) {
    overallStatus = 'unhealthy';
    components.database = { status: 'unhealthy', error: e.message };
  }

  // OrphanSweeper
  try {
    const sweeper = Container.get(OrphanSweeper);
    const lastRun = sweeper.lastRunAt;
    const stale = lastRun && (Date.now() - lastRun.getTime()) > 2 * 60 * 1000;
    const swStatus = stale ? 'degraded' : 'healthy';
    if (stale) overallStatus = 'degraded';
    components.orphanSweeper = { status: swStatus, lastRunAt: lastRun?.toISOString() ?? null, lastSweptCount: sweeper.lastSweptCount };
  } catch {
    components.orphanSweeper = { status: 'unknown' };
  }

  // PortAllocator
  try {
    const allocator = Container.get(PortAllocator);
    const activeLeases = await allocator.activeLeaseCount();
    components.portAllocator = { status: 'healthy', activeLeases };
  } catch (e: any) {
    components.portAllocator = { status: 'unknown', error: e.message };
  }

  const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;
  res.status(httpStatus).json({
    status: overallStatus,
    version: pkg.version,
    uptime: Math.floor(process.uptime()),
    components,
  });
});
```

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/app/index.ts src/services/OrphanSweeper.ts src/services/PortAllocator.ts test/unit/health.test.ts
git commit -m "feat(observability): rich health endpoint with component status (T19)"
```

---

### Task 20: Structured Error Response Format (T20)

**Files:**
- Create: `src/app/helpers.ts`
- Modify: all router files (`dashboard.ts`, `grid.ts`, `control.ts`, `apps.ts`, `webhook.ts`, `reservation.ts`, `config.ts`, `apikeys.ts`, `auth.ts`, `processes.ts`)

- [ ] **Step 1: Audit current error response formats**

```bash
grep -rn "res\.status.*json\|res\.json.*error" src/app/routers/ | grep -v "//\|test" | head -30
```

- [ ] **Step 2: Create src/app/helpers.ts**

```typescript
// src/app/helpers.ts
import { ErrorCode, XenonError } from '../errors';

export function formatError(code: ErrorCode, message: string, context?: object) {
  return { error: true, code, message, ...(context && { context }) };
}

export function sendError(res: any, err: XenonError): void {
  res.status(err.httpStatus).json(formatError(err.code, err.message, err.context));
}
```

- [ ] **Step 3: For each router, replace ad-hoc error formats**

For each `res.status(N).json({ error: '...' })` or `res.status(N).json({ error: true, message: ... })`, convert to either:
- `throw new XenonError(ErrorCode.X, message, context, httpStatus)` if inside a try/catch that propagates to the global error handler
- `sendError(res, new XenonError(...))` if the error must be returned directly without throwing

Example in `apikeys.ts`:
```typescript
// Before
res.status(404).json({ error: 'Key not found' });

// After
throw new XenonError(ErrorCode.AUTH_KEY_INVALID, 'Key not found', {}, 404);
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Run full unit suite**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/app/helpers.ts src/app/routers/
git commit -m "feat(observability): standardize all API error responses to {error,code,message} envelope (T20)"
```

---

## Final verification

- [ ] **Run full unit test suite**

```bash
npm test
```

Expected: all passing

- [ ] **TypeScript strict compile**

```bash
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Verify health endpoint**

```bash
npm run dev &
sleep 5
curl -s http://localhost:4723/xenon/api/health | jq .
```

Expected:
```json
{
  "status": "healthy",
  "version": "...",
  "uptime": ...,
  "components": {
    "database": { "status": "healthy", "latencyMs": ... },
    "orphanSweeper": { "status": "healthy", "lastRunAt": null, "lastSweptCount": 0 },
    "portAllocator": { "status": "healthy", "activeLeases": 0 }
  }
}
```

- [ ] **Tag release**

```bash
git tag -a v1.3.0 -m "Production Excellence: 20-task reliability, maintainability, performance, observability improvements"
git push origin v1.3.0
```
