# Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Xenon for 24/7 multi-team operation by fixing schema drift, orphaned sessions, port races, child-process leaks, and unauthenticated REST endpoints.

**Architecture:** Five bounded changes landing behind existing TypeDI services, existing cron framework, and Prisma migrations. No refactor outside what each fix requires. SQLite and Postgres both work end-to-end.

**Tech Stack:** TypeScript 5.5, Prisma 5.4 (SQLite + Postgres), TypeDI 0.10, Express 4, Socket.io 4, Mocha + Chai + Sinon.

**Spec:** `docs/superpowers/specs/2026-04-21-production-hardening-design.md`

---

## Pre-flight

Run once before starting:

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git checkout main
git pull
npm install
npm test   # baseline: note current pass/fail counts
```

---

## §1. Schema Integrity Guard

### Task 1: CI job — prisma migrate diff drift check

**Files:**
- Modify: `.github/workflows/npm-publish.yml` (add drift-check job before publish)
- Create: `.github/workflows/schema-drift-check.yml` (runs on every PR)

- [ ] **Step 1: Create the PR workflow**

Create `.github/workflows/schema-drift-check.yml`:

```yaml
name: Schema Drift Check

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Prisma migrate diff (migrations ↔ schema)
        env:
          DATABASE_URL: 'file:./ci-check.db'
        run: |
          npx prisma migrate diff \
            --from-migrations prisma/migrations \
            --to-schema-datamodel prisma/schema.prisma \
            --exit-code \
            && echo "Schema and migrations are in sync." \
            || (echo "::error::Schema drift detected. Run 'npm run db:generate -- --name <change>' to add a migration."; exit 1)
```

- [ ] **Step 2: Verify locally that the command works**

Run:
```bash
DATABASE_URL="file:/tmp/ci-check.db" npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
echo "exit=$?"
```
Expected: `exit=0` (schema is in sync after 1.1.28's db-push approach caught up).

- [ ] **Step 3: Force a drift to prove the check fails**

Temporarily add a field to `prisma/schema.prisma` Device model (`testField String?`), rerun the command. Expected: exit=2 with diff output. Revert the edit.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/schema-drift-check.yml
git commit -m "ci: add prisma schema-drift check workflow"
```

---

### Task 2: CI job — generated client freshness check

**Files:**
- Create: `scripts/check-client-freshness.js`
- Modify: `.github/workflows/schema-drift-check.yml` (add second step to same job)

- [ ] **Step 1: Write the freshness check script**

Create `scripts/check-client-freshness.js`:

```javascript
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const rootDir = path.resolve(__dirname, '..');
const committedIndex = path.join(rootDir, 'src/generated/client/index.d.ts');

if (!fs.existsSync(committedIndex)) {
  console.error('::error::src/generated/client/index.d.ts is missing. Run npm run build.');
  process.exit(1);
}

const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-gen-'));

try {
  execFileSync(
    path.join(rootDir, 'node_modules/.bin/prisma'),
    ['generate', '--schema', path.join(rootDir, 'prisma/schema.prisma')],
    {
      env: {
        ...process.env,
        PRISMA_CLIENT_OUTPUT: tmpOut,
        DATABASE_URL: 'file:/tmp/freshness.db',
      },
      stdio: 'pipe',
    },
  );
} catch (err) {
  console.error('::error::prisma generate failed:', err.stderr?.toString() || err.message);
  process.exit(1);
}

// Prisma writes to the output configured in schema.prisma; we instead compare the
// committed file to a freshly regenerated copy in src/generated/client after running
// the project's own generate script.
const committed = fs.readFileSync(committedIndex);
const committedHash = crypto.createHash('sha256').update(committed).digest('hex');

execFileSync(path.join(rootDir, 'node_modules/.bin/prisma'), ['generate'], {
  cwd: rootDir,
  env: { ...process.env, DATABASE_URL: 'file:/tmp/freshness.db' },
  stdio: 'pipe',
});

const regenerated = fs.readFileSync(committedIndex);
const regeneratedHash = crypto.createHash('sha256').update(regenerated).digest('hex');

if (committedHash !== regeneratedHash) {
  // Restore committed file so local dev isn't disturbed when run locally.
  fs.writeFileSync(committedIndex, committed);
  console.error(
    '::error::Generated Prisma client is stale. Run `npm run build` and commit src/generated/client.',
  );
  process.exit(1);
}

console.log('Generated client is fresh.');
```

- [ ] **Step 2: Verify locally**

```bash
node scripts/check-client-freshness.js
```
Expected: `Generated client is fresh.` exit 0.

- [ ] **Step 3: Add a CI step calling the script**

Append to `.github/workflows/schema-drift-check.yml` under the same `drift-check` job:

```yaml
      - name: Generated client freshness
        env:
          DATABASE_URL: 'file:./freshness.db'
        run: node scripts/check-client-freshness.js
```

- [ ] **Step 4: Commit**

```bash
git add scripts/check-client-freshness.js .github/workflows/schema-drift-check.yml
git commit -m "ci: add generated prisma client freshness check"
```

---

## §2. Session & Device Crash Recovery

### Task 3: Prisma migration — Session heartbeat columns

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260421080000_add_session_heartbeat_columns/migration.sql`

- [ ] **Step 1: Edit the Session model**

In `prisma/schema.prisma`, add three fields to `model Session` (after `trace_id`):

```prisma
  last_heartbeat_at       DateTime?
  heartbeat_pid           Int?
  heartbeat_host          String?
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260421080000_add_session_heartbeat_columns/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Session" ADD COLUMN "last_heartbeat_at" DATETIME;
ALTER TABLE "Session" ADD COLUMN "heartbeat_pid" INTEGER;
ALTER TABLE "Session" ADD COLUMN "heartbeat_host" TEXT;
CREATE INDEX "Session_status_last_heartbeat_at_idx" ON "Session"("status", "last_heartbeat_at");
```

- [ ] **Step 3: Regenerate client**

```bash
DATABASE_URL="file:/tmp/plan-check.db" npx prisma generate
npm run build
```
Expected: build succeeds. Verify `src/generated/client/index.d.ts` now shows `last_heartbeat_at?: Date | null` on Session.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260421080000_add_session_heartbeat_columns src/generated/client
git commit -m "feat(db): add Session heartbeat columns"
```

---

### Task 4: Prisma migration — Device lock columns

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260421080500_add_device_lock_columns/migration.sql`

- [ ] **Step 1: Edit the Device model**

In `prisma/schema.prisma`, add to `model Device` (after `cpuArchitecture`):

```prisma
  owning_session_id            String?
  locked_at                    Float?
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260421080500_add_device_lock_columns/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Device" ADD COLUMN "owning_session_id" TEXT;
ALTER TABLE "Device" ADD COLUMN "locked_at" REAL;
CREATE INDEX "Device_owning_session_id_idx" ON "Device"("owning_session_id");
```

- [ ] **Step 3: Regenerate and build**

```bash
DATABASE_URL="file:/tmp/plan-check.db" npx prisma generate
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260421080500_add_device_lock_columns src/generated/client
git commit -m "feat(db): add Device lock columns"
```

---

### Task 5: Heartbeat writer — extend SessionHeartbeatService

**Files:**
- Modify: `src/services/SessionHeartbeatService.ts`
- Create: `test/unit/SessionHeartbeatWrite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/SessionHeartbeatWrite.test.ts`:

```typescript
import { expect } from 'chai';
import sinon from 'sinon';
import { SessionHeartbeatService } from '../../src/services/SessionHeartbeatService';
import { prisma } from '../../src/prisma';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';

describe('SessionHeartbeatService write path', () => {
  let updateStub: sinon.SinonStub;

  beforeEach(() => {
    updateStub = sinon.stub(prisma.session, 'update').resolves({} as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('writes last_heartbeat_at, heartbeat_pid, heartbeat_host for each active session', async () => {
    const fakeSession = {
      getId: () => 'sess-1',
      isStopping: false,
      stoppedAt: undefined,
      checkHealth: async () => ({ isHealthy: true }),
      healthState: 'HEALTHY',
    };
    sinon.stub(SESSION_MANAGER, 'getAllSessions').returns([fakeSession] as any);

    const svc = new SessionHeartbeatService();
    await (svc as any).checkAllSessions();

    const call = updateStub.getCalls().find((c) => c.args[0].where.id === 'sess-1');
    expect(call, 'expected prisma.session.update call for sess-1').to.exist;
    expect(call!.args[0].data.last_heartbeat_at).to.be.instanceOf(Date);
    expect(call!.args[0].data.heartbeat_pid).to.equal(process.pid);
    expect(call!.args[0].data.heartbeat_host).to.be.a('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha --require ts-node/register test/unit/SessionHeartbeatWrite.test.ts
```
Expected: FAIL (current service doesn't call `prisma.session.update` in the health loop).

- [ ] **Step 3: Implement the write**

In `src/services/SessionHeartbeatService.ts`, add an import:

```typescript
import * as os from 'os';
```

Inside `checkAllSessions`, immediately after the `if (result.isHealthy)` branch and before `continue;`, insert:

```typescript
        // Heartbeat write (crash-recovery path)
        try {
          await prisma.session.update({
            where: { id: sessionId },
            data: {
              last_heartbeat_at: new Date(),
              heartbeat_pid: process.pid,
              heartbeat_host: os.hostname(),
            },
          });
        } catch (err: any) {
          this.log.debug(`Heartbeat write failed for ${sessionId}: ${err.message}`);
        }
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx mocha --require ts-node/register test/unit/SessionHeartbeatWrite.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/SessionHeartbeatService.ts test/unit/SessionHeartbeatWrite.test.ts
git commit -m "feat(session): write heartbeat fields to DB"
```

---

### Task 6: OrphanSweeper service + cron

**Files:**
- Create: `src/services/OrphanSweeper.ts`
- Create: `test/unit/OrphanSweeper.test.ts`
- Modify: `src/device-utils.ts` (add `setupCronSweepOrphanSessions`)
- Modify: `src/services/ServerManager.ts` (wire cron)

- [ ] **Step 1: Write the failing test**

Create `test/unit/OrphanSweeper.test.ts`:

```typescript
import { expect } from 'chai';
import sinon from 'sinon';
import { OrphanSweeper } from '../../src/services/OrphanSweeper';
import { prisma } from '../../src/prisma';

describe('OrphanSweeper', () => {
  afterEach(() => sinon.restore());

  it('marks sessions stale beyond threshold as failed and releases their devices', async () => {
    const now = Date.now();
    const stale = new Date(now - 200_000); // well past 3 * 30s

    const findStub = sinon.stub(prisma.session, 'findMany').resolves([
      { id: 'sess-stale', device_udid: 'udid-1', node_id: 'node-a' } as any,
    ]);
    const updateSession = sinon.stub(prisma.session, 'update').resolves({} as any);
    const updateDevice = sinon.stub(prisma.device, 'updateMany').resolves({ count: 1 } as any);

    const sweeper = new OrphanSweeper();
    await sweeper.sweep({ heartbeatIntervalMs: 30_000 });

    expect(findStub.calledOnce).to.be.true;
    expect(updateSession.calledOnce).to.be.true;
    expect(updateSession.firstCall.args[0].data.status).to.equal('failed');
    expect(updateSession.firstCall.args[0].data.failure_reason).to.match(/heartbeat timeout/i);
    expect(updateDevice.calledOnce).to.be.true;
    expect(updateDevice.firstCall.args[0].where.udid).to.equal('udid-1');
    expect(updateDevice.firstCall.args[0].data.busy).to.equal(false);
    expect(updateDevice.firstCall.args[0].data.owning_session_id).to.equal(null);
  });

  it('leaves fresh sessions alone', async () => {
    sinon.stub(prisma.session, 'findMany').resolves([]);
    const updateSession = sinon.stub(prisma.session, 'update');
    const sweeper = new OrphanSweeper();
    await sweeper.sweep({ heartbeatIntervalMs: 30_000 });
    expect(updateSession.notCalled).to.be.true;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha --require ts-node/register test/unit/OrphanSweeper.test.ts
```
Expected: FAIL (`OrphanSweeper` does not exist).

- [ ] **Step 3: Implement the service**

Create `src/services/OrphanSweeper.ts`:

```typescript
import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { SessionStatus } from '../types/SessionStatus';

export interface SweepOptions {
  heartbeatIntervalMs: number;
  staleMultiplier?: number;
}

@Service()
export class OrphanSweeper {
  private log = log.scope('OrphanSweeper');

  async sweep({ heartbeatIntervalMs, staleMultiplier = 3 }: SweepOptions): Promise<void> {
    const cutoff = new Date(Date.now() - staleMultiplier * heartbeatIntervalMs);

    let stale: Array<{ id: string; device_udid: string; node_id: string }> = [];
    try {
      stale = (await prisma.session.findMany({
        where: {
          status: 'running',
          OR: [
            { last_heartbeat_at: { lt: cutoff } },
            { last_heartbeat_at: null, updatedAt: { lt: cutoff } },
          ],
        },
        select: { id: true, device_udid: true, node_id: true },
      })) as any;
    } catch (err: any) {
      this.log.error(`findMany failed: ${err.message}`);
      return;
    }

    if (stale.length === 0) return;

    this.log.info(`Sweeping ${stale.length} orphaned session(s)`);

    for (const s of stale) {
      try {
        await prisma.session.update({
          where: { id: s.id },
          data: {
            status: 'failed',
            failure_reason: 'Session heartbeat timeout',
            endTime: new Date(),
          },
        });

        await prisma.device.updateMany({
          where: { udid: s.device_udid },
          data: {
            busy: false,
            session_id: null,
            owning_session_id: null,
            locked_at: null,
          },
        });

        await DASHBORD_EVENT_MANAGER.onSessionStopped(
          s.id,
          SessionStatus.FAILED,
          'Session heartbeat timeout',
        );
      } catch (err: any) {
        this.log.error(`Failed to sweep session ${s.id}: ${err.message}`);
      }
    }
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx mocha --require ts-node/register test/unit/OrphanSweeper.test.ts
```
Expected: PASS (2 passing).

- [ ] **Step 5: Wire the cron**

In `src/device-utils.ts`, locate where other `setupCron*` helpers are exported (`setupCronCheckStaleDevices`, etc.) and add:

```typescript
import { Container } from 'typedi';
import { OrphanSweeper } from './services/OrphanSweeper';

export function setupCronSweepOrphanSessions(heartbeatIntervalMs: number) {
  const sweeper = Container.get(OrphanSweeper);
  const intervalMs = 30_000;
  log.info(`Orphan session sweep scheduled every ${intervalMs}ms`);
  setInterval(() => {
    sweeper.sweep({ heartbeatIntervalMs }).catch((err) => {
      log.error(`Orphan sweep crashed: ${err.message}`);
    });
  }, intervalMs);
}
```

Export it alongside the other helpers.

- [ ] **Step 6: Wire into ServerManager**

In `src/services/ServerManager.ts`, find `setupMaintenanceCrons` (or the equivalent cron-wiring method) and add:

```typescript
    setupCronSweepOrphanSessions(pluginArgs.sessionHeartbeatIntervalMs || 30_000);
```

Update the import line to include `setupCronSweepOrphanSessions`.

- [ ] **Step 7: Commit**

```bash
git add src/services/OrphanSweeper.ts src/device-utils.ts src/services/ServerManager.ts test/unit/OrphanSweeper.test.ts
git commit -m "feat(session): sweep orphaned sessions and release devices"
```

---

### Task 7: Startup reconciliation

**Files:**
- Modify: `src/services/ServerManager.ts`

- [ ] **Step 1: Add startup reconcile step**

In `src/services/ServerManager.ts` `updateServer()`, immediately after the `await sessionManager.recoverActiveSessions(...)` call, add:

```typescript
    // Reconcile orphans left by a previous PID on this host
    const sweeper = Container.get(OrphanSweeper);
    await sweeper.sweep({ heartbeatIntervalMs: pluginArgs.sessionHeartbeatIntervalMs || 30_000 });
```

Add the import:

```typescript
import { OrphanSweeper } from './OrphanSweeper';
```

- [ ] **Step 2: Build to verify no type errors**

```bash
npm run build 2>&1 | tail -10
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/services/ServerManager.ts
git commit -m "feat(session): reconcile orphans on startup"
```

---

## §3. Deterministic Port Allocation

### Task 8: Prisma migration — PortLease

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260421081000_add_port_lease_table/migration.sql`

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`, append after `LocatorEtalon`:

```prisma
model PortLease {
  port          Int      @id
  purpose       String
  leasedToUdid  String
  leasedToPid   Int?
  leasedAt      Float
  expiresAt     Float

  @@index([purpose, expiresAt])
  @@index([leasedToUdid])
}
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260421081000_add_port_lease_table/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "PortLease" (
    "port" INTEGER NOT NULL PRIMARY KEY,
    "purpose" TEXT NOT NULL,
    "leasedToUdid" TEXT NOT NULL,
    "leasedToPid" INTEGER,
    "leasedAt" REAL NOT NULL,
    "expiresAt" REAL NOT NULL
);

-- CreateIndex
CREATE INDEX "PortLease_purpose_expiresAt_idx" ON "PortLease"("purpose", "expiresAt");
CREATE INDEX "PortLease_leasedToUdid_idx" ON "PortLease"("leasedToUdid");
```

- [ ] **Step 3: Regenerate and build**

```bash
DATABASE_URL="file:/tmp/plan-check.db" npx prisma generate
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260421081000_add_port_lease_table src/generated/client
git commit -m "feat(db): add PortLease table"
```

---

### Task 9: PortAllocator service

**Files:**
- Create: `src/services/PortAllocator.ts`
- Create: `test/unit/PortAllocator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/PortAllocator.test.ts`:

```typescript
import { expect } from 'chai';
import sinon from 'sinon';
import { PortAllocator, PortPurpose } from '../../src/services/PortAllocator';
import { prisma } from '../../src/prisma';
import net from 'net';

describe('PortAllocator', () => {
  let createStub: sinon.SinonStub;
  let findManyStub: sinon.SinonStub;
  let deleteStub: sinon.SinonStub;

  beforeEach(() => {
    createStub = sinon.stub(prisma.portLease, 'create');
    findManyStub = sinon.stub(prisma.portLease, 'findMany').resolves([]);
    deleteStub = sinon.stub(prisma.portLease, 'delete').resolves({} as any);
    sinon.stub(prisma.portLease, 'deleteMany').resolves({ count: 0 } as any);
  });

  afterEach(() => sinon.restore());

  it('allocates first free port in the configured range', async () => {
    createStub.resolves({ port: 8100 } as any);
    const allocator = new PortAllocator({ wda: [8100, 8102] });
    const port = await allocator.acquire('wda' as PortPurpose, 'udid-1');
    expect(port).to.equal(8100);
    expect(createStub.firstCall.args[0].data.port).to.equal(8100);
    expect(createStub.firstCall.args[0].data.leasedToUdid).to.equal('udid-1');
  });

  it('retries next port on unique-constraint collision', async () => {
    const err: any = new Error('unique');
    err.code = 'P2002';
    createStub.onFirstCall().rejects(err);
    createStub.onSecondCall().resolves({ port: 8101 } as any);

    const allocator = new PortAllocator({ wda: [8100, 8105] });
    const port = await allocator.acquire('wda' as PortPurpose, 'udid-1');
    expect(port).to.equal(8101);
  });

  it('throws when range exhausted', async () => {
    findManyStub.resolves([{ port: 8100 }, { port: 8101 }, { port: 8102 }] as any);
    const allocator = new PortAllocator({ wda: [8100, 8102] });
    try {
      await allocator.acquire('wda' as PortPurpose, 'udid-1');
      expect.fail('expected throw');
    } catch (err: any) {
      expect(err.message).to.match(/exhausted/i);
    }
  });

  it('releases all ports for a UDID', async () => {
    const deleteMany = sinon.stub().resolves({ count: 2 });
    (prisma.portLease as any).deleteMany = deleteMany;
    const allocator = new PortAllocator({ wda: [8100, 8102] });
    await allocator.releaseForUdid('udid-1');
    expect(deleteMany.calledWith({ where: { leasedToUdid: 'udid-1' } })).to.be.true;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha --require ts-node/register test/unit/PortAllocator.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

Create `src/services/PortAllocator.ts`:

```typescript
import { Service } from 'typedi';
import net from 'net';
import { prisma } from '../prisma';
import log from '../logger';

export type PortPurpose = 'wda' | 'mjpeg' | 'system' | 'proxy';

export interface PortRanges {
  wda?: [number, number];
  mjpeg?: [number, number];
  system?: [number, number];
  proxy?: [number, number];
}

const DEFAULT_RANGES: Required<PortRanges> = {
  wda: [8100, 8199],
  mjpeg: [9100, 9199],
  system: [10100, 10199],
  proxy: [11100, 11199],
};

export class PortRangeExhaustedError extends Error {
  constructor(purpose: PortPurpose) {
    super(`Port range for purpose '${purpose}' is exhausted`);
    this.name = 'PortRangeExhaustedError';
  }
}

@Service()
export class PortAllocator {
  private log = log.scope('PortAllocator');
  private ranges: Required<PortRanges>;

  constructor(overrides: PortRanges = {}) {
    this.ranges = { ...DEFAULT_RANGES, ...overrides };
  }

  async acquire(
    purpose: PortPurpose,
    udid: string,
    opts: { pid?: number; ttlMs?: number } = {},
  ): Promise<number> {
    const [start, end] = this.ranges[purpose];
    const ttlMs = opts.ttlMs ?? 60 * 60 * 1000; // default 1h
    const now = Date.now();

    // Purge expired leases first (cheap cleanup)
    await prisma.portLease.deleteMany({ where: { expiresAt: { lt: now } } });

    const active = await prisma.portLease.findMany({
      where: { purpose, port: { gte: start, lte: end } },
      select: { port: true },
    });
    const taken = new Set(active.map((l) => l.port));

    for (let port = start; port <= end; port++) {
      if (taken.has(port)) continue;
      try {
        await prisma.portLease.create({
          data: {
            port,
            purpose,
            leasedToUdid: udid,
            leasedToPid: opts.pid,
            leasedAt: now,
            expiresAt: now + ttlMs,
          },
        });
      } catch (err: any) {
        // P2002 = unique constraint race; try next port
        if (err.code === 'P2002') continue;
        throw err;
      }

      // OS-level sanity check
      const osOk = await this.isOsFree(port);
      if (!osOk) {
        await prisma.portLease.delete({ where: { port } }).catch(() => undefined);
        continue;
      }
      this.log.debug(`Leased port ${port} (${purpose}) to ${udid}`);
      return port;
    }

    throw new PortRangeExhaustedError(purpose);
  }

  async release(port: number): Promise<void> {
    await prisma.portLease.delete({ where: { port } }).catch(() => undefined);
  }

  async releaseForUdid(udid: string): Promise<void> {
    await prisma.portLease.deleteMany({ where: { leasedToUdid: udid } });
  }

  async purgeExpired(): Promise<void> {
    await prisma.portLease.deleteMany({ where: { expiresAt: { lt: Date.now() } } });
  }

  private isOsFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx mocha --require ts-node/register test/unit/PortAllocator.test.ts
```
Expected: PASS (4 passing).

Note: the "retries next port" test may need a tweak for `isOsFree`; if it fails, stub `(allocator as any).isOsFree = async () => true;` inside the test before calling `acquire`.

- [ ] **Step 5: Commit**

```bash
git add src/services/PortAllocator.ts test/unit/PortAllocator.test.ts
git commit -m "feat(ports): deterministic DB-backed port allocator"
```

---

### Task 10: Wire PortAllocator into iOS flow

**Files:**
- Modify: `src/device-managers/ios/WDAClient.ts`
- Modify: `src/device-managers/ios/IOSDiscoveryService.ts`
- Modify: `src/device-managers/ios/IOSStreamService.ts`

- [ ] **Step 1: Identify existing getFreePort usages**

```bash
grep -n "getFreePort\|getPort(" src/device-managers/ios/*.ts
```
Note the list; the edits below cover the known ones. If your grep shows more, apply the same pattern.

- [ ] **Step 2: Replace in IOSDiscoveryService**

In `src/device-managers/ios/IOSDiscoveryService.ts`, find the block assigning `wdaLocalPort` and `mjpegServerPort` (around line 113 per the audit). Replace:

```typescript
        wdaLocalPort: await getFreePort(),
        mjpegServerPort: await getFreePort(),
```

with:

```typescript
        wdaLocalPort: await this.ports.acquire('wda', udid),
        mjpegServerPort: await this.ports.acquire('mjpeg', udid),
```

Inject the allocator:

```typescript
import { Container } from 'typedi';
import { PortAllocator } from '../../services/PortAllocator';
// inside the class:
private ports = Container.get(PortAllocator);
```

- [ ] **Step 3: Replace in WDAClient**

In `src/device-managers/ios/WDAClient.ts`, wherever `getFreePort()` allocates a WDA-bound port, swap for `Container.get(PortAllocator).acquire('wda', udid)`. Add the same imports.

- [ ] **Step 4: Replace in IOSStreamService**

In `src/device-managers/ios/IOSStreamService.ts`, swap MJPEG port allocation to `.acquire('mjpeg', udid)`.

- [ ] **Step 5: Release on session teardown**

In `src/services/SessionLifecycleService.ts` (look for `finishSession` or the deleteSession tail), add:

```typescript
    try {
      await Container.get(PortAllocator).releaseForUdid(session.getDeviceUdid());
    } catch (err: any) {
      log.warn(`Port release failed for ${session.getId()}: ${err.message}`);
    }
```

- [ ] **Step 6: Build + run full unit suite**

```bash
npm run build 2>&1 | tail -5
npm test 2>&1 | tail -20
```
Expected: build clean, no new test failures vs. baseline from Pre-flight.

- [ ] **Step 7: Commit**

```bash
git add src/device-managers/ios src/services/SessionLifecycleService.ts
git commit -m "feat(ports): route iOS flow through PortAllocator"
```

---

### Task 11: Wire PortAllocator into Android flow

**Files:**
- Modify: `src/device-managers/AndroidDeviceManager.ts`
- Modify: `src/device-managers/android/AndroidStreamService.ts`

- [ ] **Step 1: Replace in AndroidDeviceManager**

Grep for `getFreePort` in `src/device-managers/AndroidDeviceManager.ts`. Replace each call with the appropriate purpose:

- ADB-forward/system port → `acquire('system', udid)`
- MJPEG → `acquire('mjpeg', udid)`

Add the same imports as Task 10 Step 2.

- [ ] **Step 2: Replace in AndroidStreamService**

Swap MJPEG allocations.

- [ ] **Step 3: Build + test**

```bash
npm run build 2>&1 | tail -5
npm test 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/device-managers/AndroidDeviceManager.ts src/device-managers/android/AndroidStreamService.ts
git commit -m "feat(ports): route Android flow through PortAllocator"
```

---

## §4. Child-Process Lifecycle

### Task 12: ProcessRegistry service

**Files:**
- Create: `src/services/ProcessRegistry.ts`
- Create: `test/unit/ProcessRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/ProcessRegistry.test.ts`:

```typescript
import { expect } from 'chai';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';
import { EventEmitter } from 'events';

class FakeChild extends EventEmitter {
  pid: number;
  killed = false;
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  kill(signal: NodeJS.Signals) {
    this.killed = signal === 'SIGKILL' ? true : this.killed;
    return true;
  }
}

describe('ProcessRegistry', () => {
  it('tracks and untracks processes', () => {
    const reg = new ProcessRegistry();
    const child = new FakeChild(12345) as any;
    const id = reg.track({ kind: 'wda', udid: 'u1', process: child });
    expect(reg.snapshot()).to.have.length(1);
    reg.untrack(id);
    expect(reg.snapshot()).to.have.length(0);
  });

  it('sends SIGTERM then SIGKILL when a child ignores SIGTERM', async () => {
    const reg = new ProcessRegistry();
    const child = new FakeChild(12345);
    const sent: NodeJS.Signals[] = [];
    child.kill = (sig: NodeJS.Signals) => {
      sent.push(sig);
      return true;
    };
    const id = reg.track({ kind: 'wda', udid: 'u1', process: child as any });
    const p = reg.terminate(id, { gracefulMs: 50 });
    await p;
    expect(sent[0]).to.equal('SIGTERM');
    expect(sent[sent.length - 1]).to.equal('SIGKILL');
  });

  it('terminateForUdid kills only matching tracked processes', async () => {
    const reg = new ProcessRegistry();
    const a = new FakeChild(1);
    const b = new FakeChild(2);
    const signalsA: string[] = [];
    const signalsB: string[] = [];
    a.kill = (s) => {
      signalsA.push(s);
      a.emit('exit', 0);
      return true;
    };
    b.kill = (s) => {
      signalsB.push(s);
      return true;
    };
    reg.track({ kind: 'wda', udid: 'u1', process: a as any });
    reg.track({ kind: 'wda', udid: 'u2', process: b as any });
    await reg.terminateForUdid('u1', { gracefulMs: 10 });
    expect(signalsA.length).to.be.greaterThan(0);
    expect(signalsB.length).to.equal(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha --require ts-node/register test/unit/ProcessRegistry.test.ts
```
Expected: FAIL (not found).

- [ ] **Step 3: Implement**

Create `src/services/ProcessRegistry.ts`:

```typescript
import { Service } from 'typedi';
import { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import log from '../logger';

export type TrackedKind =
  | 'wda'
  | 'ffmpeg'
  | 'adb-reverse'
  | 'ios-mjpeg'
  | 'log-tailer'
  | 'other';

export interface TrackedProcess {
  id: string;
  sessionId?: string;
  udid?: string;
  kind: TrackedKind;
  pid: number;
  process: ChildProcess;
  startedAt: number;
}

export interface TerminateOptions {
  gracefulMs?: number;
}

@Service()
export class ProcessRegistry {
  private log = log.scope('ProcessRegistry');
  private processes = new Map<string, TrackedProcess>();

  track(opts: { sessionId?: string; udid?: string; kind: TrackedKind; process: ChildProcess }): string {
    const id = randomUUID();
    const entry: TrackedProcess = {
      id,
      sessionId: opts.sessionId,
      udid: opts.udid,
      kind: opts.kind,
      pid: opts.process.pid || -1,
      process: opts.process,
      startedAt: Date.now(),
    };
    this.processes.set(id, entry);
    opts.process.once('exit', () => this.processes.delete(id));
    return id;
  }

  untrack(id: string): void {
    this.processes.delete(id);
  }

  snapshot(): TrackedProcess[] {
    return Array.from(this.processes.values());
  }

  async terminate(id: string, { gracefulMs = 5000 }: TerminateOptions = {}): Promise<void> {
    const entry = this.processes.get(id);
    if (!entry) return;
    const { process: child, pid, kind } = entry;

    const exited = new Promise<void>((resolve) => {
      const onExit = () => resolve();
      child.once('exit', onExit);
    });

    try {
      if (process.platform === 'win32') {
        child.kill('SIGTERM');
      } else {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      }
    } catch (err: any) {
      this.log.debug(`SIGTERM failed for ${kind}/${pid}: ${err.message}`);
    }

    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(true), gracefulMs)),
    ]);

    if (timedOut) {
      try {
        if (process.platform === 'win32') {
          child.kill('SIGKILL');
        } else {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      } catch (err: any) {
        this.log.warn(`SIGKILL failed for ${kind}/${pid}: ${err.message}`);
      }
    }

    this.processes.delete(id);
  }

  async terminateForSession(sessionId: string, opts?: TerminateOptions): Promise<void> {
    const targets = this.snapshot().filter((p) => p.sessionId === sessionId);
    await Promise.all(targets.map((t) => this.terminate(t.id, opts)));
  }

  async terminateForUdid(udid: string, opts?: TerminateOptions): Promise<void> {
    const targets = this.snapshot().filter((p) => p.udid === udid);
    await Promise.all(targets.map((t) => this.terminate(t.id, opts)));
  }

  async terminateAll(opts?: TerminateOptions): Promise<void> {
    const targets = this.snapshot();
    await Promise.all(targets.map((t) => this.terminate(t.id, opts)));
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx mocha --require ts-node/register test/unit/ProcessRegistry.test.ts
```
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/services/ProcessRegistry.ts test/unit/ProcessRegistry.test.ts
git commit -m "feat(processes): central process registry with graceful teardown"
```

---

### Task 13: Wire ProcessRegistry into spawn call sites

**Files:**
- Modify: `src/device-managers/ios/WDAClient.ts`
- Modify: `src/device-managers/ios/IOSStreamService.ts`
- Modify: `src/device-managers/android/AndroidStreamService.ts`
- Modify: `src/services/VideoPipelineService.ts`
- Modify: `src/services/DeviceLogService.ts`

- [ ] **Step 1: Enumerate spawn sites**

```bash
grep -rn "child_process\.spawn\|spawn(\|execa\.node\|execa(" src/ --include="*.ts"
```
List each file + function where a long-running child is spawned (short-lived execSync/execFile-and-return are out of scope).

- [ ] **Step 2: Pattern per call site**

At each spawn, replace:

```typescript
const child = spawn(bin, args, { detached: true });
```

with:

```typescript
const child = spawn(bin, args, { detached: true, stdio: opts?.stdio ?? 'pipe' });
const trackedId = Container.get(ProcessRegistry).track({
  kind: '<wda|ffmpeg|adb-reverse|ios-mjpeg|log-tailer|other>',
  udid,
  sessionId, // if available in scope
  process: child,
});
```

and at the known clean-shutdown paths, call `Container.get(ProcessRegistry).terminate(trackedId)` (or `terminateForUdid` from a higher scope).

Import at file top:

```typescript
import { Container } from 'typedi';
import { ProcessRegistry } from '../../services/ProcessRegistry';
```

(Adjust relative path per file location.)

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -10
```
Expected: clean.

- [ ] **Step 4: Run full unit suite**

```bash
npm test 2>&1 | tail -20
```
Expected: no new failures vs. baseline.

- [ ] **Step 5: Commit**

```bash
git add src/device-managers src/services/VideoPipelineService.ts src/services/DeviceLogService.ts
git commit -m "feat(processes): register long-running children with ProcessRegistry"
```

---

### Task 14: Shutdown hook

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Find existing signal handlers**

```bash
grep -n "SIGINT\|SIGTERM\|uncaughtException\|unhandledRejection" src/index.ts
```

- [ ] **Step 2: Add ProcessRegistry.terminateAll to teardown**

In `src/index.ts`, inside the existing shutdown handler (before the final `process.exit` call), add:

```typescript
    try {
      await Container.get(ProcessRegistry).terminateAll({ gracefulMs: 3000 });
    } catch (err: any) {
      log.error(`ProcessRegistry teardown failed: ${err.message}`);
    }
```

Add imports if missing:

```typescript
import { Container } from 'typedi';
import { ProcessRegistry } from './services/ProcessRegistry';
```

If `src/index.ts` only registers sync handlers, wrap them in an async IIFE around the existing teardown block.

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Manual sanity test**

```bash
npm run server &
XENON_PID=$!
sleep 5
kill -INT $XENON_PID
sleep 3
pgrep -f WebDriverAgent || echo "no WDA orphans"
pgrep -f "adb reverse" || echo "no adb reverse orphans"
```
Expected: both "no X orphans" printed. If the server had no devices attached, this only verifies no crash; full verification comes in integration testing later.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(processes): terminate tracked children on shutdown"
```

---

## §5. REST Auth + Rate Limit

### Task 15: Prisma migration — ApiKey table

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260421082000_add_api_key_table/migration.sql`

- [ ] **Step 1: Add model**

Append to `prisma/schema.prisma`:

```prisma
model ApiKey {
  id          String    @id @default(uuid())
  name        String
  keyHash     String    @unique
  scopes      String
  rateLimit   Int       @default(300)
  createdAt   DateTime  @default(now())
  revokedAt   DateTime?
  lastUsedAt  DateTime?
}
```

- [ ] **Step 2: Migration SQL**

Create `prisma/migrations/20260421082000_add_api_key_table/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "rateLimit" INTEGER NOT NULL DEFAULT 300,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "lastUsedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
```

- [ ] **Step 3: Regenerate**

```bash
DATABASE_URL="file:/tmp/plan-check.db" npx prisma generate
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260421082000_add_api_key_table src/generated/client
git commit -m "feat(db): add ApiKey table"
```

---

### Task 16: ApiKeyService — bootstrap + CRUD

**Files:**
- Create: `src/services/ApiKeyService.ts`
- Create: `test/unit/ApiKeyService.test.ts`
- Modify: `src/config.ts` (add `bootstrapKeyPath`)

- [ ] **Step 1: Write the failing test**

Create `test/unit/ApiKeyService.test.ts`:

```typescript
import { expect } from 'chai';
import sinon from 'sinon';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { prisma } from '../../src/prisma';
import fs from 'fs';

describe('ApiKeyService', () => {
  afterEach(() => sinon.restore());

  it('creates a bootstrap key when the table is empty', async () => {
    sinon.stub(prisma.apiKey, 'count').resolves(0);
    const create = sinon.stub(prisma.apiKey, 'create').resolves({} as any);
    const writeStub = sinon.stub(fs, 'writeFileSync');

    const svc = new ApiKeyService();
    const key = await svc.bootstrapIfEmpty('/tmp/test-bootstrap.txt');

    expect(key).to.be.a('string').with.lengthOf(64);
    expect(create.calledOnce).to.be.true;
    expect(create.firstCall.args[0].data.scopes).to.equal('admin');
    expect(writeStub.calledOnce).to.be.true;
    expect(writeStub.firstCall.args[0]).to.equal('/tmp/test-bootstrap.txt');
  });

  it('returns null when keys already exist', async () => {
    sinon.stub(prisma.apiKey, 'count').resolves(1);
    const svc = new ApiKeyService();
    const key = await svc.bootstrapIfEmpty('/tmp/test-bootstrap.txt');
    expect(key).to.be.null;
  });

  it('verify returns the key row for a valid raw key', async () => {
    const raw = 'a'.repeat(64);
    const hash = (await import('crypto'))
      .createHash('sha256')
      .update(raw)
      .digest('hex');
    sinon
      .stub(prisma.apiKey, 'findUnique')
      .resolves({ id: 'k1', keyHash: hash, scopes: 'read', rateLimit: 300, revokedAt: null } as any);
    const svc = new ApiKeyService();
    const row = await svc.verify(raw);
    expect(row?.id).to.equal('k1');
  });

  it('verify rejects revoked keys', async () => {
    const raw = 'a'.repeat(64);
    const hash = (await import('crypto'))
      .createHash('sha256')
      .update(raw)
      .digest('hex');
    sinon
      .stub(prisma.apiKey, 'findUnique')
      .resolves({ id: 'k1', keyHash: hash, scopes: 'read', rateLimit: 300, revokedAt: new Date() } as any);
    const svc = new ApiKeyService();
    const row = await svc.verify(raw);
    expect(row).to.be.null;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha --require ts-node/register test/unit/ApiKeyService.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/services/ApiKeyService.ts`:

```typescript
import { Service } from 'typedi';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../prisma';
import log from '../logger';

export type Scope = 'read' | 'sessions' | 'devices' | 'admin';

export interface ApiKeyRow {
  id: string;
  name: string;
  keyHash: string;
  scopes: string;
  rateLimit: number;
  revokedAt: Date | null;
}

@Service()
export class ApiKeyService {
  private log = log.scope('ApiKey');

  hash(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  generateRaw(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async bootstrapIfEmpty(keyFilePath: string): Promise<string | null> {
    const count = await prisma.apiKey.count();
    if (count > 0) return null;

    const raw = this.generateRaw();
    const keyHash = this.hash(raw);

    fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
    fs.writeFileSync(keyFilePath, raw + '\n', { mode: 0o600 });

    await prisma.apiKey.create({
      data: {
        name: 'bootstrap',
        keyHash,
        scopes: 'admin',
        rateLimit: 300,
      },
    });

    this.log.warn(
      `No API keys found. Bootstrap key written to ${keyFilePath}. Rotate within 24h via POST /xenon/api/apikeys.`,
    );
    return raw;
  }

  async verify(raw: string | undefined): Promise<ApiKeyRow | null> {
    if (!raw) return null;
    const row = await prisma.apiKey.findUnique({ where: { keyHash: this.hash(raw) } });
    if (!row || row.revokedAt) return null;
    prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return row as ApiKeyRow;
  }

  hasScope(row: ApiKeyRow, required: Scope[]): boolean {
    const owned = new Set(row.scopes.split(',').map((s) => s.trim()));
    if (owned.has('admin')) return true;
    return required.some((r) => owned.has(r));
  }

  async create(params: { name: string; scopes: Scope[]; rateLimit?: number }): Promise<{ id: string; raw: string }> {
    const raw = this.generateRaw();
    const row = await prisma.apiKey.create({
      data: {
        name: params.name,
        keyHash: this.hash(raw),
        scopes: params.scopes.join(','),
        rateLimit: params.rateLimit ?? 300,
      },
    });
    return { id: row.id, raw };
  }

  async revoke(id: string): Promise<void> {
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }
}
```

- [ ] **Step 4: Add `bootstrapKeyPath` and `authDisabled` to config**

In `src/config.ts`, add fields to the `Config` interface:

```typescript
  bootstrapKeyPath: string;
  authDisabled: boolean;
  nodeSecret?: string;
```

In the exported `config` literal:

```typescript
  bootstrapKeyPath:
    process.env.XENON_BOOTSTRAP_KEY_PATH ||
    path.join(basePath, 'bootstrap-key.txt'),
  authDisabled: process.env.XENON_AUTH_DISABLED === 'true',
  nodeSecret: process.env.XENON_NODE_SECRET,
```

In `src/services/ServerManager.ts` `syncDatabaseAndAIConfig` (or wherever plugin args map into config), propagate `pluginArgs.authDisabled` and `pluginArgs.nodeSecret` via `updateConfig({ authDisabled, nodeSecret })`.

Add to `IPluginArgs` (`src/interfaces/IPluginArgs.ts`):

```typescript
  authDisabled?: boolean;
  nodeSecret?: string;
```

Add to `schema.json`:

```json
    "authDisabled": {
      "type": "boolean",
      "default": false,
      "description": "Disable API-key authentication on REST endpoints. WARN-logged every 60s. Local dev only."
    },
    "nodeSecret": {
      "type": "string",
      "description": "Shared secret for hub-node channel authentication. Required on both hub and node."
    }
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npx mocha --require ts-node/register test/unit/ApiKeyService.test.ts
```
Expected: PASS (4 passing).

- [ ] **Step 6: Commit**

```bash
git add src/services/ApiKeyService.ts src/config.ts test/unit/ApiKeyService.test.ts
git commit -m "feat(auth): ApiKeyService with bootstrap, verify, create, revoke"
```

---

### Task 17: apiKeyMiddleware + scopeGuard

**Files:**
- Create: `src/middleware/apiKeyMiddleware.ts`
- Create: `src/middleware/scopeGuard.ts`
- Create: `test/unit/apiKeyMiddleware.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/apiKeyMiddleware.test.ts`:

```typescript
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { apiKeyMiddleware } from '../../src/middleware/apiKeyMiddleware';
import { ApiKeyService } from '../../src/services/ApiKeyService';

function mockReq(headers: Record<string, string> = {}, query: any = {}) {
  return { headers, query } as any;
}
function mockRes() {
  const json = sinon.stub();
  const status = sinon.stub().returnsThis();
  return { status, json, locals: {} } as any;
}

describe('apiKeyMiddleware', () => {
  afterEach(() => sinon.restore());

  it('401 when header missing', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = sinon.stub();
    await apiKeyMiddleware(req, res, next);
    expect(res.status.calledWith(401)).to.be.true;
    expect(next.called).to.be.false;
  });

  it('401 when key invalid', async () => {
    sinon.stub(Container.get(ApiKeyService), 'verify').resolves(null);
    const req = mockReq({ 'x-xenon-api-key': 'bad' });
    const res = mockRes();
    const next = sinon.stub();
    await apiKeyMiddleware(req, res, next);
    expect(res.status.calledWith(401)).to.be.true;
  });

  it('calls next and attaches apiKey on success', async () => {
    sinon
      .stub(Container.get(ApiKeyService), 'verify')
      .resolves({ id: 'k1', scopes: 'read', rateLimit: 300 } as any);
    const req = mockReq({ 'x-xenon-api-key': 'good' });
    const res = mockRes();
    const next = sinon.stub();
    await apiKeyMiddleware(req, res, next);
    expect(next.calledOnce).to.be.true;
    expect(req.apiKey.id).to.equal('k1');
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx mocha --require ts-node/register test/unit/apiKeyMiddleware.test.ts
```

- [ ] **Step 3: Implement middleware**

Create `src/middleware/apiKeyMiddleware.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../services/ApiKeyService';
import { config as xenonConfig } from '../config';

export async function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  if ((xenonConfig as any).authDisabled === true) {
    (req as any).apiKey = { id: 'auth-disabled', scopes: 'admin', rateLimit: 100_000 };
    return next();
  }

  const raw =
    (req.headers['x-xenon-api-key'] as string | undefined) ||
    (req.query.apiKey as string | undefined) ||
    ((req as any).cookies?.xenon_dashboard_session as string | undefined);

  if (!raw) {
    return res.status(401).json({ error: 'missing API key' });
  }

  const row = await Container.get(ApiKeyService).verify(raw);
  if (!row) {
    return res.status(401).json({ error: 'invalid or revoked API key' });
  }

  (req as any).apiKey = { id: row.id, scopes: row.scopes, rateLimit: row.rateLimit };
  next();
}
```

Create `src/middleware/scopeGuard.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../services/ApiKeyService';

export function scopeGuard(required: Scope[]) {
  return function (req: Request, res: Response, next: NextFunction) {
    const key = (req as any).apiKey;
    if (!key) return res.status(401).json({ error: 'unauthenticated' });
    const svc = Container.get(ApiKeyService);
    const ok = svc.hasScope(
      { id: key.id, name: '', keyHash: '', scopes: key.scopes, rateLimit: key.rateLimit, revokedAt: null },
      required,
    );
    if (!ok) return res.status(403).json({ error: 'insufficient scope' });
    next();
  };
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx mocha --require ts-node/register test/unit/apiKeyMiddleware.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/middleware/apiKeyMiddleware.ts src/middleware/scopeGuard.ts test/unit/apiKeyMiddleware.test.ts
git commit -m "feat(auth): apiKey middleware and scopeGuard"
```

---

### Task 18: rateLimitMiddleware

**Files:**
- Create: `src/middleware/rateLimitMiddleware.ts`
- Create: `test/unit/rateLimitMiddleware.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/rateLimitMiddleware.test.ts`:

```typescript
import { expect } from 'chai';
import sinon from 'sinon';
import { rateLimitMiddleware } from '../../src/middleware/rateLimitMiddleware';

function mockReq(keyId: string, rateLimit: number) {
  return { apiKey: { id: keyId, rateLimit } } as any;
}
function mockRes() {
  const json = sinon.stub();
  const status = sinon.stub().returnsThis();
  const set = sinon.stub();
  return { status, json, set } as any;
}

describe('rateLimitMiddleware', () => {
  it('allows traffic within the limit', () => {
    const next = sinon.stub();
    const mw = rateLimitMiddleware();
    for (let i = 0; i < 5; i++) mw(mockReq('k1', 60), mockRes(), next);
    expect(next.callCount).to.equal(5);
  });

  it('429 when bucket exhausted', () => {
    const next = sinon.stub();
    const mw = rateLimitMiddleware();
    const req = mockReq('k2', 3);
    const res = mockRes();
    for (let i = 0; i < 3; i++) mw(req, res, next);
    mw(req, res, next);
    expect(res.status.calledWith(429)).to.be.true;
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
npx mocha --require ts-node/register test/unit/rateLimitMiddleware.test.ts
```

- [ ] **Step 3: Implement**

Create `src/middleware/rateLimitMiddleware.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';

interface Bucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillPerSec: number;
}

const buckets = new Map<string, Bucket>();

function refill(b: Bucket) {
  const now = Date.now();
  const elapsed = (now - b.lastRefill) / 1000;
  b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.refillPerSec);
  b.lastRefill = now;
}

export function rateLimitMiddleware() {
  return function (req: Request, res: Response, next: NextFunction) {
    const key = (req as any).apiKey;
    if (!key) return next(); // authenticated middleware runs first; this is a defensive no-op

    let bucket = buckets.get(key.id);
    if (!bucket) {
      bucket = {
        tokens: key.rateLimit,
        lastRefill: Date.now(),
        capacity: key.rateLimit,
        refillPerSec: key.rateLimit / 60,
      };
      buckets.set(key.id, bucket);
    }
    refill(bucket);

    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / bucket.refillPerSec);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'rate limit exceeded' });
    }

    bucket.tokens -= 1;
    next();
  };
}

export function __resetBucketsForTests() {
  buckets.clear();
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx mocha --require ts-node/register test/unit/rateLimitMiddleware.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/middleware/rateLimitMiddleware.ts test/unit/rateLimitMiddleware.test.ts
git commit -m "feat(auth): token-bucket rate limit per API key"
```

---

### Task 19: nodeSecretMiddleware + NodeDevices header wire

**Files:**
- Create: `src/middleware/nodeSecretMiddleware.ts`
- Create: `test/unit/nodeSecretMiddleware.test.ts`
- Modify: `src/device-managers/NodeDevices.ts`

Note: `nodeSecret` was added to `src/config.ts`, `src/interfaces/IPluginArgs.ts`, and `schema.json` in Task 16 Step 4. This task consumes it.

- [ ] **Step 1: Write the failing test**

Create `test/unit/nodeSecretMiddleware.test.ts`:

```typescript
import { expect } from 'chai';
import sinon from 'sinon';
import { nodeSecretMiddleware } from '../../src/middleware/nodeSecretMiddleware';

function mockReq(headers: Record<string, string> = {}) {
  return { headers } as any;
}
function mockRes() {
  const json = sinon.stub();
  const status = sinon.stub().returnsThis();
  return { status, json } as any;
}

describe('nodeSecretMiddleware', () => {
  it('401 on mismatch when secret is configured', () => {
    const mw = nodeSecretMiddleware('expected');
    const req = mockReq({ 'x-xenon-node-secret': 'wrong' });
    const res = mockRes();
    const next = sinon.stub();
    mw(req, res, next);
    expect(res.status.calledWith(401)).to.be.true;
  });

  it('calls next on match', () => {
    const mw = nodeSecretMiddleware('shared');
    const next = sinon.stub();
    mw(mockReq({ 'x-xenon-node-secret': 'shared' }), mockRes(), next);
    expect(next.calledOnce).to.be.true;
  });

  it('permits + warns when secret unset', () => {
    const mw = nodeSecretMiddleware(undefined);
    const next = sinon.stub();
    mw(mockReq(), mockRes(), next);
    expect(next.calledOnce).to.be.true;
  });
});
```

- [ ] **Step 2: Implement**

Create `src/middleware/nodeSecretMiddleware.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import log from '../logger';

let lastWarnAt = 0;

export function nodeSecretMiddleware(expected: string | undefined) {
  return function (req: Request, res: Response, next: NextFunction) {
    if (!expected) {
      const now = Date.now();
      if (now - lastWarnAt > 60_000) {
        log.warn(
          '[nodeSecret] node-secret not configured; hub-node channel is unauthenticated. Set --plugin-xenon-node-secret.',
        );
        lastWarnAt = now;
      }
      return next();
    }
    const got = (req.headers['x-xenon-node-secret'] as string | undefined) || '';
    const a = Buffer.from(got, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'invalid node secret' });
    }
    next();
  };
}
```

- [ ] **Step 3: Run test — expect pass**

```bash
npx mocha --require ts-node/register test/unit/nodeSecretMiddleware.test.ts
```

- [ ] **Step 4: Wire NodeDevices to send the header**

In `src/device-managers/NodeDevices.ts`, add constructor param + header attachment:

```typescript
constructor(host: string, tlsRejectUnauthorized?: boolean, private nodeSecret?: string) {
  this.host = host;
  this.tlsRejectUnauthorized = tlsRejectUnauthorized;
}

private headers() {
  return this.nodeSecret ? { 'x-xenon-node-secret': this.nodeSecret } : {};
}
```

Update each `client.post(...)` call to pass `{ headers: this.headers(), params: {...} }` merged correctly.

- [ ] **Step 5: Thread nodeSecret through callers**

Grep for `new NodeDevices(` and update each site to pass `pluginArgs.nodeSecret`:

```bash
grep -rn "new NodeDevices(" src/
```

For each match, change e.g. `new NodeDevices(hub, tlsRejectUnauthorized)` to `new NodeDevices(hub, tlsRejectUnauthorized, pluginArgs.nodeSecret)`.

- [ ] **Step 6: Build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add src/middleware/nodeSecretMiddleware.ts src/device-managers/NodeDevices.ts src/interfaces/IPluginArgs.ts schema.json src/config.ts test/unit/nodeSecretMiddleware.test.ts
git commit -m "feat(auth): shared-secret middleware for hub-node channel"
```

---

### Task 20: /xenon/api/apikeys router + wire middlewares into app

**Files:**
- Create: `src/app/routers/apikeys.ts`
- Create: `src/app/routers/auth.ts` (dashboard session)
- Modify: `src/app/index.ts` (mount middlewares)

- [ ] **Step 1: Build the apikeys router**

Create `src/app/routers/apikeys.ts`:

```typescript
import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../../services/ApiKeyService';
import { scopeGuard } from '../../middleware/scopeGuard';

export function apiKeysRouter(): Router {
  const r = Router();
  const svc = Container.get(ApiKeyService);

  r.post('/', scopeGuard(['admin']), async (req, res) => {
    const { name, scopes, rateLimit } = req.body as {
      name: string;
      scopes: Scope[];
      rateLimit?: number;
    };
    if (!name || !Array.isArray(scopes) || scopes.length === 0) {
      return res.status(400).json({ error: 'name and scopes required' });
    }
    const { id, raw } = await svc.create({ name, scopes, rateLimit });
    res.json({ id, key: raw });
  });

  r.delete('/:id', scopeGuard(['admin']), async (req, res) => {
    await svc.revoke(req.params.id);
    res.json({ ok: true });
  });

  return r;
}
```

- [ ] **Step 2: Build the dashboard auth router**

Create `src/app/routers/auth.ts`:

```typescript
import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../../services/ApiKeyService';

export function authRouter(): Router {
  const r = Router();
  const svc = Container.get(ApiKeyService);

  r.post('/dashboard-session', async (req, res) => {
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey) return res.status(400).json({ error: 'apiKey required' });
    const row = await svc.verify(apiKey);
    if (!row) return res.status(401).json({ error: 'invalid key' });
    res.cookie('xenon_dashboard_session', apiKey, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true, scopes: row.scopes });
  });

  return r;
}
```

- [ ] **Step 3: Mount in app**

In `src/app/index.ts`, within the route registration (after the proxy setup, before individual routers), add:

```typescript
import { apiKeyMiddleware } from '../middleware/apiKeyMiddleware';
import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';
import { nodeSecretMiddleware } from '../middleware/nodeSecretMiddleware';
import { apiKeysRouter } from './routers/apikeys';
import { authRouter } from './routers/auth';
import { config as xenonConfig } from '../config';

// ... inside createRouter(pluginArgs):
router.use('/api/health', (_req, res) => res.json({ ok: true }));

// Hub-node channel: node-secret instead of API key
router.use(
  ['/api/register', '/api/unblock'],
  nodeSecretMiddleware(pluginArgs.nodeSecret || process.env.XENON_NODE_SECRET),
);

// Unauth: dashboard login
router.use('/api/auth', authRouter());

// All other /api/* requires API key + rate limit
router.use('/api', apiKeyMiddleware);
router.use('/api', rateLimitMiddleware());

// Admin routes for key mgmt
router.use('/api/apikeys', apiKeysRouter());
```

Ensure this block is placed BEFORE existing `/api/*` routers so middleware is applied.

- [ ] **Step 4: Bootstrap on startup**

In `src/services/ServerManager.ts` `initializeCoreSubsystems`, after `runMigrations()`, add:

```typescript
    const keyService = Container.get(ApiKeyService);
    await keyService.bootstrapIfEmpty(xenonConfig.bootstrapKeyPath);
```

Add imports:

```typescript
import { ApiKeyService } from './ApiKeyService';
import { config as xenonConfig } from '../config';
```

- [ ] **Step 5: Build + run unit suite**

```bash
npm run build 2>&1 | tail -10
npm test 2>&1 | tail -20
```
Expected: clean build; no new failures vs. baseline. Existing routes that did NOT set an API key will now 401 in tests — fix the failing test files by injecting a test key in `before()` hooks or temporarily setting `XENON_AUTH_DISABLED=true` in the test env.

- [ ] **Step 6: Commit**

```bash
git add src/app/routers/apikeys.ts src/app/routers/auth.ts src/app/index.ts src/services/ServerManager.ts
git commit -m "feat(auth): mount API-key middleware + apikeys and auth routers"
```

---

### Task 21: Dashboard paste-key screen

**Files:**
- Modify: `web/src/App.tsx` (or wherever the top-level route lives)
- Create: `web/src/components/ApiKeyGate.tsx`
- Modify: socket.io client init to send the cookie

- [ ] **Step 1: Write the gate component**

Create `web/src/components/ApiKeyGate.tsx`:

```tsx
import React, { useEffect, useState } from 'react';

interface Props {
  children: React.ReactNode;
}

export function ApiKeyGate({ children }: Props) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/xenon/api/health')
      .then(() => fetch('/xenon/api/sessions', { credentials: 'include' }))
      .then((r) => setAuthed(r.status !== 401))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div style={{ padding: 40 }}>Loading…</div>;
  if (authed) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/xenon/api/auth/dashboard-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ apiKey: value.trim() }),
    });
    if (res.ok) {
      setAuthed(true);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error || 'Invalid key');
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '120px auto', padding: 24 }}>
      <h2>Sign in to Xenon</h2>
      <p>Paste an API key. First-time setup: the bootstrap key is in <code>~/.cache/xenon/bootstrap-key.txt</code> on the server.</p>
      <form onSubmit={submit}>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="API key"
          style={{ width: '100%', padding: 8 }}
          autoFocus
        />
        <button type="submit" style={{ marginTop: 12, padding: '8px 16px' }}>
          Continue
        </button>
      </form>
      {error && <p style={{ color: 'crimson', marginTop: 12 }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wrap App root**

In `web/src/App.tsx`, import `ApiKeyGate` and wrap the routed tree:

```tsx
import { ApiKeyGate } from './components/ApiKeyGate';
// ...
return (
  <ApiKeyGate>
    {/* existing <Router>, layout, etc. */}
  </ApiKeyGate>
);
```

- [ ] **Step 3: Socket.io cookie handshake**

Wherever `io()` is initialized in the frontend (grep `web/src` for `import.*socket.io-client`), ensure the client opts in to credentials:

```tsx
const socket = io({ withCredentials: true });
```

- [ ] **Step 4: Build frontend**

```bash
npm run build:xenon 2>&1 | tail -5
npm run build 2>&1 | tail -5
```
Expected: clean.

- [ ] **Step 5: Manual smoke test**

```bash
npm run server
# In another terminal:
cat ~/.cache/xenon/bootstrap-key.txt
# Visit http://localhost:4723/xenon/ — expect paste-key screen; paste key — dashboard loads.
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ApiKeyGate.tsx web/src/App.tsx
git commit -m "feat(dashboard): paste-key sign-in gate"
```

---

## Release

### Task 22: Version bump + release notes

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`

- [ ] **Step 1: Bump version to 1.2.0**

```bash
node -e "const p=require('./package.json');p.version='1.2.0';require('fs').writeFileSync('./package.json',JSON.stringify(p,null,2)+'\n')"
node -e "const p=require('./package-lock.json');p.version='1.2.0';p.packages[''].version='1.2.0';require('fs').writeFileSync('./package-lock.json',JSON.stringify(p,null,2)+'\n')"
```

- [ ] **Step 2: Add Authentication section to README**

In `README.md`, after the "Usage" section, add:

```markdown
## Authentication

Xenon REST endpoints under `/xenon/api/*` require an API key. On first start, Xenon writes a bootstrap key to `~/.cache/xenon/bootstrap-key.txt` (override via `--plugin-xenon-bootstrap-key-path` or `XENON_BOOTSTRAP_KEY_PATH`).

**Rotating the bootstrap key:**

```bash
curl -H "X-Xenon-API-Key: $(cat ~/.cache/xenon/bootstrap-key.txt)" \
     -H 'Content-Type: application/json' \
     -d '{"name":"ci","scopes":["sessions","read"],"rateLimit":600}' \
     http://localhost:4723/xenon/api/apikeys
# Save the returned `key` value, then revoke bootstrap:
curl -X DELETE -H "X-Xenon-API-Key: $NEW_ADMIN_KEY" \
     http://localhost:4723/xenon/api/apikeys/<bootstrap-id>
```

**Hub-node channel:** set `--plugin-xenon-node-secret` (or `XENON_NODE_SECRET`) to the same value on both hub and node instances. When unset, the channel is permitted with a WARN (back-compat for single-node installs).

**Local development:** pass `--plugin-xenon-auth-disabled` to skip auth. This logs a WARN every 60s.
```

- [ ] **Step 3: Build + run full test suite**

```bash
npm run build 2>&1 | tail -5
npm test 2>&1 | tail -20
```

- [ ] **Step 4: Commit + push**

```bash
git add package.json package-lock.json README.md
git commit -m "chore: bump version to 1.2.0 for production hardening release"
git push origin main
```

CI publishes 1.2.0 automatically.

---

## Validation checklist (post-release)

Run these against an installed 1.2.0 on a real device host:

- [ ] Fresh install: first startup logs `Bootstrap key written to ...`. File exists with 0600 perms.
- [ ] `curl http://localhost:4723/xenon/api/sessions` → 401 without key.
- [ ] `curl -H "X-Xenon-API-Key: $KEY" .../xenon/api/sessions` → 200.
- [ ] Start a session, SIGKILL the appium process, restart, confirm device is `busy: false` within 2 minutes (§2).
- [ ] Start 4 parallel iOS sessions, confirm no "port in use" errors in logs (§3).
- [ ] After SIGKILL, `pgrep -f 'WebDriverAgent|ffmpeg|adb reverse'` returns zero after 10s (§4).
- [ ] Dashboard paste-key flow: incognito browser → paste screen → key → dashboard.
