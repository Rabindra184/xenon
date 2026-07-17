# Hub Identity Surface + Platform Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the xenon repo hub-ready for Xenon Studio: JWT identity surface (issue + accept), stream tickets, `/capabilities` feature detection, and the ARB foreclosure guards (event log, ArtifactStore interface, Project entity) — with every behavior change additive or flag-gated so existing plugin behavior is unchanged.

**Architecture:** All work is additive to the existing Express + TypeDI + Prisma/SQLite monolith. Identity: a new `JwtKeyService` (RS256, `jose`) signs short-lived tokens minted by `POST /auth/token`; `authMiddleware` gains a Bearer branch *after* the existing header-pair branch and *before* the cookie branch (each branch triggers only on its own input, so existing flows execute identically). Stream tickets are single-use JWTs accepted by a narrow, path-matched branch in the same middleware. Guards: an `EventLog` outbox row appended fire-and-forget from the single `SocketServer.emitToDashboard` choke point; an `ArtifactStore` interface wrapping today's filesystem paths byte-identically; a minimal `Project` entity.

**Tech Stack:** TypeScript 5.5 (ES2016/CJS), Express, TypeDI, Prisma 5.4 + SQLite, `jose` (new dep — same choice as appium-mcp-auth), Mocha + Chai + Sinon.

## Discovery record (why this plan is smaller than the spec's §2.4)

Verified during planning — **do not re-implement these, they exist:**
- `Lease` model + `LeaseService` (create/heartbeat/extend/release/resolve, typed errors) + `LeaseOrphanSweeper` + lease-bound allocation via `xenon:options.leaseId` (`src/services/lease/`, `src/app/routers/sdk-leases.ts`, `src/device-utils.ts:126`). This **is** the DeviceClaim aggregate, TTL sweep, and owner-aware allocation from spec §2.4 — token-bound, better than the spec's actor-string design. The `xenon_acquire_device` MCP tool maps to `POST /xenon/api/sdk/leases`.
- Idle-session reaper: `releaseBlockedDevices` (`src/device-utils.ts:575`) on `checkBlockedDevicesIntervalMs`, honoring per-device `newCommandTimeout`. Manual locks are excluded by design (`lastCmdExecutedAt: undefined`).
- Task 8 updates the spec + CLAUDE.md to record this.

## Global Constraints

- **Existing behavior unchanged on merge:** every new auth path triggers only on inputs that don't occur today (Bearer header, `?ticket=`, new endpoints). Regression tests assert old behavior under old inputs.
- **No SQLite-isms:** new Prisma models use portable types only (JSON stored as `String`).
- **Node engines stay `^14.17.0 || ^16.13.0 || >=18.0.0`** — `jose` v5 requires Node ≥18; pin `jose@^5` and note it requires Node 18+ at runtime for the new endpoints only (the plugin already runs on ≥18 everywhere in practice; do NOT change `engines`).
- Tests: `npx mocha test/unit/<file>.spec.ts`. Files importing anything that pulls in `SessionManager`/`CommandInterceptor` need `import 'reflect-metadata'` first (CLAUDE.md).
- Commits follow conventional commits; work on branch `feat/hub-identity-guards`; PR to main at the end (user merges).
- Env kill-switches over schema.json churn: new toggles are env vars read in `src/config.ts`, not plugin CLI args.
- JWT defaults: issuer `xenon-hub` (env `XENON_JWT_ISSUER`), audiences `xenon-rest` (TTL 3600 s), `xenon-mcp` (TTL 86400 s, env `XENON_MCP_TOKEN_TTL_SEC`), `xenon-stream` (TTL 60 s, single-use).

---

### Task 1: JwtKeyService — RS256 keypair, sign/verify, JWKS

**Files:**
- Create: `src/services/token/JwtKeyService.ts`
- Test: `test/unit/JwtKeyService.spec.ts`
- Modify: `package.json` (add `jose@^5.9.6` to dependencies)

**Interfaces:**
- Produces: `JwtKeyService.init(keyDir: string): Promise<void>`, `sign(claims: Record<string, unknown>, opts: { audience: string; ttlSeconds: number; jti?: string }): Promise<string>`, `verify(token: string, opts: { audience: string }): Promise<jose.JWTPayload>`, `jwks(): { keys: object[] }`. Registered as TypeDI `@Service()`; later tasks use `Container.get(JwtKeyService)`.

- [ ] **Step 1: Install jose**

Run: `npm install jose@^5.9.6`
Expected: `package.json` dependencies gains `"jose": "^5.9.6"`.

- [ ] **Step 2: Write the failing test**

```typescript
// test/unit/JwtKeyService.spec.ts
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';

describe('JwtKeyService', () => {
  let dir: string;
  let svc: JwtKeyService;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-jwt-'));
    svc = new JwtKeyService();
    await svc.init(dir);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('generates a private key file with 0600 on first init', () => {
    const keyPath = path.join(dir, 'xenon-jwt-private.pem');
    expect(fs.existsSync(keyPath)).to.equal(true);
    const mode = fs.statSync(keyPath).mode & 0o777;
    expect(mode).to.equal(0o600);
  });

  it('reloads the same key on second init (stable kid)', async () => {
    const kid1 = svc.jwks().keys[0].kid;
    const svc2 = new JwtKeyService();
    await svc2.init(dir);
    expect(svc2.jwks().keys[0].kid).to.equal(kid1);
  });

  it('signs and verifies a token round-trip with audience check', async () => {
    const token = await svc.sign({ sub: 'user-1', scopes: 'devices,read' }, { audience: 'xenon-rest', ttlSeconds: 60 });
    const payload = await svc.verify(token, { audience: 'xenon-rest' });
    expect(payload.sub).to.equal('user-1');
    expect(payload.scopes).to.equal('devices,read');
  });

  it('rejects wrong audience', async () => {
    const token = await svc.sign({ sub: 'u' }, { audience: 'xenon-mcp', ttlSeconds: 60 });
    try {
      await svc.verify(token, { audience: 'xenon-rest' });
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(String(e.message)).to.match(/aud/i);
    }
  });

  it('rejects expired tokens', async () => {
    const token = await svc.sign({ sub: 'u' }, { audience: 'xenon-rest', ttlSeconds: -10 });
    try {
      await svc.verify(token, { audience: 'xenon-rest' });
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(String(e.code ?? e.message)).to.match(/expired|ERR_JWT_EXPIRED/i);
    }
  });

  it('exposes a JWKS with kid, use=sig, alg=RS256 and no private material', () => {
    const jwk = svc.jwks().keys[0] as any;
    expect(jwk.kid).to.be.a('string');
    expect(jwk.use).to.equal('sig');
    expect(jwk.alg).to.equal('RS256');
    expect(jwk.d).to.equal(undefined); // private exponent must never appear
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx mocha test/unit/JwtKeyService.spec.ts`
Expected: FAIL — `Cannot find module '../../src/services/token/JwtKeyService'`.

- [ ] **Step 4: Implement JwtKeyService**

```typescript
// src/services/token/JwtKeyService.ts
import { Service } from 'typedi';
import * as jose from 'jose';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const KEY_FILE = 'xenon-jwt-private.pem';
const ISSUER = process.env.XENON_JWT_ISSUER || 'xenon-hub';

/**
 * RS256 signing key for hub-issued JWTs (REST/MCP tokens, stream tickets).
 * Key material lives on disk (0600), never in the database. `kid` is derived
 * from the public key so it is stable across restarts; rotation = drop a new
 * PEM in place, old tokens fail verification (acceptable: TTLs are short).
 */
@Service()
export class JwtKeyService {
  private privateKey!: jose.KeyLike;
  private publicJwk!: jose.JWK;
  private kid!: string;

  async init(keyDir: string): Promise<void> {
    fs.mkdirSync(keyDir, { recursive: true });
    const keyPath = path.join(keyDir, KEY_FILE);
    let pkcs8: string;
    if (fs.existsSync(keyPath)) {
      pkcs8 = fs.readFileSync(keyPath, 'utf8');
    } else {
      const { privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
      pkcs8 = await jose.exportPKCS8(privateKey);
      fs.writeFileSync(keyPath, pkcs8, { mode: 0o600 });
    }
    this.privateKey = await jose.importPKCS8(pkcs8, 'RS256');
    // Public JWK derived from the private key; strip private fields.
    const fullJwk = await jose.exportJWK(this.privateKey);
    this.publicJwk = { kty: fullJwk.kty, n: fullJwk.n, e: fullJwk.e };
    this.kid = createHash('sha256')
      .update(`${fullJwk.n}.${fullJwk.e}`)
      .digest('base64url')
      .slice(0, 16);
  }

  async sign(
    claims: Record<string, unknown>,
    opts: { audience: string; ttlSeconds: number; jti?: string },
  ): Promise<string> {
    const jwt = new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: this.kid })
      .setIssuer(ISSUER)
      .setAudience(opts.audience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + opts.ttlSeconds);
    if (opts.jti) jwt.setJti(opts.jti);
    return jwt.sign(this.privateKey);
  }

  async verify(token: string, opts: { audience: string }): Promise<jose.JWTPayload> {
    const publicKey = await jose.importJWK({ ...this.publicJwk, alg: 'RS256' }, 'RS256');
    const { payload } = await jose.jwtVerify(token, publicKey, {
      issuer: ISSUER,
      audience: opts.audience,
      clockTolerance: 60, // spec §7.1: ±60 s skew, mirrors appium-mcp-auth
    });
    return payload;
  }

  jwks(): { keys: Array<Record<string, unknown>> } {
    return { keys: [{ ...this.publicJwk, kid: this.kid, use: 'sig', alg: 'RS256' }] };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx mocha test/unit/JwtKeyService.spec.ts`
Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/services/token/JwtKeyService.ts test/unit/JwtKeyService.spec.ts
git commit -m "feat(auth): JwtKeyService — RS256 keypair, sign/verify, JWKS"
```

---

### Task 2: Token issuance endpoint + public JWKS route

**Files:**
- Modify: `src/app/routers/auth.ts` (add `POST /token` to `authAuthedRouter`, add `GET /jwks.json` to `authPublicRouter`)
- Modify: `src/app/index.ts` or `src/services/ServerManager.ts` — wherever the server boots, call `JwtKeyService.init()` once (grep for where `apiRouter.use(authMiddleware)` is set up, init before routes mount; key dir = same directory as the SQLite file — locate via `src/config.ts`'s database path, `path.dirname(...)`)
- Test: `test/unit/TokenEndpoint.spec.ts`

**Interfaces:**
- Consumes: `JwtKeyService.sign/jwks` (Task 1).
- Produces: `POST /xenon/api/auth/token` body `{ audience?: 'xenon-rest' | 'xenon-mcp' }` → `{ token: string, expiresIn: number, audience: string }`; `GET /xenon/api/auth/jwks.json` (unauthenticated) → JWKS JSON. Task 3 verifies these tokens; the appium-mcp-auth gateway will use the JWKS URL (its `jwksUri` is configurable, so `/xenon/api/auth/jwks.json` is fine — the spec's `/.well-known/jwks.json` is a convention, not a requirement; note this in Task 8's doc update).

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/TokenEndpoint.spec.ts
import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { issueToken } from '../../src/app/routers/auth';

describe('POST /auth/token handler (issueToken)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-tok-'));
    const svc = new JwtKeyService();
    await svc.init(dir);
    Container.set(JwtKeyService, svc);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    Container.reset();
  });

  const auth = { kind: 'api-key', userId: 'u1', role: 'MEMBER', scopes: 'devices,read', teamId: 't1', rateLimit: 300 } as any;

  it('mints a xenon-rest token by default with 3600s TTL', async () => {
    const out = await issueToken(auth, {});
    expect(out.audience).to.equal('xenon-rest');
    expect(out.expiresIn).to.equal(3600);
    const payload = await Container.get(JwtKeyService).verify(out.token, { audience: 'xenon-rest' });
    expect(payload.sub).to.equal('u1');
    expect(payload.scopes).to.equal('devices,read');
    expect(payload.teamId).to.equal('t1');
  });

  it('mints a xenon-mcp token with 86400s TTL', async () => {
    const out = await issueToken(auth, { audience: 'xenon-mcp' });
    expect(out.expiresIn).to.equal(86400);
    await Container.get(JwtKeyService).verify(out.token, { audience: 'xenon-mcp' });
  });

  it('rejects unknown audiences', async () => {
    try {
      await issueToken(auth, { audience: 'xenon-stream' }); // tickets are not minted here
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.message).to.match(/audience/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/TokenEndpoint.spec.ts`
Expected: FAIL — `issueToken` is not exported.

- [ ] **Step 3: Implement issueToken + routes**

In `src/app/routers/auth.ts` add (exported for testability, route is a thin wrapper):

```typescript
import { Container } from 'typedi';
import { JwtKeyService } from '../../services/token/JwtKeyService';

const MCP_TTL_SEC = Number(process.env.XENON_MCP_TOKEN_TTL_SEC || 86400);
const REST_TTL_SEC = 3600;
const MINTABLE_AUDIENCES = ['xenon-rest', 'xenon-mcp'] as const;

export async function issueToken(
  auth: { userId: string; role: string; scopes: string; teamId?: string | null },
  body: { audience?: string },
): Promise<{ token: string; expiresIn: number; audience: string }> {
  const audience = body.audience ?? 'xenon-rest';
  if (!MINTABLE_AUDIENCES.includes(audience as any)) {
    throw new Error(`unsupported audience: ${audience}`);
  }
  const expiresIn = audience === 'xenon-mcp' ? MCP_TTL_SEC : REST_TTL_SEC;
  const token = await Container.get(JwtKeyService).sign(
    { sub: auth.userId, role: auth.role, scopes: auth.scopes, teamId: auth.teamId ?? null },
    { audience, ttlSeconds: expiresIn },
  );
  return { token, expiresIn, audience };
}
```

Inside `authAuthedRouter()` (same file, alongside the existing `/me` and `/dashboard-session` routes):

```typescript
r.post('/token', async (req, res) => {
  try {
    const out = await issueToken(req.auth!, req.body ?? {});
    res.json(out);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});
```

Inside `authPublicRouter()` (the unauthenticated router — login/logout live here):

```typescript
r.get('/jwks.json', (_req, res) => {
  res.json(Container.get(JwtKeyService).jwks());
});
```

Boot wiring: at server startup (same place the routers are mounted in `src/app/index.ts` — before `apiRouter.use('/auth', authPublicRouter())`), add:

```typescript
import { JwtKeyService } from '../services/token/JwtKeyService';
// key material lives next to the SQLite db file
await Container.get(JwtKeyService).init(path.dirname(config.databasePath ?? 'xenon.db'));
```

(Grep `src/config.ts` for the actual database-path property name and use it; if boot is not async at that point, wrap in a `.then()` consistent with surrounding code.)

- [ ] **Step 4: Run test + full auth suite**

Run: `npx mocha test/unit/TokenEndpoint.spec.ts && npx mocha test/unit/ApiKeyService.test.ts`
Expected: all passing (existing ApiKeyService untouched — regression check).

- [ ] **Step 5: Commit**

```bash
git add src/app/routers/auth.ts src/app/index.ts test/unit/TokenEndpoint.spec.ts
git commit -m "feat(auth): POST /auth/token (JWT mint) + public JWKS route"
```

---

### Task 3: Bearer-JWT acceptance in authMiddleware (with regression tests)

**Files:**
- Modify: `src/middleware/authMiddleware.ts` (new branch between the header-pair block ending at line ~105 and the cookie block starting at line ~110)
- Modify: `src/types/express.d.ts` if `req.auth.kind` is a closed union — add `'bearer'`
- Test: `test/unit/authMiddleware.bearer.spec.ts`

**Interfaces:**
- Consumes: `JwtKeyService.verify` (Task 1).
- Produces: requests with `Authorization: Bearer <jwt>` (audience `xenon-rest`) get `req.auth = { kind: 'bearer', userId, role, scopes, teamId, rateLimit: 300, teamIds }`. Live user lookup on every request → revocation is instant on the REST surface (spec §7.1).

- [ ] **Step 1: Write the failing tests — including the old-behavior regression pins**

```typescript
// test/unit/authMiddleware.bearer.spec.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { prisma } from '../../src/prisma';

function fakeRes() {
  const res: any = { statusCode: 200 };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.cookie = () => res;
  return res;
}

describe('authMiddleware — Bearer branch', () => {
  let dir: string;
  let keySvc: JwtKeyService;
  const user = { id: 'u1', role: 'MEMBER', status: 'ACTIVE' };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-bearer-'));
    keySvc = new JwtKeyService();
    await keySvc.init(dir);
    Container.set(JwtKeyService, keySvc);
    Container.set(UserService, { findById: sinon.stub().resolves(user) } as any);
    Container.set(ApiKeyService, { verifyPair: sinon.stub().resolves(null), verify: sinon.stub().resolves(null) } as any);
    Container.set(UserSessionService, { resolve: sinon.stub().resolves(null) } as any);
    sinon.stub(prisma.teamMember, 'findMany').resolves([{ teamId: 't1' }] as any);
  });
  afterEach(() => {
    sinon.restore();
    Container.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a valid xenon-rest Bearer token and sets req.auth', async () => {
    const token = await keySvc.sign(
      { sub: 'u1', role: 'MEMBER', scopes: 'devices,read', teamId: 't1' },
      { audience: 'xenon-rest', ttlSeconds: 60 },
    );
    const req: any = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = fakeRes();
    const next = sinon.spy();
    await authMiddleware(req, res as any, next);
    expect(next.calledOnce).to.equal(true);
    expect(req.auth.kind).to.equal('bearer');
    expect(req.auth.userId).to.equal('u1');
    expect(req.auth.scopes).to.equal('devices,read');
  });

  it('rejects an xenon-mcp-audience token on the REST surface', async () => {
    const token = await keySvc.sign({ sub: 'u1' }, { audience: 'xenon-mcp', ttlSeconds: 60 });
    const req: any = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = fakeRes();
    await authMiddleware(req, res as any, sinon.spy());
    expect(res.statusCode).to.equal(401);
  });

  it('rejects a token for a disabled user (live revocation)', async () => {
    (Container.get(UserService).findById as sinon.SinonStub).resolves({ ...user, status: 'DISABLED' });
    const token = await keySvc.sign({ sub: 'u1' }, { audience: 'xenon-rest', ttlSeconds: 60 });
    const req: any = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = fakeRes();
    await authMiddleware(req, res as any, sinon.spy());
    expect(res.statusCode).to.equal(401);
  });

  // ---- regression pins: old inputs behave exactly as before ----

  it('REGRESSION: no credentials → 401 unauthenticated (unchanged)', async () => {
    const req: any = { headers: {}, query: {} };
    const res = fakeRes();
    await authMiddleware(req, res as any, sinon.spy());
    expect(res.statusCode).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'unauthenticated' });
  });

  it('REGRESSION: header pair still takes priority over a Bearer header', async () => {
    const row = { id: 'k1', userId: 'u1', scopes: 'admin', rateLimit: 100, teamId: null };
    (Container.get(ApiKeyService).verifyPair as sinon.SinonStub).resolves(row);
    const token = await keySvc.sign({ sub: 'other' }, { audience: 'xenon-rest', ttlSeconds: 60 });
    const req: any = {
      headers: { 'x-xenon-access-key': 'ak', 'x-xenon-token': 'tk', authorization: `Bearer ${token}` },
      query: {},
    };
    const res = fakeRes();
    const next = sinon.spy();
    await authMiddleware(req, res as any, next);
    expect(next.calledOnce).to.equal(true);
    expect(req.auth.kind).to.equal('api-key'); // pair wins, Bearer never evaluated
  });
});
```

- [ ] **Step 2: Run to verify the new-behavior tests fail**

Run: `npx mocha test/unit/authMiddleware.bearer.spec.ts`
Expected: Bearer tests FAIL (401 instead of next()); both REGRESSION tests already PASS — proving the pin is real before the change.

- [ ] **Step 3: Implement the Bearer branch**

In `src/middleware/authMiddleware.ts`, insert between the header-pair block (`if (headerAccessKey && headerToken) {...}` ending ~line 105) and the cookie block (~line 110):

```typescript
  // Path 1.5: Authorization: Bearer <hub-issued JWT> (audience xenon-rest).
  // Live user lookup on every request → revocation is instant on the REST
  // surface even though the token itself is stateless (spec §7.1).
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    try {
      const payload = await Container.get(JwtKeyService).verify(authHeader.slice(7), {
        audience: 'xenon-rest',
      });
      const user = await userSvc.findById(String(payload.sub));
      if (!user || user.status !== 'ACTIVE') {
        return res.status(401).json({ error: 'invalid token' });
      }
      const teamIds = await computeTeamIds({
        role: user.role as any,
        userId: user.id,
        apiKeyTeamId: (payload.teamId as string | null) ?? null,
      });
      req.auth = {
        kind: 'bearer' as any,
        userId: user.id,
        role: user.role as any,
        scopes: String(payload.scopes ?? ''),
        teamId: (payload.teamId as string | null) ?? null,
        rateLimit: 300,
        teamIds,
      };
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid token' });
    }
  }
```

Add the import at the top: `import { JwtKeyService } from '../services/token/JwtKeyService';`. If `src/types/express.d.ts` types `kind` as a closed union, add `'bearer'` there and drop the `as any`.

- [ ] **Step 4: Run the spec + the full unit suite**

Run: `npx mocha test/unit/authMiddleware.bearer.spec.ts && npm test`
Expected: all passing — including every pre-existing auth-dependent test, untouched.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/authMiddleware.ts src/types/express.d.ts test/unit/authMiddleware.bearer.spec.ts
git commit -m "feat(auth): accept hub-issued Bearer JWTs in authMiddleware (live revocation)"
```

---

### Task 4: Stream tickets — mint endpoint + single-use acceptance

**Files:**
- Create: `src/services/token/StreamTicketService.ts`
- Modify: `src/app/routers/control.ts` (add `POST /:udid/stream/ticket`)
- Modify: `src/middleware/authMiddleware.ts` (narrow ticket branch, before the final 401)
- Test: `test/unit/StreamTicketService.spec.ts`

**Interfaces:**
- Consumes: `JwtKeyService.sign/verify` (Task 1).
- Produces: `POST /xenon/api/control/:udid/stream/ticket` → `{ ticket, expiresIn: 60 }`; `GET /xenon/api/control/:udid/stream?ticket=<jwt>` authenticates via the ticket (webview `<img>` path — spec §2.3/§7.1). `StreamTicketService.mint(udid, actorId): Promise<string>`, `redeem(ticket, udid): Promise<{ actorId: string }>` (throws on reuse/mismatch/expiry).

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/StreamTicketService.spec.ts
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { StreamTicketService } from '../../src/services/token/StreamTicketService';

describe('StreamTicketService', () => {
  let dir: string;
  let svc: StreamTicketService;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-ticket-'));
    const keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    svc = new StreamTicketService();
  });
  afterEach(() => {
    Container.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('mints and redeems a ticket once for the bound udid', async () => {
    const t = await svc.mint('UDID-1', 'actor-1');
    const out = await svc.redeem(t, 'UDID-1');
    expect(out.actorId).to.equal('actor-1');
  });

  it('rejects redemption for a different udid', async () => {
    const t = await svc.mint('UDID-1', 'actor-1');
    try { await svc.redeem(t, 'UDID-2'); expect.fail('should throw'); }
    catch (e: any) { expect(e.message).to.match(/udid/); }
  });

  it('rejects second redemption (single-use)', async () => {
    const t = await svc.mint('UDID-1', 'actor-1');
    await svc.redeem(t, 'UDID-1');
    try { await svc.redeem(t, 'UDID-1'); expect.fail('should throw'); }
    catch (e: any) { expect(e.message).to.match(/used/); }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha test/unit/StreamTicketService.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/services/token/StreamTicketService.ts
import { Service, Container } from 'typedi';
import { randomUUID } from 'crypto';
import { JwtKeyService } from './JwtKeyService';

const TICKET_TTL_SEC = 60;

/** Single-use, udid-bound, 60 s tokens for the webview <img> MJPEG path. */
@Service()
export class StreamTicketService {
  // jti -> expiry epoch-ms. Pruned on each redeem; bounded by 60 s TTL.
  private used = new Map<string, number>();

  async mint(udid: string, actorId: string): Promise<string> {
    return Container.get(JwtKeyService).sign(
      { udid, actorId },
      { audience: 'xenon-stream', ttlSeconds: TICKET_TTL_SEC, jti: randomUUID() },
    );
  }

  async redeem(ticket: string, udid: string): Promise<{ actorId: string }> {
    const payload = await Container.get(JwtKeyService).verify(ticket, { audience: 'xenon-stream' });
    if (payload.udid !== udid) throw new Error('ticket udid mismatch');
    const jti = String(payload.jti);
    const now = Date.now();
    for (const [k, exp] of this.used) if (exp < now) this.used.delete(k);
    if (this.used.has(jti)) throw new Error('ticket already used');
    this.used.set(jti, now + TICKET_TTL_SEC * 1000);
    return { actorId: String(payload.actorId) };
  }
}
```

Route in `src/app/routers/control.ts` (next to the existing stream routes, ~line 497):

```typescript
router.post('/:udid/stream/ticket', async (req: Request, res: Response) => {
  const actorId = req.apiKey?.id ?? req.auth?.userId;
  if (!actorId) return res.status(401).json({ error: 'unauthenticated' });
  const ticket = await Container.get(StreamTicketService).mint(req.params.udid, actorId);
  res.json({ ticket, expiresIn: 60 });
});
```

Ticket acceptance in `src/middleware/authMiddleware.ts`, immediately before the final `return res.status(401).json({ error: 'unauthenticated' })`:

```typescript
  // Path 3: single-use stream ticket — ONLY for GET <control>/:udid/stream.
  const ticket = req.query?.ticket;
  const streamMatch = req.method === 'GET' && /^\/control\/([^/]+)\/stream$/.exec(req.path);
  if (typeof ticket === 'string' && streamMatch) {
    try {
      const { actorId } = await Container.get(StreamTicketService).redeem(ticket, streamMatch[1]);
      req.auth = { kind: 'stream-ticket' as any, userId: actorId, role: 'MEMBER', scopes: 'read', rateLimit: 300, teamIds: undefined };
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid ticket' });
    }
  }
```

(Import `StreamTicketService`; extend the `kind` union with `'stream-ticket'`. The regex runs against `req.path` *relative to the apiRouter mount*, i.e. `/control/<udid>/stream` — verify with a quick `log.debug(req.path)` if in doubt, and adjust if the middleware sees the full `/xenon/api/...` path.)

- [ ] **Step 4: Run tests**

Run: `npx mocha test/unit/StreamTicketService.spec.ts && npx mocha test/unit/authMiddleware.bearer.spec.ts`
Expected: all passing (the bearer spec re-run proves the new branch didn't disturb ordering — its no-credential regression still 401s because `?ticket` is absent).

- [ ] **Step 5: Commit**

```bash
git add src/services/token/StreamTicketService.ts src/app/routers/control.ts src/middleware/authMiddleware.ts test/unit/StreamTicketService.spec.ts
git commit -m "feat(stream): single-use udid-bound stream tickets for webview MJPEG"
```

---

### Task 5: GET /xenon/api/capabilities — feature detection

**Files:**
- Create: `src/app/routers/capabilities.ts`
- Modify: `src/app/index.ts` (mount after `authMiddleware`, next to the other routers ~line 230)
- Test: `test/unit/CapabilitiesRouter.spec.ts`

**Interfaces:**
- Produces: `GET /xenon/api/capabilities` → `{ version: string, features: Record<string, boolean> }`. The extension feature-detects against this instead of version-matching (spec §3 item 9, §6).

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/CapabilitiesRouter.spec.ts
import { expect } from 'chai';
import { buildCapabilities } from '../../src/app/routers/capabilities';

describe('capabilities payload', () => {
  it('reports version and the hub feature set', () => {
    const caps = buildCapabilities();
    expect(caps.version).to.be.a('string').and.not.equal('');
    expect(caps.features).to.deep.equal({
      bearerAuth: true,
      tokenIssuance: true,
      streamTickets: true,
      leases: true,
      eventLog: true,
      projects: true,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx mocha test/unit/CapabilitiesRouter.spec.ts` → module not found.

- [ ] **Step 3: Implement**

```typescript
// src/app/routers/capabilities.ts
import { Router } from 'express';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../../package.json');

export function buildCapabilities() {
  return {
    version: String(pkg.version),
    features: {
      bearerAuth: true,
      tokenIssuance: true,
      streamTickets: true,
      leases: true,      // pre-existing: /sdk/leases
      eventLog: true,    // Task 6
      projects: true,    // Task 7
    },
  };
}

export function capabilitiesRouter(): Router {
  const r = Router();
  r.get('/', (_req, res) => res.json(buildCapabilities()));
  return r;
}
```

Mount in `src/app/index.ts` after `apiRouter.use(authMiddleware)`:
`apiRouter.use('/capabilities', capabilitiesRouter());`

- [ ] **Step 4: Run** — `npx mocha test/unit/CapabilitiesRouter.spec.ts` → 1 passing.

- [ ] **Step 5: Commit**

```bash
git add src/app/routers/capabilities.ts src/app/index.ts test/unit/CapabilitiesRouter.spec.ts
git commit -m "feat(api): /capabilities feature-detection endpoint"
```

---

### Task 6: EventLog outbox — durable, fire-and-forget, from the Socket.io choke point

**Files:**
- Modify: `prisma/schema.prisma` (add `EventLog` model)
- Create: `src/services/EventLogService.ts`
- Modify: `src/services/SocketServer.ts` (`emitToDashboard` appends via EventLogService)
- Test: `test/unit/EventLogService.spec.ts`

**Interfaces:**
- Produces: `EventLogService.appendSafe(entry: { type: string; payload: unknown; correlationId?: string; teamId?: string }): void` (never throws, never blocks the caller); `EventLogService.prune(retentionDays: number): Promise<number>`. Every dashboard broadcast is also durably logged. Kill-switch: env `XENON_EVENT_LOG=off`.

- [ ] **Step 1: Add the Prisma model + migrate**

Append to `prisma/schema.prisma`:

```prisma
model EventLog {
  id            String   @id @default(cuid())
  type          String
  payload       String   // JSON string — portable, no SQLite-isms
  correlationId String?
  teamId        String?
  occurredAt    DateTime @default(now())

  @@index([type, occurredAt])
  @@index([occurredAt])
}
```

Run: `npm run db:generate` (name the migration `event_log`), then `npm run db:migrate`.
Expected: migration applied; `prisma.eventLog` exists on the client.

- [ ] **Step 2: Write the failing test**

```typescript
// test/unit/EventLogService.spec.ts
import { expect } from 'chai';
import sinon from 'sinon';
import { EventLogService } from '../../src/services/EventLogService';

describe('EventLogService', () => {
  function fakePrisma() {
    return { eventLog: { create: sinon.stub().resolves({}), deleteMany: sinon.stub().resolves({ count: 3 }) } };
  }

  it('appendSafe writes type + JSON payload asynchronously', async () => {
    const db = fakePrisma();
    const svc = new EventLogService({ client: db } as any);
    svc.appendSafe({ type: 'device_blocked', payload: { udid: 'U1' }, teamId: 't1' });
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget tick run
    expect(db.eventLog.create.calledOnce).to.equal(true);
    const arg = db.eventLog.create.firstCall.args[0].data;
    expect(arg.type).to.equal('device_blocked');
    expect(JSON.parse(arg.payload)).to.deep.equal({ udid: 'U1' });
  });

  it('appendSafe never throws even when the DB write fails', async () => {
    const db = fakePrisma();
    db.eventLog.create.rejects(new Error('disk full'));
    const svc = new EventLogService({ client: db } as any);
    expect(() => svc.appendSafe({ type: 'x', payload: {} })).to.not.throw();
    await new Promise((r) => setImmediate(r));
  });

  it('is a no-op when XENON_EVENT_LOG=off', async () => {
    process.env.XENON_EVENT_LOG = 'off';
    const db = fakePrisma();
    const svc = new EventLogService({ client: db } as any);
    svc.appendSafe({ type: 'x', payload: {} });
    await new Promise((r) => setImmediate(r));
    expect(db.eventLog.create.called).to.equal(false);
    delete process.env.XENON_EVENT_LOG;
  });

  it('prune deletes rows older than retention', async () => {
    const db = fakePrisma();
    const svc = new EventLogService({ client: db } as any);
    const n = await svc.prune(30);
    expect(n).to.equal(3);
    const where = db.eventLog.deleteMany.firstCall.args[0].where;
    expect(where.occurredAt.lt).to.be.a('date');
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx mocha test/unit/EventLogService.spec.ts` → module not found.

- [ ] **Step 4: Implement**

```typescript
// src/services/EventLogService.ts
import { Service } from 'typedi';
import { PrismaService } from '../data-service/prisma-service';
import log from '../logger';

export interface EventLogEntry {
  type: string;
  payload: unknown;
  correlationId?: string;
  teamId?: string;
}

/**
 * Transactional-outbox seed (ARB foreclosure guard #1). Append-only log of
 * every dashboard-visible domain event. Fire-and-forget by design: the
 * broadcast hot path must gain zero latency and never fail because of the log.
 */
@Service()
export class EventLogService {
  constructor(private prismaService: PrismaService) {}

  appendSafe(entry: EventLogEntry): void {
    if (process.env.XENON_EVENT_LOG === 'off') return;
    setImmediate(() => {
      this.prismaService.client.eventLog
        .create({
          data: {
            type: entry.type,
            payload: JSON.stringify(entry.payload ?? null),
            correlationId: entry.correlationId ?? null,
            teamId: entry.teamId ?? null,
          },
        })
        .catch((err: any) => log.debug(`EventLog append failed (non-fatal): ${err?.message}`));
    });
  }

  async prune(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const res = await this.prismaService.client.eventLog.deleteMany({
      where: { occurredAt: { lt: cutoff } },
    });
    return res.count;
  }
}
```

Wire the choke point in `src/services/SocketServer.ts` (`emitToDashboard`, ~line 170):

```typescript
  public emitToDashboard(event: string, data: any) {
    if (this.io) {
      this.io.to('dashboard').emit(event, data);
    }
    Container.get(EventLogService).appendSafe({ type: event, payload: data });
  }
```

(Add the import. `emitToNodes` is intentionally NOT logged — node control traffic is high-frequency plumbing, not domain events.) Add a daily prune alongside the existing sweeper starts in `src/services/ServerManager.ts` (~line 104, next to `LeaseOrphanSweeper`):

```typescript
    const eventLog = Container.get(EventLogService);
    setInterval(() => {
      eventLog.prune(Number(process.env.XENON_EVENT_LOG_RETENTION_DAYS || 30))
        .catch((err) => log.warn(`EventLog prune failed: ${err?.message ?? err}`));
    }, 24 * 60 * 60 * 1000).unref();
```

- [ ] **Step 5: Run** — `npx mocha test/unit/EventLogService.spec.ts && npm test`
Expected: new spec passes; full suite green (broadcast behavior unchanged — Socket.io emit precedes the append and does not await it).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/services/EventLogService.ts src/services/SocketServer.ts src/services/ServerManager.ts test/unit/EventLogService.spec.ts
git commit -m "feat(events): durable EventLog outbox behind the Socket.io choke point"
```

---

### Task 7: ArtifactStore interface + FS implementation, adopted by recording paths

**Files:**
- Create: `src/services/artifacts/ArtifactStore.ts`
- Modify: the module where `compositeOutputPath` and per-device recording paths are built — grep first: `grep -rn "compositeOutputPath\|recordingsAssetsPath" src/services/recording/ src/config.ts` (CLAUDE.md documents `compositeOutputPath(groupId)` = `${recordingsAssetsPath}/_groups/<id>/composite.mp4`)
- Test: `test/unit/ArtifactStore.spec.ts`

**Interfaces:**
- Produces: `ArtifactStore` interface — `resolve(...segments: string[]): string`, `ensureDir(...segments: string[]): Promise<string>`, `createReadStream(relPath: string)`, `exists(relPath: string): Promise<boolean>` — and `FsArtifactStore(rootDir: string)` registered in the TypeDI container at boot with `rootDir = recordingsAssetsPath`. **Guarantee:** `resolve()` returns byte-identical paths to today's string concatenation (the test pins this), so recordings/proof-bundles behave identically; S3 later = new implementation, zero call-site churn.

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/ArtifactStore.spec.ts
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FsArtifactStore } from '../../src/services/artifacts/ArtifactStore';

describe('FsArtifactStore', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-art-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('resolve() is byte-identical to legacy path concatenation', () => {
    const store = new FsArtifactStore(root);
    const legacy = path.join(root, '_groups', 'g1', 'composite.mp4');
    expect(store.resolve('_groups', 'g1', 'composite.mp4')).to.equal(legacy);
  });

  it('refuses path traversal outside the root', () => {
    const store = new FsArtifactStore(root);
    expect(() => store.resolve('..', 'etc', 'passwd')).to.throw(/outside/);
  });

  it('ensureDir creates nested directories and returns the absolute path', async () => {
    const store = new FsArtifactStore(root);
    const dir = await store.ensureDir('_groups', 'g2');
    expect(fs.statSync(dir).isDirectory()).to.equal(true);
  });

  it('exists() reflects the filesystem', async () => {
    const store = new FsArtifactStore(root);
    expect(await store.exists('nope.mp4')).to.equal(false);
    fs.writeFileSync(path.join(root, 'yes.mp4'), 'x');
    expect(await store.exists('yes.mp4')).to.equal(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx mocha test/unit/ArtifactStore.spec.ts` → module not found.

- [ ] **Step 3: Implement**

```typescript
// src/services/artifacts/ArtifactStore.ts
import fs from 'fs';
import path from 'path';

/**
 * ARB foreclosure guard #2: every artifact path flows through this interface
 * so the S3/object-store backend later is an implementation swap, not a
 * call-site migration. FsArtifactStore must stay byte-identical to the
 * legacy string concatenation it replaces.
 */
export interface ArtifactStore {
  resolve(...segments: string[]): string;
  ensureDir(...segments: string[]): Promise<string>;
  createReadStream(relPath: string): fs.ReadStream;
  exists(relPath: string): Promise<boolean>;
}

export class FsArtifactStore implements ArtifactStore {
  constructor(private readonly rootDir: string) {}

  resolve(...segments: string[]): string {
    const abs = path.resolve(this.rootDir, ...segments);
    if (!abs.startsWith(path.resolve(this.rootDir) + path.sep) && abs !== path.resolve(this.rootDir)) {
      throw new Error(`artifact path resolves outside the store root: ${abs}`);
    }
    return abs;
  }

  async ensureDir(...segments: string[]): Promise<string> {
    const dir = this.resolve(...segments);
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  }

  createReadStream(relPath: string): fs.ReadStream {
    return fs.createReadStream(this.resolve(relPath));
  }

  async exists(relPath: string): Promise<boolean> {
    try { await fs.promises.access(this.resolve(relPath)); return true; }
    catch { return false; }
  }
}

export const ARTIFACT_STORE = 'artifact-store'; // TypeDI token
```

- [ ] **Step 4: Register at boot + adopt in recording path construction**

Boot (same place `JwtKeyService.init` runs, Task 2): `Container.set(ARTIFACT_STORE, new FsArtifactStore(<recordingsAssetsPath from src/config.ts — grep its exact export name>));`

Adopt: run `grep -rn "compositeOutputPath\|recordingsAssetsPath" src/services/recording/`. In the module defining `compositeOutputPath(groupId)`, replace the string concatenation body with:

```typescript
import { Container } from 'typedi';
import { ARTIFACT_STORE } from '../artifacts/ArtifactStore';
import type { ArtifactStore } from '../artifacts/ArtifactStore';

export function compositeOutputPath(groupId: string): string {
  return (Container.get(ARTIFACT_STORE) as ArtifactStore).resolve('_groups', groupId, 'composite.mp4');
}
```

Apply the same one-line pattern to the sibling per-device path helper(s) found by the grep — **only path-construction helpers, nothing that changes when directories are created**. If any recording spec exists in `test/unit` covering these helpers, run it and confirm identical output.

- [ ] **Step 5: Run** — `npx mocha test/unit/ArtifactStore.spec.ts && npm test`
Expected: all green; the byte-identical test is the recording-regression pin.

- [ ] **Step 6: Commit**

```bash
git add src/services/artifacts/ArtifactStore.ts src/services/recording src/app/index.ts test/unit/ArtifactStore.spec.ts
git commit -m "feat(artifacts): ArtifactStore interface + FS impl; recording paths adopt it byte-identically"
```

---

### Task 8: Project entity skeleton + docs reconciliation

**Files:**
- Modify: `prisma/schema.prisma` (add `Project`)
- Create: `src/app/routers/projects.ts`
- Modify: `src/app/index.ts` (mount `/projects`)
- Modify: `docs/superpowers/specs/2026-07-17-xenon-ide-extension-design.md` (§2.4 note), `CLAUDE.md` (lease + new-surface notes)
- Test: `test/unit/ProjectsRouter.spec.ts`

**Interfaces:**
- Produces: `Project { id, name, teamId?, createdAt }`; `GET /xenon/api/projects` (any authenticated caller, team-scoped list), `POST /xenon/api/projects` (`scopeGuard(['admin'])`). ARB guard #4 — runs/flows/secrets attach to projects in later plans; this task only creates the container.

- [ ] **Step 1: Prisma model + migration**

```prisma
model Project {
  id        String   @id @default(cuid())
  name      String
  teamId    String?
  createdAt DateTime @default(now())

  @@index([teamId])
}
```

Run: `npm run db:generate` (migration `project_entity`), `npm run db:migrate`.

- [ ] **Step 2: Write the failing test**

```typescript
// test/unit/ProjectsRouter.spec.ts
import { expect } from 'chai';
import sinon from 'sinon';
import { listProjects, createProject } from '../../src/app/routers/projects';

describe('projects handlers', () => {
  function db() {
    return { project: { findMany: sinon.stub().resolves([{ id: 'p1', name: 'App A', teamId: 't1' }]), create: sinon.stub().resolves({ id: 'p2', name: 'New', teamId: null }) } };
  }

  it('lists projects scoped to the caller teamIds when narrowed', async () => {
    const client = db();
    const out = await listProjects(client as any, ['t1']);
    expect(out).to.have.length(1);
    expect(client.project.findMany.firstCall.args[0].where).to.deep.equal({ OR: [{ teamId: { in: ['t1'] } }, { teamId: null }] });
  });

  it('lists all projects for unscoped (admin) callers', async () => {
    const client = db();
    await listProjects(client as any, undefined);
    expect(client.project.findMany.firstCall.args[0]).to.deep.equal({});
  });

  it('creates a project with a required name', async () => {
    const client = db();
    const p = await createProject(client as any, { name: 'New' });
    expect(p.id).to.equal('p2');
    try { await createProject(client as any, { name: '' }); expect.fail('should throw'); }
    catch (e: any) { expect(e.message).to.match(/name/); }
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx mocha test/unit/ProjectsRouter.spec.ts` → module not found.

- [ ] **Step 4: Implement**

```typescript
// src/app/routers/projects.ts
import { Router } from 'express';
import { prisma } from '../../prisma';
import { scopeGuard } from '../../middleware/scopeGuard';

export async function listProjects(client: typeof prisma, teamIds: string[] | undefined) {
  const where = teamIds ? { where: { OR: [{ teamId: { in: teamIds } }, { teamId: null }] } } : {};
  return client.project.findMany(where as any);
}

export async function createProject(client: typeof prisma, body: { name?: string; teamId?: string }) {
  if (!body.name || !body.name.trim()) throw new Error('name is required');
  return client.project.create({ data: { name: body.name.trim(), teamId: body.teamId ?? null } });
}

export function projectsRouter(): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    res.json(await listProjects(prisma, req.auth?.teamIds));
  });
  r.post('/', scopeGuard(['admin']), async (req, res) => {
    try { res.status(201).json(await createProject(prisma, req.body ?? {})); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  return r;
}
```

Mount in `src/app/index.ts`: `apiRouter.use('/projects', projectsRouter());`

- [ ] **Step 5: Docs reconciliation (part of this task's deliverable)**

In `docs/superpowers/specs/2026-07-17-xenon-ide-extension-design.md`, append to §2.4:

```markdown
> **Implementation note (2026-07-17, verified during planning):** the lease
> subsystem (`src/services/lease/`, `POST /xenon/api/sdk/leases`,
> `LeaseOrphanSweeper`, lease-bound allocation via `xenon:options.leaseId`)
> already implements this section's claim/lease/reaper contract for the agent
> path — token-bound, with heartbeats. `xenon_acquire_device` maps to the
> lease API; Xenon work items 7–8 (§3) are satisfied by existing code plus the
> pre-existing idle reaper (`releaseBlockedDevices` on
> `checkBlockedDevicesIntervalMs`). Manual locks remain the dashboard-only
> convention. JWKS is served at `/xenon/api/auth/jwks.json` (the gateway's
> `jwksUri` is explicit config, so the `/.well-known` path is not required).
```

In `CLAUDE.md`, add one paragraph under "Identity & Manual Locks" (after the existing lock paragraph):

```markdown
Device leases: programmatic clients (SDK, MCP tools) claim devices via
`POST /xenon/api/sdk/leases` (`src/services/lease/LeaseService.ts`) — token-bound
claims with TTL + heartbeat, swept by `LeaseOrphanSweeper`, resolved at
allocation via the `xenon:options.leaseId` capability. Prefer leases over
manual locks for anything non-interactive. Hub-issued JWTs: `POST /auth/token`
mints RS256 tokens (`JwtKeyService`), `authMiddleware` accepts them as
`Authorization: Bearer`, JWKS at `/auth/jwks.json`; single-use stream tickets
(`?ticket=`) authenticate the webview MJPEG path.
```

- [ ] **Step 6: Run everything** — `npx mocha test/unit/ProjectsRouter.spec.ts && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/app/routers/projects.ts src/app/index.ts test/unit/ProjectsRouter.spec.ts docs/superpowers/specs/2026-07-17-xenon-ide-extension-design.md CLAUDE.md
git commit -m "feat(platform): Project entity skeleton + docs reconciliation (leases supersede claim plan)"
```

---

## Self-review notes

- **Spec coverage:** spec §3 items 1 (token service) → Tasks 1–3; 3 (stream tickets) → Task 4; 9 (`/capabilities`) → Task 5; ARB guards 1 (outbox) → Task 6, 2 (ArtifactStore) → Task 7, 4 (Project) → Task 8; ARB guard 3 (DeviceClaim) → **satisfied by the pre-existing lease subsystem** (discovery record + Task 8 doc note); ARB guard 5 (API versioning) → deferred to the CLI plan where the third client forces it, deliberately.
- **Out of scope (follow-up plans):** capability gate + healing-tier capability (P2 items, separate plan), owner-aware *manual-lock* conversion (superseded by leases), hosted MCP deployment, `xenon-studio` repo work.
- **Type consistency:** `JwtKeyService.sign/verify/jwks`, `issueToken`, `StreamTicketService.mint/redeem`, `EventLogService.appendSafe/prune`, `FsArtifactStore.resolve/ensureDir/exists`, `listProjects/createProject` — names match across tasks.
- **Guardrails honored:** every new auth path triggers only on new inputs (Bearer header, `?ticket=`, new routes); regression pins in Task 3 assert byte-identical old behavior; event log is fire-and-forget with an env kill-switch; ArtifactStore is byte-identical by test; no engines/schema.json churn.
