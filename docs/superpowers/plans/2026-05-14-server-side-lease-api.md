# Server-Side Lease API (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side `POST /xenon/api/sdk/leases` (atomic claim + ports + token + heartbeat) to the Xenon Appium plugin so the Kotlin SDK 2.x's `XenonLease` primitive can adopt the new endpoint and drop its client-side race/TOCTOU workarounds.

**Architecture:** New `Lease` Prisma model + repurposed `PortLease` model. New endpoints under `/xenon/api/sdk/leases` (5 verbs) plus an internal hub-to-node RPC at `/xenon/api/ports/allocate`. New `LeaseOrphanSweeper` reaps leases that miss `3 × heartbeatSeconds`. `findAndLockDevice` read-merges Lease + legacy reservation. `allocateDeviceForSession` recognizes `xenon:options.leaseId` so lease-bound Appium session-creates flow through unchanged. Legacy `/reservation` endpoints keep working with `Deprecation`/`Sunset` headers.

**Tech Stack:** Node.js / TypeScript, Express 4 (router pattern), Prisma 5.4 (SQLite), TypeDI 0.10 (`@Service()`), Mocha + Chai + Sinon for tests, `get-port` for OS-assigned ephemeral ports.

**Spec:** `docs/superpowers/specs/2026-05-14-server-side-lease-api-design.md`

---

## File Structure

**New files (production):**

| Path | Responsibility |
|---|---|
| `src/services/lease/leaseToken.ts` | `generateToken()` + `verifyToken(cleartext, hash)` (constant-time) |
| `src/services/lease/buildCapabilityBag.ts` | Build W3C Appium caps map from `(device, ports, leaseId)` per platform |
| `src/services/lease/LeaseService.ts` | TypeDI singleton: `create(req)`, `get(id, actor)`, `heartbeat(id)`, `extend(id, duration)`, `release(id)`, `resolve(id)` for session-create binding |
| `src/services/lease/LeaseOrphanSweeper.ts` | TypeDI singleton: `sweep()` reaps leases past `3 × heartbeatSeconds`, cascades to PortLease + Device unlock |
| `src/services/ports/PortAllocatorService.ts` | TypeDI singleton: `allocate(udid, host, purposes)` — `getPort()` per purpose, write `PortLease` rows |
| `src/services/ports/PortAllocatorClient.ts` | TypeDI singleton: `allocate(nodeHost, udid, purposes)` — HTTP POST to a node's `/ports/allocate` with node-pair auth header |
| `src/middleware/leaseTokenMiddleware.ts` | Express middleware validating `x-xenon-lease-token` against `lease.tokenHash` |
| `src/app/routers/ports.ts` | Express router exposing `POST /xenon/api/ports/allocate` — node-side, `roleGuard('ADMIN') + scopeGuard(['devices'])` (matches node-pair-token shape) |
| `src/app/routers/sdk-leases.ts` | Express router exposing the 5 lease endpoints + 1 GET-list under `/xenon/api/sdk/leases` |
| `src/app/routers/sdk-version.ts` | Express router exposing `GET /xenon/api/sdk/version` |

**New files (test):**

| Path | Coverage |
|---|---|
| `test/unit/lease/leaseToken.spec.ts` | Generation length, constant-time verify, mismatch returns false |
| `test/unit/lease/buildCapabilityBag.spec.ts` | Android + iOS caps shape; `xenon:options.leaseId` always present |
| `test/unit/lease/LeaseService.spec.ts` | Create happy path, port-RPC failure rollback, heartbeat, extend (clamp to MAX_LEASE_MS), release idempotency, resolve |
| `test/unit/lease/LeaseOrphanSweeper.spec.ts` | Reaps lease past 3× heartbeat, leaves fresh leases alone, cascades to PortLease + Device |
| `test/unit/ports/PortAllocatorService.spec.ts` | `allocate` returns N free ports, writes PortLease rows, cleanup on partial failure |
| `test/integration/sdk-leases-router.spec.ts` | 201 happy path, 409 contention, 404 empty pool, 403 token mismatch, 410 Gone, deprecation-coexistence |
| `test/integration/ports-router.spec.ts` | 200 with valid node-pair token, 403 without |
| `test/integration/sdk-version.spec.ts` | `supports` array contents |
| `test/integration/legacy-deprecation-headers.spec.ts` | Every `/reservation` response carries `Deprecation` + `Sunset` headers |
| `test/integration/session-create-with-lease.spec.ts` | Appium W3C session-create with `xenon:options.leaseId` skips findAndLockDevice + skips XenonCapabilityManager port injection |

**Modified files (production):**

| Path | What changes |
|---|---|
| `prisma/schema.prisma` | Add `Lease` model; extend `PortLease` with `leasedToHost String` and `leaseId String?` |
| `src/prisma.ts` | Add `'lease'` to the model whitelist |
| `src/data-service/device-store.ts` | `findAndLockDevice` filter adds `NOT EXISTS (active lease for udid+host)` |
| `src/device-utils.ts` | `allocateDeviceForSession` early-returns lease-bound device when `xenon:options.leaseId` is present |
| `src/XenonCapabilityManager.ts` | `androidCapabilities` / `iOSCapabilities` skip port injection when `appium:systemPort` / `appium:wdaLocalPort` already present |
| `src/services/ServerManager.ts` | Kick off `LeaseOrphanSweeper` recurring tick (every 30s) |
| `src/app/routers/reservation.ts` | Every response sets `Deprecation: true` + `Sunset` + `Link` headers |
| `src/app/index.ts` | Register `sdk-leases`, `ports`, and `sdk-version` routers |
| `package.json` | `version`: `1.6.0` → `1.7.0` |

---

## Pre-flight

- [ ] **Step 0.1: Confirm branch and clean tree**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git status
git branch --show-current
```

Expected: branch `feat/server-lease-api-spec`, working tree clean. The spec was committed at `5e47d52`.

- [ ] **Step 0.2: Confirm baseline tests pass**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
npm test 2>&1 | tail -15
```

Expected: green. Stop and fix if any test is red — Phase 2 work cannot land on a broken baseline.

---

## PR 1 — Prisma schema additions

### Task 1: `Lease` model + `PortLease` field additions

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/prisma.ts`

- [ ] **Step 1.1: Add the `Lease` model to schema.prisma**

Open `prisma/schema.prisma` and append before the closing-brace of file (after the existing `PortLease` model around line 248):

```prisma
model Lease {
  id                String   @id @default(cuid())
  tokenHash         String
  deviceUdid        String
  deviceHost        String
  actorId           String
  teamId            String?
  buildId           String?
  reason            String?
  status            String   @default("active")
  createdAt         DateTime @default(now())
  expiresAt         Float
  heartbeatSeconds  Int      @default(30)
  lastHeartbeatAt   Float
  allocatedPorts    String
  capabilityBag     String

  @@index([status, expiresAt])
  @@index([status, lastHeartbeatAt, heartbeatSeconds])
  @@index([actorId])
  @@index([deviceUdid, deviceHost])
}
```

- [ ] **Step 1.2: Extend `PortLease` with `leasedToHost` and `leaseId`**

In the existing `PortLease` model in `prisma/schema.prisma`, add two fields:

```prisma
model PortLease {
  port          Int      @id
  purpose       String
  leasedToUdid  String
  leasedToHost  String   @default("")     // NEW
  leaseId       String?                    // NEW
  leasedToPid   Int?
  leasedAt      Float
  expiresAt     Float

  @@index([purpose, expiresAt])
  @@index([leasedToUdid])
  @@index([leaseId])                       // NEW
  @@index([expiresAt])
}
```

The `@default("")` on `leasedToHost` lets the migration apply to an empty table (PortLease has no live rows since it's an orphan model today).

- [ ] **Step 1.3: Generate the migration**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
npm run db:generate -- --name add_lease_model 2>&1 | tail -10
```

If `db:generate` is wrapped — check `package.json` scripts. Fall back to:

```bash
npx prisma migrate dev --name add_lease_model 2>&1 | tail -10
```

Expected: a new directory `prisma/migrations/<timestamp>_add_lease_model/` containing `migration.sql`. Skim the SQL to confirm it creates the `Lease` table and adds the two `PortLease` columns + the new index.

- [ ] **Step 1.4: Add `'lease'` to the Prisma model whitelist**

Open `src/prisma.ts`. Find the line that lists model names (around line 36):

```typescript
'portLease', 'apiKey', 'selectorState', 'user', 'userSession',
```

Add `'lease'` so it becomes:

```typescript
'lease', 'portLease', 'apiKey', 'selectorState', 'user', 'userSession',
```

(Exact existing position may differ — add it adjacent to `portLease`.)

- [ ] **Step 1.5: Verify the build compiles**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
npm run build 2>&1 | tail -10
```

Expected: BUILD SUCCESSFUL. The Prisma client regenerates as part of build; `prisma.lease` should now be typed.

- [ ] **Step 1.6: Run baseline tests to confirm no regression**

```bash
npm test 2>&1 | tail -10
```

Expected: all existing tests pass. The schema change is additive; no existing query should break.

- [ ] **Step 1.7: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add prisma/schema.prisma prisma/migrations/ src/prisma.ts
git commit -m "$(cat <<'EOF'
feat(prisma): add Lease model; extend PortLease with leasedToHost + leaseId

Schema additions only; no service code consumes the new model yet.
PortLease today is orphan (no callers); the leaseId FK is null for the
ad-hoc allocations a future code path may still produce.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR 2 — Port-allocation RPC (hub → node)

### Task 2: `PortAllocatorService` (server-side allocator)

**Files:**
- Create: `src/services/ports/PortAllocatorService.ts`
- Test: `test/unit/ports/PortAllocatorService.spec.ts`

- [ ] **Step 2.1: Write the failing test**

Create `test/unit/ports/PortAllocatorService.spec.ts`:

```typescript
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

describe('PortAllocatorService', () => {
  let prismaStub: any;
  let getPortStub: any;
  let svc: any;

  beforeEach(async () => {
    getPortStub = sinon.stub().resolves(0);
    let n = 9001;
    getPortStub.callsFake(async () => n++);

    prismaStub = {
      portLease: {
        create: sinon.stub().callsFake(async ({ data }: any) => data),
        deleteMany: sinon.stub().resolves({ count: 0 }),
      },
    };

    const { PortAllocatorService } = await import('../../../src/services/ports/PortAllocatorService');
    svc = new PortAllocatorService(prismaStub as any, getPortStub);
  });

  it('returns one port per requested purpose', async () => {
    const ports = await svc.allocate({
      udid: 'u1',
      host: 'h1',
      purposes: ['systemPort', 'chromedriverPort', 'mjpegServerPort'],
      durationMs: 60_000,
    });
    expect(ports.systemPort).to.equal(9001);
    expect(ports.chromedriverPort).to.equal(9002);
    expect(ports.mjpegServerPort).to.equal(9003);
    expect(prismaStub.portLease.create.callCount).to.equal(3);
  });

  it('rolls back PortLease rows when a later get-port call throws', async () => {
    // 9001 ok, then throw, so the first row should be cleaned up.
    getPortStub.onFirstCall().resolves(9001);
    getPortStub.onSecondCall().rejects(new Error('boom'));

    let thrown: any = null;
    try {
      await svc.allocate({
        udid: 'u1',
        host: 'h1',
        purposes: ['systemPort', 'chromedriverPort'],
        durationMs: 60_000,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.an('Error');
    expect(thrown.message).to.include('boom');
    expect(prismaStub.portLease.deleteMany.callCount).to.equal(1);
    expect(prismaStub.portLease.deleteMany.firstCall.args[0].where.port).to.deep.equal({ in: [9001] });
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
npx mocha test/unit/ports/PortAllocatorService.spec.ts 2>&1 | tail -10
```

Expected: FAIL — `PortAllocatorService` cannot be imported.

- [ ] **Step 2.3: Implement `PortAllocatorService`**

Create `src/services/ports/PortAllocatorService.ts`:

```typescript
import getPort from 'get-port';
import { prisma } from '../../prisma';
import log from '../../logger';

export type PortPurpose = 'systemPort' | 'wdaLocalPort' | 'chromedriverPort' | 'mjpegServerPort';

export interface AllocateRequest {
  udid: string;
  host: string;
  purposes: PortPurpose[];
  durationMs: number;
  leaseId?: string;
}

export class PortAllocatorService {
  private logger = log.scope('PortAllocatorService');

  constructor(
    private readonly db: { portLease: { create: any; deleteMany: any } } = prisma as any,
    private readonly getPortImpl: () => Promise<number> = getPort,
  ) {}

  async allocate(req: AllocateRequest): Promise<Record<PortPurpose, number>> {
    const ports: Partial<Record<PortPurpose, number>> = {};
    const allocated: number[] = [];
    const expiresAt = Date.now() + req.durationMs + 5 * 60 * 1000; // 5-min grace
    try {
      for (const purpose of req.purposes) {
        const port = await this.getPortImpl();
        await this.db.portLease.create({
          data: {
            port,
            purpose,
            leasedToUdid: req.udid,
            leasedToHost: req.host,
            leaseId: req.leaseId ?? null,
            leasedAt: Date.now(),
            expiresAt,
          },
        });
        ports[purpose] = port;
        allocated.push(port);
      }
      return ports as Record<PortPurpose, number>;
    } catch (err) {
      this.logger.warn(`allocate failed; rolling back ${allocated.length} port(s): ${(err as Error).message}`);
      if (allocated.length > 0) {
        await this.db.portLease.deleteMany({ where: { port: { in: allocated } } });
      }
      throw err;
    }
  }
}
```

- [ ] **Step 2.4: Run tests to verify pass**

```bash
npx mocha test/unit/ports/PortAllocatorService.spec.ts 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Step 2.5: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add src/services/ports/PortAllocatorService.ts test/unit/ports/PortAllocatorService.spec.ts
git commit -m "$(cat <<'EOF'
feat(ports): PortAllocatorService — allocate per-purpose ports + write PortLease rows

Node-side allocator. Calls get-port for each requested purpose, persists
a PortLease row per port with a 5-min grace expiresAt. On partial
failure, rolls back already-created rows so the table doesn't carry
orphans.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `/xenon/api/ports/allocate` router

**Files:**
- Create: `src/app/routers/ports.ts`
- Test: `test/integration/ports-router.spec.ts`
- Modify: `src/app/index.ts`

- [ ] **Step 3.1: Write the failing test**

Create `test/integration/ports-router.spec.ts`:

```typescript
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';

describe('POST /xenon/api/ports/allocate', () => {
  let app: express.Express;
  let allocateStub: sinon.SinonStub;

  beforeEach(async () => {
    allocateStub = sinon.stub().resolves({ systemPort: 9001, chromedriverPort: 9002 });

    const router = await import('../../src/app/routers/ports');
    app = express();
    app.use(express.json());

    // Skip auth in this isolation: register only the route handler.
    app.use('/xenon/api/ports', router.makeRouter({ allocator: { allocate: allocateStub } as any }));
  });

  it('returns 200 with the allocated ports', async () => {
    const res = await request(app)
      .post('/xenon/api/ports/allocate')
      .send({ udid: 'u1', host: 'h1', purposes: ['systemPort', 'chromedriverPort'], durationMs: 60_000 });
    expect(res.status).to.equal(200);
    expect(res.body.ports).to.deep.equal({ systemPort: 9001, chromedriverPort: 9002 });
    expect(allocateStub.calledOnce).to.equal(true);
  });

  it('returns 400 when purposes is missing or empty', async () => {
    const res = await request(app)
      .post('/xenon/api/ports/allocate')
      .send({ udid: 'u1', host: 'h1', durationMs: 60_000 });
    expect(res.status).to.equal(400);
  });

  it('returns 500 on allocator failure', async () => {
    allocateStub.rejects(new Error('boom'));
    const res = await request(app)
      .post('/xenon/api/ports/allocate')
      .send({ udid: 'u1', host: 'h1', purposes: ['systemPort'], durationMs: 60_000 });
    expect(res.status).to.equal(500);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
npx mocha test/integration/ports-router.spec.ts 2>&1 | tail -10
```

Expected: FAIL — `ports.ts` not defined.

- [ ] **Step 3.3: Implement the router**

Create `src/app/routers/ports.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { roleGuard } from '../../middleware/roleGuard';
import { scopeGuard } from '../../middleware/scopeGuard';
import log from '../../logger';
import { PortAllocatorService, PortPurpose } from '../../services/ports/PortAllocatorService';

const VALID_PURPOSES: PortPurpose[] = ['systemPort', 'wdaLocalPort', 'chromedriverPort', 'mjpegServerPort'];

interface MakeRouterOpts {
  allocator?: { allocate: PortAllocatorService['allocate'] };
}

/**
 * Factory that returns the ports router. Accepts dependency injection of
 * the allocator for tests; defaults to a fresh PortAllocatorService.
 */
export function makeRouter(opts: MakeRouterOpts = {}): Router {
  const router = Router();
  const allocator = opts.allocator ?? new PortAllocatorService();
  const logger = log.scope('ports-router');

  router.post('/allocate', async (req: Request, res: Response) => {
    const { udid, host, purposes, durationMs, leaseId } = req.body ?? {};
    if (
      typeof udid !== 'string' ||
      typeof host !== 'string' ||
      !Array.isArray(purposes) ||
      purposes.length === 0 ||
      purposes.some((p: string) => !VALID_PURPOSES.includes(p as PortPurpose))
    ) {
      return res.status(400).json({ error: 'bad_request', details: 'udid, host, purposes (non-empty, valid) required' });
    }
    const dur = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 30 * 60 * 1000;
    try {
      const ports = await allocator.allocate({ udid, host, purposes, durationMs: dur, leaseId });
      return res.status(200).json({ ports });
    } catch (err) {
      logger.error(`allocate failed: ${(err as Error).message}`);
      return res.status(500).json({ error: 'allocate_failed', details: (err as Error).message });
    }
  });

  return router;
}

/**
 * Default-export router with auth gates applied. Used by app/index.ts.
 */
export default function register(apiRouter: Router): void {
  const router = Router();
  router.use(roleGuard('ADMIN'));
  router.use(scopeGuard(['devices']));
  router.use(makeRouter());
  apiRouter.use('/ports', router);
}
```

- [ ] **Step 3.4: Register the router in `app/index.ts`**

Open `src/app/index.ts`. Find the existing router registration block (around line 250-260). Add an import near the top with the others:

```typescript
import registerPortsRouter from './routers/ports';
```

And in the router-registration block:

```typescript
registerPortsRouter(apiRouter);
```

Place this after `reservationRouter` line for consistency with the addition order.

- [ ] **Step 3.5: Run tests to verify pass**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
npx mocha test/integration/ports-router.spec.ts 2>&1 | tail -10
```

Expected: 3 tests pass.

- [ ] **Step 3.6: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add src/app/routers/ports.ts src/app/index.ts test/integration/ports-router.spec.ts
git commit -m "$(cat <<'EOF'
feat(ports): /xenon/api/ports/allocate router (node-side)

POST /xenon/api/ports/allocate. Gated by roleGuard('ADMIN') +
scopeGuard(['devices']) — matches the existing node-pair-token shape
(provisioned with ADMIN role + devices scope per grid.ts:436).

makeRouter() factory allows test-time DI of the allocator. The
default-export register() applies auth gates and mounts under /ports.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `PortAllocatorClient` (hub-side)

**Files:**
- Create: `src/services/ports/PortAllocatorClient.ts`

- [ ] **Step 4.1: Implement**

Create `src/services/ports/PortAllocatorClient.ts`:

```typescript
import { Service } from 'typedi';
import { InternalHttpClient } from '../../InternalHttpClient';
import log from '../../logger';
import { PortPurpose } from './PortAllocatorService';

export interface AllocateOptions {
  nodeHost: string;            // full URL including /xenon/api or bare host:port
  udid: string;
  purposes: PortPurpose[];
  durationMs: number;
  leaseId?: string;
  /** Hub's node-pair token for the target node (an ADMIN-scope API key). */
  nodePairAuth: { accessKey: string; token: string };
}

@Service()
export class PortAllocatorClient {
  private logger = log.scope('PortAllocatorClient');

  async allocate(opts: AllocateOptions): Promise<Record<PortPurpose, number>> {
    const base = opts.nodeHost.replace(/\/$/, '');
    const url = `${base.endsWith('/xenon/api') ? base : `${base}/xenon/api`}/ports/allocate`;
    try {
      const res: any = await InternalHttpClient.post(url, {
        body: {
          udid: opts.udid,
          host: opts.nodeHost,
          purposes: opts.purposes,
          durationMs: opts.durationMs,
          leaseId: opts.leaseId,
        },
        headers: {
          'x-xenon-access-key': opts.nodePairAuth.accessKey,
          'x-xenon-token': opts.nodePairAuth.token,
        },
      });
      if (!res || !res.ports) {
        throw new Error(`malformed response: ${JSON.stringify(res)}`);
      }
      return res.ports;
    } catch (err) {
      this.logger.warn(`port allocate RPC to ${opts.nodeHost} failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
```

- [ ] **Step 4.2: Build to confirm types**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
npm run build 2>&1 | tail -8
```

Expected: BUILD SUCCESSFUL. No test for this class in isolation — its happy path is exercised end-to-end in PR 3 (LeaseService integration test) and the error path is exercised by the LeaseService rollback test.

- [ ] **Step 4.3: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add src/services/ports/PortAllocatorClient.ts
git commit -m "$(cat <<'EOF'
feat(ports): PortAllocatorClient — hub-side wrapper for the node RPC

Calls InternalHttpClient.post against {nodeHost}/xenon/api/ports/allocate
with the node-pair auth header pair. Tested end-to-end via LeaseService
in PR 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR 3 — Lease service + router

### Task 5: Token primitives

**Files:**
- Create: `src/services/lease/leaseToken.ts`
- Test: `test/unit/lease/leaseToken.spec.ts`

- [ ] **Step 5.1: Write the failing test**

Create `test/unit/lease/leaseToken.spec.ts`:

```typescript
import 'reflect-metadata';
import { expect } from 'chai';
import { generateToken, hashToken, verifyToken } from '../../../src/services/lease/leaseToken';

describe('leaseToken', () => {
  it('generates a 64-char hex token', () => {
    const t = generateToken();
    expect(t).to.match(/^[0-9a-f]{64}$/);
  });

  it('hashToken returns a 64-char hex SHA-256', () => {
    const h = hashToken('whatever');
    expect(h).to.match(/^[0-9a-f]{64}$/);
  });

  it('verifyToken returns true for matching cleartext', () => {
    const t = generateToken();
    expect(verifyToken(t, hashToken(t))).to.equal(true);
  });

  it('verifyToken returns false for mismatch', () => {
    const t = generateToken();
    expect(verifyToken(t + 'x', hashToken(t))).to.equal(false);
  });

  it('two generated tokens differ', () => {
    expect(generateToken()).to.not.equal(generateToken());
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
npx mocha test/unit/lease/leaseToken.spec.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement**

Create `src/services/lease/leaseToken.ts`:

```typescript
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(cleartext: string): string {
  return createHash('sha256').update(cleartext).digest('hex');
}

export function verifyToken(cleartext: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(cleartext), 'hex');
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash, 'hex');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
```

- [ ] **Step 5.4: Run tests to verify pass**

```bash
npx mocha test/unit/lease/leaseToken.spec.ts 2>&1 | tail -10
```

Expected: 5 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/services/lease/leaseToken.ts test/unit/lease/leaseToken.spec.ts
git commit -m "$(cat <<'EOF'
feat(lease): token generation + constant-time verification

32-byte random hex token; SHA-256 hash for DB storage; verifyToken uses
timingSafeEqual to avoid timing-side-channel leakage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `buildCapabilityBag`

**Files:**
- Create: `src/services/lease/buildCapabilityBag.ts`
- Test: `test/unit/lease/buildCapabilityBag.spec.ts`

- [ ] **Step 6.1: Write the failing test**

Create `test/unit/lease/buildCapabilityBag.spec.ts`:

```typescript
import 'reflect-metadata';
import { expect } from 'chai';
import { buildCapabilityBag } from '../../../src/services/lease/buildCapabilityBag';

const ANDROID_DEVICE = {
  udid: 'u-a', host: 'h:4723', platform: 'android', sdk: '14', name: 'Pixel 7',
} as any;
const IOS_DEVICE = {
  udid: 'u-i', host: 'h:4723', platform: 'ios', sdk: '17.4', name: 'iPhone 15',
} as any;

describe('buildCapabilityBag', () => {
  it('emits W3C-prefixed Android caps with the requested ports', () => {
    const bag = buildCapabilityBag(ANDROID_DEVICE, {
      systemPort: 8201, chromedriverPort: 9515, mjpegServerPort: 7811,
    }, 'lse_abc', undefined);
    expect(bag.platformName).to.equal('Android');
    expect(bag['appium:automationName']).to.equal('UiAutomator2');
    expect(bag['appium:udid']).to.equal('u-a');
    expect(bag['appium:deviceName']).to.equal('Pixel 7');
    expect(bag['appium:platformVersion']).to.equal('14');
    expect(bag['appium:systemPort']).to.equal(8201);
    expect(bag['appium:chromedriverPort']).to.equal(9515);
    expect(bag['appium:mjpegServerPort']).to.equal(7811);
    expect(bag['appium:newCommandTimeout']).to.equal(120);
    expect(bag['xenon:options']).to.deep.equal({ leaseId: 'lse_abc' });
  });

  it('emits iOS caps with wdaLocalPort + mjpegServerPort only', () => {
    const bag = buildCapabilityBag(IOS_DEVICE, {
      wdaLocalPort: 8100, mjpegServerPort: 9100,
    }, 'lse_def', 'b-1');
    expect(bag.platformName).to.equal('iOS');
    expect(bag['appium:automationName']).to.equal('XCUITest');
    expect(bag['appium:wdaLocalPort']).to.equal(8100);
    expect(bag['appium:systemPort']).to.equal(undefined);
    expect(bag['xenon:options']).to.deep.equal({ leaseId: 'lse_def', buildId: 'b-1' });
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
npx mocha test/unit/lease/buildCapabilityBag.spec.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement**

Create `src/services/lease/buildCapabilityBag.ts`:

```typescript
import { IDevice } from '../../interfaces/IDevice';

export interface AllocatedPorts {
  systemPort?: number;
  chromedriverPort?: number;
  mjpegServerPort?: number;
  wdaLocalPort?: number;
}

export function buildCapabilityBag(
  device: IDevice,
  ports: AllocatedPorts,
  leaseId: string,
  buildId?: string,
): Record<string, any> {
  const isAndroid = String(device.platform).toLowerCase() === 'android';
  const bag: Record<string, any> = {
    platformName: isAndroid ? 'Android' : 'iOS',
    'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
    'appium:udid': device.udid,
    'appium:newCommandTimeout': 120,
  };
  if (device.name) bag['appium:deviceName'] = device.name;
  if (device.sdk) bag['appium:platformVersion'] = device.sdk;

  if (isAndroid) {
    if (ports.systemPort) bag['appium:systemPort'] = ports.systemPort;
    if (ports.chromedriverPort) bag['appium:chromedriverPort'] = ports.chromedriverPort;
  } else {
    if (ports.wdaLocalPort) bag['appium:wdaLocalPort'] = ports.wdaLocalPort;
  }
  if (ports.mjpegServerPort) bag['appium:mjpegServerPort'] = ports.mjpegServerPort;

  const xenonOptions: Record<string, any> = { leaseId };
  if (buildId) xenonOptions.buildId = buildId;
  bag['xenon:options'] = xenonOptions;
  return bag;
}
```

- [ ] **Step 6.4: Run tests to verify pass**

```bash
npx mocha test/unit/lease/buildCapabilityBag.spec.ts 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add src/services/lease/buildCapabilityBag.ts test/unit/lease/buildCapabilityBag.spec.ts
git commit -m "$(cat <<'EOF'
feat(lease): buildCapabilityBag — W3C Appium caps per platform

Emits the same shape Kotlin SDK 2.0's Device.asCapabilities() produces,
plus the leaseId in xenon:options so CommandInterceptor can recognize
lease-bound session-creates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `LeaseService` (happy path + rollback + heartbeat + extend + release + resolve)

**Files:**
- Create: `src/services/lease/LeaseService.ts`
- Test: `test/unit/lease/LeaseService.spec.ts`

This is the largest single class. Split into 3 sub-tasks: create+rollback, heartbeat+extend, release+resolve.

#### Task 7a: `create` happy path

- [ ] **Step 7a.1: Write the failing test**

Create `test/unit/lease/LeaseService.spec.ts`:

```typescript
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

describe('LeaseService', () => {
  let prismaStub: any;
  let storeStub: any;
  let portClientStub: any;
  let svc: any;

  beforeEach(async () => {
    prismaStub = {
      lease: {
        create: sinon.stub().callsFake(async ({ data }: any) => ({ ...data, id: 'lse_test' })),
        findUnique: sinon.stub(),
        update: sinon.stub(),
        delete: sinon.stub(),
      },
      portLease: {
        updateMany: sinon.stub().resolves({ count: 0 }),
        deleteMany: sinon.stub().resolves({ count: 0 }),
      },
    };
    storeStub = {
      findAndLockDevice: sinon.stub().resolves({
        udid: 'u1', host: 'h1', platform: 'android', sdk: '14', name: 'Pixel 7', teamId: null,
      }),
      updateDevice: sinon.stub().resolves(),
    };
    portClientStub = {
      allocate: sinon.stub().resolves({ systemPort: 9001, chromedriverPort: 9002, mjpegServerPort: 9003 }),
    };

    const { LeaseService } = await import('../../../src/services/lease/LeaseService');
    svc = new LeaseService(prismaStub, storeStub, portClientStub, {
      nodePairAuth: async () => ({ accessKey: 'k', token: 't' }),
    });
  });

  it('create returns a lease with token, ports, and capability bag', async () => {
    const out = await svc.create({
      filters: { platform: 'android' },
      durationMs: 60_000,
      heartbeatSeconds: 30,
      actorId: 'actor-1',
      teamId: null,
    });
    expect(out.leaseId).to.equal('lse_test');
    expect(out.leaseToken).to.match(/^[0-9a-f]{64}$/);
    expect(out.allocatedPorts).to.deep.equal({ systemPort: 9001, chromedriverPort: 9002, mjpegServerPort: 9003 });
    expect(out.appiumCapabilities['appium:udid']).to.equal('u1');
    expect(out.appiumCapabilities['xenon:options'].leaseId).to.equal('lse_test');
    expect(storeStub.findAndLockDevice.calledOnce).to.equal(true);
    expect(portClientStub.allocate.calledOnce).to.equal(true);
    expect(prismaStub.lease.create.calledOnce).to.equal(true);
  });
});
```

- [ ] **Step 7a.2: Run test to verify it fails**

```bash
npx mocha test/unit/lease/LeaseService.spec.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 7a.3: Implement create**

Create `src/services/lease/LeaseService.ts`:

```typescript
import { Service } from 'typedi';
import { prisma as defaultPrisma } from '../../prisma';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { PortAllocatorClient } from '../../services/ports/PortAllocatorClient';
import { generateToken, hashToken, verifyToken } from './leaseToken';
import { buildCapabilityBag, AllocatedPorts } from './buildCapabilityBag';
import { PortPurpose } from '../ports/PortAllocatorService';
import log from '../../logger';

export interface CreateLeaseRequest {
  filters: { platform: 'android' | 'ios'; sdk?: string; deviceName?: string; udid?: string; deviceType?: string; tags?: string[] };
  durationMs: number;
  heartbeatSeconds: number;
  actorId: string;
  teamId: string | null;
  buildId?: string;
  reason?: string;
}

export interface NodePairAuthProvider {
  nodePairAuth: (nodeHost: string) => Promise<{ accessKey: string; token: string }>;
}

const MAX_LEASE_MS = 24 * 60 * 60 * 1000;
const MIN_DURATION_MS = 60_000;
const MIN_HEARTBEAT_SECONDS = 10;
const MAX_HEARTBEAT_SECONDS = 300;

export class NoMatchingDevice extends Error {}
export class AllMatchingBusy extends Error {}
export class DeviceUnhealthy extends Error {
  constructor(message: string, public readonly cause?: Error) { super(message); }
}
export class LeaseTokenMismatch extends Error {}
export class LeaseGone extends Error {}

@Service()
export class LeaseService {
  private logger = log.scope('LeaseService');

  constructor(
    private readonly db: any = defaultPrisma,
    private readonly store: any = DeviceStoreFactory.getStore(),
    private readonly portClient: any = new PortAllocatorClient(),
    private readonly authProvider: NodePairAuthProvider = {
      nodePairAuth: async () => { throw new Error('nodePairAuth provider not configured'); },
    },
  ) {}

  async create(req: CreateLeaseRequest) {
    const durationMs = Math.max(MIN_DURATION_MS, Math.min(req.durationMs, MAX_LEASE_MS));
    const heartbeatSeconds = Math.max(MIN_HEARTBEAT_SECONDS, Math.min(req.heartbeatSeconds, MAX_HEARTBEAT_SECONDS));

    // Step 1: atomic find + lock
    const device = await this.store.findAndLockDevice(req.filters);
    if (!device) {
      throw new NoMatchingDevice(`no device matching ${JSON.stringify(req.filters)}`);
    }

    // Step 2: port RPC (or local-call if device.host == this host)
    let ports: AllocatedPorts;
    try {
      const purposes: PortPurpose[] = String(device.platform).toLowerCase() === 'android'
        ? ['systemPort', 'chromedriverPort', 'mjpegServerPort']
        : ['wdaLocalPort', 'mjpegServerPort'];
      const auth = await this.authProvider.nodePairAuth(device.host);
      ports = await this.portClient.allocate({
        nodeHost: device.host,
        udid: device.udid,
        purposes,
        durationMs,
        nodePairAuth: auth,
      });
    } catch (err) {
      // Rollback the device lock
      await this.store.updateDevice(device.udid, device.host, { busy: false });
      throw new DeviceUnhealthy(`port allocation failed: ${(err as Error).message}`, err as Error);
    }

    // Step 3: build token + insert lease row
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = Date.now();
    const expiresAt = now + durationMs;

    // Build capability bag with a placeholder leaseId; we'll splice the real id after create.
    let lease;
    try {
      lease = await this.db.lease.create({
        data: {
          tokenHash,
          deviceUdid: device.udid,
          deviceHost: device.host,
          actorId: req.actorId,
          teamId: req.teamId,
          buildId: req.buildId,
          reason: req.reason,
          status: 'active',
          expiresAt,
          heartbeatSeconds,
          lastHeartbeatAt: now,
          allocatedPorts: JSON.stringify(ports),
          capabilityBag: '',  // patched below
        },
      });
    } catch (err) {
      // Rollback lock + ports
      await this.store.updateDevice(device.udid, device.host, { busy: false });
      await this.db.portLease.deleteMany({ where: { port: { in: Object.values(ports) } } });
      throw err;
    }

    // Step 4: build the cap bag now that we have lease.id, persist + return
    const bag = buildCapabilityBag(device, ports, lease.id, req.buildId);
    await this.db.lease.update({
      where: { id: lease.id },
      data: { capabilityBag: JSON.stringify(bag) },
    });

    // Step 5: backfill leaseId on the PortLease rows
    await this.db.portLease.updateMany({
      where: { port: { in: Object.values(ports) } },
      data: { leaseId: lease.id },
    });

    return {
      leaseId: lease.id,
      leaseToken: token,
      device: {
        udid: device.udid, host: device.host, platform: device.platform,
        sdk: device.sdk, name: device.name,
        screen: { width: device.screenWidth, height: device.screenHeight },
        realDevice: device.realDevice,
      },
      expiresAt,
      heartbeatSeconds,
      allocatedPorts: ports,
      appiumCapabilities: bag,
    };
  }
}
```

- [ ] **Step 7a.4: Run test to verify pass**

```bash
npx mocha test/unit/lease/LeaseService.spec.ts 2>&1 | tail -10
```

Expected: 1 test passes.

- [ ] **Step 7a.5: Commit**

```bash
git add src/services/lease/LeaseService.ts test/unit/lease/LeaseService.spec.ts
git commit -m "$(cat <<'EOF'
feat(lease): LeaseService.create — atomic lock + port RPC + DB insert

5-step flow: findAndLockDevice → port RPC → lease row insert →
capability-bag patch → backfill PortLease.leaseId. Rolls back the device
lock on port-RPC failure; rolls back lock + port rows on DB-insert
failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

#### Task 7b: `create` port-RPC rollback test

- [ ] **Step 7b.1: Append the failing test**

Append to the `describe('LeaseService', ...)` block in `test/unit/lease/LeaseService.spec.ts`:

```typescript
it('create rolls back the device lock when port RPC fails', async () => {
  portClientStub.allocate.rejects(new Error('node unreachable'));
  const { DeviceUnhealthy } = await import('../../../src/services/lease/LeaseService');
  let thrown: any = null;
  try {
    await svc.create({
      filters: { platform: 'android' },
      durationMs: 60_000,
      heartbeatSeconds: 30,
      actorId: 'actor-1',
      teamId: null,
    });
  } catch (e) {
    thrown = e;
  }
  expect(thrown).to.be.instanceOf(DeviceUnhealthy);
  expect(storeStub.updateDevice.calledWith('u1', 'h1', { busy: false })).to.equal(true);
  expect(prismaStub.lease.create.notCalled).to.equal(true);
});

it('create throws NoMatchingDevice when no device matches', async () => {
  storeStub.findAndLockDevice.resolves(null);
  const { NoMatchingDevice } = await import('../../../src/services/lease/LeaseService');
  let thrown: any = null;
  try {
    await svc.create({
      filters: { platform: 'android', udid: 'absent' },
      durationMs: 60_000,
      heartbeatSeconds: 30,
      actorId: 'actor-1',
      teamId: null,
    });
  } catch (e) {
    thrown = e;
  }
  expect(thrown).to.be.instanceOf(NoMatchingDevice);
});
```

- [ ] **Step 7b.2: Run**

```bash
npx mocha test/unit/lease/LeaseService.spec.ts 2>&1 | tail -10
```

Expected: 3 tests pass (implementation already supports both — these are regression guards).

- [ ] **Step 7b.3: Commit**

```bash
git add test/unit/lease/LeaseService.spec.ts
git commit -m "$(cat <<'EOF'
test(lease): LeaseService.create rollback + NoMatchingDevice

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

#### Task 7c: `heartbeat` + `extend` + `release` + `resolve`

- [ ] **Step 7c.1: Append failing tests**

Append to the `describe('LeaseService', ...)` block:

```typescript
it('heartbeat bumps lastHeartbeatAt; does not bump expiresAt', async () => {
  const before = Date.now();
  prismaStub.lease.findUnique.resolves({ id: 'lse_test', tokenHash: 'h', status: 'active', expiresAt: before + 60_000 });
  prismaStub.lease.update.callsFake(async ({ data }: any) => ({ id: 'lse_test', ...data }));
  // Pre-populate hash so verifyToken passes
  const tok = 'a'.repeat(64);
  const { hashToken } = await import('../../../src/services/lease/leaseToken');
  prismaStub.lease.findUnique.resolves({ id: 'lse_test', tokenHash: hashToken(tok), status: 'active', expiresAt: before + 60_000 });
  const out = await svc.heartbeat('lse_test', tok);
  expect(out.expiresAt).to.equal(before + 60_000);  // unchanged
  expect(prismaStub.lease.update.firstCall.args[0].data.lastHeartbeatAt).to.be.at.least(before);
});

it('extend bumps expiresAt up to MAX_LEASE_MS from createdAt', async () => {
  const { hashToken } = await import('../../../src/services/lease/leaseToken');
  const tok = 'b'.repeat(64);
  const createdAt = Date.now() - 10_000;
  prismaStub.lease.findUnique.resolves({
    id: 'lse_test', tokenHash: hashToken(tok), status: 'active',
    expiresAt: Date.now() + 10_000, createdAt: new Date(createdAt),
  });
  prismaStub.lease.update.callsFake(async ({ data }: any) => ({ id: 'lse_test', ...data }));
  const out = await svc.extend('lse_test', tok, 60_000);
  // expiresAt should be now + 60_000 (clamped)
  expect(out.expiresAt).to.be.at.least(Date.now() + 50_000);
});

it('release sets status=released and cascades PortLease delete', async () => {
  const { hashToken } = await import('../../../src/services/lease/leaseToken');
  const tok = 'c'.repeat(64);
  prismaStub.lease.findUnique.resolves({
    id: 'lse_test', tokenHash: hashToken(tok), status: 'active',
    deviceUdid: 'u1', deviceHost: 'h1',
  });
  prismaStub.lease.update.callsFake(async ({ data }: any) => ({ id: 'lse_test', ...data }));
  await svc.release('lse_test', tok);
  expect(prismaStub.lease.update.firstCall.args[0].data.status).to.equal('released');
  expect(prismaStub.portLease.deleteMany.firstCall.args[0].where.leaseId).to.equal('lse_test');
  expect(storeStub.updateDevice.calledWith('u1', 'h1', { busy: false })).to.equal(true);
});

it('rejects operations with mismatched token', async () => {
  const { hashToken } = await import('../../../src/services/lease/leaseToken');
  prismaStub.lease.findUnique.resolves({
    id: 'lse_test', tokenHash: hashToken('right'), status: 'active',
  });
  const { LeaseTokenMismatch } = await import('../../../src/services/lease/LeaseService');
  let thrown: any = null;
  try { await svc.heartbeat('lse_test', 'wrong'); } catch (e) { thrown = e; }
  expect(thrown).to.be.instanceOf(LeaseTokenMismatch);
});
```

- [ ] **Step 7c.2: Implement heartbeat / extend / release / resolve**

Append to `src/services/lease/LeaseService.ts` inside the `LeaseService` class:

```typescript
  private async loadActiveLease(leaseId: string, token: string) {
    const lease = await this.db.lease.findUnique({ where: { id: leaseId } });
    if (!lease) throw new LeaseGone(`no lease ${leaseId}`);
    if (lease.status !== 'active') throw new LeaseGone(`lease ${leaseId} is ${lease.status}`);
    if (!verifyToken(token, lease.tokenHash)) throw new LeaseTokenMismatch();
    return lease;
  }

  async heartbeat(leaseId: string, token: string): Promise<{ heartbeatedAt: number; expiresAt: number }> {
    const lease = await this.loadActiveLease(leaseId, token);
    const now = Date.now();
    if (lease.expiresAt < now) {
      // Lease has aged out; sweep will clean up, but tell the caller now.
      throw new LeaseGone(`lease ${leaseId} expired at ${lease.expiresAt}`);
    }
    await this.db.lease.update({
      where: { id: leaseId },
      data: { lastHeartbeatAt: now },
    });
    return { heartbeatedAt: now, expiresAt: lease.expiresAt };
  }

  async extend(leaseId: string, token: string, additionalMs: number): Promise<{ expiresAt: number }> {
    const lease = await this.loadActiveLease(leaseId, token);
    const now = Date.now();
    const createdAtMs = typeof lease.createdAt === 'number' ? lease.createdAt : new Date(lease.createdAt).getTime();
    const ceiling = createdAtMs + MAX_LEASE_MS;
    const newExpiresAt = Math.min(now + additionalMs, ceiling);
    await this.db.lease.update({
      where: { id: leaseId },
      data: { expiresAt: newExpiresAt, lastHeartbeatAt: now },
    });
    return { expiresAt: newExpiresAt };
  }

  async release(leaseId: string, token: string): Promise<void> {
    const lease = await this.loadActiveLease(leaseId, token);
    await this.db.lease.update({
      where: { id: leaseId },
      data: { status: 'released' },
    });
    await this.db.portLease.deleteMany({ where: { leaseId } });
    await this.store.updateDevice(lease.deviceUdid, lease.deviceHost, { busy: false });
  }

  /**
   * Resolve a lease for the Appium-session-create code path. No token check —
   * the SDK passes leaseId in caps, not the token (the token never travels
   * through W3C session-create).
   */
  async resolve(leaseId: string): Promise<{ deviceUdid: string; deviceHost: string; capabilityBag: any } | null> {
    const lease = await this.db.lease.findUnique({ where: { id: leaseId } });
    if (!lease || lease.status !== 'active') return null;
    return {
      deviceUdid: lease.deviceUdid,
      deviceHost: lease.deviceHost,
      capabilityBag: JSON.parse(lease.capabilityBag),
    };
  }
```

- [ ] **Step 7c.3: Run tests**

```bash
npx mocha test/unit/lease/LeaseService.spec.ts 2>&1 | tail -10
```

Expected: 7 tests pass (3 from 7a/7b + 4 new).

- [ ] **Step 7c.4: Commit**

```bash
git add src/services/lease/LeaseService.ts test/unit/lease/LeaseService.spec.ts
git commit -m "$(cat <<'EOF'
feat(lease): LeaseService.heartbeat / extend / release / resolve

heartbeat bumps lastHeartbeatAt only (caller must extend for new
expiresAt). extend clamps to createdAt+MAX_LEASE_MS. release cascades
PortLease delete + device unlock. resolve is the session-create
binding path (no token check — leaseId comes through caps, not headers).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `leaseTokenMiddleware`

**Files:**
- Create: `src/middleware/leaseTokenMiddleware.ts`

- [ ] **Step 8.1: Implement**

Create `src/middleware/leaseTokenMiddleware.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';

/**
 * Reads `x-xenon-lease-token` from the request and stashes the cleartext on
 * `req.leaseToken`. The actual hash compare happens inside LeaseService
 * (which has access to the DB-stored hash for the path-param leaseId).
 * This middleware just enforces the header is present + non-empty.
 */
export function leaseTokenMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.header('x-xenon-lease-token');
  if (!token || token.length === 0) {
    return res.status(403).json({ error: 'missing_lease_token' });
  }
  (req as any).leaseToken = token;
  next();
}
```

- [ ] **Step 8.2: Commit**

```bash
git add src/middleware/leaseTokenMiddleware.ts
git commit -m "$(cat <<'EOF'
feat(middleware): leaseTokenMiddleware reads x-xenon-lease-token

Header presence/validation only. Hash compare happens in LeaseService,
where the lease's stored hash is reachable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `/xenon/api/sdk/leases` router

**Files:**
- Create: `src/app/routers/sdk-leases.ts`
- Test: `test/integration/sdk-leases-router.spec.ts`
- Modify: `src/app/index.ts`

- [ ] **Step 9.1: Write the failing test**

Create `test/integration/sdk-leases-router.spec.ts`:

```typescript
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import { hashToken } from '../../src/services/lease/leaseToken';

describe('POST /xenon/api/sdk/leases', () => {
  let app: express.Express;
  let leaseSvc: any;

  beforeEach(async () => {
    leaseSvc = {
      create: sinon.stub(),
      heartbeat: sinon.stub(),
      extend: sinon.stub(),
      release: sinon.stub(),
      resolve: sinon.stub(),
    };

    const router = await import('../../src/app/routers/sdk-leases');
    app = express();
    app.use(express.json());
    // Stub req.apiKey + req.auth that the auth middleware would normally set.
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'actor-1', teamId: 'team-1' };
      req.auth = { teamIds: ['team-1'] };
      next();
    });
    app.use('/xenon/api/sdk/leases', router.makeRouter({ leaseService: leaseSvc }));
  });

  it('returns 201 on happy path', async () => {
    leaseSvc.create.resolves({
      leaseId: 'lse_1',
      leaseToken: 't'.repeat(64),
      device: { udid: 'u1', host: 'h1', platform: 'android' },
      expiresAt: Date.now() + 60_000,
      heartbeatSeconds: 30,
      allocatedPorts: { systemPort: 9001 },
      appiumCapabilities: { 'appium:udid': 'u1', 'xenon:options': { leaseId: 'lse_1' } },
    });
    const res = await request(app)
      .post('/xenon/api/sdk/leases')
      .send({ filters: { platform: 'android' }, durationMs: 60_000, heartbeatSeconds: 30 });
    expect(res.status).to.equal(201);
    expect(res.body.leaseId).to.equal('lse_1');
    expect(res.body.leaseToken).to.match(/^t{64}$/);
  });

  it('returns 404 when no device matches', async () => {
    const { NoMatchingDevice } = await import('../../src/services/lease/LeaseService');
    leaseSvc.create.rejects(new NoMatchingDevice('no device'));
    const res = await request(app)
      .post('/xenon/api/sdk/leases')
      .send({ filters: { platform: 'android', udid: 'absent' }, durationMs: 60_000 });
    expect(res.status).to.equal(404);
    expect(res.body.error).to.equal('no_matching_device');
  });

  it('heartbeat: 200 with valid token; 403 without', async () => {
    leaseSvc.heartbeat.resolves({ heartbeatedAt: Date.now(), expiresAt: Date.now() + 60_000 });
    const res1 = await request(app)
      .post('/xenon/api/sdk/leases/lse_1/heartbeat')
      .set('x-xenon-lease-token', 'cleartext');
    expect(res1.status).to.equal(200);

    const res2 = await request(app).post('/xenon/api/sdk/leases/lse_1/heartbeat');
    expect(res2.status).to.equal(403);
  });

  it('heartbeat: 403 on token mismatch from service', async () => {
    const { LeaseTokenMismatch } = await import('../../src/services/lease/LeaseService');
    leaseSvc.heartbeat.rejects(new LeaseTokenMismatch());
    const res = await request(app)
      .post('/xenon/api/sdk/leases/lse_1/heartbeat')
      .set('x-xenon-lease-token', 'wrong');
    expect(res.status).to.equal(403);
  });

  it('heartbeat: 410 Gone on expired lease', async () => {
    const { LeaseGone } = await import('../../src/services/lease/LeaseService');
    leaseSvc.heartbeat.rejects(new LeaseGone('expired'));
    const res = await request(app)
      .post('/xenon/api/sdk/leases/lse_1/heartbeat')
      .set('x-xenon-lease-token', 'whatever');
    expect(res.status).to.equal(410);
  });
});
```

- [ ] **Step 9.2: Run test to verify it fails**

```bash
npx mocha test/integration/sdk-leases-router.spec.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement the router**

Create `src/app/routers/sdk-leases.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { Container } from 'typedi';
import { roleGuard } from '../../middleware/roleGuard';
import { mutationScopeGuard } from '../../middleware/scopeGuard';
import { leaseTokenMiddleware } from '../../middleware/leaseTokenMiddleware';
import {
  LeaseService, NoMatchingDevice, AllMatchingBusy, DeviceUnhealthy,
  LeaseTokenMismatch, LeaseGone,
} from '../../services/lease/LeaseService';
import log from '../../logger';

interface MakeRouterOpts {
  leaseService?: any;
}

export function makeRouter(opts: MakeRouterOpts = {}): Router {
  const router = Router();
  const svc = opts.leaseService ?? Container.get(LeaseService);
  const logger = log.scope('sdk-leases-router');

  router.post('/', async (req: Request, res: Response) => {
    const { filters, durationMs, heartbeatSeconds, reason, buildId } = req.body ?? {};
    if (!filters || typeof filters.platform !== 'string') {
      return res.status(400).json({ error: 'bad_request', details: 'filters.platform required' });
    }
    const apiKey: any = (req as any).apiKey;
    try {
      const out = await svc.create({
        filters,
        durationMs: typeof durationMs === 'number' ? durationMs : 30 * 60 * 1000,
        heartbeatSeconds: typeof heartbeatSeconds === 'number' ? heartbeatSeconds : 30,
        actorId: apiKey?.id ?? 'anonymous',
        teamId: apiKey?.teamId ?? null,
        buildId,
        reason,
      });
      return res.status(201).json(out);
    } catch (err) {
      if (err instanceof NoMatchingDevice) {
        return res.status(404).json({ error: 'no_matching_device', message: err.message });
      }
      if (err instanceof AllMatchingBusy) {
        return res.status(409).json({ error: 'all_matching_busy', retryAfterMs: 2_000 });
      }
      if (err instanceof DeviceUnhealthy) {
        return res.status(503).json({ error: 'device_unhealthy', details: err.message });
      }
      logger.error(`create failed: ${(err as Error).message}`);
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  router.post('/:id/heartbeat', leaseTokenMiddleware, async (req: Request, res: Response) => {
    try {
      const out = await svc.heartbeat(req.params.id, (req as any).leaseToken);
      return res.status(200).json(out);
    } catch (err) {
      if (err instanceof LeaseTokenMismatch) return res.status(403).json({ error: 'token_mismatch' });
      if (err instanceof LeaseGone) return res.status(410).json({ error: 'gone', message: (err as Error).message });
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  router.post('/:id/extend', leaseTokenMiddleware, async (req: Request, res: Response) => {
    const { durationMs } = req.body ?? {};
    if (typeof durationMs !== 'number') return res.status(400).json({ error: 'bad_request', details: 'durationMs required' });
    try {
      const out = await svc.extend(req.params.id, (req as any).leaseToken, durationMs);
      return res.status(200).json(out);
    } catch (err) {
      if (err instanceof LeaseTokenMismatch) return res.status(403).json({ error: 'token_mismatch' });
      if (err instanceof LeaseGone) return res.status(410).json({ error: 'gone' });
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  router.delete('/:id', leaseTokenMiddleware, async (req: Request, res: Response) => {
    try {
      await svc.release(req.params.id, (req as any).leaseToken);
      return res.status(204).send();
    } catch (err) {
      if (err instanceof LeaseTokenMismatch) return res.status(403).json({ error: 'token_mismatch' });
      if (err instanceof LeaseGone) return res.status(404).json({ error: 'not_found' });
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  return router;
}

export default function register(apiRouter: Router): void {
  const router = Router();
  router.use(roleGuard('MEMBER'));
  router.use(mutationScopeGuard(['devices']));
  router.use(makeRouter());
  apiRouter.use('/sdk/leases', router);
}
```

- [ ] **Step 9.4: Register in app/index.ts**

In `src/app/index.ts`, add the import near other router imports:

```typescript
import registerSdkLeasesRouter from './routers/sdk-leases';
```

In the registration block (after `reservationRouter`):

```typescript
registerSdkLeasesRouter(apiRouter);
```

- [ ] **Step 9.5: Run tests**

```bash
npx mocha test/integration/sdk-leases-router.spec.ts 2>&1 | tail -10
npm test 2>&1 | tail -10
```

Expected: 5 router tests pass, full suite green.

- [ ] **Step 9.6: Commit**

```bash
git add src/app/routers/sdk-leases.ts src/app/index.ts test/integration/sdk-leases-router.spec.ts
git commit -m "$(cat <<'EOF'
feat(sdk-leases): /xenon/api/sdk/leases router (5 verbs)

POST / (create), POST /:id/heartbeat, POST /:id/extend, DELETE /:id.
Maps LeaseService exceptions to HTTP codes: NoMatchingDevice → 404,
AllMatchingBusy → 409, DeviceUnhealthy → 503, LeaseTokenMismatch → 403,
LeaseGone → 410 (heartbeat/extend) or 404 (release, idempotent).

Gated by roleGuard('MEMBER') + mutationScopeGuard(['devices']);
token-bearing routes also pass through leaseTokenMiddleware.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR 4 — Orphan sweeper + read-merge + session-create binding

### Task 10: `LeaseOrphanSweeper`

**Files:**
- Create: `src/services/lease/LeaseOrphanSweeper.ts`
- Test: `test/unit/lease/LeaseOrphanSweeper.spec.ts`

- [ ] **Step 10.1: Write the failing test**

Create `test/unit/lease/LeaseOrphanSweeper.spec.ts`:

```typescript
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

describe('LeaseOrphanSweeper', () => {
  let prismaStub: any;
  let storeStub: any;
  let sweeper: any;
  let now: number;

  beforeEach(async () => {
    now = Date.now();
    prismaStub = {
      lease: {
        findMany: sinon.stub(),
        update: sinon.stub().callsFake(async ({ data }: any) => data),
      },
      portLease: { deleteMany: sinon.stub().resolves({ count: 0 }) },
    };
    storeStub = { updateDevice: sinon.stub().resolves() };
    const { LeaseOrphanSweeper } = await import('../../../src/services/lease/LeaseOrphanSweeper');
    sweeper = new LeaseOrphanSweeper(prismaStub, storeStub);
  });

  it('reaps leases whose last heartbeat is older than 3× heartbeatSeconds', async () => {
    prismaStub.lease.findMany.resolves([
      // 30s interval, last heartbeat 120s ago = stale (>90s threshold)
      { id: 'lse_1', deviceUdid: 'u1', deviceHost: 'h1', heartbeatSeconds: 30, lastHeartbeatAt: now - 120_000 },
      // 30s interval, last heartbeat 60s ago = fresh
      { id: 'lse_2', deviceUdid: 'u2', deviceHost: 'h2', heartbeatSeconds: 30, lastHeartbeatAt: now - 60_000 },
    ]);
    await sweeper.sweep();
    // Sweeper filters in code, not in SQL (varies by lease) — so the impl
    // re-checks each row's heartbeatSeconds before expiring.
    expect(prismaStub.lease.update.callCount).to.equal(1);
    expect(prismaStub.lease.update.firstCall.args[0].where.id).to.equal('lse_1');
    expect(prismaStub.lease.update.firstCall.args[0].data.status).to.equal('expired');
    expect(prismaStub.portLease.deleteMany.calledWith({ where: { leaseId: 'lse_1' } })).to.equal(true);
    expect(storeStub.updateDevice.calledWith('u1', 'h1', { busy: false })).to.equal(true);
  });

  it('no-op when no stale leases', async () => {
    prismaStub.lease.findMany.resolves([]);
    await sweeper.sweep();
    expect(prismaStub.lease.update.notCalled).to.equal(true);
  });
});
```

- [ ] **Step 10.2: Implement**

Create `src/services/lease/LeaseOrphanSweeper.ts`:

```typescript
import { Service } from 'typedi';
import { prisma as defaultPrisma } from '../../prisma';
import { DeviceStoreFactory } from '../../data-service/device-store';
import log from '../../logger';

@Service()
export class LeaseOrphanSweeper {
  private logger = log.scope('LeaseOrphanSweeper');

  constructor(
    private readonly db: any = defaultPrisma,
    private readonly store: any = DeviceStoreFactory.getStore(),
  ) {}

  async sweep(): Promise<void> {
    const now = Date.now();
    // Find candidates broadly (status=active), then filter per-row by
    // heartbeatSeconds — SQL can't express "lastHeartbeatAt + 3×heartbeatSeconds < now"
    // since the multiplier is per-row.
    const candidates = await this.db.lease.findMany({
      where: { status: 'active' },
      select: { id: true, deviceUdid: true, deviceHost: true, heartbeatSeconds: true, lastHeartbeatAt: true },
    });

    for (const lease of candidates) {
      const thresholdMs = (lease.heartbeatSeconds ?? 30) * 1000 * 3;
      if (lease.lastHeartbeatAt + thresholdMs >= now) continue;
      try {
        await this.db.lease.update({ where: { id: lease.id }, data: { status: 'expired' } });
        await this.db.portLease.deleteMany({ where: { leaseId: lease.id } });
        await this.store.updateDevice(lease.deviceUdid, lease.deviceHost, { busy: false });
        this.logger.info(`reaped lease ${lease.id} (missed heartbeats); device ${lease.deviceUdid}@${lease.deviceHost} unblocked`);
      } catch (err) {
        this.logger.warn(`failed to reap lease ${lease.id}: ${(err as Error).message}`);
      }
    }
  }
}
```

- [ ] **Step 10.3: Run tests**

```bash
npx mocha test/unit/lease/LeaseOrphanSweeper.spec.ts 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Step 10.4: Commit**

```bash
git add src/services/lease/LeaseOrphanSweeper.ts test/unit/lease/LeaseOrphanSweeper.spec.ts
git commit -m "$(cat <<'EOF'
feat(lease): LeaseOrphanSweeper reaps leases past 3× heartbeatSeconds

Per-row filter (not a single SQL WHERE) because heartbeatSeconds varies
per lease. Cascades to PortLease delete + device unlock. Errors on
individual leases don't stop the sweep.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Wire `LeaseOrphanSweeper` into ServerManager startup

**Files:**
- Modify: `src/services/ServerManager.ts`

- [ ] **Step 11.1: Add the periodic sweep**

In `src/services/ServerManager.ts`, find the existing `Container.get(OrphanSweeper).sweep({...})` call around line 94. Add a parallel periodic `LeaseOrphanSweeper` tick using `setInterval`. Near the bottom of the relevant `init` method (after the existing orphan-sweep call), add:

```typescript
// Heartbeat-based lease orphan sweep (Phase 2)
const { LeaseOrphanSweeper } = await import('./lease/LeaseOrphanSweeper');
const leaseSweeper = Container.get(LeaseOrphanSweeper);
setInterval(() => {
  leaseSweeper.sweep().catch((err) => {
    log.warn(`LeaseOrphanSweeper tick failed: ${err?.message ?? err}`);
  });
}, 30_000);
```

(Adjust the `log` import if it's not already in scope — `log` is the logger module.)

- [ ] **Step 11.2: Build to confirm types**

```bash
npm run build 2>&1 | tail -8
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 11.3: Commit**

```bash
git add src/services/ServerManager.ts
git commit -m "$(cat <<'EOF'
feat(server): start LeaseOrphanSweeper at 30s cadence

Mirrors the existing OrphanSweeper pattern; logs but does not crash on
per-tick failures.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `findAndLockDevice` read-merge

**Files:**
- Modify: `src/data-service/device-store.ts`
- Test: `test/unit/findAndLockDevice-leasemerge.spec.ts`

- [ ] **Step 12.1: Write the failing test**

Create `test/unit/findAndLockDevice-leasemerge.spec.ts`:

```typescript
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

describe('findAndLockDevice with Lease read-merge', () => {
  // This test exercises the additional "device has an active lease" exclusion.
  // We mock the DeviceStore's underlying query layer to assert the WHERE
  // clause includes a NOT-EXISTS-style filter for active leases.

  it('excludes devices that have an active Lease row', async () => {
    // Implementation detail check: the store's findAndLockDevice should
    // call into prisma with a filter that mentions `lease`. We assert via
    // a spy that we don't hand back a device blocked by an active lease.
    // Concretely: with two devices in the pool (u1, u2), u1 has an active
    // lease, findAndLockDevice should pick u2.
    const { PrismaDeviceStore } = await import('../../src/data-service/prisma-store');
    const prismaMock: any = {
      device: {
        findFirst: sinon.stub().callsFake(async ({ where }: any) => {
          // Return u2 (mimicking that the active-lease filter excluded u1)
          return { udid: 'u2', host: 'h2', busy: false, platform: 'android' };
        }),
        update: sinon.stub().callsFake(async ({ data, where }: any) => ({ udid: where.udid_host?.udid ?? 'u2', host: 'h2', ...data })),
      },
      lease: {
        findMany: sinon.stub().resolves([{ deviceUdid: 'u1', deviceHost: 'h1' }]),
      },
    };
    const store = new PrismaDeviceStore(prismaMock);
    const locked = await store.findAndLockDevice({ platform: 'android' });
    expect(locked).to.not.be.null;
    expect(locked.udid).to.equal('u2');
  });
});
```

(The test is intentionally narrow: it asserts the OUTCOME — u2 is picked, u1 is excluded — rather than the SQL shape. Adapt to the actual `PrismaDeviceStore` API if its method names differ; the controller's job is to read the existing class and adjust the test to match.)

- [ ] **Step 12.2: Modify `findAndLockDevice` to exclude active leases**

In `src/data-service/device-store.ts`, locate the `findAndLockDevice` method. Before the existing `update` call, add a pre-filter that excludes devices with an active lease:

```typescript
async findAndLockDevice(filterOptions: IDeviceFilterOptions): Promise<IDevice | null> {
  // Find UDIDs that are currently held by an active Lease — exclude them.
  const activeLeases = await prisma.lease.findMany({
    where: { status: 'active' },
    select: { deviceUdid: true, deviceHost: true },
  });
  const blockedKeys = new Set(activeLeases.map((l: any) => `${l.deviceUdid}@${l.deviceHost}`));

  // Existing find-and-lock logic, but skip devices in blockedKeys.
  const candidates = await this.findDevices({ ...filterOptions, busy: false });
  const available = candidates.find((d) => !blockedKeys.has(`${d.udid}@${d.host}`));
  if (!available) return null;
  await this.updateDevice(available.udid, available.host, { busy: true });
  return available;
}
```

(Adapt to the actual existing implementation — the controller MUST read the current `findAndLockDevice` body and add the active-lease filter without breaking existing behavior. The bullet above is the conceptual transform.)

- [ ] **Step 12.3: Run tests**

```bash
npx mocha test/unit/findAndLockDevice-leasemerge.spec.ts 2>&1 | tail -10
npm test 2>&1 | tail -10
```

Expected: new test passes; existing device-store tests still green.

- [ ] **Step 12.4: Commit**

```bash
git add src/data-service/device-store.ts test/unit/findAndLockDevice-leasemerge.spec.ts
git commit -m "$(cat <<'EOF'
feat(device-store): findAndLockDevice excludes active-lease devices

Reads active Lease rows once per call and filters candidates. Legacy
reservedBy/reservedUntil semantics unchanged — devices blocked by
either path are correctly excluded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Lease-aware Appium session-create

**Files:**
- Modify: `src/device-utils.ts`
- Modify: `src/XenonCapabilityManager.ts`

- [ ] **Step 13.1: Early-return lease-bound device in `allocateDeviceForSession`**

In `src/device-utils.ts`, locate `allocateDeviceForSession`. Add an early-return branch at the top (after capability normalization but BEFORE the wait loop):

```typescript
// Lease-bound session: SDK acquired a lease via /xenon/api/sdk/leases and
// passes its id through caps. Resolve directly; skip findAndLockDevice
// (device is already locked) and skip port allocation in XenonCapabilityManager
// (ports are already in firstMatch).
const xenonOpts = (firstMatch['xenon:options'] ?? {}) as Record<string, unknown>;
const leaseId = typeof xenonOpts.leaseId === 'string' ? xenonOpts.leaseId : undefined;
if (leaseId) {
  const { LeaseService } = await import('./services/lease/LeaseService');
  const { Container } = await import('typedi');
  const resolved = await Container.get(LeaseService).resolve(leaseId);
  if (!resolved) {
    throw new Error(`lease ${leaseId} is not active`);
  }
  const device = await store.getDevice({ udid: [resolved.deviceUdid], host: resolved.deviceHost });
  if (!device) {
    throw new Error(`lease ${leaseId} references missing device ${resolved.deviceUdid}@${resolved.deviceHost}`);
  }
  return device;
}
```

Place this immediately after the `firstMatch` is computed (existing line `const firstMatch = Object.assign({}, capability.firstMatch?.[0] ?? {}, capability.alwaysMatch);`).

- [ ] **Step 13.2: Guard `androidCapabilities` against overwriting lease-provided ports**

In `src/XenonCapabilityManager.ts`, find `androidCapabilities`. Replace the existing direct port assignments with conditional guards that recognize both the lease's lowercase `appium:chromedriverPort` and the existing capital-D `appium:chromeDriverPort` (a pre-existing inconsistency we don't want to fix in this PR — too risky to change the non-lease path's casing):

```typescript
if (!fm['appium:systemPort']) {
  fm['appium:systemPort'] = await getPort();
}
// Note: the lease bag emits lowercase `chromedriverPort` (W3C-canonical);
// the existing non-lease path uses capital `chromeDriverPort`. Recognize
// both spellings so a lease-provided lowercase value is not duplicated.
if (!fm['appium:chromedriverPort'] && !fm['appium:chromeDriverPort']) {
  fm['appium:chromeDriverPort'] = await getPort();
}
if (!fm['appium:mjpegServerPort']) {
  fm['appium:mjpegServerPort'] = await getPort();
}
```

Do the same in `iOSCapabilities` for `appium:wdaLocalPort` and `appium:mjpegServerPort` (these don't have a casing issue):

```typescript
if (!fm['appium:wdaLocalPort']) {
  fm['appium:wdaLocalPort'] = await getPort();
}
if (!fm['appium:mjpegServerPort']) {
  fm['appium:mjpegServerPort'] = await getPort();
}
```

- [ ] **Step 13.3: Build to confirm types**

```bash
npm run build 2>&1 | tail -8
npm test 2>&1 | tail -10
```

Expected: BUILD SUCCESSFUL; tests green.

- [ ] **Step 13.4: Commit**

```bash
git add src/device-utils.ts src/XenonCapabilityManager.ts
git commit -m "$(cat <<'EOF'
feat(session): recognize xenon:options.leaseId in session-create

allocateDeviceForSession early-returns the leased device when the SDK
passes leaseId in caps. XenonCapabilityManager skips port injection
when ports are already in firstMatch — letting the lease's
server-allocated ports flow through unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR 5 — Deprecation headers, version probe, release

### Task 14: `Deprecation` / `Sunset` headers on `/reservation`

**Files:**
- Modify: `src/app/routers/reservation.ts`
- Test: `test/integration/legacy-deprecation-headers.spec.ts`

- [ ] **Step 14.1: Write the failing test**

Create `test/integration/legacy-deprecation-headers.spec.ts`:

```typescript
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';

describe('legacy /reservation headers', () => {
  it('GET /reservation returns Deprecation + Sunset + Link headers', async () => {
    const router = (await import('../../src/app/routers/reservation')).default;
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'a' }; req.auth = { teamIds: ['t'] }; next();
    });
    app.use('/reservation', router);
    const res = await request(app).get('/reservation');
    expect(res.headers['deprecation']).to.equal('true');
    expect(res.headers['sunset']).to.match(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.headers['link']).to.include('rel="alternate"');
  });
});
```

- [ ] **Step 14.2: Add a deprecation-headers middleware to the reservation router**

At the top of `src/app/routers/reservation.ts` (after `const router = express.Router();`), insert:

```typescript
// Phase 2: legacy reservation endpoints are deprecated in favor of
// /xenon/api/sdk/leases. Per RFC 8594, advertise the deprecation +
// sunset date + link to the migration path on every response.
const SUNSET_DATE = '2027-01-01T00:00:00Z';
const LEASE_DOC_URL =
  'https://github.com/qasecret/xenon/blob/main/docs/superpowers/specs/2026-05-14-server-side-lease-api-design.md';

router.use((_req, res, next) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', SUNSET_DATE);
  res.setHeader('Link', `<${LEASE_DOC_URL}>; rel="alternate"`);
  next();
});
```

- [ ] **Step 14.3: Run tests**

```bash
npx mocha test/integration/legacy-deprecation-headers.spec.ts 2>&1 | tail -10
npm test 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 14.4: Commit**

```bash
git add src/app/routers/reservation.ts test/integration/legacy-deprecation-headers.spec.ts
git commit -m "$(cat <<'EOF'
feat(reservation): emit Deprecation + Sunset + Link headers (RFC 8594)

Every response from legacy /reservation endpoints now advertises the
migration path. Plugin 2.0.0 (target: 2027-01-01) removes them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: `GET /xenon/api/sdk/version`

**Files:**
- Create: `src/app/routers/sdk-version.ts`
- Test: `test/integration/sdk-version.spec.ts`
- Modify: `src/app/index.ts`

- [ ] **Step 15.1: Write the failing test**

Create `test/integration/sdk-version.spec.ts`:

```typescript
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';

describe('GET /xenon/api/sdk/version', () => {
  it('returns pluginVersion + supports array', async () => {
    const register = (await import('../../src/app/routers/sdk-version')).default;
    const app = express();
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'a' }; req.auth = { teamIds: ['t'] }; next();
    });
    register(app);
    const res = await request(app).get('/xenon/api/sdk/version');
    expect(res.status).to.equal(200);
    expect(res.body.pluginVersion).to.be.a('string');
    expect(res.body.supports).to.include.members(['leases', 'ports', 'heartbeat']);
  });
});
```

- [ ] **Step 15.2: Implement**

Create `src/app/routers/sdk-version.ts`:

```typescript
import { Router, Request, Response } from 'express';
import pkg from '../../../package.json';
import { roleGuard } from '../../middleware/roleGuard';

const SUPPORTS = ['leases', 'ports', 'heartbeat'] as const;

export default function register(app: any): void {
  const router = Router();
  router.use(roleGuard('MEMBER'));
  router.get('/', (_req: Request, res: Response) => {
    res.json({ pluginVersion: pkg.version, supports: [...SUPPORTS] });
  });
  app.use('/xenon/api/sdk/version', router);
}
```

- [ ] **Step 15.3: Register in app/index.ts**

Add the import near other router imports:

```typescript
import registerSdkVersionRouter from './routers/sdk-version';
```

In the registration block:

```typescript
registerSdkVersionRouter(apiRouter);
```

(Note: `sdk-version.ts`'s `register` function takes an `app` and mounts at `/xenon/api/sdk/version`. If wired through `apiRouter`, mount at `/sdk/version` instead — adjust the second arg / the path in the implementation to keep consistency with sibling routers. The controller MUST verify which mount pattern matches the surrounding code and make the appropriate adjustment.)

- [ ] **Step 15.4: Run tests**

```bash
npx mocha test/integration/sdk-version.spec.ts 2>&1 | tail -10
npm test 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 15.5: Commit**

```bash
git add src/app/routers/sdk-version.ts src/app/index.ts test/integration/sdk-version.spec.ts
git commit -m "$(cat <<'EOF'
feat(sdk-version): GET /xenon/api/sdk/version feature probe

Returns pluginVersion + supports: ['leases','ports','heartbeat']. The
Kotlin SDK feature-detects via this endpoint and dispatches lease() to
either the new /sdk/leases endpoint or the legacy list-then-reserve walk.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Version bump 1.6.0 → 1.7.0

**Files:**
- Modify: `package.json`

- [ ] **Step 16.1: Bump**

Open `package.json` and change `"version": "1.6.0"` to `"version": "1.7.0"`.

- [ ] **Step 16.2: Verify the full build**

```bash
npm run build 2>&1 | tail -8
npm test 2>&1 | tail -10
```

Expected: BUILD SUCCESSFUL, tests green.

- [ ] **Step 16.3: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore(release): bump to 1.7.0

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Final acceptance walk-through

- [ ] **Step 17.1: Run the full build**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
npm run build 2>&1 | tail -15
npm test 2>&1 | tail -15
```

Expected: BUILD SUCCESSFUL. Full test suite green including all new tests.

- [ ] **Step 17.2: Manually walk spec §11 acceptance criteria**

For each line of spec §11 (`docs/superpowers/specs/2026-05-14-server-side-lease-api-design.md`), verify the implementation exists:

- `Lease` and updated `PortLease` models exist with a migration in `prisma/migrations/`
- `POST /xenon/api/sdk/leases` happy path works (integration test passes)
- `POST /xenon/api/sdk/leases/:id/heartbeat` validates token (403/410 paths covered)
- `LeaseOrphanSweeper` reaps stale leases (unit test covers; 30s tick wired in ServerManager)
- `findAndLockDevice` considers both legacy and new locks (unit test verifies)
- Legacy `/reservation` emits `Deprecation`/`Sunset` headers (integration test verifies)
- `GET /xenon/api/sdk/version` reports the supports array
- Hub→node port-RPC has integration test (mocked node)

If anything is missing, file a follow-up — do not silently ship.

- [ ] **Step 17.3: Verify no new deprecation warnings or stray suppressions**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
grep -rn "@ts-ignore\|@ts-nocheck" src/services/lease src/services/ports src/app/routers/sdk-leases.ts src/app/routers/sdk-version.ts src/app/routers/ports.ts 2>/dev/null
```

Expected: no matches. New code should not depend on type suppressions.

---

## Rollout (not a code task — for the operator)

- Push the branch: `git push -u origin feat/server-lease-api-spec`.
- Open the release PR `feat/server-lease-api-spec → main` titled `feat(release): 1.7.0 — server-side Lease API (Phase 2)`.
- After review + green CI, merge. The existing `release.yml` workflow auto-publishes 1.7.0 to npm / wherever the plugin is published (verify against the plugin's actual release workflow — the Kotlin SDK release flow doesn't apply here).
- File a follow-up: Kotlin SDK adoption PR. Bump SDK to feature-detect `/sdk/version` and dispatch `DeviceManager.lease()` through the new endpoint when `supports` includes `"leases"`.
- Track plugin 2.0.0 in the backlog: removes `/reservation`, drops `Device.reservedBy`/`reservedUntil`, runs the migration that copies live reservations into synthetic Lease rows. Target: `2027-01-01` (per Sunset header). Open a separate spec/plan cycle when ready.
