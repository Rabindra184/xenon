# Device Access Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a user from driving a device that another user — or another user's Appium session — already holds, by making the existing manual lock authoritative at a single chokepoint in the `/control` router.

**Architecture:** A pure policy function decides access from plain data; a thin Express middleware does the I/O and mounts once on the `/control` router, guarding every non-GET request except a short reasoned allowlist. `POST /stream/start` gets its own pure decision function because "busy" means something different at stream-start time. Ownership is keyed on `req.auth.userId` (the human) rather than the credential.

**Tech Stack:** TypeScript 5.5, Express 4, TypeDI, Prisma 5 (SQLite), Mocha + Chai + Sinon + supertest, React 17 frontend.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-08-device-access-guard-design.md`. Read it before Task 1.
- Branch `feat/device-access-guard` already exists and holds the spec commit. Work on it.
- **Never run the full test suite** (`npm test`, or a broad mocha glob) — it crashes this repo. Run only the exact spec file named in each step.
- **Never run `eslint --fix`** across `src/` — the repo carries ~25 pre-existing prettier errors and `--fix` sweeps unrelated files into the diff.
- **`git add` explicit paths only.** Never `git add -A` or `git add .`.
- Every spec file that imports anything reaching `SessionManager` needs `import 'reflect-metadata';` as its first line.
- `schema.json` must not be modified. This change adds no plugin args.
- Verify each new guard is non-vacuous: neuter its condition (`if (false && …)`), confirm the test goes red, restore.
- CI has no build/test gate. `npx tsc --noEmit` must pass locally before merge.

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `src/services/device-access/deviceAccessPolicy.ts` | Pure. Access decision + deny-response body. No I/O. |
| `src/services/device-access/actor.ts` | Pure-ish. Maps an Express `Request` to `{ userId, apiKeyId, isAdmin }`. |
| `src/services/device-access/SessionOwnerResolver.ts` | Resolves an Appium session id to its owning userId, and a userId to a display name. Memoized. |
| `src/middleware/deviceAccessGuard.ts` | Express middleware + the unguarded-endpoint allowlist. |
| `src/app/routers/streamStartConflict.ts` | Pure. `stream/start` conflict decision (proceed / reclaim / deny). |
| `test/unit/device-access-policy.spec.ts` | Truth table for the policy. |
| `test/unit/session-owner-resolver.spec.ts` | Owner resolution + caching behaviour. |
| `test/unit/device-access-guard.spec.ts` | Middleware behaviour via supertest. |
| `test/unit/stream-start-conflict.spec.ts` | The lock-steal scenario. |

**Modify:**

| Path | Change |
|---|---|
| `src/app/routers/control.ts:49` | Mount `deviceAccessGuard()`. |
| `src/app/routers/control.ts:516-599` | Rewrite the `stream/start` conflict block; key the manual lock on `userId`. |
| `web/src/api-service/api-client.ts:39-48` | Surface a 409 device-conflict as a toast. |

---

### Task 1: Pure access policy

**Files:**
- Create: `src/services/device-access/deviceAccessPolicy.ts`
- Test: `test/unit/device-access-policy.spec.ts`

**Interfaces:**
- Consumes: `inspectManualLock` from `src/services/recording/manualLock.ts` (existing).
- Produces: `evaluateDeviceAccess(input: DeviceAccessInput): DeviceAccessDecision`, `denyBody(code, holderId, holderName): DenyBody`, types `DeviceAccessDenyCode`, `DeviceAccessInput`, `DeviceAccessDecision`. Tasks 3 and 4 both import these.

- [ ] **Step 1: Write the failing test**

Create `test/unit/device-access-policy.spec.ts`:

```ts
import { expect } from 'chai';
import {
  evaluateDeviceAccess,
  denyBody,
  DeviceAccessInput,
} from '../../src/services/device-access/deviceAccessPolicy';

// Guards the gap where every /control mutation (tap, swipe, text, install,
// shell, …) reached the device with no ownership check at all: only
// stream/stop consulted the manual lock. See
// docs/superpowers/specs/2026-08-08-device-access-guard-design.md.

const UDID = 'DEV-1';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';

function input(over: Partial<DeviceAccessInput> = {}): DeviceAccessInput {
  return {
    udid: UDID,
    busy: true,
    sessionId: `manual_${ALICE}_${UDID}`,
    sessionOwnerUserId: null,
    actorUserId: ALICE,
    actorApiKeyId: undefined,
    isAdmin: false,
    ...over,
  };
}

describe('evaluateDeviceAccess', () => {
  it('allows an admin regardless of who holds the device', () => {
    const d = evaluateDeviceAccess(input({ actorUserId: BOB, isAdmin: true }));
    expect(d).to.deep.equal({ allow: true });
  });

  it('allows anyone when the device is not busy', () => {
    const d = evaluateDeviceAccess(input({ busy: false, actorUserId: BOB }));
    expect(d).to.deep.equal({ allow: true });
  });

  it('allows the owner of a manual lock', () => {
    expect(evaluateDeviceAccess(input())).to.deep.equal({ allow: true });
  });

  it('allows a lock written with the caller apiKeyId (upgrade tolerance)', () => {
    const d = evaluateDeviceAccess(
      input({
        sessionId: `manual_key_abc_${UDID}`,
        actorUserId: ALICE,
        actorApiKeyId: 'key_abc',
      }),
    );
    expect(d).to.deep.equal({ allow: true });
  });

  it('denies a manual lock owned by another user, naming the holder', () => {
    const d = evaluateDeviceAccess(input({ actorUserId: BOB }));
    expect(d).to.deep.equal({
      allow: false,
      code: 'device_held_by_another_user',
      holderId: ALICE,
    });
  });

  it('allows a legacy ownerless lock', () => {
    const d = evaluateDeviceAccess(
      input({ sessionId: `manual_${UDID}`, actorUserId: BOB }),
    );
    expect(d).to.deep.equal({ allow: true });
  });

  it('allows the owner of the running Appium session', () => {
    const d = evaluateDeviceAccess(
      input({ sessionId: 'appium-sess-1', sessionOwnerUserId: ALICE }),
    );
    expect(d).to.deep.equal({ allow: true });
  });

  it('denies an Appium session owned by another user', () => {
    const d = evaluateDeviceAccess(
      input({ sessionId: 'appium-sess-1', sessionOwnerUserId: ALICE, actorUserId: BOB }),
    );
    expect(d).to.deep.equal({
      allow: false,
      code: 'device_in_use_by_session',
      holderId: ALICE,
    });
  });

  it('denies when the session owner cannot be attributed (fail closed)', () => {
    const d = evaluateDeviceAccess(
      input({ sessionId: 'appium-sess-1', sessionOwnerUserId: null }),
    );
    expect(d).to.deep.equal({
      allow: false,
      code: 'device_in_use_by_session',
      holderId: '',
    });
  });

  it('denies a busy device carrying no session id at all', () => {
    const d = evaluateDeviceAccess(input({ sessionId: null }));
    expect(d).to.deep.equal({
      allow: false,
      code: 'device_in_use_by_session',
      holderId: '',
    });
  });
});

describe('denyBody', () => {
  it('names the holder when one resolved', () => {
    const b = denyBody('device_held_by_another_user', ALICE, 'alice@example.com');
    expect(b.success).to.equal(false);
    expect(b.error).to.equal('device_held_by_another_user');
    expect(b.message).to.contain('alice@example.com');
    expect(b.holder).to.deep.equal({ userId: ALICE, name: 'alice@example.com' });
  });

  it('falls back to a generic phrase when the holder does not resolve', () => {
    const b = denyBody('device_held_by_another_user', 'key_abc', null);
    expect(b.message).to.contain('another user');
    expect(b.holder).to.deep.equal({ userId: 'key_abc', name: undefined });
  });

  it('omits holder entirely when there is no holder id', () => {
    const b = denyBody('device_in_use_by_session', '', null);
    expect(b.holder).to.equal(undefined);
    expect(b.message).to.contain('another user');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha test/unit/device-access-policy.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/services/device-access/deviceAccessPolicy'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/device-access/deviceAccessPolicy.ts`:

```ts
import { inspectManualLock } from '../recording/manualLock';

/**
 * Access policy for /control mutations.
 *
 * Pure by design: no Express, no Prisma, no Container. The middleware
 * (src/middleware/deviceAccessGuard.ts) does the I/O and hands plain data in,
 * so the whole truth table is unit-testable without a device or a database.
 *
 * Ownership is keyed on the *user*, not the credential. `req.apiKey` is never
 * populated for dashboard cookie sessions, so a key-based identity would deny
 * a user their own device the moment they switched credential paths, and could
 * never match Session.api_key_id -> ApiKey.userId.
 */
export type DeviceAccessDenyCode = 'device_held_by_another_user' | 'device_in_use_by_session';

export interface DeviceAccessInput {
  udid: string;
  busy: boolean;
  /** device.session_id — a manual lock, an Appium session id, or null. */
  sessionId: string | null | undefined;
  /** Resolved owner of an Appium session id. null when unattributable. */
  sessionOwnerUserId?: string | null;
  actorUserId?: string;
  /**
   * The caller's current API-key id. Only used to recognise locks written by
   * versions that keyed on apiKey.id. Locks are ephemeral device-row state, so
   * this tolerance can be dropped a release after ship.
   */
  actorApiKeyId?: string;
  isAdmin: boolean;
}

export type DeviceAccessDecision =
  | { allow: true }
  | { allow: false; code: DeviceAccessDenyCode; holderId: string };

export interface DenyBody {
  success: false;
  error: DeviceAccessDenyCode;
  message: string;
  holder?: { userId: string; name: string | undefined };
}

const ALLOW: DeviceAccessDecision = { allow: true };

export function evaluateDeviceAccess(input: DeviceAccessInput): DeviceAccessDecision {
  if (input.isAdmin) return ALLOW;
  if (!input.busy) return ALLOW;

  const asUser = inspectManualLock(input.sessionId, input.actorUserId, input.udid);
  if (asUser) {
    // Ownerless orphan. stream/stop already lets any caller clear one; denying
    // here would strand the device for everybody.
    if (asUser.legacy) return ALLOW;
    // "Self" is the disjunction over both candidate identities. Collapsing this
    // to a single inspectManualLock call silently drops the upgrade tolerance.
    const asKey = inspectManualLock(input.sessionId, input.actorApiKeyId, input.udid);
    if (asUser.self || asKey?.self) return ALLOW;
    return { allow: false, code: 'device_held_by_another_user', holderId: asUser.actorId };
  }

  // Not a manual lock: a real Appium session holds the device (or the row is
  // busy with no id at all, which is an inconsistent state we fail closed on).
  const owner = input.sessionOwnerUserId ?? '';
  if (owner && input.actorUserId && owner === input.actorUserId) return ALLOW;
  return { allow: false, code: 'device_in_use_by_session', holderId: owner };
}

export function denyBody(
  code: DeviceAccessDenyCode,
  holderId: string,
  holderName: string | null,
): DenyBody {
  const who = holderName || 'another user';
  const message =
    code === 'device_held_by_another_user'
      ? `Device is being controlled by ${who}. Ask them to release it, or use an admin key to force-release.`
      : `Device is in use by an Appium session owned by ${who}.`;
  return {
    success: false,
    error: code,
    message,
    holder: holderId ? { userId: holderId, name: holderName ?? undefined } : undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx mocha test/unit/device-access-policy.spec.ts
```

Expected: PASS, 13 passing.

- [ ] **Step 5: Verify the tests are not vacuous**

In `deviceAccessPolicy.ts`, temporarily change `if (input.isAdmin) return ALLOW;` to `if (false && input.isAdmin) return ALLOW;` and re-run. Expected: the admin test FAILS. Restore the line and confirm green again.

- [ ] **Step 6: Commit**

```bash
git add src/services/device-access/deviceAccessPolicy.ts test/unit/device-access-policy.spec.ts
git commit -m "feat(device-access): pure ownership policy for control endpoints"
```

---

### Task 2: Session owner resolution

**Files:**
- Create: `src/services/device-access/SessionOwnerResolver.ts`
- Test: `test/unit/session-owner-resolver.spec.ts`

**Interfaces:**
- Consumes: `prisma` from `src/prisma.ts`, injected via constructor default so tests pass a stub.
- Produces: class `SessionOwnerResolver` with `ownerOf(sessionId: string): Promise<string | null>`, `displayName(userId: string): Promise<string | null>`, `clear(): void`. Tasks 3 and 4 resolve it via `Container.get(SessionOwnerResolver)`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/session-owner-resolver.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import { SessionOwnerResolver } from '../../src/services/device-access/SessionOwnerResolver';

// A stub shaped like the two Prisma delegates the resolver touches, counting
// calls so the caching contract is observable.
function stubDb(opts: {
  session?: { api_key_id: string | null } | null;
  apiKey?: { userId: string } | null;
  user?: { email: string; name: string } | null;
}) {
  const calls = { session: 0, apiKey: 0, user: 0 };
  return {
    calls,
    session: {
      findUnique: async () => {
        calls.session += 1;
        return opts.session ?? null;
      },
    },
    apiKey: {
      findUnique: async () => {
        calls.apiKey += 1;
        return opts.apiKey ?? null;
      },
    },
    user: {
      findUnique: async () => {
        calls.user += 1;
        return opts.user ?? null;
      },
    },
  };
}

describe('SessionOwnerResolver.ownerOf', () => {
  it('resolves session -> apiKey -> userId', async () => {
    const db = stubDb({ session: { api_key_id: 'key_1' }, apiKey: { userId: 'usr_alice' } });
    const r = new SessionOwnerResolver(db);
    expect(await r.ownerOf('sess-1')).to.equal('usr_alice');
  });

  it('returns null when the session has no api_key_id', async () => {
    const db = stubDb({ session: { api_key_id: null } });
    const r = new SessionOwnerResolver(db);
    expect(await r.ownerOf('sess-1')).to.equal(null);
  });

  it('returns null when the session row is missing', async () => {
    const db = stubDb({ session: null });
    const r = new SessionOwnerResolver(db);
    expect(await r.ownerOf('sess-1')).to.equal(null);
  });

  it('returns null when the api key row is gone', async () => {
    const db = stubDb({ session: { api_key_id: 'key_1' }, apiKey: null });
    const r = new SessionOwnerResolver(db);
    expect(await r.ownerOf('sess-1')).to.equal(null);
  });

  it('caches a resolved owner — session ownership never changes', async () => {
    const db = stubDb({ session: { api_key_id: 'key_1' }, apiKey: { userId: 'usr_alice' } });
    const r = new SessionOwnerResolver(db);
    await r.ownerOf('sess-1');
    await r.ownerOf('sess-1');
    expect(db.calls.session).to.equal(1);
    expect(db.calls.apiKey).to.equal(1);
  });

  it('does NOT cache an unresolved owner — the row may not be written yet', async () => {
    const db = stubDb({ session: null });
    const r = new SessionOwnerResolver(db);
    await r.ownerOf('sess-1');
    await r.ownerOf('sess-1');
    expect(db.calls.session).to.equal(2);
  });
});

describe('SessionOwnerResolver.displayName', () => {
  it('prefers email', async () => {
    const db = stubDb({ user: { email: 'alice@example.com', name: 'Alice' } });
    const r = new SessionOwnerResolver(db);
    expect(await r.displayName('usr_alice')).to.equal('alice@example.com');
  });

  it('returns null for an id that is not a user (e.g. a legacy apiKey id)', async () => {
    const db = stubDb({ user: null });
    const r = new SessionOwnerResolver(db);
    expect(await r.displayName('key_abc')).to.equal(null);
  });

  it('caches a resolved name', async () => {
    const db = stubDb({ user: { email: 'alice@example.com', name: 'Alice' } });
    const r = new SessionOwnerResolver(db);
    await r.displayName('usr_alice');
    await r.displayName('usr_alice');
    expect(db.calls.user).to.equal(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha test/unit/session-owner-resolver.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/services/device-access/SessionOwnerResolver'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/device-access/SessionOwnerResolver.ts`:

```ts
import { Service } from 'typedi';
import { prisma as defaultPrisma } from '../../prisma';

/** Bound so a long-lived server cannot accumulate entries without limit. */
const MAX_CACHE_ENTRIES = 500;

/**
 * Resolves who owns a running Appium session, and how to name them.
 *
 * `Session.api_key_id` records the key that created the session; the owning
 * human is `ApiKey.userId`. Comparing at user level is what lets a dashboard
 * (cookie) caller be recognised as the owner of a session they started with an
 * SDK key.
 *
 * Only positive results are cached. Session ownership never changes for a
 * given session id, so a resolved owner cannot go stale — but a *negative*
 * result can simply mean the Session row has not been written yet, and caching
 * that would deny the owner their own device for the life of the process.
 */
@Service()
export class SessionOwnerResolver {
  private ownerCache = new Map<string, string>();
  private nameCache = new Map<string, string>();

  constructor(private readonly db: any = defaultPrisma) {}

  async ownerOf(sessionId: string): Promise<string | null> {
    if (!sessionId) return null;
    const cached = this.ownerCache.get(sessionId);
    if (cached) return cached;

    const session = await this.db.session.findUnique({
      where: { id: sessionId },
      select: { api_key_id: true },
    });
    if (!session?.api_key_id) return null;

    const key = await this.db.apiKey.findUnique({
      where: { id: session.api_key_id },
      select: { userId: true },
    });
    const owner: string | null = key?.userId ?? null;
    if (owner) this.remember(this.ownerCache, sessionId, owner);
    return owner;
  }

  async displayName(userId: string): Promise<string | null> {
    if (!userId) return null;
    const cached = this.nameCache.get(userId);
    if (cached) return cached;

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    const label: string | null = user?.email ?? user?.name ?? null;
    if (label) this.remember(this.nameCache, userId, label);
    return label;
  }

  clear(): void {
    this.ownerCache.clear();
    this.nameCache.clear();
  }

  private remember(cache: Map<string, string>, key: string, value: string): void {
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(key, value);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx mocha test/unit/session-owner-resolver.spec.ts
```

Expected: PASS, 9 passing.

- [ ] **Step 5: Verify the negative-caching test is not vacuous**

Temporarily change `if (owner) this.remember(...)` to `this.remember(this.ownerCache, sessionId, owner as string)` — the "does NOT cache an unresolved owner" test must still pass (it never reaches that line), but add a temporary `this.ownerCache.set(sessionId, '')` right before `return null` in the no-`api_key_id` branch and confirm that test FAILS. Restore both.

- [ ] **Step 6: Commit**

```bash
git add src/services/device-access/SessionOwnerResolver.ts test/unit/session-owner-resolver.spec.ts
git commit -m "feat(device-access): resolve Appium session owner to a userId"
```

---

### Task 3: Guard middleware, mounted on /control

**Files:**
- Create: `src/services/device-access/actor.ts`
- Create: `src/middleware/deviceAccessGuard.ts`
- Modify: `src/app/routers/control.ts:49`
- Test: `test/unit/device-access-guard.spec.ts`

**Interfaces:**
- Consumes: `evaluateDeviceAccess`, `denyBody` (Task 1); `SessionOwnerResolver` (Task 2); `isManualLock` from `src/services/recording/manualLock.ts`.
- Produces: `resolveActor(req): DeviceAccessActor` with `{ userId?: string; apiKeyId?: string; isAdmin: boolean }` — Task 4 imports it. `deviceAccessGuard(deps?: DeviceAccessGuardDeps)` returning an Express middleware. `UNGUARDED_CONTROL_MUTATIONS: readonly string[]`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/device-access-guard.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { deviceAccessGuard } from '../../src/middleware/deviceAccessGuard';

const UDID = 'DEV-1';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';

// Mini router shaped like /control: a udid segment then an action segment.
function appWith(opts: {
  actorUserId?: string;
  role?: string;
  scopes?: string;
  busy?: boolean;
  sessionId?: string | null;
  sessionOwner?: string | null;
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (opts.actorUserId) {
      (req as any).auth = {
        kind: 'api-key',
        userId: opts.actorUserId,
        role: opts.role ?? 'MEMBER',
        scopes: opts.scopes ?? 'devices',
        rateLimit: 100,
      };
    }
    next();
  });
  const router = express.Router();
  router.use(
    deviceAccessGuard({
      findDevice: async () => ({
        busy: opts.busy ?? true,
        session_id: opts.sessionId === undefined ? `manual_${ALICE}_${UDID}` : opts.sessionId,
      }),
      resolveSessionOwner: async () => opts.sessionOwner ?? null,
      describeHolder: async (id: string) =>
        id === ALICE ? 'alice@example.com' : null,
    }),
  );
  router.post('/:udid/tap', (_req, res) => res.json({ success: true, reached: true }));
  router.get('/:udid/screenshot', (_req, res) => res.json({ reached: true }));
  router.post('/:udid/stream/start', (_req, res) => res.json({ reached: true }));
  router.post('/:udid/stream/stop', (_req, res) => res.json({ reached: true }));
  router.post('/:udid/stream/ticket', (_req, res) => res.json({ reached: true }));
  app.use('/control', router);
  return app;
}

describe('deviceAccessGuard', () => {
  it('lets the lock owner through', async () => {
    const res = await request(appWith({ actorUserId: ALICE })).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(200);
    expect(res.body.reached).to.equal(true);
  });

  it('denies a foreign holder with 409 and names them', async () => {
    const res = await request(appWith({ actorUserId: BOB })).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(409);
    expect(res.body.error).to.equal('device_held_by_another_user');
    expect(res.body.message).to.contain('alice@example.com');
    expect(res.body.holder).to.deep.equal({ userId: ALICE, name: 'alice@example.com' });
  });

  it('never blocks a GET', async () => {
    const res = await request(appWith({ actorUserId: BOB })).get(`/control/${UDID}/screenshot`);
    expect(res.status).to.equal(200);
  });

  it('skips stream/start, stream/stop and stream/ticket', async () => {
    const app = appWith({ actorUserId: BOB });
    for (const p of ['stream/start', 'stream/stop', 'stream/ticket']) {
      const res = await request(app).post(`/control/${UDID}/${p}`);
      expect(res.status, p).to.equal(200);
    }
  });

  it('lets an admin-scoped key through', async () => {
    const res = await request(
      appWith({ actorUserId: BOB, scopes: 'admin' }),
    ).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(200);
  });

  it('lets a SUPER_ADMIN through', async () => {
    const res = await request(
      appWith({ actorUserId: BOB, role: 'SUPER_ADMIN' }),
    ).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(200);
  });

  it('does not treat a scope merely containing "admin" as admin', async () => {
    const res = await request(
      appWith({ actorUserId: BOB, scopes: 'nonadmin,devices' }),
    ).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(409);
  });

  it('401s when there is no actor', async () => {
    const res = await request(appWith({})).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(401);
  });

  it('denies a foreign Appium session', async () => {
    const res = await request(
      appWith({ actorUserId: BOB, sessionId: 'appium-1', sessionOwner: ALICE }),
    ).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(409);
    expect(res.body.error).to.equal('device_in_use_by_session');
  });

  it('allows the owner of the running Appium session', async () => {
    const res = await request(
      appWith({ actorUserId: ALICE, sessionId: 'appium-1', sessionOwner: ALICE }),
    ).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(200);
  });

  it('falls through to the handler when the device is unknown', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).auth = { kind: 'api-key', userId: BOB, role: 'MEMBER', scopes: 'devices', rateLimit: 1 };
      next();
    });
    const router = express.Router();
    router.use(deviceAccessGuard({ findDevice: async () => null }));
    router.post('/:udid/tap', (_req, res) => res.status(404).send('Device not found'));
    app.use('/control', router);
    const res = await request(app).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha test/unit/device-access-guard.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/middleware/deviceAccessGuard'`.

- [ ] **Step 3: Write `actor.ts`**

Create `src/services/device-access/actor.ts`:

```ts
/// <reference path="../../types/express.d.ts" />
import type { Request } from 'express';

export interface DeviceAccessActor {
  userId?: string;
  apiKeyId?: string;
  isAdmin: boolean;
}

/**
 * Map a request to the identity ownership is judged against.
 *
 * `userId` is the authority — it is populated on every credential path.
 * `apiKeyId` is carried only so locks written by versions that keyed on
 * apiKey.id are still recognised as their owner's.
 *
 * Admin detection splits scopes on ',' rather than using String.includes, so a
 * scope like 'nonadmin' cannot grant a bypass. (control.ts's stream/stop check
 * still uses the substring form — noted as a follow-up in the spec.)
 */
export function resolveActor(req: Request): DeviceAccessActor {
  const auth = req.auth;
  const rawScopes = auth?.scopes ?? req.apiKey?.scopes ?? '';
  const scopes = new Set(rawScopes.split(',').map((s) => s.trim()));
  return {
    userId: auth?.userId,
    apiKeyId: auth?.apiKeyId ?? req.apiKey?.id,
    isAdmin: auth?.role === 'SUPER_ADMIN' || scopes.has('admin'),
  };
}
```

- [ ] **Step 4: Write `deviceAccessGuard.ts`**

Create `src/middleware/deviceAccessGuard.ts`:

```ts
/// <reference path="../types/express.d.ts" />
import type { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import log from '../logger';
import { DeviceStoreFactory } from '../data-service/device-store';
import { isManualLock } from '../services/recording/manualLock';
import { SessionOwnerResolver } from '../services/device-access/SessionOwnerResolver';
import { evaluateDeviceAccess, denyBody } from '../services/device-access/deviceAccessPolicy';
import { resolveActor } from '../services/device-access/actor';

const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Mutations under /control that this guard must NOT handle.
 *
 * Every entry needs a reason. Adding one without a reason re-opens the hole
 * this guard exists to close.
 */
export const UNGUARDED_CONTROL_MUTATIONS: readonly string[] = [
  'stream/start', // own conflict handling — see app/routers/streamStartConflict.ts
  'stream/stop', // richer check already: self | legacy | admin, plus orphan release
  'stream/ticket', // mints a viewing credential; viewing is a read
];

export interface DeviceAccessGuardDeps {
  findDevice?: (
    udid: string,
  ) => Promise<{ busy?: boolean; session_id?: string | null } | null | undefined>;
  resolveSessionOwner?: (sessionId: string) => Promise<string | null>;
  describeHolder?: (holderId: string) => Promise<string | null>;
}

/**
 * Refuse /control mutations against a device somebody else holds.
 *
 * Guards by HTTP method rather than by an enumerated path list, so an endpoint
 * added later is protected by default. That property is the whole point: the
 * gap this closes existed because ownership had to be remembered in ~20
 * handlers and was remembered in none of them.
 */
export function deviceAccessGuard(deps: DeviceAccessGuardDeps = {}) {
  const findDevice =
    deps.findDevice ?? ((udid: string) => DeviceStoreFactory.getStore().findDevice({ udid }));
  const resolveSessionOwner =
    deps.resolveSessionOwner ??
    ((sid: string) => Container.get(SessionOwnerResolver).ownerOf(sid));
  const describeHolder =
    deps.describeHolder ?? ((id: string) => Container.get(SessionOwnerResolver).displayName(id));

  return async function (req: Request, res: Response, next: NextFunction) {
    if (!STATE_CHANGING.has(req.method)) return next();

    // Router-level middleware has no req.params, so read the path directly.
    // Inside the /control router req.path is `/<udid>/<action…>`.
    const parts = req.path.split('/').filter(Boolean);
    const udid = decodeURIComponent(parts[0] ?? '');
    const action = parts.slice(1).join('/');
    if (!udid || !action) return next();
    if (UNGUARDED_CONTROL_MUTATIONS.includes(action)) return next();

    const actor = resolveActor(req);
    if (!actor.userId) {
      return res.status(401).json({ success: false, error: 'unauthenticated' });
    }

    let device;
    try {
      device = await findDevice(udid);
    } catch (e: any) {
      log.warn(`deviceAccessGuard: device lookup failed for ${udid}: ${e?.message ?? e}`);
      return next(); // never break control on a store hiccup; the handler 404s or errors
    }
    if (!device) return next(); // handler owns the 404

    let sessionOwnerUserId: string | null = null;
    if (device.busy && device.session_id && !isManualLock(device.session_id)) {
      sessionOwnerUserId = await resolveSessionOwner(device.session_id);
    }

    const decision = evaluateDeviceAccess({
      udid,
      busy: !!device.busy,
      sessionId: device.session_id,
      sessionOwnerUserId,
      actorUserId: actor.userId,
      actorApiKeyId: actor.apiKeyId,
      isAdmin: actor.isAdmin,
    });
    if (decision.allow) return next();

    const holderName = decision.holderId ? await describeHolder(decision.holderId) : null;
    log.warn(
      `Device access denied: ${actor.userId} -> ${req.method} ${req.originalUrl} ` +
        `on ${udid} (${decision.code}, holder=${decision.holderId || 'unknown'})`,
    );
    return res.status(409).json(denyBody(decision.code, decision.holderId, holderName));
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx mocha test/unit/device-access-guard.spec.ts
```

Expected: PASS, 11 passing.

- [ ] **Step 6: Mount the guard on the real router**

In `src/app/routers/control.ts`, add the import next to the other middleware imports (near line 24-25):

```ts
import { deviceAccessGuard } from '../../middleware/deviceAccessGuard';
```

Then immediately after the existing `mutationScopeGuard` line (line 49):

```ts
router.use(mutationScopeGuard(['devices']));

// Ownership: refuse mutations against a device held by another user or by
// another user's Appium session. Mounted here so every current and future
// mutation is covered without per-handler opt-in.
router.use(deviceAccessGuard());
```

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Verify the guard is not vacuous**

In `deviceAccessGuard.ts`, temporarily change `if (decision.allow) return next();` to `if (true || decision.allow) return next();` and re-run the spec. Expected: the four deny tests FAIL. Restore and confirm green.

- [ ] **Step 9: Commit**

```bash
git add src/services/device-access/actor.ts src/middleware/deviceAccessGuard.ts src/app/routers/control.ts test/unit/device-access-guard.spec.ts
git commit -m "feat(control): enforce device ownership on every /control mutation"
```

---

### Task 4: Fix the `stream/start` lock steal

**Files:**
- Create: `src/app/routers/streamStartConflict.ts`
- Modify: `src/app/routers/control.ts:516-599`
- Test: `test/unit/stream-start-conflict.spec.ts`

**Interfaces:**
- Consumes: `isManualLock`, `inspectManualLock` (`src/services/recording/manualLock.ts`); `DeviceAccessDenyCode` (Task 1); `resolveActor` (Task 3); `SessionOwnerResolver` (Task 2).
- Produces: `decideStreamStartConflict(input: StreamStartConflictInput): StreamStartAction` where `StreamStartAction` is `{ action: 'proceed' } | { action: 'reclaim' } | { action: 'deny'; code: DeviceAccessDenyCode; holderId: string }`.

This task is **required, not optional**. Task 3 shipped alone makes things worse: B's `stream/start` still rewrites the lock to B, and the new guard then denies A access to A's own device.

- [ ] **Step 1: Write the failing test**

Create `test/unit/stream-start-conflict.spec.ts`:

```ts
import { expect } from 'chai';
import {
  decideStreamStartConflict,
  StreamStartConflictInput,
} from '../../src/app/routers/streamStartConflict';

// Guards the lock steal at control.ts:530. The old shape was:
//
//   const isCurrentlyControlledManually = hasActiveManualStream(udid);
//   if (device.busy && !isCurrentlyControlledManually) { …reclaim or 409… }
//
// When a manual stream WAS live the busy check was skipped entirely, so
// execution fell through to blockDevice(udid, host, manual_<B>_<udid>).
// resolveBlockSessionId only shields a real Appium session id from manual
// overwrite — manual-over-manual keeps the incoming id. So B's start silently
// took A's lock, and A's own stream/stop then 403'd.

const UDID = 'DEV-1';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';

function input(over: Partial<StreamStartConflictInput> = {}): StreamStartConflictInput {
  return {
    udid: UDID,
    busy: true,
    sessionId: `manual_${ALICE}_${UDID}`,
    hasLiveManualStream: true,
    sessionOwnerUserId: null,
    actorUserId: ALICE,
    actorApiKeyId: undefined,
    isAdmin: false,
    ...over,
  };
}

describe('decideStreamStartConflict', () => {
  it('proceeds when the device is free', () => {
    expect(decideStreamStartConflict(input({ busy: false }))).to.deep.equal({
      action: 'proceed',
    });
  });

  it('REFUSES to steal a live manual stream held by another user', () => {
    expect(decideStreamStartConflict(input({ actorUserId: BOB }))).to.deep.equal({
      action: 'deny',
      code: 'device_held_by_another_user',
      holderId: ALICE,
    });
  });

  it('lets the holder restart their own live stream', () => {
    expect(decideStreamStartConflict(input())).to.deep.equal({ action: 'proceed' });
  });

  it('recognises the holder through a lock written with their apiKeyId', () => {
    const d = decideStreamStartConflict(
      input({ sessionId: `manual_key_abc_${UDID}`, actorUserId: ALICE, actorApiKeyId: 'key_abc' }),
    );
    expect(d).to.deep.equal({ action: 'proceed' });
  });

  it('lets an admin take over a live foreign stream', () => {
    const d = decideStreamStartConflict(input({ actorUserId: BOB, isAdmin: true }));
    expect(d).to.deep.equal({ action: 'proceed' });
  });

  it('takes over a live stream behind a legacy ownerless lock', () => {
    const d = decideStreamStartConflict(
      input({ sessionId: `manual_${UDID}`, actorUserId: BOB }),
    );
    expect(d).to.deep.equal({ action: 'proceed' });
  });

  it('reclaims a manual lock with no live stream, whoever owned it', () => {
    const d = decideStreamStartConflict(
      input({ actorUserId: BOB, hasLiveManualStream: false }),
    );
    expect(d).to.deep.equal({ action: 'reclaim' });
  });

  it('denies a foreign Appium session', () => {
    const d = decideStreamStartConflict(
      input({
        sessionId: 'appium-1',
        hasLiveManualStream: false,
        sessionOwnerUserId: ALICE,
        actorUserId: BOB,
      }),
    );
    expect(d).to.deep.equal({
      action: 'deny',
      code: 'device_in_use_by_session',
      holderId: ALICE,
    });
  });

  it('allows previewing an Appium session you started yourself', () => {
    const d = decideStreamStartConflict(
      input({
        sessionId: 'appium-1',
        hasLiveManualStream: false,
        sessionOwnerUserId: ALICE,
        actorUserId: ALICE,
      }),
    );
    expect(d).to.deep.equal({ action: 'proceed' });
  });

  it('denies an unattributable Appium session (fail closed)', () => {
    const d = decideStreamStartConflict(
      input({ sessionId: 'appium-1', hasLiveManualStream: false, sessionOwnerUserId: null }),
    );
    expect(d).to.deep.equal({
      action: 'deny',
      code: 'device_in_use_by_session',
      holderId: '',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha test/unit/stream-start-conflict.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/app/routers/streamStartConflict'`.

- [ ] **Step 3: Write the implementation**

Create `src/app/routers/streamStartConflict.ts`:

```ts
import { inspectManualLock, isManualLock } from '../../services/recording/manualLock';
import type { DeviceAccessDenyCode } from '../../services/device-access/deviceAccessPolicy';

export type StreamStartAction =
  | { action: 'proceed' }
  /** Manual lock with no live stream: an orphan. Clear it, then proceed. */
  | { action: 'reclaim' }
  | { action: 'deny'; code: DeviceAccessDenyCode; holderId: string };

export interface StreamStartConflictInput {
  udid: string;
  busy: boolean;
  sessionId: string | null | undefined;
  /** An in-memory iOS/Android stream session exists for this device. */
  hasLiveManualStream: boolean;
  sessionOwnerUserId?: string | null;
  actorUserId?: string;
  actorApiKeyId?: string;
  isAdmin: boolean;
}

const PROCEED: StreamStartAction = { action: 'proceed' };

/**
 * Conflict decision for POST /:udid/stream/start.
 *
 * Separate from evaluateDeviceAccess because "busy" means something different
 * here: a manual lock whose stream is gone is an orphan to reclaim rather than
 * a conflict, and starting a preview over your own Appium session is legitimate
 * (#149 — resolveBlockSessionId keeps the real session id, so the manual stream
 * coexists under the session's lock).
 */
export function decideStreamStartConflict(i: StreamStartConflictInput): StreamStartAction {
  if (!i.busy) return PROCEED;

  if (isManualLock(i.sessionId)) {
    // Orphan: lock persisted but nothing is serving (server restart, crashed
    // stop, H.264 stop that skipped unlock). Any caller may reclaim it.
    if (!i.hasLiveManualStream) return { action: 'reclaim' };
    if (i.isAdmin) return PROCEED;

    const asUser = inspectManualLock(i.sessionId, i.actorUserId, i.udid);
    if (asUser?.legacy) return PROCEED;
    const asKey = inspectManualLock(i.sessionId, i.actorApiKeyId, i.udid);
    if (asUser?.self || asKey?.self) return PROCEED;

    return {
      action: 'deny',
      code: 'device_held_by_another_user',
      holderId: asUser?.actorId ?? '',
    };
  }

  // A real Appium session holds the device.
  if (i.isAdmin) return PROCEED;
  const owner = i.sessionOwnerUserId ?? '';
  if (owner && i.actorUserId && owner === i.actorUserId) return PROCEED;
  return { action: 'deny', code: 'device_in_use_by_session', holderId: owner };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx mocha test/unit/stream-start-conflict.spec.ts
```

Expected: PASS, 10 passing.

- [ ] **Step 5: Wire it into the handler**

In `src/app/routers/control.ts`, add to the imports:

```ts
import { decideStreamStartConflict } from './streamStartConflict';
import { SessionOwnerResolver } from '../../services/device-access/SessionOwnerResolver';
import { resolveActor } from '../../services/device-access/actor';
import { denyBody } from '../../services/device-access/deviceAccessPolicy';
```

Replace the whole conflict block: everything from the `// Principal Insight: Automation Protection` comment down to the closing brace immediately before `try {`. (Line numbers have shifted by the few lines Task 3 added near the top of the file — anchor on the comment text, not on the numbers in the spec.) Replace it with:

```ts
  // Ownership at stream-start time. A manual lock with no live stream is an
  // orphan to reclaim; a live foreign stream is a conflict we must refuse.
  // Refusing is what stops one user's start from silently rewriting another
  // user's lock (which then locked the original holder out of their own stop).
  const actor = resolveActor(req);
  if (!actor.userId) {
    return res.status(401).json({ success: false, error: 'unauthenticated' });
  }
  // Bind to a local so the non-undefined narrowing survives the awaits below.
  const actorUserId: string = actor.userId;

  const ownerResolver = Container.get(SessionOwnerResolver);
  const sessionOwnerUserId =
    device.busy && device.session_id && !isManualLock(device.session_id)
      ? await ownerResolver.ownerOf(device.session_id)
      : null;

  const conflict = decideStreamStartConflict({
    udid,
    busy: !!device.busy,
    sessionId: device.session_id,
    hasLiveManualStream: hasActiveManualStream(udid),
    sessionOwnerUserId,
    actorUserId,
    actorApiKeyId: actor.apiKeyId,
    isAdmin: actor.isAdmin,
  });

  if (conflict.action === 'deny') {
    const holderName = conflict.holderId
      ? await ownerResolver.displayName(conflict.holderId)
      : null;
    log.warn(
      `Manual Control refused for ${udid}: ${conflict.code} (holder=${conflict.holderId || 'unknown'})`,
    );
    return res.status(409).send(denyBody(conflict.code, conflict.holderId, holderName));
  }

  if (conflict.action === 'reclaim') {
    log.warn(`Reclaiming orphaned manual lock on ${udid} (${device.session_id}) — no live stream.`);
    try {
      await unblockDevice(udid, device.host);
    } catch (e: any) {
      log.warn(`Failed to clear orphaned lock on ${udid}: ${e?.message ?? e}`);
    }
  }
```

- [ ] **Step 6: Key the new lock on userId**

Still in the `stream/start` handler, further down inside the `try`, replace the actor block — from `const actorId =` through `await blockDevice(udid, device.host, manualSid);`, including the `if (!actorId)` 401 — with:

```ts
    // Lock is keyed on the user, not the credential — see
    // src/services/device-access/deviceAccessPolicy.ts.
    const manualSid = formatManualLock(actorUserId, udid);
    await blockDevice(udid, device.host, manualSid);
```

`actorUserId` is already in scope from Step 5, and the 401 it replaces is now raised earlier — before the stream is started rather than after, which is the correct order anyway.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. If it reports `'actorId' is declared but never read`, the old block at 592-598 was not fully replaced — remove the leftover.

- [ ] **Step 8: Confirm no stale references remain**

```bash
grep -n "req.apiKey?.id ?? " src/app/routers/control.ts
```

Expected: one remaining hit, in `stream/ticket` (line ~638). `stream/stop` (line ~654) also still uses the old form; both are left alone deliberately — `stream/stop` must keep recognising locks written either way, and the dual-identity check in `evaluateDeviceAccess` covers the new format there via `inspectManualLock`. Do not change them in this task.

- [ ] **Step 9: Re-run both affected specs**

```bash
npx mocha test/unit/stream-start-conflict.spec.ts test/unit/device-access-guard.spec.ts
```

Expected: PASS, 21 passing.

- [ ] **Step 10: Commit**

```bash
git add src/app/routers/streamStartConflict.ts src/app/routers/control.ts test/unit/stream-start-conflict.spec.ts
git commit -m "fix(control): stop stream/start from stealing another user's device lock"
```

---

### Task 5: Surface the conflict in the dashboard

**Files:**
- Modify: `web/src/api-service/api-client.ts:39-48`

**Interfaces:**
- Consumes: the 409 body shape from Task 1 (`{ error, message }`).
- Produces: nothing importable. Behavioural only.

The api-client already owns a module-level toast emitter and fires it on 403, so one branch there covers every control call — tap, swipe, text, keyevent, install, shell — without touching `DeviceTile`. `DevicePicker` already disables blocked devices (`blocked` at DevicePicker.tsx:138), so no picker change is needed.

- [ ] **Step 1: Extend `jsonResult`**

In `web/src/api-service/api-client.ts`, replace the `jsonResult` method with:

```ts
  private async jsonResult(res: Response) {
    if (res.status === 403) {
      const body = await res.clone().json().catch(() => ({}) as any);
      const msg =
        (body && (body.error || body.message)) ||
        'You do not have permission for this action.';
      if (toastEmitter) {
        toastEmitter(msg, 'error');
      }
    }
    // 409 from /control means another user (or their Appium session) holds the
    // device. Without this a blocked tap is a silent no-op — the user sees a
    // frozen tile and assumes the stream broke.
    if (res.status === 409) {
      const body = await res.clone().json().catch(() => ({}) as any);
      if (body && DEVICE_CONFLICT_CODES.has(body.error)) {
        notifyDeviceConflict(body.message || 'This device is in use by another user.');
      }
    }
    return res.json();
  }
```

- [ ] **Step 2: Add the codes and the throttle**

Above `class ApiClient` in the same file, after `setApiToastEmitter`:

```ts
const DEVICE_CONFLICT_CODES = new Set([
  'device_held_by_another_user',
  'device_in_use_by_session',
]);

// A held device usually produces a burst of denials (a swipe is several
// gestures, a keystroke run is one call per character). Show each distinct
// message at most once per interval so the toast stack stays readable.
const CONFLICT_TOAST_INTERVAL_MS = 5000;
const lastConflictToastAt = new Map<string, number>();

function notifyDeviceConflict(message: string): void {
  if (!toastEmitter) return;
  const now = Date.now();
  const last = lastConflictToastAt.get(message) ?? 0;
  if (now - last < CONFLICT_TOAST_INTERVAL_MS) return;
  lastConflictToastAt.set(message, now);
  toastEmitter(message, 'error');
}
```

- [ ] **Step 3: Build the frontend**

```bash
npm run build:xenon && npm run build:copy
```

Expected: both complete without error. The running server serves `lib/public`, so a CSS/JS change is not live until this runs.

- [ ] **Step 4: Commit**

```bash
git add web/src/api-service/api-client.ts
git commit -m "feat(web): toast the 409 when a device is held by another user"
```

---

### Task 6: Full verification

**Files:** none modified.

- [ ] **Step 1: Typecheck the whole project**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run every spec this change touches**

```bash
npx mocha test/unit/device-access-policy.spec.ts test/unit/session-owner-resolver.spec.ts test/unit/device-access-guard.spec.ts test/unit/stream-start-conflict.spec.ts
```

Expected: PASS, 43 passing, 0 failing.

- [ ] **Step 3: Check lint on the new files only**

```bash
npx eslint src/services/device-access src/middleware/deviceAccessGuard.ts src/app/routers/streamStartConflict.ts --ext .ts
```

Expected: no errors. **Do not pass `--fix`,** and do not lint `src/` as a whole — the repo carries pre-existing prettier errors that `--fix` would sweep into this diff.

- [ ] **Step 4: Build and restart a real server**

```bash
npm run build
```

Then restart via Xenon Control and confirm the listener comes up and devices are discovered. Grep the new server log for `Fatal` before believing it started — the app's status can read "Starting…" while the child has already exited.

- [ ] **Step 5: Hardware validation with two identities**

With two API keys belonging to two different users (or one key plus a dashboard cookie session), against a real device:

1. A starts a stream on the device. Confirm `device.session_id` is `manual_<A-userId>_<udid>`.
2. B posts a tap → expect `409 device_held_by_another_user`, message naming A.
3. B posts `stream/start` → expect `409`, and confirm `device.session_id` is **still A's**.
4. A posts a tap → expect `200`. **This is the half that is easy to skip and the one that matters most** — a guard that over-denies is worse than the hole it closes.
5. A posts `stream/stop` → expect `200` and the lock released.
6. An admin key posts a tap while A holds the device → expect `200`.
7. A starts an Appium session with their key, then from A's dashboard cookie session posts a tap → expect `200` (the cross-credential case unit tests cannot reach).

- [ ] **Step 6: Prove the guard does not misfire**

Drive a normal single-user session for a few minutes — stream, tap, type, screenshot, stop.

```bash
grep -c "Device access denied" <server log>
```

Expected: `0`. A denial during ordinary single-user work means the ownership check is wrong, not that it is working.

- [ ] **Step 7: Commit anything outstanding and open the PR**

```bash
git status --porcelain
git push -u origin feat/device-access-guard
gh pr create --title "feat(control): enforce device ownership on control endpoints" --body "Implements docs/superpowers/specs/2026-08-08-device-access-guard-design.md"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Gap 1 — no control endpoint checks ownership | 3 |
| Gap 2 — stream/start lock steal | 4 |
| Gap 3 — inconsistent ownership key | 1 (policy), 3 (`resolveActor`), 4 (lock written on userId) |
| Policy rules 1-5, legacy allow, fail-closed unknown owner | 1 |
| Dual-identity self-check (userId OR apiKeyId) | 1, 4 |
| Session owner via `api_key_id -> ApiKey.userId`, memoized | 2 |
| Mount point + method predicate + allowlist | 3 |
| Hub–node: enforce on the hub before the proxy branch | 3 (guard runs before each handler's proxy branch) |
| stream/start decision table, all six rows | 4 |
| 409 contract, best-effort holder name, warn log | 1 (body), 3 (log + status), 4 (status) |
| Frontend toast; picker already disables | 5 |
| Three named specs + non-vacuous checks | 1, 2, 3, 4 |
| Hardware validation incl. "A is never denied" | 6 |
| `schema.json` untouched | Global Constraints |

**Type consistency:** `DeviceAccessDenyCode` is defined once in Task 1 and imported by Tasks 3 and 4. `holderId` is a plain `string` (empty when unknown) everywhere — never `null` — so `denyBody`'s `holderId ? … : undefined` branch is the single place emptiness is interpreted. `resolveActor` returns `{ userId?, apiKeyId?, isAdmin }` in Task 3 and is consumed with those exact names in Task 4. `SessionOwnerResolver.ownerOf`/`displayName` both return `Promise<string | null>` and are consumed as such in Tasks 3 and 4.

**Placeholder scan:** none — every step carries the code or the exact command.

**Known deliberate exclusions** (from the spec's Out of Scope): `GET /:udid/clipboard` stays open; no idle expiry; `stream/stop` keeps its 403 and its substring `includes('admin')` check; no team scoping; no credential forwarding on the hub→node proxy.
