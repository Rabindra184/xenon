# Phase 4B — Per-node `(accessKey, token)` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared `XENON_NODE_SECRET` for hub-node auth (both REST and Socket.io channels) with the same `(accessKey, token)` header pair we ship for SDK / CLI clients. Keep legacy support for one minor under a feature flag.

**Architecture:** `nodeSecretMiddleware` (REST) and `SocketServer.ts`'s auth handler (socket) both gain a fast path: if pair-auth headers are present, fall through to `authMiddleware` (REST) or run the existing ApiKey lookup (socket). If only the legacy `x-xenon-node-secret` is present AND `XENON_ACCEPT_LEGACY_NODE_SECRET=true`, validate it and synthesize `req.auth` for a lazily-created "Legacy Node" User row. Outbound (`NodeDevices`, `SocketClient`) prefers `XENON_HUB_ACCESS_KEY` + `XENON_HUB_TOKEN`, falls back to `XENON_NODE_SECRET`.

**Tech Stack:** TypeScript 5.5, Express, Prisma 5.4 (SQLite), Mocha + chai + sinon, Socket.io. No new dependencies. No schema changes.

**Spec:** `docs/superpowers/specs/2026-04-30-phase-4b-node-pair-auth-design.md`

---

## File Structure

| File | Purpose |
|---|---|
| `src/config.ts` | MODIFIED — add `hubAccessKey?`, `hubToken?`, `acceptLegacyNodeSecret: boolean` |
| `src/services/identity/legacyNodeUser.ts` | NEW — `ensureLegacyNodeUser()` lazy-create helper with module-cache + P2002-safe |
| `test/unit/legacyNodeUser.test.ts` | NEW |
| `src/middleware/nodeSecretMiddleware.ts` | MODIFIED — rewrite per spec (pair-aware + legacy synthesizer + flag-gated) |
| `test/unit/nodeSecretMiddleware.test.ts` | NEW (replaces or supplements any existing test) |
| `src/services/SocketServer.ts` | MODIFIED — same dual-shape acceptance for socket handshake |
| `test/unit/SocketServer.test.ts` | NEW or extended — socket-handshake pair vs legacy |
| `src/device-managers/NodeDevices.ts` | MODIFIED — constructor accepts `{ nodeSecret?, hubAccessKey?, hubToken? }`; `nodeHeaders()` returns pair when both set, else legacy, else {} |
| `src/services/SocketClient.ts` | MODIFIED — auth payload prefers `{ accessKey, token }` over `{ nodeSecret }` |
| `src/plugin.ts` | MODIFIED — call site for `new NodeDevices(...)` switches to options-bag |
| `src/services/ServerManager.ts` | MODIFIED — same |
| `src/device-utils.ts` | MODIFIED — same (two call sites at lines 411, 438, 609 today) |
| `test/integration/node-pair-auth-rest.spec.ts` | NEW — /register accepts pair, accepts legacy with flag on, 401s with flag off |
| `test/integration/node-pair-auth-socket.spec.ts` | NEW — socket handshake equivalent |
| `src/app/swagger.ts` | MODIFIED — deprecate `x-xenon-node-secret` security scheme |
| `docs/superpowers/operations/node-provisioning.md` | NEW — operator migration guide |

---

## Conventions (read first)

- **Branches:** PR-A on `feat/phase-4b-node-pair-auth` (already created — spec at HEAD `74a7000`). PR-B on `feat/phase-4b-docs` off latest main after PR-A merge.
- **Commits:** Conventional Commits + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Test runner:** `XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 <path>`.
- **Type-check:** `npx tsc --noEmit` (root). No frontend changes in Phase 4B.
- **Working tree:** stage by exact path; never `git add -A`.
- **Commit messages:** `cat > /tmp/<task>-msg.txt << 'XENON_EOF' … XENON_EOF` (heredoc with quoted delimiter); `git commit -F /tmp/<task>-msg.txt`.

---

# PR-A — Backend rewrite

**Branch:** `feat/phase-4b-node-pair-auth` (spec already committed at HEAD `74a7000`).
**Ships:** all backend changes. Existing nodes keep working via the legacy path; new nodes use pair auth. Operator can migrate at their own pace.

---

## Task 1: Config — `XENON_HUB_*` + `XENON_ACCEPT_LEGACY_NODE_SECRET`

**File:** Modify `src/config.ts`.

- [ ] **Step 1: Read the file**

```
sed -n '20,90p' src/config.ts
```

Phase 1 / Phase 2 / Phase 3 added their own field groups. Match the layout style.

- [ ] **Step 2: Extend the `Config` interface**

After `nodeSecretPrevious?: string;` (around line 29), add:

```ts
  // Phase 4B node pair auth
  hubAccessKey?: string;
  hubToken?: string;
  acceptLegacyNodeSecret: boolean;
```

- [ ] **Step 3: Extend the `config` singleton**

After `nodeSecretPrevious: process.env.XENON_NODE_SECRET_PREVIOUS,` (around line 82), add:

```ts
  hubAccessKey: process.env.XENON_HUB_ACCESS_KEY,
  hubToken: process.env.XENON_HUB_TOKEN,
  acceptLegacyNodeSecret: process.env.XENON_ACCEPT_LEGACY_NODE_SECRET !== 'false',
```

(Default `true`, mirrors Phase 1's `XENON_ACCEPT_LEGACY_KEY` pattern.)

- [ ] **Step 4: Type-check + commit**

```
npx tsc --noEmit 2>&1 | grep "src/config\.ts" || echo "tsc clean"
```

```
cat > /tmp/xenon-p4bt1-msg.txt << 'XENON_EOF'
feat(config): hubAccessKey + hubToken + acceptLegacyNodeSecret

Three env-driven config knobs for the Phase 4B hub-node pair-auth
migration:
- XENON_HUB_ACCESS_KEY / XENON_HUB_TOKEN: outbound credentials a node
  uses to authenticate to the hub. When both are set they take
  precedence over the legacy XENON_NODE_SECRET.
- XENON_ACCEPT_LEGACY_NODE_SECRET (default true): inbound flag on the
  hub. When false, x-xenon-node-secret is rejected; nodes must use
  the (accessKey, token) pair. Mirrors Phase 1's XENON_ACCEPT_LEGACY_KEY.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/config.ts
git commit -F /tmp/xenon-p4bt1-msg.txt && rm /tmp/xenon-p4bt1-msg.txt
```

---

## Task 2: `ensureLegacyNodeUser()` lazy helper (TDD)

**Files:**
- Create: `src/services/identity/legacyNodeUser.ts`
- Create: `test/unit/legacyNodeUser.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// test/unit/legacyNodeUser.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  ensureLegacyNodeUser,
  resetLegacyNodeUserCache,
} from '../../src/services/identity/legacyNodeUser';
import { prisma } from '../../src/prisma';

describe('ensureLegacyNodeUser', () => {
  beforeEach(() => resetLegacyNodeUserCache());
  afterEach(() => sinon.restore());

  it('returns existing row when one is found', async () => {
    sinon.stub(prisma.user, 'findUnique').resolves({
      id: 'u-existing',
    } as any);
    const create = sinon.stub(prisma.user, 'create');
    const out = await ensureLegacyNodeUser();
    expect(out.id).to.equal('u-existing');
    expect(create.called).to.be.false;
  });

  it('creates a row with INACTIVE + unusable hash + ADMIN role when none exists', async () => {
    sinon.stub(prisma.user, 'findUnique').resolves(null);
    const create = sinon.stub(prisma.user, 'create').resolves({ id: 'u-new' } as any);
    const out = await ensureLegacyNodeUser();
    expect(out.id).to.equal('u-new');
    const data = create.firstCall.args[0].data;
    expect(data.email).to.equal('legacy-node@xenon.local');
    expect(data.status).to.equal('INACTIVE');
    expect(data.role).to.equal('ADMIN');
    expect(data.passwordHash).to.match(/^\$2[ayb]\$04\$invalid/);
  });

  it('caches the id in module scope after first lookup', async () => {
    const findOne = sinon.stub(prisma.user, 'findUnique').resolves({
      id: 'u-cached',
    } as any);
    await ensureLegacyNodeUser();
    await ensureLegacyNodeUser();
    expect(findOne.calledOnce).to.be.true;
  });

  it('handles concurrent first-create races (P2002) by re-fetching', async () => {
    let lookupCalls = 0;
    sinon.stub(prisma.user, 'findUnique').callsFake(async () => {
      lookupCalls += 1;
      // First call: row doesn't exist yet. Second call (after P2002): exists.
      if (lookupCalls === 1) return null;
      return { id: 'u-race' } as any;
    });
    sinon.stub(prisma.user, 'create').rejects(
      Object.assign(new Error('Unique constraint violated'), { code: 'P2002' }),
    );
    const out = await ensureLegacyNodeUser();
    expect(out.id).to.equal('u-race');
    expect(lookupCalls).to.equal(2);
  });
});
```

- [ ] **Step 2: RED**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/legacyNodeUser.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/services/identity/legacyNodeUser.ts
import { prisma } from '../../prisma';

const LEGACY_NODE_EMAIL = 'legacy-node@xenon.local';
// Bcrypt-shaped string that won't match any password (cost 04 prefix + the
// rest is intentionally not a real hash). Mirrors Phase 1's Legacy Admin row.
const UNUSABLE_HASH =
  '$2b$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid';

let cachedId: string | undefined;

// For tests only — drops the module-scope cache between cases.
export function resetLegacyNodeUserCache(): void {
  cachedId = undefined;
}

// Ensures the synthetic "Legacy Node" user row exists and returns its id.
// Lazily created on first request that authenticates via the legacy
// x-xenon-node-secret header (Phase 4B). Marked INACTIVE so a real /login
// can never succeed for it; passwordHash is unusable so even if status flips
// to ACTIVE, bcrypt-compare fails. Concurrent-create race (P2002) is handled
// by re-fetching.
export async function ensureLegacyNodeUser(): Promise<{ id: string }> {
  if (cachedId) return { id: cachedId };

  const existing = await prisma.user.findUnique({
    where: { email: LEGACY_NODE_EMAIL },
    select: { id: true },
  });
  if (existing) {
    cachedId = existing.id;
    return { id: existing.id };
  }

  try {
    const created = await prisma.user.create({
      data: {
        email: LEGACY_NODE_EMAIL,
        name: 'Legacy Node Channel',
        passwordHash: UNUSABLE_HASH,
        accessKey: `xen_legacynode${Date.now().toString(36).slice(-8)}`,
        role: 'ADMIN',
        status: 'INACTIVE',
      },
      select: { id: true },
    });
    cachedId = created.id;
    return { id: created.id };
  } catch (e: any) {
    if (e?.code === 'P2002') {
      // Concurrent first-create race; re-fetch the now-existing row.
      const row = await prisma.user.findUnique({
        where: { email: LEGACY_NODE_EMAIL },
        select: { id: true },
      });
      if (row) {
        cachedId = row.id;
        return { id: row.id };
      }
    }
    throw e;
  }
}
```

- [ ] **Step 4: GREEN** (4 tests)

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/legacyNodeUser.test.ts
```

- [ ] **Step 5: Commit**

```
cat > /tmp/xenon-p4bt2-msg.txt << 'XENON_EOF'
feat(auth): ensureLegacyNodeUser lazy helper

Mirrors Phase 1's Legacy Admin pattern: a synthetic "Legacy Node"
User row that backs requests authenticated via the legacy
x-xenon-node-secret header (Phase 4B). Lazy-created on first such
request, INACTIVE + unusable bcrypt so login is impossible, ADMIN
role so downstream guards on /register and /unblock pass.

Module-scope cache avoids re-querying after first lookup. Concurrent
first-create race (P2002) is handled by re-fetching.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/services/identity/legacyNodeUser.ts test/unit/legacyNodeUser.test.ts
git commit -F /tmp/xenon-p4bt2-msg.txt && rm /tmp/xenon-p4bt2-msg.txt
```

---

## Task 3: Rewrite `nodeSecretMiddleware` (TDD)

**Files:**
- Modify: `src/middleware/nodeSecretMiddleware.ts`
- Create: `test/unit/nodeSecretMiddleware.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// test/unit/nodeSecretMiddleware.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { nodeSecretMiddleware } from '../../src/middleware/nodeSecretMiddleware';
import * as legacyNodeUser from '../../src/services/identity/legacyNodeUser';
import { config } from '../../src/config';

function mkReq(headers: Record<string, string> = {}): any {
  return { headers };
}
function mkRes() {
  const res: any = {};
  res.status = sinon.stub().returns(res);
  res.json = sinon.stub().returns(res);
  return res;
}

describe('nodeSecretMiddleware (Phase 4B)', () => {
  afterEach(() => sinon.restore());

  it('pair-auth headers present → next() without touching req.auth', () => {
    const req = mkReq({
      'x-xenon-access-key': 'xen_abc',
      'x-xenon-token': 'tok',
    });
    const res = mkRes();
    const next = sinon.stub();
    nodeSecretMiddleware('expected-secret')(req, res, next);
    expect(next.calledOnce).to.be.true;
    expect(req.auth).to.be.undefined;
  });

  it('legacy header + flag on + valid secret → req.auth synthesized', async () => {
    const orig = (config as any).acceptLegacyNodeSecret;
    (config as any).acceptLegacyNodeSecret = true;
    sinon.stub(legacyNodeUser, 'ensureLegacyNodeUser').resolves({ id: 'u-legacy' });
    const req = mkReq({ 'x-xenon-node-secret': 'expected-secret' });
    const res = mkRes();
    const next = sinon.stub();
    try {
      const mw = nodeSecretMiddleware('expected-secret');
      await new Promise<void>((resolve) => {
        next.callsFake(() => resolve());
        mw(req, res, next);
      });
      expect(req.auth).to.exist;
      expect(req.auth.userId).to.equal('u-legacy');
      expect(req.auth.role).to.equal('ADMIN');
      expect(req.auth.scopes).to.equal('devices');
      expect(req.auth.kind).to.equal('api-key');
    } finally {
      (config as any).acceptLegacyNodeSecret = orig;
    }
  });

  it('legacy header + flag off → 401', async () => {
    const orig = (config as any).acceptLegacyNodeSecret;
    (config as any).acceptLegacyNodeSecret = false;
    const req = mkReq({ 'x-xenon-node-secret': 'expected-secret' });
    const res = mkRes();
    const next = sinon.stub();
    try {
      nodeSecretMiddleware('expected-secret')(req, res, next);
      // Allow microtask queue (the flag check and 401 may be sync, but the
      // legacy validation path is async-flavored — give it a tick to settle).
      await new Promise((r) => setImmediate(r));
      expect((res.status as sinon.SinonStub).calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    } finally {
      (config as any).acceptLegacyNodeSecret = orig;
    }
  });

  it('legacy header + invalid secret → 401', async () => {
    const orig = (config as any).acceptLegacyNodeSecret;
    (config as any).acceptLegacyNodeSecret = true;
    const req = mkReq({ 'x-xenon-node-secret': 'wrong-secret' });
    const res = mkRes();
    const next = sinon.stub();
    try {
      nodeSecretMiddleware('expected-secret')(req, res, next);
      await new Promise((r) => setImmediate(r));
      expect((res.status as sinon.SinonStub).calledWith(401)).to.be.true;
    } finally {
      (config as any).acceptLegacyNodeSecret = orig;
    }
  });

  it('no auth headers → next() (downstream authMiddleware will 401)', () => {
    const req = mkReq({});
    const res = mkRes();
    const next = sinon.stub();
    nodeSecretMiddleware('expected-secret')(req, res, next);
    expect(next.calledOnce).to.be.true;
  });

  it('pair + legacy both present → pair wins, legacy ignored', () => {
    const req = mkReq({
      'x-xenon-access-key': 'xen_abc',
      'x-xenon-token': 'tok',
      'x-xenon-node-secret': 'expected-secret',
    });
    const res = mkRes();
    const next = sinon.stub();
    nodeSecretMiddleware('expected-secret')(req, res, next);
    expect(next.calledOnce).to.be.true;
    // req.auth NOT synthesized — authMiddleware will populate from pair.
    expect(req.auth).to.be.undefined;
  });
});
```

- [ ] **Step 2: RED**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/nodeSecretMiddleware.test.ts
```

- [ ] **Step 3: Replace `src/middleware/nodeSecretMiddleware.ts`**

```ts
import { Request, Response, NextFunction } from 'express';
import log from '../logger';
import { config as xenonConfig } from '../config';
import { validateNodeSecret } from '../auth/nodeSecret';
import { ensureLegacyNodeUser } from '../services/identity/legacyNodeUser';

let lastWarnAt = 0;
const lastDeprecationWarnByIp = new Map<string, number>();

// Phase 4B-aware node-secret middleware. Three resolution paths:
//
//   1. Pair-auth headers present (x-xenon-access-key + x-xenon-token):
//      pass through. The downstream authMiddleware will populate req.auth
//      from the pair as it does for any other (accessKey, token) caller.
//
//   2. Legacy x-xenon-node-secret present AND
//      XENON_ACCEPT_LEGACY_NODE_SECRET=true (default for one minor):
//      validate timing-safely. On success, synthesize req.auth pointing
//      at the lazily-created Legacy Node User so downstream guards
//      (roleGuard('ADMIN') + scopeGuard(['devices'])) pass.
//
//   3. Neither shape: fall through. authMiddleware will 401.
//
// When XENON_ACCEPT_LEGACY_NODE_SECRET=false, path 2 returns 401 instead
// of synthesizing — operators must migrate to pair auth.
export function nodeSecretMiddleware(expected: string | undefined) {
  return function (req: Request, res: Response, next: NextFunction) {
    // Path 1: pair auth.
    const pairKey = req.headers['x-xenon-access-key'] as string | undefined;
    const pairTok = req.headers['x-xenon-token'] as string | undefined;
    if (pairKey && pairTok) {
      return next();
    }

    const legacyHeader = req.headers['x-xenon-node-secret'] as string | undefined;

    // No auth headers at all — let authMiddleware do its thing.
    if (!legacyHeader) {
      // Existing legacy warning — once a minute when running without any
      // node-secret AND auth-disabled is true, the route would be wide open.
      if (!expected && xenonConfig.authDisabled === true) {
        return res.status(503).json({
          error:
            'hub-node secret not configured while API-key auth is disabled; set --plugin-xenon-node-secret',
        });
      }
      const now = Date.now();
      if (!expected && now - lastWarnAt > 60_000) {
        log.warn(
          '[nodeSecret] node-secret not configured; hub-node channel falls back to API-key auth. Set --plugin-xenon-node-secret for defense in depth.',
        );
        lastWarnAt = now;
      }
      return next();
    }

    // Path 2: legacy header. Subject to the flag.
    if (xenonConfig.acceptLegacyNodeSecret !== true) {
      return res.status(401).json({
        error:
          'x-xenon-node-secret is rejected; XENON_ACCEPT_LEGACY_NODE_SECRET is false. Migrate this node to (accessKey, token) pair auth.',
      });
    }

    const outcome = validateNodeSecret(legacyHeader, {
      current: expected,
      previous: xenonConfig.nodeSecretPrevious,
    });
    if (outcome === 'reject') {
      return res.status(401).json({ error: 'invalid node secret' });
    }

    // Throttle the deprecation log per source IP.
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown';
    const now = Date.now();
    const last = lastDeprecationWarnByIp.get(ip) ?? 0;
    if (now - last > 60_000) {
      log.warn(
        `[nodeSecret] DEPRECATED: ${ip} authenticated via x-xenon-node-secret. Migrate this node to pair auth (XENON_HUB_ACCESS_KEY + XENON_HUB_TOKEN).`,
      );
      lastDeprecationWarnByIp.set(ip, now);
    }

    // Synthesize req.auth so downstream roleGuard + scopeGuard succeed.
    ensureLegacyNodeUser()
      .then((u) => {
        (req as Request & { auth?: any }).auth = {
          kind: 'api-key',
          userId: u.id,
          role: 'ADMIN',
          scopes: 'devices',
          rateLimit: 1000,
          teamIds: undefined,
          apiKeyId: undefined,
          sessionId: undefined,
          teamId: null,
        };
        next();
      })
      .catch((e) => {
        log.error(`[nodeSecret] Legacy Node user lookup failed: ${e?.message ?? e}`);
        res.status(500).json({ error: 'internal server error' });
      });
  };
}
```

- [ ] **Step 4: GREEN** (6 tests)

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/nodeSecretMiddleware.test.ts
```

- [ ] **Step 5: Commit**

```
cat > /tmp/xenon-p4bt3-msg.txt << 'XENON_EOF'
feat(auth): nodeSecretMiddleware — pair-aware + legacy synthesizer

Three resolution paths:
- pair-auth headers (x-xenon-access-key + x-xenon-token) present →
  fall through; downstream authMiddleware handles it.
- legacy x-xenon-node-secret present and XENON_ACCEPT_LEGACY_NODE_SECRET=true
  → validate timing-safely; on success synthesize req.auth pointing at
  the Legacy Node user (lazy-create) so roleGuard + scopeGuard succeed.
- legacy header but flag off → 401 with a migration-pointing message.
- no auth headers → next() (authMiddleware will 401 unless other auth).

Per-IP throttled deprecation log nudges operators toward pair auth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/middleware/nodeSecretMiddleware.ts test/unit/nodeSecretMiddleware.test.ts
git commit -F /tmp/xenon-p4bt3-msg.txt && rm /tmp/xenon-p4bt3-msg.txt
```

---

## Task 4: Rewrite `SocketServer.ts` handshake auth (TDD where possible)

**File:** Modify `src/services/SocketServer.ts`.

The current code (around line 140-155) checks `nodeSecret` first. Phase 4B makes the same dual-shape change as the REST middleware: pair-auth wins, legacy is gated by the flag.

- [ ] **Step 1: Read the current handler**

```
sed -n '120,180p' src/services/SocketServer.ts
```

Find the `nodeSecret` block at line 140-155 and the API-key fallback below it.

- [ ] **Step 2: Modify the auth resolution**

Replace the legacy-secret-first block with this order:

```ts
// Phase 4B: pair-auth first (mirrors REST authMiddleware path 1).
const pairKey =
  (typeof auth.accessKey === 'string' && auth.accessKey) ||
  ((headers['x-xenon-access-key'] as string | undefined) ?? '');
const pairTok =
  (typeof auth.token === 'string' && auth.token) ||
  ((headers['x-xenon-token'] as string | undefined) ?? '');
if (pairKey && pairTok) {
  const row = await Container.get(ApiKeyService).verifyPair(pairKey, pairTok);
  if (!row) throw new Error('invalid (accessKey, token) pair');
  // Confirm the resolved User is ACTIVE.
  const owner = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { status: true, role: true },
  });
  if (!owner || owner.status !== 'ACTIVE') throw new Error('inactive user');
  return 'node';
}

// Legacy node secret — only if the flag allows.
const nodeSecret =
  (typeof auth.nodeSecret === 'string' && auth.nodeSecret) ||
  ((headers['x-xenon-node-secret'] as string | undefined) ?? '');
if (nodeSecret) {
  if (xenonConfig.acceptLegacyNodeSecret !== true) {
    throw new Error(
      'x-xenon-node-secret is rejected; XENON_ACCEPT_LEGACY_NODE_SECRET is false',
    );
  }
  if (!xenonConfig.nodeSecret && !xenonConfig.nodeSecretPrevious) {
    throw new Error('node secret presented but server has none configured');
  }
  const outcome = validateNodeSecret(nodeSecret, {
    current: xenonConfig.nodeSecret,
    previous: xenonConfig.nodeSecretPrevious,
  });
  if (outcome === 'reject') throw new Error('invalid node secret');
  return 'node';
}

// Dashboard path: API key header / cookie (existing block stays).
```

The existing `// Dashboard path: API key header, or session cookie set by /auth/login.` block continues unchanged below this.

If `prisma` isn't already imported, add it. The `ApiKeyService.verifyPair` is the same one Phase 1 added — its presence confirms a token-User pair as a unit.

- [ ] **Step 3: Add socket-handshake unit test**

If a `test/unit/SocketServer.test.ts` doesn't exist, create one. If it exists, append to it. The test exercises the auth resolver function — read the file to find the resolver's name (likely `resolveAuth` or similar).

If the resolver isn't easily exported or testable in isolation, skip the unit test for the socket path and rely on the Task 9 integration test. Document in the report.

- [ ] **Step 4: Type-check + commit**

```
npx tsc --noEmit 2>&1 | grep "SocketServer\\.ts" || echo "tsc clean"
```

```
cat > /tmp/xenon-p4bt4-msg.txt << 'XENON_EOF'
feat(auth): SocketServer handshake — pair-aware + legacy gated

Mirrors the REST nodeSecretMiddleware change for the Socket.io
handshake: pair auth (accessKey, token) wins; legacy nodeSecret
falls through only when XENON_ACCEPT_LEGACY_NODE_SECRET=true.

Pair-auth callers go through the same ApiKeyService.verifyPair path
as REST programmatic clients, with an ACTIVE-user check.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/services/SocketServer.ts
# If you added a unit test file, stage it too.
git commit -F /tmp/xenon-p4bt4-msg.txt && rm /tmp/xenon-p4bt4-msg.txt
```

---

## Task 5: `NodeDevices` outbound — pair > legacy precedence

**File:** Modify `src/device-managers/NodeDevices.ts`.

- [ ] **Step 1: Replace the constructor signature + headers helper**

The existing constructor is `(host, tlsRejectUnauthorized?, nodeSecret?)`. Switch to an options bag so we can add fields without breaking call-site ergonomics:

```ts
import log from '../logger';
import { DeviceWithPath } from '@devicefarmer/adbkit';
import { DeviceUpdate } from '../types/DeviceUpdate';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';
import { InternalHttpClient } from '../InternalHttpClient';

interface NodeDevicesOptions {
  tlsRejectUnauthorized?: boolean;
  nodeSecret?: string;        // legacy
  hubAccessKey?: string;       // pair-auth (preferred)
  hubToken?: string;
}

export default class NodeDevices {
  private host: string;
  private tlsRejectUnauthorized?: boolean;
  private nodeSecret?: string;
  private hubAccessKey?: string;
  private hubToken?: string;

  constructor(host: string, options: NodeDevicesOptions = {}) {
    this.host = host;
    this.tlsRejectUnauthorized = options.tlsRejectUnauthorized;
    this.nodeSecret = options.nodeSecret;
    this.hubAccessKey = options.hubAccessKey;
    this.hubToken = options.hubToken;
  }

  // Pair-auth wins when both shapes are configured. Documented in spec.
  private nodeHeaders(): Record<string, string> {
    if (this.hubAccessKey && this.hubToken) {
      return {
        'x-xenon-access-key': this.hubAccessKey,
        'x-xenon-token': this.hubToken,
      };
    }
    if (this.nodeSecret) {
      return { 'x-xenon-node-secret': this.nodeSecret };
    }
    return {};
  }

  // ... rest of the class (postDevicesToHub, unblockDevice, unRegisterNode) is unchanged
  // — they all call this.nodeHeaders() and don't care about the specific shape.
}
```

Keep the rest of the file (the three methods) verbatim.

- [ ] **Step 2: Find the call sites + update them**

```
grep -rnE "new NodeDevices\(" src/ 2>/dev/null
```

Three call sites today (per the spec):
- `src/plugin.ts:117-120`
- `src/services/ServerManager.ts:259, 267-270` (two-arg construction)
- `src/device-utils.ts:438` (in a function with `nodeSecret?: string` param at line 411)

For each call site, change from positional args:

```ts
// OLD:
new NodeDevices(hubArgument, tlsRejectUnauthorized, nodeSecret);
```

to options bag:

```ts
// NEW:
new NodeDevices(hubArgument, {
  tlsRejectUnauthorized,
  nodeSecret,
  hubAccessKey: xenonConfig.hubAccessKey,
  hubToken: xenonConfig.hubToken,
});
```

The exact `xenonConfig` import path varies per file — match the file's existing imports. Look at neighboring code that already references `xenonConfig` or `config` (Phase 1+ added this pattern).

For `src/device-utils.ts:411`, the function signature was `(... , nodeSecret?: string)`. Either:
- (a) Keep the parameter and read `hubAccessKey`/`hubToken` from `xenonConfig` directly inside the function body (cleanest — preserves the existing call-site signatures throughout the file), OR
- (b) Widen the function signature to also accept hub credentials.

Recommend (a) — fewer ripple edits.

The `src/plugin.ts:117-120` call passes `this.pluginArgs.nodeSecret` (not `xenonConfig.nodeSecret`) because pluginArgs is the schema-driven CLI args bag. Read it to see if pluginArgs ALSO has hub credentials available, or if this call site needs to import `xenonConfig`.

- [ ] **Step 3: Type-check**

```
npx tsc --noEmit 2>&1 | grep -E "(NodeDevices|plugin\\.ts|ServerManager|device-utils)" || echo "tsc clean"
```

- [ ] **Step 4: Commit**

```
cat > /tmp/xenon-p4bt5-msg.txt << 'XENON_EOF'
feat(auth): NodeDevices outbound — pair > legacy precedence

NodeDevices constructor now takes an options bag with both legacy
nodeSecret and pair-auth (hubAccessKey, hubToken). When both shapes
are configured the pair wins; deployments mid-migration can have
both env vars set without breakage.

Call sites in plugin.ts, ServerManager.ts, and device-utils.ts
updated to pass xenonConfig.hubAccessKey / hubToken alongside the
existing nodeSecret param. Constructor positional API replaced by
options bag to avoid further parameter sprawl.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/device-managers/NodeDevices.ts src/plugin.ts \
        src/services/ServerManager.ts src/device-utils.ts
git commit -F /tmp/xenon-p4bt5-msg.txt && rm /tmp/xenon-p4bt5-msg.txt
```

---

## Task 6: `SocketClient` outbound — same precedence

**File:** Modify `src/services/SocketClient.ts`.

- [ ] **Step 1: Read the connect block**

```
sed -n '20,50p' src/services/SocketClient.ts
```

The existing code reads `xenonConfig.nodeSecret` and sends `auth: nodeSecret ? { nodeSecret } : undefined` to socket.io.

- [ ] **Step 2: Replace with pair-first**

```ts
// Phase 4B: prefer (accessKey, token) pair over legacy nodeSecret.
const hubAccessKey = xenonConfig.hubAccessKey;
const hubToken = xenonConfig.hubToken;
const nodeSecret = xenonConfig.nodeSecret;

let socketAuth: Record<string, string> | undefined;
if (hubAccessKey && hubToken) {
  socketAuth = { accessKey: hubAccessKey, token: hubToken };
} else if (nodeSecret) {
  socketAuth = { nodeSecret };
} else {
  socketAuth = undefined;
  log.warn(
    '[SocketClient] Neither (XENON_HUB_ACCESS_KEY + XENON_HUB_TOKEN) nor XENON_NODE_SECRET set; hub will reject the handshake unless it also has auth disabled.',
  );
}

this.socket = io(normalizedHubUrl, {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  auth: socketAuth,
});
```

The `auth.accessKey` / `auth.token` shape on the wire matches what `SocketServer` (Task 4) reads.

- [ ] **Step 3: Type-check + commit**

```
npx tsc --noEmit 2>&1 | grep "SocketClient\\.ts" || echo "tsc clean"
```

```
cat > /tmp/xenon-p4bt6-msg.txt << 'XENON_EOF'
feat(auth): SocketClient outbound — pair > legacy precedence

Mirrors the REST NodeDevices outbound change for the Socket.io
client. When XENON_HUB_ACCESS_KEY + XENON_HUB_TOKEN are both set,
the handshake's auth payload carries the pair; otherwise falls
back to XENON_NODE_SECRET; otherwise warns and connects without
auth (hub will reject unless XENON_AUTH_DISABLED=true).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/services/SocketClient.ts
git commit -F /tmp/xenon-p4bt6-msg.txt && rm /tmp/xenon-p4bt6-msg.txt
```

---

## Task 7: Integration test — `/register` REST pair vs legacy

**File:** Create `test/integration/node-pair-auth-rest.spec.ts`.

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { nodeSecretMiddleware } from '../../src/middleware/nodeSecretMiddleware';
import GridRouter from '../../src/app/routers/grid';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';

describe('node pair auth — REST /register (integration)', function () {
  this.timeout(60_000);
  const NODE_SECRET = 'test-node-secret-' + Date.now();
  let nodeUser: { id: string; accessKey: string };
  let rawToken: string;

  before(async () => {
    // Provision a "node user" + a devices-scoped token, simulating the
    // post-Phase-4B operator workflow.
    const u = await Container.get(UserService).createUser({
      email: `phase4b-node-${Date.now()}@xenon.local`,
      name: 'Phase 4B Test Node',
      password: 'unused-test-pass-1',
      role: 'ADMIN',
    });
    nodeUser = { id: u.id, accessKey: u.accessKey };
    const tok = await Container.get(ApiKeyService).create({
      name: 'phase4b test',
      scopes: ['devices'],
      userId: u.id,
    });
    rawToken = tok.raw;
  });

  after(async () => {
    await prisma.apiKey.deleteMany({ where: { userId: nodeUser.id } });
    await prisma.userSession.deleteMany({ where: { userId: nodeUser.id } });
    await prisma.user.delete({ where: { id: nodeUser.id } });
    // Also clear the lazy-created Legacy Node row so we don't pollute the
    // test DB across runs.
    await prisma.user
      .delete({ where: { email: 'legacy-node@xenon.local' } })
      .catch(() => undefined);
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(['/register'], nodeSecretMiddleware(NODE_SECRET));
    app.use(authMiddleware);
    GridRouter.register(app as any, {} as any);
    return app;
  }

  it('pair (accessKey, token) → 200', async () => {
    const r = await request(buildApp())
      .post('/register')
      .query({ type: 'add' })
      .set('x-xenon-access-key', nodeUser.accessKey)
      .set('x-xenon-token', rawToken)
      .send([]);
    // Status 200 OR 400 from the handler itself when devices=[] is empty —
    // either way it's not a 401, which is what we're testing for.
    expect(r.status).to.not.equal(401);
    expect(r.status).to.not.equal(403);
  });

  it('legacy x-xenon-node-secret + flag on → 200', async () => {
    const orig = (config as any).acceptLegacyNodeSecret;
    (config as any).acceptLegacyNodeSecret = true;
    try {
      const r = await request(buildApp())
        .post('/register')
        .query({ type: 'add' })
        .set('x-xenon-node-secret', NODE_SECRET)
        .send([]);
      expect(r.status).to.not.equal(401);
      expect(r.status).to.not.equal(403);
    } finally {
      (config as any).acceptLegacyNodeSecret = orig;
    }
  });

  it('legacy x-xenon-node-secret + flag off → 401', async () => {
    const orig = (config as any).acceptLegacyNodeSecret;
    (config as any).acceptLegacyNodeSecret = false;
    try {
      const r = await request(buildApp())
        .post('/register')
        .query({ type: 'add' })
        .set('x-xenon-node-secret', NODE_SECRET)
        .send([]);
      expect(r.status).to.equal(401);
      expect(r.body.error).to.match(/XENON_ACCEPT_LEGACY_NODE_SECRET/);
    } finally {
      (config as any).acceptLegacyNodeSecret = orig;
    }
  });

  it('no auth headers → 401', async () => {
    const r = await request(buildApp())
      .post('/register')
      .query({ type: 'add' })
      .send([]);
    expect(r.status).to.equal(401);
  });

  it('pair AND legacy both present → pair wins (200, no Legacy Node row created)', async () => {
    // First, ensure no Legacy Node row exists.
    await prisma.user
      .delete({ where: { email: 'legacy-node@xenon.local' } })
      .catch(() => undefined);

    const r = await request(buildApp())
      .post('/register')
      .query({ type: 'add' })
      .set('x-xenon-access-key', nodeUser.accessKey)
      .set('x-xenon-token', rawToken)
      .set('x-xenon-node-secret', NODE_SECRET)
      .send([]);
    expect(r.status).to.not.equal(401);

    // Confirm pair was used (Legacy Node row was NOT lazily created).
    const legacy = await prisma.user.findUnique({
      where: { email: 'legacy-node@xenon.local' },
    });
    expect(legacy).to.be.null;
  });
});
```

If `GridRouter.register` doesn't fit `app as any` (different arg shape), match what `team-visibility-grid.spec.ts` from Phase 4A uses.

If the endpoint requires a payload more elaborate than `[]`, look at how `registerNode` is invoked in existing handler tests for the right body shape — but a 401/403 test doesn't need a valid payload, since the auth check happens before the handler body.

Note: this test also calls `resetLegacyNodeUserCache()` indirectly via the after-hook deleting the row. If the cached id refers to a stale row, the next test in another file might fail. Add an explicit reset at the top of `after()` if needed:

```ts
import { resetLegacyNodeUserCache } from '../../src/services/identity/legacyNodeUser';

after(async () => {
  resetLegacyNodeUserCache();
  // ... existing cleanup ...
});
```

- [ ] **Run**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 test/integration/node-pair-auth-rest.spec.ts
```

Expected: 5 passing.

- [ ] **Commit**

```
cat > /tmp/xenon-p4bt7-msg.txt << 'XENON_EOF'
test(integration): node pair auth — REST /register

Five cases:
- (accessKey, token) pair → not 401/403.
- Legacy x-xenon-node-secret with XENON_ACCEPT_LEGACY_NODE_SECRET=true → not 401.
- Legacy with flag off → 401 with migration-pointing error.
- No auth headers → 401.
- Both pair and legacy present → pair wins (Legacy Node row not created).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add test/integration/node-pair-auth-rest.spec.ts
git commit -F /tmp/xenon-p4bt7-msg.txt && rm /tmp/xenon-p4bt7-msg.txt
```

---

## Task 8: Integration test — Socket handshake

**File:** Create `test/integration/node-pair-auth-socket.spec.ts`.

The Socket.io handshake test is more elaborate because we need an actual server + client. Two pragmatic options:

(a) **Spin up a real Socket.io server and client.** Pros: end-to-end coverage. Cons: heavyweight; flaky in CI.
(b) **Test the auth resolver function directly** (export it from `SocketServer.ts` if not already exported). Faster, more deterministic, narrower coverage.

Recommend (b). Read `src/services/SocketServer.ts` to find the auth resolver function. If it's a private method, expose a test-only export (`export function _resolveAuthForTest(...)`) or refactor the relevant logic into a small testable helper.

If exposing test-only internals feels too invasive, fall back to (a): use `socket.io` + `socket.io-client` to spin up an in-process pair, run the four scenarios. Skeleton:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
// ... import whatever SocketServer's setup function is named ...

describe('node pair auth — Socket handshake (integration)', function () {
  this.timeout(60_000);
  // Test bodies analogous to the REST suite.
});
```

If structural complexity of (a) is too high (>30 minutes), document the deviation: ship the unit tests in Task 4 as the only socket coverage, skip this integration test. The REST integration test in Task 7 plus the unit tests already give the auth-shape coverage; the socket path uses the same primitives.

Pragmatic call: **skip Task 8 if (b) requires a non-trivial refactor of SocketServer.ts to extract the resolver, and the unit test in Task 4 is missing or hard to write.** Report DONE_WITH_CONCERNS noting the deferred coverage.

- [ ] **If completed:** commit:

```
cat > /tmp/xenon-p4bt8-msg.txt << 'XENON_EOF'
test(integration): node pair auth — Socket handshake

Mirrors the REST suite for the Socket.io channel: pair (accessKey,
token) → connected; legacy nodeSecret with flag on → connected;
legacy with flag off → rejected; no auth → rejected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add test/integration/node-pair-auth-socket.spec.ts
# (and any helper file you exported for the test)
git commit -F /tmp/xenon-p4bt8-msg.txt && rm /tmp/xenon-p4bt8-msg.txt
```

If skipped, document in the PR-A finalization body.

---

## Task 9: Swagger update

**File:** Modify `src/app/swagger.ts`.

- [ ] Find the `x-xenon-node-secret` security scheme (around line 208-210 today).
- [ ] Update the description to deprecate it and point at pair auth:

```ts
{
  name: 'x-xenon-node-secret',
  description:
    'DEPRECATED (Phase 4B): use the (accessKey, token) header pair instead — set ' +
    '`x-xenon-access-key` and `x-xenon-token` on /register and /unblock. The legacy ' +
    'header is accepted while `XENON_ACCEPT_LEGACY_NODE_SECRET=true` (default for ' +
    'one minor); operators flip to `false` once every node has migrated. See the ' +
    'node-provisioning ops doc for the migration plan.',
}
```

- [ ] Find the doc-block at line 30 (the API overview): update the hub-node mention to recommend pair auth as primary.
- [ ] Update `src/app/swagger-docs.ts:2713`, `:2751`, `:2762`, `:2786` (the `/register` and `/unblock` route docs that mention `x-xenon-node-secret`). Add a sentence noting pair-auth is the preferred shape.
- [ ] Type-check + commit:

```
npx tsc --noEmit 2>&1 | grep "swagger" || echo "tsc clean"
```

```
cat > /tmp/xenon-p4bt9-msg.txt << 'XENON_EOF'
docs(swagger): deprecate x-xenon-node-secret in favor of pair auth

Marks the legacy header as deprecated in the OpenAPI / Swagger
schema and the route-level docs for /register and /unblock. Pair
auth (x-xenon-access-key + x-xenon-token) is the preferred shape;
the legacy header is accepted while XENON_ACCEPT_LEGACY_NODE_SECRET
is true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/app/swagger.ts src/app/swagger-docs.ts
git commit -F /tmp/xenon-p4bt9-msg.txt && rm /tmp/xenon-p4bt9-msg.txt
```

---

## Task 10: PR-A finalization

- [ ] **Run the full identity surface** + the new Phase 4B tests:

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 \
  test/unit/UserService.test.ts test/unit/UserSessionService.test.ts \
  test/unit/ApiKeyService.test.ts test/unit/loginRateLimiter.test.ts \
  test/unit/authMiddleware.test.ts test/unit/apiKeyMiddleware.test.ts \
  test/unit/profile-router.test.ts test/unit/bootstrap-identity.test.ts \
  test/unit/extract-access-key-token-pair.test.ts test/unit/roleGuard.test.ts \
  test/unit/PasswordResetService.test.ts test/unit/EmailService.test.ts \
  test/unit/userAuthorization.test.ts test/unit/users-router.test.ts \
  test/unit/TeamService.test.ts test/unit/team-filter.test.ts \
  test/unit/legacyNodeUser.test.ts test/unit/nodeSecretMiddleware.test.ts \
  test/integration/auth-flow.spec.ts test/integration/role-matrix.spec.ts \
  test/integration/team-visibility-grid.spec.ts \
  test/integration/team-visibility-dashboard.spec.ts \
  test/integration/team-visibility-recordings.spec.ts \
  test/integration/node-pair-auth-rest.spec.ts
```

(Add `test/integration/node-pair-auth-socket.spec.ts` if Task 8 shipped.)

All green.

- [ ] `npx tsc --noEmit` clean.
- [ ] `git push -u origin feat/phase-4b-node-pair-auth`.
- [ ] Open PR-A: title `feat(auth): Phase 4B — node pair auth + legacy fallback (PR-A of 2)`. Body documents:
  - The dual-shape acceptance (pair preferred; legacy gated).
  - The migration plan summary (pointing at PR-B for full doc).
  - Whether Task 8 (socket integration test) shipped or deferred.
  - The Legacy Node user pattern (mirrors Phase 1's Legacy Admin).

---

# PR-B — Operator documentation + manual verification

**Branch:** `feat/phase-4b-docs` (off `main` after PR-A merge).

---

## Task 11: Operator migration doc

**File:** Create `docs/superpowers/operations/node-provisioning.md`.

```markdown
# Node Provisioning (Phase 4B onward)

After Phase 4B, every node-to-hub call uses the same `(accessKey, token)`
header pair we ship for SDK / CLI clients. The legacy `XENON_NODE_SECRET`
shared-secret keeps working for one minor under
`XENON_ACCEPT_LEGACY_NODE_SECRET=true` (default), with a deprecation log
line nudging you to migrate.

## Why migrate

- One auth path: nodes look like any other programmatic API client.
- Per-node credentials: revoking one node's token doesn't break the others.
- Audit trail: every `/register` call now attributes to the node's User row.
- No shared secrets in `XENON_NODE_SECRET` env to leak.

## Migrating a single node

### 1. On the hub

Sign in to the dashboard at `https://<hub-host>/xenon/`. Then:

1. Open `/users` → "+ Invite User".
2. Email: `node-<hostname>@xenon.local` (pick a convention durable across
   redeploys — host or rack-id is fine).
3. Name: `Node <hostname>`.
4. Role: `ADMIN`.
5. Submit. The dialog shows a temporary password — copy it.

### 2. Generate the node's API token

1. Sign out. Sign in as the new node user with the temp password.
2. Open `/profile` → "API Tokens" tab.
3. Note the **access key** displayed at the top of the table (`xen_…`).
4. Click "Generate New Token", name it `node-<hostname>`, scopes
   `devices`. Submit.
5. Copy the token shown once.

### 3. On the node

Set the env vars before bringing the node up:

```bash
export XENON_HUB_ACCESS_KEY="xen_..."          # access key from step 2.3
export XENON_HUB_TOKEN="..."                    # token from step 2.4
```

Restart the node process. Both the REST `/register` calls and the Socket.io
handshake will switch to pair auth automatically.

### 4. Verify

On the hub, tail the operator logs. Before migration, you should see
this every minute or so per legacy-using node:

```
[nodeSecret] DEPRECATED: 1.2.3.4 authenticated via x-xenon-node-secret. Migrate this node to pair auth (XENON_HUB_ACCESS_KEY + XENON_HUB_TOKEN).
```

After step 3, that log line should stop firing for that source IP.

You can also confirm in the dashboard: `/sessions` (or `/devices`) actions
will now attribute to the node's User row, not to "API key …".

## Migrating a multi-node deployment

Do nodes one at a time. Each migration is independent — the hub accepts
both shapes simultaneously while `XENON_ACCEPT_LEGACY_NODE_SECRET=true`.

1. Migrate node A.
2. Confirm the deprecation log stops for A's IP.
3. Migrate node B.
4. ... and so on.

## Tightening the screw

Once every node has migrated:

1. On the hub, set `XENON_ACCEPT_LEGACY_NODE_SECRET=false`. Restart.
2. Drop `XENON_NODE_SECRET` and `XENON_NODE_SECRET_PREVIOUS` from the
   hub's env (they're no longer consulted).
3. On each node, drop `XENON_NODE_SECRET` from its env (it's no longer
   sent because pair auth wins; this is just cleanup).

After step 1, any unmigrated node will start failing `/register` and
socket handshakes with `x-xenon-node-secret is rejected; ...`. That's
your deadline-enforcer.

## First-run scenario

A fresh hub install (post-Phase-4B) has no `XENON_NODE_SECRET` set.
You must provision the first node user via the dashboard BEFORE
bringing up the first node — otherwise the node has nothing to
authenticate with.

If you're starting fresh and don't yet have the dashboard URL,
the bootstrap super-admin is created on first hub boot per Phase 1's
flow (see `docs/superpowers/specs/2026-04-28-phase-1-identity-backbone-design.md`).

## What if I lose a node's token?

Sign in to the hub as the node user. Open `/profile` → API Tokens.
Delete the lost token, generate a new one, and re-set
`XENON_HUB_TOKEN` on the node. Or, if you've also lost the access
key (it's printed at the top of the API Tokens tab), rotate it
via the "Rotate" button next to it — existing tokens are rebound
to the new accessKey at verify time, so you don't need to re-issue
tokens unless you explicitly want to.

## Common gotchas

- **HTTPS proxy in front of the hub.** The deprecation log logs the
  source IP. If your nodes are behind a proxy, confirm `X-Forwarded-For`
  is being honored — `nodeSecretMiddleware` already reads it.
- **Multiple nodes behind one NAT.** The deprecation log throttles per
  source IP, so multiple legacy-using nodes behind one NAT show one log
  line per minute, not per-node. Migrate them one at a time so the
  individual nodes' IPs become resolvable in the log stream.
- **Node user accidentally promoted to SUPER_ADMIN.** The token's
  `['devices']` scope still constrains what the node can do, but admin
  hygiene says: keep node users at ADMIN. Audit periodically.
```

- [ ] **Commit**

```
cat > /tmp/xenon-p4bt11-msg.txt << 'XENON_EOF'
docs(ops): node-provisioning guide for Phase 4B pair auth

Walks an operator through migrating from the legacy XENON_NODE_SECRET
shared secret to per-node (accessKey, token) pair auth. Covers the
single-node migration steps, multi-node rollout, the
XENON_ACCEPT_LEGACY_NODE_SECRET deadline-enforcer flip, the
first-run bootstrap scenario, lost-token recovery, and common
gotchas.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add docs/superpowers/operations/node-provisioning.md
git commit -F /tmp/xenon-p4bt11-msg.txt && rm /tmp/xenon-p4bt11-msg.txt
```

If `docs/superpowers/operations/` doesn't exist, create it. If the project conventionally puts operator docs elsewhere (`docs/operations/` or just `docs/`), use that location instead. Match what other ops-style docs in the repo do.

---

## Task 12: Manual verification + PR-B finalization

This task has no code changes — it's running the system manually.

- [ ] **Step 1: Bring up the hub + a node**

```
npm run dev
```

(Plus your local-node setup — the project's existing dev workflow.)

- [ ] **Step 2: Walk the migration**

Follow the doc's steps with a real test node, capturing any frictions in the doc. Update the doc inline with anything discovered.

- [ ] **Step 3: Push + open PR**

```
git push -u origin feat/phase-4b-docs
gh pr create --title "docs(ops): Phase 4B node-provisioning guide (PR-B of 2)" --body-file /tmp/xenon-p4b-pr-b-body.md
```

PR body documents whether the manual verification surfaced any doc updates and links the migration guide.

---

## Self-Review Checklist (pre-merge)

Before each PR:

- [ ] All tests in the relevant suite pass.
- [ ] `tsc --noEmit` clean.
- [ ] No `git add -A` was used.
- [ ] Conventional Commits + Co-Authored-By trailer.
- [ ] PR-A body documents the dual-shape acceptance + the per-IP deprecation log behavior + whether Task 8 shipped.
- [ ] PR-B body confirms manual verification was walked end-to-end with a real node (or notes if it was deferred to a follow-up).
- [ ] Spec coverage: every spec section maps to a task.

## Out of scope for this plan

- Phase 5 sidebar redesign — separate cycle.
- Removal of `XENON_NODE_SECRET` entirely — separate phase after this minor bakes.
- Dedicated `NODE` role — YAGNI.
- Auto-bootstrapping a first-node user on fresh hub install.
- Frontend "Nodes" management page — nodes appear as users in `/users`.
- 2FA / SSO / OIDC / account lockout — deferred indefinitely.
