# Phase 1 — Identity Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real `User` entity (email + bcrypt password + accessKey) on top of Xenon's existing API-key auth, ship a `/login` screen and a `/profile` page with two tabs, and migrate every existing `ApiKey` row to a `userId`. Existing single-key clients keep working through a back-compat flag.

**Architecture:** New `User` and `UserSession` Prisma models. New `UserService`, `UserSessionService`, `LoginRateLimiter`. `apiKeyMiddleware` is renamed `authMiddleware` and learns three resolution paths (cookie → UserSession or ApiKey, `(accessKey, token)` headers, legacy `x-xenon-api-key`). Frontend gains `/login` and `/profile` routes plus a route guard that redirects on 401. The existing `ApiKeyGate` is demoted to `/api-key-gate` as an ops escape hatch.

**Tech Stack:** TypeScript 5.5, Prisma 5.4 (SQLite), TypeDI 0.10, Express, Mocha + Chai + Sinon for backend tests, React 17 + Vite + Tailwind + vitest for frontend, `bcrypt@^5` (NEW dep), existing `lucide-react` icons.

**Spec:** `docs/superpowers/specs/2026-04-28-phase-1-identity-backbone-design.md`

---

## File Structure

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | MODIFIED — add `User`, `UserSession`, `UserRole`, `UserStatus`; add `ApiKey.userId` FK + index. |
| `prisma/migrations/<timestamp>_phase_1_identity/migration.sql` | NEW (Prisma-generated) — schema migration. |
| `src/services/UserService.ts` | NEW — bcrypt hash/verify, accessKey gen + rotate, password change, `bootstrapIfEmpty`. |
| `src/services/UserSessionService.ts` | NEW — opaque session create/resolve/revoke, sliding TTL, hourly cleanup. |
| `src/middleware/loginRateLimiter.ts` | NEW — in-memory IP token bucket (5 attempts / 5 min default). |
| `src/middleware/apiKeyMiddleware.ts` | RENAMED → `authMiddleware.ts` (re-exported under old name for one release). |
| `src/middleware/authMiddleware.ts` | NEW (replaces `apiKeyMiddleware`) — cookie → UserSession or ApiKey, headers `(accessKey,token)`, legacy `x-xenon-api-key`. |
| `src/types/express.d.ts` | MODIFIED — replace `req.apiKey` with `req.auth` (back-compat alias kept). |
| `src/services/ApiKeyService.ts` | MODIFIED — `create()` adds `userId`; `verify()` joins User; new `verifyPair(accessKey, token)`. |
| `src/app/routers/auth.ts` | MODIFIED — add `/login`, `/logout`, `/change-password`, `/me`; gate `/dashboard-session` to `SUPER_ADMIN`. |
| `src/app/routers/profile.ts` | NEW — `/profile/tokens` (CRUD) and `/profile/access-key` (get + rotate). |
| `src/app/index.ts` | MODIFIED — mount `profileRouter()`; rename `apiKeyMiddleware` → `authMiddleware`; mount login rate limiter on `/auth/login` only. |
| `src/services/identity/bootstrap.ts` | NEW — `bootstrapIdentity()`: ensure super-admin user, optionally reset password from env. |
| `src/services/identity/sessionCleanupCron.ts` | NEW — hourly delete of expired UserSessions. |
| `src/index.ts` or wherever boot runs | MODIFIED — call `bootstrapIdentity()` and start cleanup cron after migrations. |
| `src/config.ts` | MODIFIED — add 7 new env-driven config keys. |
| `schema.json` | MODIFIED — surface bootstrap & rate-limit env knobs as plugin args (regenerate types via `npm run build:schema`). |
| `web/src/pages/login.tsx` | NEW — `/login` route, Xenon-adapted hero + email/password form. |
| `web/src/pages/profile/profile-page.tsx` | NEW — `/profile` shell with two tabs. |
| `web/src/pages/profile/password-tab.tsx` | NEW — change-password form. |
| `web/src/pages/profile/api-tokens-tab.tsx` | NEW — Access Key row + Identity Tokens table + Generate modal. |
| `web/src/pages/profile/generate-token-modal.tsx` | NEW — small modal: name + optional expiry. |
| `web/src/api-service/auth.ts` | NEW — `login()`, `logout()`, `me()`, `changePassword()`, `getMe()`. |
| `web/src/api-service/profile.ts` | NEW — `listTokens()`, `createToken()`, `deleteToken()`, `getAccessKey()`, `rotateAccessKey()`. |
| `web/src/auth/auth-context.tsx` | NEW — React context that holds the `me` payload and a `signOut()` helper. |
| `web/src/auth/route-guard.tsx` | NEW — wraps authenticated routes; calls `/auth/me`; redirects to `/login?next=` on 401. |
| `web/src/components/header/header.tsx` | MODIFIED — replace hardcoded "Administrator" with avatar + name + role from auth context; dropdown adds Profile / Logout. |
| `web/src/components/ApiKeyGate.tsx` | MODIFIED — only mounts on `/api-key-gate`; left out of the default `<App>` chain. |
| `web/src/App.tsx` | MODIFIED — replace `<ApiKeyGate>` wrapper with `<AuthProvider><RouteGuard>…</RouteGuard></AuthProvider>`; add `/login` and `/api-key-gate` routes outside the guard. |
| `web/src/routes/index.tsx` | MODIFIED — add `/profile` route; keep `*` redirect to `/overview`. |
| `test/unit/UserService.test.ts` | NEW |
| `test/unit/UserSessionService.test.ts` | NEW |
| `test/unit/loginRateLimiter.test.ts` | NEW |
| `test/unit/authMiddleware.test.ts` | NEW |
| `test/unit/profile-router.test.ts` | NEW |
| `test/unit/bootstrap-identity.test.ts` | NEW |
| `test/integration/auth-flow.spec.ts` | NEW |
| `test/integration/auth-rate-limit.spec.ts` | NEW |
| `test/integration/profile-tokens.spec.ts` | NEW |
| `test/integration/legacy-key-compat.spec.ts` | NEW |
| `test/integration/migration.spec.ts` | NEW |
| `test/unit/extract-access-key-token-pair.test.ts` | NEW |
| `src/XenonCapabilityManager.ts` | MODIFIED — new `extractAccessKeyTokenPair()` helper. |
| `src/services/SessionLifecycleService.ts` | MODIFIED — `authorizeSessionRequest` accepts `df:options.{accessKey,token}` and falls back to legacy `xenon:accessKey` only when `XENON_ACCEPT_LEGACY_KEY=true`. |
| `src/services/ServerManager.ts` | MODIFIED — replace `ApiKeyService.bootstrapIfEmpty` call with `bootstrapIdentity()`. |

No new top-level `package.json` workspace; just one new dep.

---

## Conventions (read first)

- **Branch:** all work goes on `feat/identity-backbone-spec` — the spec commit is already there; subsequent commits implement it. Rename to `feat/identity-backbone` if you prefer once the spec is no longer the only thing on the branch.
- **Commits:** Conventional Commits — `feat(auth): …`, `test(auth): …`, `refactor(middleware): …`, `chore(deps): add bcrypt`. Always sign with the trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Test runner (backend):** Mocha + chai + sinon. Files end in `.test.ts` (matches existing `ApiKeyService.test.ts`). Run a single file:
  ```
  npx mocha --require ts-node/register --timeout 30000 test/unit/UserService.test.ts
  ```
  Run the full unit suite: `npm test`.
- **Test runner (frontend):** vitest in `web/`. Run a single file:
  ```
  cd web && npx vitest run src/auth/auth-context.test.tsx
  ```
- **Type-check during work:** `npx tsc --noEmit` from repo root. Pre-existing project-wide errors are acceptable; only fail a task on a NEW error in a file you touched.
- **Prisma migrations:** `npm run db:generate -- --name <slug>` to create a new migration after editing `schema.prisma`. `npm run db:migrate` applies. After every schema change, regenerate the client: `npx prisma generate`.
- **bcrypt cost:** production = 12. Tests use `bcrypt.hashSync(pw, 4)` so suites stay fast; the cost is read from `config.bcryptCost` so the same code runs both.
- **Hooks:** never bypass. If a pre-commit hook fails, fix the underlying issue, re-stage, and **make a new commit** (do not `--amend`).
- **Don't run the full e2e suite per task** — only the relevant unit/integration tests. Save the manual verification (`npm run dev`) for the last task.

---

## Task 1: Add bcrypt dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (auto)

- [ ] **Step 1: Install bcrypt and its types**

```
npm install --save bcrypt@^5.1.1
npm install --save-dev @types/bcrypt@^5.0.2
```

- [ ] **Step 2: Verify it imports**

Run:
```
node -e "console.log(require('bcrypt').hashSync('test', 4).slice(0,4))"
```
Expected: prints `$2b$` (a bcrypt hash prefix).

- [ ] **Step 3: Commit**

```
git add package.json package-lock.json
git commit -m "chore(deps): add bcrypt for password hashing

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Prisma schema — User, UserSession, ApiKey.userId

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_phase_1_identity/migration.sql` (Prisma-generated)

- [ ] **Step 1: Add new models and enums to `schema.prisma`**

> **SQLite caveat (verified during Task 2 implementation):** Prisma's SQLite connector does not support `enum`. Substitute the two enums below with plain `String` columns (`role String @default("MEMBER")`, `status String @default("ACTIVE")`) and an inline schema comment listing the allowed values. TypeScript string-literal unions in `src/types/identity.ts` (Task 3) provide the type safety the enum would have. If/when the project moves to PostgreSQL, real enums can be added at that time.

Append at the end (after the existing `ApiKey` and `Team` blocks already at lines 249–272):

```prisma
enum UserRole   { SUPER_ADMIN ADMIN MEMBER }
enum UserStatus { ACTIVE INACTIVE }

model User {
  id                String     @id @default(uuid())
  email             String     @unique
  name              String
  passwordHash      String
  accessKey         String     @unique
  role              UserRole   @default(MEMBER)
  status            UserStatus @default(ACTIVE)
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
  lastLoginAt       DateTime?
  passwordChangedAt DateTime?

  apiKeys           ApiKey[]
  sessions          UserSession[]

  @@index([accessKey])
}

model UserSession {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  lastSeenAt  DateTime @default(now())
  userAgent   String?
  ipHash      String?

  @@index([userId])
  @@index([expiresAt])
}
```

And modify the existing `ApiKey` block (line 249) to add the FK:

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
  teamId      String?
  role        String    @default("member")
  team        Team?     @relation(fields: [teamId], references: [id])

  // NEW
  userId      String?                                       // nullable in the migration; backfilled, then made NOT NULL in a follow-up step
  user        User?     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([teamId])
  @@index([userId])
}
```

> **Why nullable then enforced:** SQLite cannot add a NOT NULL FK with a generated default in one step. We add it nullable, backfill in Task 17, then run a second migration to enforce NOT NULL.

> **Indexing note (verified during Task 2 implementation):** Do NOT add `@@index([accessKey])` on `User`. The `@unique` already creates a covering index in SQLite; a second `@@index` is dead weight (extra writes on user create / accessKey rotate, no read benefit).

- [ ] **Step 2: Generate the migration**

```
npm run db:generate -- --name phase_1_identity
```

Expected output: a new directory under `prisma/migrations/` and a fresh `src/generated/client`.

- [ ] **Step 3: Apply locally and verify**

```
npm run db:migrate
npx prisma studio --browser none --port 0 &
sleep 2 ; kill %1
```
(The `studio` invocation just confirms the schema parses. Skip if not installed.)

Verify the generated SQL contains `CREATE TABLE "User"`, `CREATE TABLE "UserSession"`, and `ALTER TABLE "ApiKey" ADD COLUMN "userId"`.

- [ ] **Step 4: Commit**

```
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add User, UserSession, ApiKey.userId

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extend Express request typing — `req.auth`

**Files:**
- Modify: `src/types/express.d.ts`

- [ ] **Step 1: Replace the `req.apiKey` augmentation with a unified `req.auth` plus a back-compat alias**

```ts
import 'express';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        kind: 'user-session' | 'api-key';
        userId: string;
        role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
        scopes: string;          // comma-separated; for user-session this is derived from role
        teamId?: string | null;
        apiKeyId?: string;
        sessionId?: string;
        rateLimit: number;
      };
      // BACK-COMPAT: existing call sites still read `req.apiKey`. Keep this
      // until every reference has been migrated to req.auth.
      apiKey?: {
        id: string;
        scopes: string;
        rateLimit: number;
        teamId?: string | null;
      };
    }
  }
}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

Expected: no NEW errors mentioning `express.d.ts` or any file you didn't touch in this task.

- [ ] **Step 3: Commit**

```
git add src/types/express.d.ts
git commit -m "feat(types): add req.auth alongside legacy req.apiKey

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `UserService` — bcrypt hash / verify (TDD)

**Files:**
- Create: `src/services/UserService.ts`
- Create: `test/unit/UserService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/UserService.test.ts
import { expect } from 'chai';
import sinon from 'sinon';
import { UserService } from '../../src/services/UserService';
import { prisma } from '../../src/prisma';

describe('UserService', () => {
  afterEach(() => sinon.restore());

  describe('hashPassword / verifyPassword', () => {
    it('hashes a password with bcrypt and verifies it', async () => {
      const svc = new UserService();
      const hash = await svc.hashPassword('correct-horse-staple');
      expect(hash).to.match(/^\$2[ayb]\$/);
      expect(await svc.verifyPassword('correct-horse-staple', hash)).to.be.true;
      expect(await svc.verifyPassword('wrong', hash)).to.be.false;
    });

    it('rejects passwords shorter than 8 characters', async () => {
      const svc = new UserService();
      let err: Error | undefined;
      try { await svc.hashPassword('short'); } catch (e) { err = e as Error; }
      expect(err?.message).to.match(/at least 8/);
    });
  });

  describe('generateAccessKey', () => {
    it('returns a string with the xen_ prefix and 12 url-safe chars', () => {
      const svc = new UserService();
      const key = svc.generateAccessKey();
      expect(key).to.match(/^xen_[A-Za-z0-9]{12}$/);
    });

    it('returns different values on every call', () => {
      const svc = new UserService();
      const a = svc.generateAccessKey();
      const b = svc.generateAccessKey();
      expect(a).to.not.equal(b);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx mocha --require ts-node/register --timeout 30000 test/unit/UserService.test.ts
```
Expected: FAIL with `Cannot find module '../../src/services/UserService'`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

```ts
// src/services/UserService.ts
import { Service } from 'typedi';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import log from '../logger';

const ACCESS_KEY_PREFIX = 'xen_';
const ACCESS_KEY_LEN = 12;
const PASSWORD_MIN = 8;
const ACCESS_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

@Service()
export class UserService {
  private log = log.scope('User');

  // Cost is overridable for tests so suites don't take 30s.
  bcryptCost = Number(process.env.XENON_BCRYPT_COST) || 12;

  async hashPassword(password: string): Promise<string> {
    if (!password || password.length < PASSWORD_MIN) {
      throw new Error(`password must be at least ${PASSWORD_MIN} characters`);
    }
    return bcrypt.hash(password, this.bcryptCost);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    if (!password || !hash) return false;
    return bcrypt.compare(password, hash);
  }

  generateAccessKey(): string {
    const bytes = crypto.randomBytes(ACCESS_KEY_LEN);
    let s = '';
    for (let i = 0; i < ACCESS_KEY_LEN; i++) {
      s += ACCESS_KEY_ALPHABET[bytes[i] % ACCESS_KEY_ALPHABET.length];
    }
    return ACCESS_KEY_PREFIX + s;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/UserService.test.ts
```
Expected: 4 passing.

- [ ] **Step 5: Commit**

```
git add src/services/UserService.ts test/unit/UserService.test.ts
git commit -m "feat(auth): UserService bcrypt hashing + accessKey generator

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `UserService` — CRUD + rotateAccessKey + changePassword (TDD)

**Files:**
- Modify: `src/services/UserService.ts`
- Modify: `test/unit/UserService.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
// test/unit/UserService.test.ts (append to the existing describe block)

describe('CRUD + rotation', () => {
  it('createUser persists a hashed password and a unique accessKey', async () => {
    const create = sinon.stub(prisma.user, 'create').resolves({ id: 'u1' } as any);
    const svc = new UserService();
    sinon.stub(svc, 'generateAccessKey').returns('xen_abcdefghijkl');
    const user = await svc.createUser({
      email: 'a@b.com',
      name: 'A',
      password: 'correct-horse',
      role: 'MEMBER',
    });
    expect(user.id).to.equal('u1');
    const args = create.firstCall.args[0].data;
    expect(args.email).to.equal('a@b.com');
    expect(args.passwordHash).to.match(/^\$2/);
    expect(args.accessKey).to.equal('xen_abcdefghijkl');
    expect(args.role).to.equal('MEMBER');
  });

  it('rotateAccessKey writes a new accessKey but keeps the user id', async () => {
    sinon.stub(prisma.user, 'update').resolves({ id: 'u1', accessKey: 'xen_NEW00000000' } as any);
    const svc = new UserService();
    sinon.stub(svc, 'generateAccessKey').returns('xen_NEW00000000');
    const result = await svc.rotateAccessKey('u1');
    expect(result.accessKey).to.equal('xen_NEW00000000');
  });

  it('changePassword verifies old password before writing new hash', async () => {
    const oldHash = await new UserService().hashPassword('old-password');
    sinon.stub(prisma.user, 'findUnique').resolves({ id: 'u1', passwordHash: oldHash } as any);
    const update = sinon.stub(prisma.user, 'update').resolves({} as any);
    const svc = new UserService();
    await svc.changePassword('u1', 'old-password', 'new-password');
    expect(update.calledOnce).to.be.true;
  });

  it('changePassword throws when the old password is wrong', async () => {
    const oldHash = await new UserService().hashPassword('old-password');
    sinon.stub(prisma.user, 'findUnique').resolves({ id: 'u1', passwordHash: oldHash } as any);
    const svc = new UserService();
    let err: Error | undefined;
    try { await svc.changePassword('u1', 'WRONG', 'new-password'); } catch (e) { err = e as Error; }
    expect(err?.message).to.match(/incorrect/);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/UserService.test.ts
```
Expected: 4 failing (`createUser is not a function`, etc.).

- [ ] **Step 3: Append to `UserService`**

```ts
import { prisma } from '../prisma';
import { UserRole, UserStatus } from '../generated/client';

export interface CreateUserParams {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
  status?: UserStatus;
}

@Service()
export class UserService {
  // ...existing...

  async createUser(p: CreateUserParams) {
    const passwordHash = await this.hashPassword(p.password);
    const accessKey   = this.generateAccessKey();
    return prisma.user.create({
      data: {
        email: p.email.toLowerCase(),
        name: p.name,
        passwordHash,
        accessKey,
        role: p.role ?? 'MEMBER',
        status: p.status ?? 'ACTIVE',
      },
    });
  }

  async findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findByAccessKey(accessKey: string) {
    return prisma.user.findUnique({ where: { accessKey } });
  }

  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  async rotateAccessKey(userId: string) {
    const accessKey = this.generateAccessKey();
    return prisma.user.update({
      where: { id: userId },
      data: { accessKey, updatedAt: new Date() },
      select: { id: true, accessKey: true },
    });
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new Error('user not found');
    if (!(await this.verifyPassword(oldPassword, u.passwordHash))) {
      throw new Error('incorrect current password');
    }
    const passwordHash = await this.hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
  }

  async setLastLoginAt(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    }).catch(() => undefined);
  }
}
```

- [ ] **Step 4: Run, confirm pass**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/UserService.test.ts
```
Expected: 8 passing.

- [ ] **Step 5: Commit**

```
git add src/services/UserService.ts test/unit/UserService.test.ts
git commit -m "feat(auth): UserService CRUD + rotateAccessKey + changePassword

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `UserSessionService` (TDD)

**Files:**
- Create: `src/services/UserSessionService.ts`
- Create: `test/unit/UserSessionService.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/unit/UserSessionService.test.ts
import { expect } from 'chai';
import sinon from 'sinon';
import { UserSessionService } from '../../src/services/UserSessionService';
import { prisma } from '../../src/prisma';

describe('UserSessionService', () => {
  afterEach(() => sinon.restore());

  it('create() inserts a row with sliding expiresAt', async () => {
    const create = sinon.stub(prisma.userSession, 'create').resolves({ id: 's1' } as any);
    const svc = new UserSessionService();
    const session = await svc.create('u1', { userAgent: 'curl', ipHash: 'abc' });
    expect(session.id).to.equal('s1');
    const data = create.firstCall.args[0].data;
    expect(data.userId).to.equal('u1');
    expect(data.expiresAt).to.be.instanceOf(Date);
  });

  it('resolve() returns session + slides expiresAt forward', async () => {
    sinon.stub(prisma.userSession, 'findUnique').resolves({
      id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 1_000_000),
    } as any);
    const update = sinon.stub(prisma.userSession, 'update').resolves({} as any);
    const svc = new UserSessionService();
    const out = await svc.resolve('s1');
    expect(out?.userId).to.equal('u1');
    expect(update.calledOnce).to.be.true;
  });

  it('resolve() returns null for expired sessions', async () => {
    sinon.stub(prisma.userSession, 'findUnique').resolves({
      id: 's1', userId: 'u1', expiresAt: new Date(Date.now() - 1_000),
    } as any);
    const svc = new UserSessionService();
    const out = await svc.resolve('s1');
    expect(out).to.be.null;
  });

  it('revoke() deletes a single session', async () => {
    const del = sinon.stub(prisma.userSession, 'delete').resolves({} as any);
    await new UserSessionService().revoke('s1');
    expect(del.firstCall.args[0].where.id).to.equal('s1');
  });

  it('revokeAllForUserExcept() deletes everything except the given session', async () => {
    const del = sinon.stub(prisma.userSession, 'deleteMany').resolves({ count: 2 } as any);
    await new UserSessionService().revokeAllForUserExcept('u1', 'keep-me');
    expect(del.firstCall.args[0].where.userId).to.equal('u1');
    expect(del.firstCall.args[0].where.NOT).to.deep.equal({ id: 'keep-me' });
  });

  it('cleanupExpired() deletes rows whose expiresAt has passed', async () => {
    const del = sinon.stub(prisma.userSession, 'deleteMany').resolves({ count: 5 } as any);
    const removed = await new UserSessionService().cleanupExpired();
    expect(removed).to.equal(5);
    const where = del.firstCall.args[0].where;
    expect(where.expiresAt.lt).to.be.instanceOf(Date);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```
npx mocha --require ts-node/register --timeout 30000 test/unit/UserSessionService.test.ts
```
Expected: cannot find module.

- [ ] **Step 3: Implement**

```ts
// src/services/UserSessionService.ts
import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

@Service()
export class UserSessionService {
  private log = log.scope('UserSession');

  ttlMs(): number {
    return Number(process.env.XENON_USER_SESSION_TTL_MS) || DEFAULT_TTL_MS;
  }

  async create(userId: string, meta: { userAgent?: string; ipHash?: string } = {}) {
    const expiresAt = new Date(Date.now() + this.ttlMs());
    return prisma.userSession.create({
      data: { userId, expiresAt, userAgent: meta.userAgent, ipHash: meta.ipHash },
    });
  }

  async resolve(sessionId: string) {
    const row = await prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    const newExpiresAt = new Date(Date.now() + this.ttlMs());
    prisma.userSession.update({
      where: { id: sessionId },
      data: { expiresAt: newExpiresAt, lastSeenAt: new Date() },
    }).catch(() => undefined);
    return row;
  }

  async revoke(sessionId: string) {
    await prisma.userSession.delete({ where: { id: sessionId } }).catch(() => undefined);
  }

  async revokeAllForUserExcept(userId: string, keepSessionId: string) {
    await prisma.userSession.deleteMany({
      where: { userId, NOT: { id: keepSessionId } },
    });
  }

  async cleanupExpired(): Promise<number> {
    const r = await prisma.userSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (r.count > 0) this.log.info(`cleaned ${r.count} expired user sessions`);
    return r.count;
  }
}
```

- [ ] **Step 4: Run, confirm pass**

```
npx mocha --require ts-node/register --timeout 30000 test/unit/UserSessionService.test.ts
```
Expected: 6 passing.

- [ ] **Step 5: Commit**

```
git add src/services/UserSessionService.ts test/unit/UserSessionService.test.ts
git commit -m "feat(auth): UserSessionService with sliding TTL

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `LoginRateLimiter` (TDD)

**Files:**
- Create: `src/middleware/loginRateLimiter.ts`
- Create: `test/unit/loginRateLimiter.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/unit/loginRateLimiter.test.ts
import { expect } from 'chai';
import { LoginRateLimiter } from '../../src/middleware/loginRateLimiter';

describe('LoginRateLimiter', () => {
  it('allows up to N attempts then 429s', () => {
    const r = new LoginRateLimiter({ attempts: 3, windowMs: 60_000 });
    expect(r.consume('1.2.3.4')).to.equal('ok');
    expect(r.consume('1.2.3.4')).to.equal('ok');
    expect(r.consume('1.2.3.4')).to.equal('ok');
    expect(r.consume('1.2.3.4')).to.equal('blocked');
  });

  it('separate IPs do not interfere', () => {
    const r = new LoginRateLimiter({ attempts: 2, windowMs: 60_000 });
    r.consume('1.1.1.1'); r.consume('1.1.1.1');
    expect(r.consume('2.2.2.2')).to.equal('ok');
    expect(r.consume('1.1.1.1')).to.equal('blocked');
  });

  it('clearOnSuccess() resets the bucket for a successful login', () => {
    const r = new LoginRateLimiter({ attempts: 3, windowMs: 60_000 });
    r.consume('1.1.1.1'); r.consume('1.1.1.1'); r.consume('1.1.1.1');
    r.clearOnSuccess('1.1.1.1');
    expect(r.consume('1.1.1.1')).to.equal('ok');
  });

  it('window rolls over after windowMs', () => {
    const r = new LoginRateLimiter({ attempts: 1, windowMs: 10 });
    r.consume('1.1.1.1');
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(r.consume('1.1.1.1')).to.equal('ok');
        resolve();
      }, 30);
    });
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```
npx mocha --require ts-node/register --timeout 30000 test/unit/loginRateLimiter.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/middleware/loginRateLimiter.ts
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';

interface Bucket { count: number; resetAt: number; }

export class LoginRateLimiter {
  private attempts: number;
  private windowMs: number;
  private buckets = new Map<string, Bucket>();

  constructor(opts?: { attempts?: number; windowMs?: number }) {
    this.attempts = opts?.attempts ?? config.loginRateLimitAttempts ?? 5;
    this.windowMs = opts?.windowMs ?? config.loginRateLimitWindowMs ?? 5 * 60 * 1000;
  }

  consume(ipHashOrKey: string): 'ok' | 'blocked' {
    const now = Date.now();
    let b = this.buckets.get(ipHashOrKey);
    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(ipHashOrKey, b);
    }
    if (b.count >= this.attempts) return 'blocked';
    b.count++;
    return 'ok';
  }

  clearOnSuccess(ipHashOrKey: string) {
    this.buckets.delete(ipHashOrKey);
  }

  retryAfterSec(ipHashOrKey: string): number {
    const b = this.buckets.get(ipHashOrKey);
    if (!b) return 0;
    return Math.max(0, Math.ceil((b.resetAt - Date.now()) / 1000));
  }
}

const ipSecret = process.env.XENON_IP_HASH_SECRET || 'xenon-ip-hash';
function ipHash(req: Request): string {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim()
    || req.socket.remoteAddress
    || 'unknown';
  return crypto.createHash('sha256').update(ip + ':' + ipSecret).digest('hex').slice(0, 16);
}

export function loginRateLimitMiddleware(limiter: LoginRateLimiter) {
  return function (req: Request, res: Response, next: NextFunction) {
    const key = ipHash(req);
    if (limiter.consume(key) === 'blocked') {
      res.set('Retry-After', String(limiter.retryAfterSec(key)));
      return res.status(429).json({ error: 'too many login attempts' });
    }
    (req as any).loginRateLimitKey = key;
    next();
  };
}

export const ipHashOf = ipHash;  // exported for /auth/login to call clearOnSuccess
```

> **Note:** `config.loginRateLimitAttempts` and `config.loginRateLimitWindowMs` are added in Task 11. The tests in this task pass options explicitly, so the config values aren't required yet.

- [ ] **Step 4: Run, confirm pass**

```
npx mocha --require ts-node/register --timeout 30000 test/unit/loginRateLimiter.test.ts
```
Expected: 4 passing.

- [ ] **Step 5: Commit**

```
git add src/middleware/loginRateLimiter.ts test/unit/loginRateLimiter.test.ts
git commit -m "feat(auth): in-memory IP token bucket for /auth/login

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `ApiKeyService` — userId on create, accessKey+token verifyPair (TDD)

**Files:**
- Modify: `src/services/ApiKeyService.ts`
- Modify: `test/unit/ApiKeyService.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
// test/unit/ApiKeyService.test.ts (add to the existing describe)

it('create() persists the userId fk', async () => {
  const create = sinon.stub(prisma.apiKey, 'create').resolves({ id: 'k1' } as any);
  const svc = new ApiKeyService();
  await svc.create({ name: 'x', scopes: ['read'], userId: 'u1' });
  expect(create.firstCall.args[0].data.userId).to.equal('u1');
});

it('verifyPair() returns the row when accessKey matches token owner', async () => {
  const raw = 'a'.repeat(64);
  const hash = (await import('crypto')).createHash('sha256').update(raw).digest('hex');
  sinon.stub(prisma.user, 'findUnique').resolves({ id: 'u1' } as any);
  sinon.stub(prisma.apiKey, 'findFirst').resolves({
    id: 'k1', keyHash: hash, scopes: 'read', rateLimit: 300, revokedAt: null, userId: 'u1',
  } as any);
  sinon.stub(prisma.apiKey, 'update').resolves({} as any);
  const svc = new ApiKeyService();
  const row = await svc.verifyPair('xen_abc', raw);
  expect(row?.id).to.equal('k1');
});

it('verifyPair() returns null when token is not owned by the accessKey user', async () => {
  const raw = 'a'.repeat(64);
  sinon.stub(prisma.user, 'findUnique').resolves({ id: 'u1' } as any);
  sinon.stub(prisma.apiKey, 'findFirst').resolves(null);
  const svc = new ApiKeyService();
  const row = await svc.verifyPair('xen_abc', raw);
  expect(row).to.be.null;
});
```

- [ ] **Step 2: Run, confirm fail**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/ApiKeyService.test.ts
```

- [ ] **Step 3: Modify `ApiKeyService`**

Update `create` and add `verifyPair`:

```ts
// src/services/ApiKeyService.ts (replace the `create` method and add verifyPair)

async create(params: {
  name: string;
  scopes: Scope[];
  rateLimit?: number;
  teamId?: string | null;
  userId: string;                               // NEW — required
  expiresAt?: Date;                             // NEW — optional
}): Promise<{ id: string; raw: string }> {
  const raw = this.generateRaw();
  const row = await prisma.apiKey.create({
    data: {
      name: params.name,
      keyHash: this.hash(raw),
      scopes: params.scopes.join(','),
      rateLimit: params.rateLimit ?? 300,
      teamId: params.teamId ?? null,
      userId: params.userId,
    },
  });
  return { id: row.id, raw };
}

async verifyPair(accessKey: string, token: string): Promise<ApiKeyRow | null> {
  if (!accessKey || !token) return null;
  const user = await prisma.user.findUnique({ where: { accessKey } });
  if (!user) return null;
  const row = await prisma.apiKey.findFirst({
    where: { keyHash: this.hash(token), userId: user.id, revokedAt: null },
  });
  if (!row) return null;
  prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return row as ApiKeyRow;
}
```

Also extend `ApiKeyRow` to include `userId: string`:

```ts
export interface ApiKeyRow {
  id: string;
  name: string;
  keyHash: string;
  scopes: string;
  rateLimit: number;
  revokedAt: Date | null;
  teamId?: string | null;
  role?: string;
  userId?: string;          // NEW (nullable until backfill in Task 17)
}
```

> Existing call sites that previously called `svc.create({ name, scopes })` now must pass `userId`. The compiler will surface those — fix each to pull from `req.auth.userId`. Most are in admin endpoints that already hold `req.apiKey.id`; update them to `req.auth!.userId` after `authMiddleware` lands in Task 9.

- [ ] **Step 4: Run, confirm pass**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/ApiKeyService.test.ts
```
Expected: existing passes + 3 new passing.

- [ ] **Step 5: Commit**

```
git add src/services/ApiKeyService.ts test/unit/ApiKeyService.test.ts
git commit -m "feat(auth): ApiKey.userId + verifyPair(accessKey, token)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `authMiddleware` — three resolution paths (TDD)

**Files:**
- Create: `src/middleware/authMiddleware.ts`
- Create: `test/unit/authMiddleware.test.ts`
- Modify: `src/middleware/apiKeyMiddleware.ts` — turn it into a re-export shim.

> **Why a new file rather than rewriting `apiKeyMiddleware.ts`:** every consumer in `src/app/index.ts` and the routers imports `apiKeyMiddleware`. We add `authMiddleware.ts` as the new canonical module and make `apiKeyMiddleware.ts` re-export it under the old name. Import sites get migrated in Task 12. No big-bang rename.

- [ ] **Step 1: Write failing tests**

```ts
// test/unit/authMiddleware.test.ts
import { expect } from 'chai';
import sinon from 'sinon';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { Container } from 'typedi';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { UserService } from '../../src/services/UserService';
import { config } from '../../src/config';

function mkRes() {
  return {
    status(code: number) { (this as any)._code = code; return this; },
    json(b: any) { (this as any)._body = b; return this; },
    cookie() { return this; },
    _code: undefined as number | undefined,
    _body: undefined as any,
  };
}

describe('authMiddleware', () => {
  afterEach(() => sinon.restore());

  it('401s when no credentials are present', async () => {
    const req: any = { headers: {} };
    const res = mkRes() as any;
    await authMiddleware(req, res, () => { throw new Error('should not call next'); });
    expect(res._code).to.equal(401);
  });

  it('header (accessKey, token) pair → req.auth populated', async () => {
    const apiKey = { id: 'k1', userId: 'u1', scopes: 'admin', rateLimit: 300, teamId: null };
    sinon.stub(Container.get(ApiKeyService), 'verifyPair').resolves(apiKey as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1', email: 'a@b', name: 'A', role: 'ADMIN', status: 'ACTIVE',
    } as any);
    const req: any = {
      headers: { 'x-xenon-access-key': 'xen_abc', 'x-xenon-token': 'tok' },
    };
    let called = false;
    await authMiddleware(req, mkRes() as any, () => { called = true; });
    expect(called).to.be.true;
    expect(req.auth?.kind).to.equal('api-key');
    expect(req.auth?.userId).to.equal('u1');
    expect(req.auth?.role).to.equal('ADMIN');
  });

  it('cookie session id → resolves UserSession → req.auth populated', async () => {
    sinon.stub(Container.get(UserSessionService), 'resolve').resolves({
      id: 's1', userId: 'u1',
    } as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1', role: 'SUPER_ADMIN', status: 'ACTIVE',
    } as any);
    const req: any = { headers: { cookie: 'xenon_dashboard_session=s1' } };
    let called = false;
    await authMiddleware(req, mkRes() as any, () => { called = true; });
    expect(called).to.be.true;
    expect(req.auth?.kind).to.equal('user-session');
    expect(req.auth?.role).to.equal('SUPER_ADMIN');
    // SUPER_ADMIN should derive the 'admin' scope
    expect(req.auth?.scopes).to.equal('admin');
  });

  it('legacy x-xenon-api-key works only when XENON_ACCEPT_LEGACY_KEY=true', async () => {
    sinon.stub(Container.get(ApiKeyService), 'verify').resolves({
      id: 'k1', userId: 'u1', scopes: 'read', rateLimit: 300, teamId: null,
    } as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1', role: 'MEMBER', status: 'ACTIVE',
    } as any);
    const orig = config.acceptLegacyKey;
    (config as any).acceptLegacyKey = true;
    try {
      const req: any = { headers: { 'x-xenon-api-key': 'rawkey' } };
      let called = false;
      await authMiddleware(req, mkRes() as any, () => { called = true; });
      expect(called).to.be.true;
      expect(req.auth?.kind).to.equal('api-key');
    } finally {
      (config as any).acceptLegacyKey = orig;
    }
  });

  it('legacy x-xenon-api-key 401s when XENON_ACCEPT_LEGACY_KEY=false', async () => {
    const orig = config.acceptLegacyKey;
    (config as any).acceptLegacyKey = false;
    try {
      const req: any = { headers: { 'x-xenon-api-key': 'rawkey' } };
      const res = mkRes() as any;
      await authMiddleware(req, res, () => { throw new Error('should not call'); });
      expect(res._code).to.equal(401);
    } finally {
      (config as any).acceptLegacyKey = orig;
    }
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/authMiddleware.test.ts
```

- [ ] **Step 3: Implement `authMiddleware.ts`**

```ts
// src/middleware/authMiddleware.ts
/// <reference path="../types/express.d.ts" />
import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../services/ApiKeyService';
import { UserSessionService } from '../services/UserSessionService';
import { UserService } from '../services/UserService';
import { config } from '../config';

const SESSION_COOKIE = 'xenon_dashboard_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Role → scopes derivation. The same table is used in profile token creation
// to enforce that members can never grant 'admin'.
export function scopesForRole(role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER'): string {
  if (role === 'SUPER_ADMIN') return 'admin';
  if (role === 'ADMIN')       return 'devices,sessions,read';
  return 'sessions,read';
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (config.authDisabled === true) {
    req.auth = {
      kind: 'api-key',
      userId: 'auth-disabled',
      role: 'SUPER_ADMIN',
      scopes: 'admin',
      rateLimit: 100_000,
    };
    req.apiKey = { id: 'auth-disabled', scopes: 'admin', rateLimit: 100_000 };
    return next();
  }

  const apiKeySvc      = Container.get(ApiKeyService);
  const userSessionSvc = Container.get(UserSessionService);
  const userSvc        = Container.get(UserService);

  // Path 1: header (accessKey, token) pair
  const headerAccessKey = req.headers['x-xenon-access-key'] as string | undefined;
  const headerToken     = req.headers['x-xenon-token']      as string | undefined;
  if (headerAccessKey && headerToken) {
    const row = await apiKeySvc.verifyPair(headerAccessKey, headerToken);
    if (!row || !row.userId) return res.status(401).json({ error: 'invalid credentials' });
    const user = await userSvc.findById(row.userId);
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'invalid credentials' });
    req.auth = {
      kind: 'api-key', userId: user.id, role: user.role,
      scopes: row.scopes, teamId: row.teamId ?? null, apiKeyId: row.id, rateLimit: row.rateLimit,
    };
    req.apiKey = { id: row.id, scopes: row.scopes, rateLimit: row.rateLimit, teamId: row.teamId ?? null };
    return next();
  }

  // Path 2: cookie — UserSession first (because session ids are short-lived
  // unique uuids), then ApiKey (matches old behavior).
  const cookie = readCookie(req, SESSION_COOKIE);
  if (cookie) {
    const session = await userSessionSvc.resolve(cookie);
    if (session) {
      const user = await userSvc.findById(session.userId);
      if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'invalid session' });
      const isSecure = req.secure || (req.headers['x-forwarded-proto'] as string) === 'https';
      res.cookie(SESSION_COOKIE, cookie, {
        httpOnly: true, secure: isSecure, sameSite: 'strict', maxAge: SESSION_TTL_MS,
      });
      req.auth = {
        kind: 'user-session', userId: user.id, role: user.role,
        scopes: scopesForRole(user.role), sessionId: session.id, rateLimit: 300,
      };
      return next();
    }
    // Fall through: maybe it's a raw API key in the cookie (legacy issuance path).
    const row = await apiKeySvc.verify(cookie);
    if (row && row.userId) {
      const user = await userSvc.findById(row.userId);
      if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'invalid session' });
      const isSecure = req.secure || (req.headers['x-forwarded-proto'] as string) === 'https';
      res.cookie(SESSION_COOKIE, cookie, {
        httpOnly: true, secure: isSecure, sameSite: 'strict', maxAge: SESSION_TTL_MS,
      });
      req.auth = {
        kind: 'api-key', userId: user.id, role: user.role,
        scopes: row.scopes, teamId: row.teamId ?? null, apiKeyId: row.id, rateLimit: row.rateLimit,
      };
      req.apiKey = { id: row.id, scopes: row.scopes, rateLimit: row.rateLimit, teamId: row.teamId ?? null };
      return next();
    }
  }

  // Path 3: legacy x-xenon-api-key header (single secret), only when flag is on.
  if (config.acceptLegacyKey) {
    const headerKey = req.headers['x-xenon-api-key'] as string | undefined;
    if (headerKey) {
      const row = await apiKeySvc.verify(headerKey);
      if (row && row.userId) {
        const user = await userSvc.findById(row.userId);
        if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'invalid credentials' });
        req.auth = {
          kind: 'api-key', userId: user.id, role: user.role,
          scopes: row.scopes, teamId: row.teamId ?? null, apiKeyId: row.id, rateLimit: row.rateLimit,
        };
        req.apiKey = { id: row.id, scopes: row.scopes, rateLimit: row.rateLimit, teamId: row.teamId ?? null };
        return next();
      }
    }
  }

  return res.status(401).json({ error: 'unauthenticated' });
}
```

- [ ] **Step 4: Re-export the old name**

Replace the body of `src/middleware/apiKeyMiddleware.ts` with:

```ts
// Back-compat shim: import sites still reference `apiKeyMiddleware`. We will
// migrate them in a follow-up; until then this re-exports the new symbol so
// nothing breaks.
export { authMiddleware as apiKeyMiddleware } from './authMiddleware';
```

- [ ] **Step 5: Run, confirm pass**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/authMiddleware.test.ts
npx mocha --require ts-node/register --timeout 30000 test/unit/apiKeyMiddleware.test.ts
```
Expected: all green.

- [ ] **Step 6: Commit**

```
git add src/middleware/authMiddleware.ts src/middleware/apiKeyMiddleware.ts test/unit/authMiddleware.test.ts
git commit -m "feat(auth): authMiddleware with three resolution paths

Cookie -> UserSession or ApiKey, header (accessKey,token) pair, and a
back-compat path for legacy x-xenon-api-key gated by XENON_ACCEPT_LEGACY_KEY.
The old apiKeyMiddleware export is preserved as a re-export shim.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Update `scopeGuard` to read `req.auth`

**Files:**
- Modify: `src/middleware/scopeGuard.ts`

- [ ] **Step 1: Replace the body**

```ts
/// <reference path="../types/express.d.ts" />
import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../services/ApiKeyService';

export function scopeGuard(required: Scope[]) {
  return function (req: Request, res: Response, next: NextFunction) {
    const auth = req.auth;
    if (!auth) return res.status(401).json({ error: 'unauthenticated' });
    const ok = Container.get(ApiKeyService).hasScope(
      { id: auth.userId, name: '', keyHash: '', scopes: auth.scopes, rateLimit: auth.rateLimit, revokedAt: null },
      required,
    );
    if (!ok) return res.status(403).json({ error: 'insufficient scope' });
    next();
  };
}

export function mutationScopeGuard(required: Scope[]) {
  const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
  const guard = scopeGuard(required);
  return function (req: Request, res: Response, next: NextFunction) {
    if (!STATE_CHANGING.has(req.method)) return next();
    return guard(req, res, next);
  };
}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```
Expected: no NEW errors mentioning `scopeGuard.ts`.

- [ ] **Step 3: Commit**

```
git add src/middleware/scopeGuard.ts
git commit -m "refactor(middleware): scopeGuard reads req.auth

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Config — new env vars

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Extend the `Config` interface and the singleton**

Add to the `Config` interface (after `nodeSecretPrevious?: string`):

```ts
  // Phase 1 identity
  bootstrapAdminEmail: string;
  bootstrapAdminPassword: string;
  bootstrapResetPassword: boolean;
  acceptLegacyKey: boolean;
  loginRateLimitAttempts: number;
  loginRateLimitWindowMs: number;
  userSessionTtlMs: number;
```

Add to the singleton (in the `config` object, after `nodeSecretPrevious`):

```ts
  bootstrapAdminEmail: process.env.XENON_BOOTSTRAP_ADMIN_EMAIL || 'admin@xenon.local',
  bootstrapAdminPassword: process.env.XENON_BOOTSTRAP_ADMIN_PASSWORD || 'Admin@123',
  bootstrapResetPassword: process.env.XENON_BOOTSTRAP_RESET_PASSWORD === 'true',
  acceptLegacyKey: process.env.XENON_ACCEPT_LEGACY_KEY !== 'false', // default true for one minor
  loginRateLimitAttempts: Number(process.env.XENON_LOGIN_RATE_LIMIT_ATTEMPTS) || 5,
  loginRateLimitWindowMs: Number(process.env.XENON_LOGIN_RATE_LIMIT_WINDOW_MS) || 5 * 60 * 1000,
  userSessionTtlMs: Number(process.env.XENON_USER_SESSION_TTL_MS) || 24 * 60 * 60 * 1000,
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```
git add src/config.ts
git commit -m "feat(config): identity bootstrap and rate-limit env vars

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Migrate import sites — `apiKeyMiddleware` → `authMiddleware`

**Files:**
- Modify: `src/app/index.ts`
- Modify: `src/services/SocketServer.ts` (only the comment refers to `apiKeyMiddleware`; no code change required — verify and skip if so)

- [ ] **Step 1: Update the import + mount in `src/app/index.ts`**

Change line 28 from:
```ts
import { apiKeyMiddleware } from '../middleware/apiKeyMiddleware';
```
to:
```ts
import { authMiddleware } from '../middleware/authMiddleware';
```

And line 220 from:
```ts
apiRouter.use(apiKeyMiddleware);
```
to:
```ts
apiRouter.use(authMiddleware);
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```
Expected: no NEW errors.

- [ ] **Step 3: Run the unit suite**

```
XENON_BCRYPT_COST=4 npm test -- --grep 'authMiddleware|apiKey|scopeGuard'
```

- [ ] **Step 4: Commit**

```
git add src/app/index.ts
git commit -m "refactor(app): use authMiddleware instead of apiKeyMiddleware

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: `/auth` router — login / logout / change-password / me (TDD)

**Files:**
- Modify: `src/app/routers/auth.ts`
- Create: `test/integration/auth-flow.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// test/integration/auth-flow.spec.ts
import { expect } from 'chai';
import request from 'supertest';
import express from 'express';
import { authRouter } from '../../src/app/routers/auth';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { prisma } from '../../src/prisma';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter());
  app.use('/api', authMiddleware);
  app.get('/api/whoami', (req, res) => res.json(req.auth));
  return app;
}

describe('auth flow (integration)', function () {
  this.timeout(30_000);
  let user: any;

  before(async () => {
    await prisma.userSession.deleteMany({ where: { user: { email: 'loginflow@xenon.local' } } });
    await prisma.user.deleteMany({ where: { email: 'loginflow@xenon.local' } });
    user = await Container.get(UserService).createUser({
      email: 'loginflow@xenon.local',
      name: 'Login Flow',
      password: 'flow-test-12',
      role: 'ADMIN',
    });
  });

  after(async () => {
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('login → cookie → /whoami → logout → 401', async () => {
    const app = buildApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'loginflow@xenon.local', password: 'flow-test-12' });
    expect(login.status).to.equal(204);
    const cookie = login.headers['set-cookie']?.[0];
    expect(cookie).to.match(/^xenon_dashboard_session=/);

    const me = await request(app).get('/api/whoami').set('Cookie', cookie!);
    expect(me.status).to.equal(200);
    expect(me.body.userId).to.equal(user.id);
    expect(me.body.kind).to.equal('user-session');

    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie!);
    expect(out.status).to.equal(204);

    const me2 = await request(app).get('/api/whoami').set('Cookie', cookie!);
    expect(me2.status).to.equal(401);
  });

  it('login with wrong password returns generic 401 (no enumeration)', async () => {
    const app = buildApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'loginflow@xenon.local', password: 'WRONG' });
    expect(login.status).to.equal(401);
    expect(login.body.error).to.equal('invalid credentials');
  });

  it('login with unknown email returns the same generic 401', async () => {
    const app = buildApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-such@xenon.local', password: 'whatever' });
    expect(login.status).to.equal(401);
    expect(login.body.error).to.equal('invalid credentials');
  });
});
```

> Note: this test hits the real Prisma DB. Make sure your local SQLite is migrated first (`npm run db:migrate`).

- [ ] **Step 2: Run, confirm fail**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/integration/auth-flow.spec.ts
```

- [ ] **Step 3: Replace `src/app/routers/auth.ts`**

```ts
/// <reference path="../../types/express.d.ts" />
import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../../services/ApiKeyService';
import { UserService } from '../../services/UserService';
import { UserSessionService } from '../../services/UserSessionService';
import { LoginRateLimiter, loginRateLimitMiddleware, ipHashOf } from '../../middleware/loginRateLimiter';
import { config } from '../../config';

export function authRouter(): Router {
  const r = Router();
  const apiKeySvc = Container.get(ApiKeyService);
  const userSvc = Container.get(UserService);
  const sessionSvc = Container.get(UserSessionService);
  const limiter = new LoginRateLimiter();
  const isSecureFromReq = (req: any) =>
    req.secure || (req.headers['x-forwarded-proto'] as string | undefined) === 'https';

  // POST /auth/login — IP rate-limited, generic 401, timing-safe.
  r.post('/login', loginRateLimitMiddleware(limiter), async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = await userSvc.findByEmail(email);
    // Always run bcrypt to keep timing constant whether or not the user exists.
    const ok = await userSvc.verifyPassword(
      password,
      user?.passwordHash ?? '$2b$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid',
    );
    if (!user || user.status !== 'ACTIVE' || !ok) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const ipKey = (req as any).loginRateLimitKey ?? ipHashOf(req as any);
    limiter.clearOnSuccess(ipKey);

    const session = await sessionSvc.create(user.id, {
      userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 200),
      ipHash: ipKey,
    });
    await userSvc.setLastLoginAt(user.id);

    res.cookie('xenon_dashboard_session', session.id, {
      httpOnly: true,
      secure: isSecureFromReq(req),
      sameSite: 'strict',
      maxAge: config.userSessionTtlMs,
    });
    return res.status(204).end();
  });

  // POST /auth/logout
  r.post('/logout', async (req, res) => {
    const cookie = (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('xenon_dashboard_session='))
      ?.slice('xenon_dashboard_session='.length);
    if (cookie) await sessionSvc.revoke(cookie);
    res.clearCookie('xenon_dashboard_session', { httpOnly: true, sameSite: 'strict' });
    return res.status(204).end();
  });

  // POST /auth/change-password — gated by authMiddleware (mounted upstream); req.auth must exist.
  r.post('/change-password', async (req, res) => {
    const auth = req.auth;
    if (!auth) return res.status(401).json({ error: 'unauthenticated' });
    const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'oldPassword and newPassword required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
    try {
      await userSvc.changePassword(auth.userId, oldPassword, newPassword);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    if (auth.sessionId) await sessionSvc.revokeAllForUserExcept(auth.userId, auth.sessionId);
    return res.status(204).end();
  });

  // GET /auth/me — gated by authMiddleware
  r.get('/me', async (req, res) => {
    const auth = req.auth;
    if (!auth) return res.status(401).json({ error: 'unauthenticated' });
    const user = await userSvc.findById(auth.userId);
    if (!user) return res.status(401).json({ error: 'unauthenticated' });
    return res.json({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      accessKey: user.accessKey,
      scopes: auth.scopes,
      teamId: auth.teamId ?? null,
      kind: auth.kind,
    });
  });

  // POST /auth/dashboard-session (legacy ops escape hatch — gated to SUPER_ADMIN)
  r.post('/dashboard-session', async (req, res) => {
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey) return res.status(400).json({ error: 'apiKey required' });
    const row = await apiKeySvc.verify(apiKey);
    if (!row || !row.userId) return res.status(401).json({ error: 'invalid key' });
    const owner = await userSvc.findById(row.userId);
    if (!owner || owner.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'super-admin scope required for dashboard-session exchange' });
    }
    res.cookie('xenon_dashboard_session', apiKey, {
      httpOnly: true,
      secure: isSecureFromReq(req),
      sameSite: 'strict',
      maxAge: config.userSessionTtlMs,
    });
    res.json({ ok: true, scopes: row.scopes });
  });

  return r;
}
```

- [ ] **Step 4: Mount `/auth/me` and `/auth/change-password` behind authMiddleware**

In `src/app/index.ts`, the existing line 217 mounts `authRouter()` *before* `authMiddleware`:

```ts
apiRouter.use('/auth', authRouter());
apiRouter.use(authMiddleware);
```

`/auth/login` and `/auth/logout` correctly stay open. But `/auth/me` and `/auth/change-password` need to be authenticated. Refactor:

```ts
// Open: login + logout
apiRouter.use('/auth', authRouter());     // routes inside that don't need auth

// Authenticated routes start here
apiRouter.use(authMiddleware);
apiRouter.use(rateLimitMiddleware());
```

The router file already gates `/auth/me` and `/auth/change-password` with an explicit `if (!req.auth)` check — which works because **after** mounting `authRouter()` on a path that's *also* later under `authMiddleware`, those routes were already matched. We need to mount the auth router twice — once open for login/logout, once gated for me/change-password.

Easier: split `authRouter()` into `authPublicRouter()` (login + logout) and `authAuthedRouter()` (me + change-password + dashboard-session). Update `src/app/index.ts`:

```ts
// (replace the single mount above with these two)
apiRouter.use('/auth', authPublicRouter());      // login, logout — unauthenticated
apiRouter.use(authMiddleware);
apiRouter.use(rateLimitMiddleware());
apiRouter.use('/auth', authAuthedRouter());      // me, change-password, dashboard-session
```

Refactor `src/app/routers/auth.ts` accordingly to export both functions; the bodies are just split versions of what's above.

- [ ] **Step 5: Run, confirm pass**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/integration/auth-flow.spec.ts
```

- [ ] **Step 6: Commit**

```
git add src/app/routers/auth.ts src/app/index.ts test/integration/auth-flow.spec.ts
git commit -m "feat(auth): /auth/login, /auth/logout, /auth/change-password, /auth/me

Login is rate-limited per IP; bad credentials always return a generic 401
to avoid email enumeration. Change-password invalidates all other sessions
for the user. /auth/dashboard-session is now gated to super-admins.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: `/profile` router — tokens + access-key (TDD)

**Files:**
- Create: `src/app/routers/profile.ts`
- Create: `test/unit/profile-router.test.ts`
- Modify: `src/app/index.ts` (mount router)

- [ ] **Step 1: Write failing tests**

```ts
// test/unit/profile-router.test.ts
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { profileRouter } from '../../src/app/routers/profile';
import { Container } from 'typedi';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserService } from '../../src/services/UserService';
import { prisma } from '../../src/prisma';

function appWithAuth(auth: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).auth = auth; next(); });
  app.use('/profile', profileRouter());
  return app;
}

describe('profile router', () => {
  afterEach(() => sinon.restore());

  it('GET /profile/access-key returns the caller accessKey', async () => {
    sinon.stub(Container.get(UserService), 'findById').resolves({ accessKey: 'xen_abc' } as any);
    const app = appWithAuth({ userId: 'u1', role: 'ADMIN', scopes: 'devices,sessions,read' });
    const r = await request(app).get('/profile/access-key');
    expect(r.body.accessKey).to.equal('xen_abc');
  });

  it('POST /profile/access-key/rotate returns a new accessKey', async () => {
    sinon.stub(Container.get(UserService), 'rotateAccessKey').resolves({ id: 'u1', accessKey: 'xen_NEW' } as any);
    const app = appWithAuth({ userId: 'u1', role: 'ADMIN', scopes: 'devices,sessions,read' });
    const r = await request(app).post('/profile/access-key/rotate');
    expect(r.body.accessKey).to.equal('xen_NEW');
  });

  it('GET /profile/tokens lists caller tokens without secrets', async () => {
    sinon.stub(prisma.apiKey, 'findMany').resolves([
      { id: 'k1', name: 'CI', scopes: 'sessions,read', expiresAt: null, createdAt: new Date(), lastUsedAt: null },
    ] as any);
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).get('/profile/tokens');
    expect(r.body[0].name).to.equal('CI');
    expect(r.body[0].keyHash).to.be.undefined;
  });

  it('POST /profile/tokens creates a token with role-derived default scopes', async () => {
    const create = sinon.stub(Container.get(ApiKeyService), 'create')
      .resolves({ id: 'k2', raw: 'rawsecret' });
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).post('/profile/tokens').send({ name: 'CI' });
    expect(r.status).to.equal(201);
    expect(r.body.token).to.equal('rawsecret');
    expect(create.firstCall.args[0].scopes).to.deep.equal(['sessions', 'read']);
  });

  it('POST /profile/tokens rejects an attempt to widen scopes', async () => {
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).post('/profile/tokens').send({ name: 'CI', scopes: ['admin'] });
    expect(r.status).to.equal(400);
    expect(r.body.error).to.match(/cannot widen/);
  });

  it('DELETE /profile/tokens/:id only deletes caller-owned tokens', async () => {
    sinon.stub(prisma.apiKey, 'findFirst').resolves({ id: 'k1', userId: 'u1' } as any);
    const revoke = sinon.stub(Container.get(ApiKeyService), 'revoke').resolves(undefined as any);
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).delete('/profile/tokens/k1');
    expect(r.status).to.equal(204);
    expect(revoke.calledOnceWithExactly('k1')).to.be.true;
  });

  it('DELETE /profile/tokens/:id 404s when the token belongs to someone else', async () => {
    sinon.stub(prisma.apiKey, 'findFirst').resolves(null);
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).delete('/profile/tokens/k1');
    expect(r.status).to.equal(404);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/profile-router.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/app/routers/profile.ts
/// <reference path="../../types/express.d.ts" />
import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../../services/ApiKeyService';
import { UserService } from '../../services/UserService';
import { prisma } from '../../prisma';

const ROLE_SCOPES: Record<string, Scope[]> = {
  SUPER_ADMIN: ['admin'],
  ADMIN: ['devices', 'sessions', 'read'],
  MEMBER: ['sessions', 'read'],
};

function widenedScope(requested: Scope[], allowed: Scope[]): boolean {
  // 'admin' is widening for any non-super-admin allowed set.
  for (const r of requested) {
    if (r === 'admin' && !allowed.includes('admin')) return true;
    if (!allowed.includes(r)) return true;
  }
  return false;
}

export function profileRouter(): Router {
  const r = Router();
  const userSvc = Container.get(UserService);
  const apiKeySvc = Container.get(ApiKeyService);

  function requireAuth(req: any, res: any) {
    const auth = req.auth;
    if (!auth) { res.status(401).json({ error: 'unauthenticated' }); return null; }
    return auth;
  }

  r.get('/access-key', async (req, res) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const user = await userSvc.findById(auth.userId);
    if (!user) return res.status(404).json({ error: 'user not found' });
    return res.json({ accessKey: user.accessKey });
  });

  r.post('/access-key/rotate', async (req, res) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const updated = await userSvc.rotateAccessKey(auth.userId);
    return res.json({ accessKey: updated.accessKey });
  });

  r.get('/tokens', async (req, res) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const rows = await prisma.apiKey.findMany({
      where: { userId: auth.userId, revokedAt: null },
      select: { id: true, name: true, scopes: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map((row) => ({
      id: row.id,
      name: row.name,
      scopes: row.scopes.split(','),
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    })));
  });

  r.post('/tokens', async (req, res) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { name, scopes } = req.body as { name?: string; scopes?: Scope[] };
    if (!name) return res.status(400).json({ error: 'name required' });

    const allowed = ROLE_SCOPES[auth.role] ?? ROLE_SCOPES.MEMBER;
    const requested = (scopes && scopes.length > 0) ? scopes : allowed;
    if (widenedScope(requested, allowed)) {
      return res.status(400).json({ error: 'cannot widen scopes beyond your role' });
    }
    const { id, raw } = await apiKeySvc.create({
      name, scopes: requested, userId: auth.userId,
    });
    return res.status(201).json({ id, token: raw });
  });

  r.delete('/tokens/:id', async (req, res) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const row = await prisma.apiKey.findFirst({
      where: { id: req.params.id, userId: auth.userId },
    });
    if (!row) return res.status(404).json({ error: 'token not found' });
    await apiKeySvc.revoke(req.params.id);
    return res.status(204).end();
  });

  return r;
}
```

- [ ] **Step 4: Mount in `src/app/index.ts`**

After `apiRouter.use('/apikeys', apiKeysRouter());` (around line 224), add:

```ts
apiRouter.use('/profile', profileRouter());
```

And add the import at the top:

```ts
import { profileRouter } from './routers/profile';
```

- [ ] **Step 5: Run, confirm pass**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/profile-router.test.ts
```
Expected: 7 passing.

- [ ] **Step 6: Commit**

```
git add src/app/routers/profile.ts src/app/index.ts test/unit/profile-router.test.ts
git commit -m "feat(auth): /profile/tokens and /profile/access-key

Members and admins manage their own tokens through this router. Token
scopes default to the caller's role-derived set and can only be narrowed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Identity bootstrap (TDD)

**Files:**
- Create: `src/services/identity/bootstrap.ts`
- Create: `test/unit/bootstrap-identity.test.ts`
- Modify: `src/services/ApiKeyService.ts` — `bootstrapIfEmpty` accepts a `userId` and stamps it on the bootstrap key.

- [ ] **Step 1: Write failing tests**

```ts
// test/unit/bootstrap-identity.test.ts
import { expect } from 'chai';
import sinon from 'sinon';
import { bootstrapIdentity } from '../../src/services/identity/bootstrap';
import { prisma } from '../../src/prisma';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';

describe('bootstrapIdentity', () => {
  afterEach(() => sinon.restore());

  it('creates a super-admin and a Legacy Admin (when ApiKeys exist) on a fresh DB', async () => {
    sinon.stub(prisma.user, 'count').resolves(0);
    sinon.stub(prisma.apiKey, 'count').resolves(2);                // existing keys
    const create = sinon.stub(Container.get(UserService), 'createUser')
      .onFirstCall().resolves({ id: 'super', role: 'SUPER_ADMIN' } as any)
      .onSecondCall().resolves({ id: 'legacy', role: 'SUPER_ADMIN' } as any);
    sinon.stub(prisma.apiKey, 'updateMany').resolves({ count: 2 } as any);
    sinon.stub(Container.get(ApiKeyService), 'bootstrapIfEmpty').resolves(null);

    await bootstrapIdentity();

    expect(create.callCount).to.equal(2);
    expect(create.firstCall.args[0].role).to.equal('SUPER_ADMIN');
    expect(create.secondCall.args[0].email).to.equal('legacy-admin@xenon.local');
    expect(create.secondCall.args[0].status).to.equal('INACTIVE');
  });

  it('does not create a Legacy Admin when no ApiKeys exist', async () => {
    sinon.stub(prisma.user, 'count').resolves(0);
    sinon.stub(prisma.apiKey, 'count').resolves(0);
    const create = sinon.stub(Container.get(UserService), 'createUser')
      .resolves({ id: 'super', role: 'SUPER_ADMIN' } as any);
    sinon.stub(Container.get(ApiKeyService), 'bootstrapIfEmpty').resolves('rawkey');

    await bootstrapIdentity();
    expect(create.callCount).to.equal(1);
  });

  it('XENON_BOOTSTRAP_RESET_PASSWORD=true rotates the super-admin password', async () => {
    sinon.stub(prisma.user, 'count').resolves(2);
    sinon.stub(prisma.user, 'findFirst').resolves({ id: 'super' } as any);
    const update = sinon.stub(prisma.user, 'update').resolves({} as any);
    sinon.stub(prisma.userSession, 'deleteMany').resolves({ count: 1 } as any);

    process.env.XENON_BOOTSTRAP_RESET_PASSWORD = 'true';
    process.env.XENON_BOOTSTRAP_ADMIN_PASSWORD = 'NewPw1234';
    try {
      await bootstrapIdentity();
      expect(update.calledOnce).to.be.true;
    } finally {
      delete process.env.XENON_BOOTSTRAP_RESET_PASSWORD;
      delete process.env.XENON_BOOTSTRAP_ADMIN_PASSWORD;
    }
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/bootstrap-identity.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/services/identity/bootstrap.ts
import { Container } from 'typedi';
import { prisma } from '../../prisma';
import { UserService } from '../UserService';
import { ApiKeyService } from '../ApiKeyService';
import { config } from '../../config';
import log from '../../logger';

const LEGACY_EMAIL = 'legacy-admin@xenon.local';

export async function bootstrapIdentity() {
  const userSvc = Container.get(UserService);
  const apiKeySvc = Container.get(ApiKeyService);
  const l = log.scope('Identity-Bootstrap');

  // 1) Reset super-admin password (env-driven; works on any populated DB).
  if (config.bootstrapResetPassword) {
    const sa = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (sa) {
      const passwordHash = await userSvc.hashPassword(config.bootstrapAdminPassword);
      await prisma.user.update({
        where: { id: sa.id },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await prisma.userSession.deleteMany({ where: { userId: sa.id } });
      l.warn(`Bootstrap super-admin password reset via XENON_BOOTSTRAP_RESET_PASSWORD.`);
    }
  }

  const userCount = await prisma.user.count();
  if (userCount > 0) {
    return;                                               // already bootstrapped
  }

  // 2) Create the bootstrap super-admin.
  const superAdmin = await userSvc.createUser({
    email: config.bootstrapAdminEmail,
    name: 'Bootstrap Super Admin',
    password: config.bootstrapAdminPassword,
    role: 'SUPER_ADMIN',
  });
  l.warn(`Bootstrap super-admin "${config.bootstrapAdminEmail}" created. Sign in and rotate the password.`);

  // 3) If ApiKey rows already exist (legacy install), create Legacy Admin and
  //    backfill all existing keys to it. Then re-tag any 'bootstrap'-named key
  //    to the real super-admin we just created.
  const apiKeyCount = await prisma.apiKey.count();
  if (apiKeyCount > 0) {
    const legacy = await userSvc.createUser({
      email: LEGACY_EMAIL,
      name: 'Legacy Admin',
      password: 'unset-' + Math.random().toString(36).slice(2),  // hash exists; status INACTIVE prevents login
      role: 'SUPER_ADMIN',
      status: 'INACTIVE',
    });
    await prisma.apiKey.updateMany({
      where: { userId: null },
      data: { userId: legacy.id },
    });
    await prisma.apiKey.updateMany({
      where: { name: 'bootstrap' },
      data: { userId: superAdmin.id },
    });
    l.warn(`Backfilled existing API keys to Legacy Admin (${legacy.id}). Reassign via Phase 2 user-management UI.`);
  } else {
    // 4) Fresh DB: write a bootstrap key owned by the super-admin.
    await apiKeySvc.bootstrapIfEmpty(config.bootstrapKeyPath, superAdmin.id);
  }
}
```

- [ ] **Step 4: Update `ApiKeyService.bootstrapIfEmpty()` to accept a `userId`**

In `src/services/ApiKeyService.ts`, change the signature:

```ts
async bootstrapIfEmpty(keyFilePath: string, userId: string): Promise<string | null> {
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
      userId,                                             // NEW
    },
  });

  this.log.warn(
    `No API keys found. Bootstrap key written to ${keyFilePath}. Rotate within 24h via POST /xenon/api/profile/tokens.`,
  );
  return raw;
}
```

The existing `ApiKeyService.test.ts` calls `bootstrapIfEmpty('/tmp/test-bootstrap.txt')` — pass a dummy user id (`'u-test'`) in those existing tests so they still compile; the assertions on `create.firstCall.args[0].data` should now expect `userId` too.

- [ ] **Step 5: Run, confirm pass**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/bootstrap-identity.test.ts test/unit/ApiKeyService.test.ts
```

- [ ] **Step 6: Hook bootstrap into the boot sequence**

The existing call site is `src/services/ServerManager.ts:196`:

```ts
const raw = await Container.get(ApiKeyService).bootstrapIfEmpty(xenonConfig.bootstrapKeyPath);
```

Replace it with:

```ts
const { bootstrapIdentity } = await import('./identity/bootstrap');
await bootstrapIdentity();
```

(Note: the path is `./identity/bootstrap` because `ServerManager.ts` and the new `identity/` directory both live under `src/services/`. Adjust if you placed `bootstrap.ts` elsewhere.)

- [ ] **Step 7: Commit**

```
git add src/services/identity/bootstrap.ts src/services/ApiKeyService.ts test/unit/bootstrap-identity.test.ts test/unit/ApiKeyService.test.ts src/index.ts
git commit -m "feat(auth): bootstrapIdentity() + Legacy Admin migration

On a fresh DB this creates a SUPER_ADMIN and a bootstrap API key owned by
that user. On an existing DB with ApiKeys but no Users it creates a
synthetic Legacy Admin and backfills every key to it. The bootstrap key
(name='bootstrap') is reassigned to the real super-admin.

XENON_BOOTSTRAP_RESET_PASSWORD=true on next boot rotates the super-admin
password to XENON_BOOTSTRAP_ADMIN_PASSWORD and revokes all of that user's
sessions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Make `ApiKey.userId` NOT NULL (follow-up migration)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_apikey_userid_required/migration.sql`

- [ ] **Step 1: Verify backfill**

After running the boot once, every row should have `userId`:

```
sqlite3 ~/.cache/xenon/xenon.db 'SELECT COUNT(*) FROM ApiKey WHERE userId IS NULL;'
```
Expected: `0`.

- [ ] **Step 2: Drop the optionality in the schema**

```prisma
model ApiKey {
  // ...
  userId      String                                       // NOT NULL now
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  // ...
}
```

- [ ] **Step 3: Generate the migration**

```
npm run db:generate -- --name apikey_userid_required
npm run db:migrate
```

- [ ] **Step 4: Commit**

```
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): ApiKey.userId NOT NULL after backfill

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Hourly session cleanup cron

**Files:**
- Create: `src/services/identity/sessionCleanupCron.ts`
- Modify: `src/index.ts` — start the cron after migrations.

- [ ] **Step 1: Implement**

```ts
// src/services/identity/sessionCleanupCron.ts
import { Container } from 'typedi';
import { UserSessionService } from '../UserSessionService';
import log from '../../logger';

const HOUR_MS = 60 * 60 * 1000;

export function startUserSessionCleanupCron() {
  const svc = Container.get(UserSessionService);
  const l = log.scope('UserSession-Cron');
  // Run once shortly after boot, then every hour.
  setTimeout(() => {
    svc.cleanupExpired().catch((e) => l.error('cleanup failed', e));
  }, 30_000);
  setInterval(() => {
    svc.cleanupExpired().catch((e) => l.error('cleanup failed', e));
  }, HOUR_MS).unref();
}
```

- [ ] **Step 2: Wire into boot**

In the same place you wired `bootstrapIdentity()`, also call `startUserSessionCleanupCron()` after migrations have run.

- [ ] **Step 3: Type-check**

```
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```
git add src/services/identity/sessionCleanupCron.ts src/index.ts
git commit -m "feat(auth): hourly cron deletes expired user sessions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Frontend — auth API service

**Files:**
- Create: `web/src/api-service/auth.ts`
- Create: `web/src/api-service/profile.ts`

- [ ] **Step 1: Implement `auth.ts`**

```ts
// web/src/api-service/auth.ts
const BASE = '/xenon/api/auth';

export async function login(email: string, password: string): Promise<void> {
  const r = await fetch(`${BASE}/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `Login failed (${r.status})`);
  }
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/logout`, { method: 'POST', credentials: 'include' });
}

export interface MePayload {
  userId: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
  accessKey: string;
  scopes: string;
  teamId: string | null;
  kind: 'user-session' | 'api-key';
}

export async function getMe(): Promise<MePayload | null> {
  const r = await fetch(`${BASE}/me`, { credentials: 'include' });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`Failed to fetch /me (${r.status})`);
  return r.json();
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const r = await fetch(`${BASE}/change-password`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `Change password failed (${r.status})`);
  }
}
```

- [ ] **Step 2: Implement `profile.ts`**

```ts
// web/src/api-service/profile.ts
const BASE = '/xenon/api/profile';

export interface TokenSummary {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listTokens(): Promise<TokenSummary[]> {
  const r = await fetch(`${BASE}/tokens`, { credentials: 'include' });
  if (!r.ok) throw new Error(`listTokens failed (${r.status})`);
  return r.json();
}

export async function createToken(
  name: string,
  scopes?: string[],
): Promise<{ id: string; token: string }> {
  const r = await fetch(`${BASE}/tokens`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scopes }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `createToken failed (${r.status})`);
  }
  return r.json();
}

export async function deleteToken(id: string): Promise<void> {
  const r = await fetch(`${BASE}/tokens/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!r.ok && r.status !== 204) throw new Error(`deleteToken failed (${r.status})`);
}

export async function getAccessKey(): Promise<string> {
  const r = await fetch(`${BASE}/access-key`, { credentials: 'include' });
  if (!r.ok) throw new Error(`getAccessKey failed (${r.status})`);
  return (await r.json()).accessKey;
}

export async function rotateAccessKey(): Promise<string> {
  const r = await fetch(`${BASE}/access-key/rotate`, {
    method: 'POST', credentials: 'include',
  });
  if (!r.ok) throw new Error(`rotateAccessKey failed (${r.status})`);
  return (await r.json()).accessKey;
}
```

- [ ] **Step 3: Commit**

```
git add web/src/api-service/auth.ts web/src/api-service/profile.ts
git commit -m "feat(web): auth + profile fetch helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Frontend — `AuthContext` + `RouteGuard`

**Files:**
- Create: `web/src/auth/auth-context.tsx`
- Create: `web/src/auth/route-guard.tsx`

- [ ] **Step 1: Implement `AuthContext`**

```tsx
// web/src/auth/auth-context.tsx
import * as React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { getMe, MePayload, logout as apiLogout } from '../api-service/auth';

interface AuthState {
  loading: boolean;
  me: MePayload | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);

  async function refresh() {
    try {
      setMe(await getMe());
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await apiLogout();
    setMe(null);
    window.location.href = '/xenon/login';
  }

  useEffect(() => { refresh(); }, []);

  return (
    <AuthCtx.Provider value={{ loading, me, refresh, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
```

- [ ] **Step 2: Implement `RouteGuard`**

```tsx
// web/src/auth/route-guard.tsx
import * as React from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useAuth } from './auth-context';

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { loading, me } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
        Loading…
      </div>
    );
  }
  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}
```

- [ ] **Step 3: Commit**

```
git add web/src/auth/auth-context.tsx web/src/auth/route-guard.tsx
git commit -m "feat(web): AuthContext + RouteGuard for /auth/me-driven gating

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: Frontend — `/login` page

**Files:**
- Create: `web/src/pages/login.tsx`

- [ ] **Step 1: Implement**

```tsx
// web/src/pages/login.tsx
import * as React from 'react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { login } from '../api-service/auth';
import { useAuth } from '../auth/auth-context';

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { refresh } = useAuth();
  const params = new URLSearchParams(loc.search);
  const next = params.get('next') || '/overview';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      await refresh();
      nav(next, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full grid grid-cols-1 md:grid-cols-2 bg-[var(--bg)] text-[var(--text)]">
      {/* Left hero — Xenon-adapted */}
      <aside className="relative hidden md:flex flex-col justify-center px-12 overflow-hidden bg-gradient-to-br from-[#0a0e1a] via-[#131a2e] to-[#1a2548]">
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'radial-gradient(circle at 80% 20%, rgba(99,102,241,0.18), transparent 60%)' }} />
        <div className="relative">
          <div className="text-3xl font-semibold tracking-tight mb-2">Xenon</div>
          <p className="text-sm text-[var(--text-dim)] max-w-sm leading-relaxed mb-8">
            Enterprise-grade Appium device lab orchestration with AI self-healing,
            live device streaming, and proof-pack recording.
          </p>
          <div className="flex flex-wrap gap-2 max-w-sm">
            {['Hub-Node', '5-tier Healing', 'Live MJPEG', 'Mosaic Recording'].map((t) => (
              <span key={t} className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[var(--text-muted)]">
                {t}
              </span>
            ))}
          </div>
        </div>
      </aside>

      {/* Right — sign-in form */}
      <main className="flex items-center justify-center px-6 md:px-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold mb-1">Welcome back!</h1>
          <p className="text-sm text-[var(--text-dim)] mb-6">Sign in to your account</p>

          <label className="block text-xs text-[var(--text-dim)] mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
            className="w-full mb-4 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--green)] outline-none"
          />
          <label className="block text-xs text-[var(--text-dim)] mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full mb-2 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--green)] outline-none"
          />

          {error && <div className="mt-3 text-xs text-[var(--red)]">{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 w-full h-10 rounded-md bg-[var(--green)] text-black font-medium text-sm disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Commit (route wiring comes in Task 24)**

```
git add web/src/pages/login.tsx
git commit -m "feat(web): /login screen with Xenon-adapted hero

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: Frontend — `/profile` page (shell + tabs + Password & Auth)

**Files:**
- Create: `web/src/pages/profile/profile-page.tsx`
- Create: `web/src/pages/profile/password-tab.tsx`

- [ ] **Step 1: Profile shell with tab state**

```tsx
// web/src/pages/profile/profile-page.tsx
import * as React from 'react';
import { useState } from 'react';
import { PasswordTab } from './password-tab';
import { ApiTokensTab } from './api-tokens-tab';

type Tab = 'password' | 'tokens';

export default function ProfilePage() {
  const [tab, setTab] = useState<Tab>('password');
  return (
    <div className="flex">
      <nav className="w-56 shrink-0 border-r border-[var(--border)] py-6 px-3">
        <div className="text-sm font-semibold mb-4 px-2">Profile Settings</div>
        {[
          { id: 'password', label: 'Password & Authentication' } as const,
          { id: 'tokens',   label: 'API Tokens' } as const,
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`block w-full text-left px-3 py-2 text-sm rounded-md mb-1 ${
              tab === t.id
                ? 'bg-[var(--green)]/10 text-[var(--green)]'
                : 'text-[var(--text)] hover:bg-[var(--surface)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <section className="flex-1 px-8 py-6">
        {tab === 'password' ? <PasswordTab /> : <ApiTokensTab />}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Password tab**

```tsx
// web/src/pages/profile/password-tab.tsx
import * as React from 'react';
import { useState } from 'react';
import { changePassword } from '../../api-service/auth';

export function PasswordTab() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newPassword !== confirm) {
      setMsg({ kind: 'err', text: 'Passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await changePassword(oldPassword, newPassword);
      setMsg({ kind: 'ok', text: 'Password updated. Other sessions for your account were signed out.' });
      setOldPassword(''); setNewPassword(''); setConfirm('');
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md">
      <h2 className="text-xl font-semibold mb-4">Update Password</h2>
      {(['oldPassword', 'newPassword', 'confirm'] as const).map((id) => (
        <div key={id} className="mb-3">
          <label className="block text-xs text-[var(--text-dim)] mb-1">
            {id === 'oldPassword' ? 'Current password' : id === 'newPassword' ? 'New password' : 'Confirm new password'}
          </label>
          <input
            type="password"
            value={id === 'oldPassword' ? oldPassword : id === 'newPassword' ? newPassword : confirm}
            onChange={(e) => {
              if (id === 'oldPassword') setOldPassword(e.target.value);
              else if (id === 'newPassword') setNewPassword(e.target.value);
              else setConfirm(e.target.value);
            }}
            className="w-full h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm"
          />
        </div>
      ))}
      {msg && (
        <div className={`text-xs mb-3 ${msg.kind === 'ok' ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
          {msg.text}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || newPassword.length < 8}
        className="h-10 px-4 rounded-md bg-[var(--green)] text-black font-medium text-sm disabled:opacity-50"
      >
        {busy ? 'Updating…' : 'Update Password'}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Commit (api-tokens tab in next task)**

```
git add web/src/pages/profile/profile-page.tsx web/src/pages/profile/password-tab.tsx
git commit -m "feat(web): /profile shell + Password & Authentication tab

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: Frontend — `/profile` API Tokens tab + generate modal

**Files:**
- Create: `web/src/pages/profile/api-tokens-tab.tsx`
- Create: `web/src/pages/profile/generate-token-modal.tsx`

- [ ] **Step 1: Implement the modal**

```tsx
// web/src/pages/profile/generate-token-modal.tsx
import * as React from 'react';
import { useState } from 'react';
import { createToken } from '../../api-service/profile';

export function GenerateTokenModal({
  onClose,
  onCreated,
}: { onClose: () => void; onCreated: (info: { name: string; token: string }) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await createToken(name);
      onCreated({ name, token: r.token });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-md p-6">
        <h3 className="text-lg font-semibold mb-4">Generate Identity Token</h3>
        <label className="block text-xs text-[var(--text-dim)] mb-1">Description</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. mac, CI, etc."
          required
          className="w-full mb-4 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm"
        />
        {error && <div className="text-xs text-[var(--red)] mb-2">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-md border border-[var(--border)] text-sm">
            Cancel
          </button>
          <button type="submit" disabled={busy || !name} className="h-9 px-4 rounded-md bg-[var(--green)] text-black text-sm font-medium disabled:opacity-50">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Implement the API Tokens tab**

```tsx
// web/src/pages/profile/api-tokens-tab.tsx
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Copy, RefreshCw, Trash2 } from 'lucide-react';
import { listTokens, deleteToken, getAccessKey, rotateAccessKey, TokenSummary } from '../../api-service/profile';
import { GenerateTokenModal } from './generate-token-modal';

export function ApiTokensTab() {
  const [accessKey, setAccessKey] = useState<string>('');
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null);

  async function refresh() {
    setLoading(true);
    const [ak, t] = await Promise.all([getAccessKey(), listTokens()]);
    setAccessKey(ak);
    setTokens(t);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function rotate() {
    if (!confirm('Rotate access key? Existing tokens stay valid but the old accessKey will stop working immediately.')) return;
    setAccessKey(await rotateAccessKey());
  }
  async function remove(id: string) {
    if (!confirm('Delete this token? It will stop working immediately.')) return;
    await deleteToken(id);
    setTokens((t) => t.filter((x) => x.id !== id));
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-xs text-[var(--text-dim)]">Access Key</span>
        <code className="px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs">{accessKey || '…'}</code>
        <button onClick={() => navigator.clipboard.writeText(accessKey)} aria-label="Copy access key" className="text-[var(--text-dim)] hover:text-[var(--text)]">
          <Copy size={14} />
        </button>
        <button onClick={rotate} aria-label="Rotate access key" className="text-[var(--text-dim)] hover:text-[var(--text)]">
          <RefreshCw size={14} />
        </button>
        <span className="text-[10px] text-[var(--text-dim)] ml-2">Public — paired with a token below</span>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">Identity Tokens</h2>
        <button onClick={() => setShowModal(true)} className="h-9 px-4 rounded-md bg-[var(--green)] text-black font-medium text-sm">
          Generate New Token
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--text-dim)]">Loading…</div>
      ) : tokens.length === 0 ? (
        <div className="text-sm text-[var(--text-dim)] py-6 text-center border border-dashed border-[var(--border)] rounded-md">
          No tokens yet — generate one to use programmatically.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[11px] text-[var(--text-dim)] uppercase tracking-wide">
            <tr>
              <th className="text-left py-2">Name</th>
              <th className="text-left py-2">Issued</th>
              <th className="text-left py-2">Last Used</th>
              <th className="w-px"></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} className="border-t border-[var(--border)]">
                <td className="py-2">{t.name}</td>
                <td className="py-2 text-[var(--text-muted)]">{new Date(t.createdAt).toLocaleString()}</td>
                <td className="py-2 text-[var(--text-muted)]">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : '—'}</td>
                <td className="py-2 text-right">
                  <button onClick={() => remove(t.id)} aria-label="Delete token" className="text-[var(--red)] hover:opacity-80">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showModal && (
        <GenerateTokenModal
          onClose={() => setShowModal(false)}
          onCreated={(info) => { setShowModal(false); setRevealed(info); refresh(); }}
        />
      )}

      {revealed && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center" role="dialog">
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-md p-6">
            <h3 className="text-base font-semibold mb-2">Token created</h3>
            <p className="text-xs text-[var(--text-dim)] mb-3">Copy this now — it will not be shown again.</p>
            <code className="block break-all px-3 py-2 rounded bg-[var(--surface)] border border-[var(--border)] text-xs mb-3">{revealed.token}</code>
            <div className="flex justify-end">
              <button onClick={() => setRevealed(null)} className="h-9 px-4 rounded-md bg-[var(--green)] text-black text-sm font-medium">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```
git add web/src/pages/profile/api-tokens-tab.tsx web/src/pages/profile/generate-token-modal.tsx
git commit -m "feat(web): /profile API Tokens tab + generate modal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 23: Frontend — header user dropdown

**Files:**
- Modify: `web/src/components/header/header.tsx`

- [ ] **Step 1: Replace the hardcoded "Administrator" block**

In `header.tsx` at lines 116–160 (the dropdown trigger and content), replace:

- Trigger: show user initials avatar + name + role from `useAuth()`.
- Dropdown: keep the "Workspace" / "System" sections; add a `Profile` and a `Logout` row at the bottom.

```tsx
import { useAuth } from '../../auth/auth-context';
import { LogOut, User as UserIcon } from 'lucide-react';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const { me, signOut } = useAuth();
  // ...existing useRelativeTime, dropdown state...

  const initials = (me?.name ?? 'A').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const roleLabel =
    me?.role === 'SUPER_ADMIN' ? 'Super Admin' :
    me?.role === 'ADMIN'       ? 'Admin'       :
                                 'Member';
```

Replace the trigger button (line 117-127):

```tsx
<button
  type="button"
  className="flex items-center gap-2 h-9 px-2.5 rounded-md border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface)] transition-colors"
  onClick={() => setDropdownOpen((o) => !o)}
  aria-haspopup="true"
  aria-expanded={dropdownOpen}
>
  <span className="h-6 w-6 rounded-full bg-[var(--green)] text-black text-[10px] font-bold flex items-center justify-center">
    {initials}
  </span>
  <span className="hidden md:flex flex-col leading-tight text-left">
    <span className="text-[12px] text-[var(--text)]">{me?.name ?? 'Loading…'}</span>
    <span className="text-[10px] text-[var(--text-dim)]">{me ? roleLabel : ''}</span>
  </span>
  <ChevronDown className="h-3.5 w-3.5 text-[var(--text-dim)]" />
</button>
```

Replace the dropdown contents (lines 128–160) — keep what's there, append:

```tsx
<div className="h-px bg-[var(--border)]" />
<button
  type="button"
  onClick={() => { setDropdownOpen(false); navigate('/profile'); }}
  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--surface)] text-left"
>
  <UserIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
  Profile
</button>
<button
  type="button"
  onClick={() => signOut()}
  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--red)] hover:bg-[var(--red)]/5 text-left"
>
  <LogOut className="h-3.5 w-3.5" />
  Logout
</button>
```

Remove the `import { Shield } from 'lucide-react'` (replaced by `UserIcon`).

- [ ] **Step 2: Type-check**

```
cd web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```
git add web/src/components/header/header.tsx
git commit -m "feat(web): header avatar + name + role from /auth/me, plus Logout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 24: Frontend — wire `/login`, `/profile`, route guard, demote `ApiKeyGate`

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/routes/index.tsx`

- [ ] **Step 1: Replace `<ApiKeyGate>` with `<AuthProvider>` + `<RouteGuard>`**

Replace `web/src/App.tsx`:

```tsx
import * as React from 'react';
import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/header/header';
import { AppRoutes } from './routes';
import { ToastProvider } from './components/ui/toast';
import Sidebar from './components/sidebar/sidebar';
import CommandPalette from './components/command-palette/command-palette';
import { AuthProvider } from './auth/auth-context';
import { RouteGuard } from './auth/route-guard';

const LoginPage = lazy(() => import('./pages/login'));
const ApiKeyGate = lazy(() => import('./components/ApiKeyGate').then(m => ({ default: m.ApiKeyGate })));

function Shell() {
  return (
    <ToastProvider>
      <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)]">
        <Sidebar />
        <Header />
        <main className="pl-14 pt-14 h-screen overflow-y-auto">
          <AppRoutes />
        </main>
        <CommandPalette />
      </div>
    </ToastProvider>
  );
}

function App() {
  return (
    <BrowserRouter basename="/xenon">
      <AuthProvider>
        <Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/api-key-gate" element={<ApiKeyGate><Navigate to="/overview" replace /></ApiKeyGate>} />
            <Route
              path="*"
              element={
                <RouteGuard>
                  <Shell />
                </RouteGuard>
              }
            />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 2: Add `/profile` to `AppRoutes`**

In `web/src/routes/index.tsx`, after the `Teams` lazy import, add:

```ts
const ProfilePage = lazy(() => import('../pages/profile/profile-page'));
```

And add the route inside `<Routes>` (before the catch-all `*`):

```tsx
<Route path="/profile" element={<ProfilePage />} />
```

- [ ] **Step 3: Frontend smoke check (vitest)**

Add a smoke test that mounts `<App />` and verifies the unauthenticated path redirects:

```tsx
// web/src/auth/auth.smoke.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth-context';
import { RouteGuard } from './route-guard';

vi.mock('../api-service/auth', () => ({
  getMe: vi.fn().mockResolvedValue(null),
  logout: vi.fn(),
  login: vi.fn(),
}));

describe('RouteGuard', () => {
  it('redirects to /login when /auth/me returns null', async () => {
    render(
      <MemoryRouter initialEntries={['/devices']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div>LOGIN</div>} />
            <Route path="*" element={<RouteGuard><div>SHELL</div></RouteGuard>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('LOGIN')).toBeInTheDocument());
  });
});
```

Run:

```
cd web && npx vitest run src/auth/auth.smoke.test.tsx
```
Expected: 1 passing.

- [ ] **Step 4: Commit**

```
git add web/src/App.tsx web/src/routes/index.tsx web/src/auth/auth.smoke.test.tsx
git commit -m "feat(web): wire /login, /profile, route guard; demote ApiKeyGate

Unauthenticated routes (/login, /api-key-gate) sit outside the guard.
Everything else is wrapped in RouteGuard, which redirects to /login on
401 from /auth/me. ApiKeyGate is no longer the default entry point.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 25: Integration — rate limit, profile tokens, legacy compat, migration

**Files:**
- Create: `test/integration/auth-rate-limit.spec.ts`
- Create: `test/integration/profile-tokens.spec.ts`
- Create: `test/integration/legacy-key-compat.spec.ts`
- Create: `test/integration/migration.spec.ts`

- [ ] **Step 1: rate limit**

```ts
// test/integration/auth-rate-limit.spec.ts
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authPublicRouter } from '../../src/app/routers/auth';

describe('login rate limit', function () {
  this.timeout(15_000);

  it('5 bad logins from one IP → 6th returns 429 with Retry-After', async () => {
    const app = express();
    app.use(express.json());
    app.use('/auth', authPublicRouter());

    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/auth/login')
        .set('X-Forwarded-For', '9.9.9.9')
        .send({ email: 'no@no.com', password: 'no' });
      expect(r.status).to.equal(401);
    }
    const blocked = await request(app).post('/auth/login')
      .set('X-Forwarded-For', '9.9.9.9')
      .send({ email: 'no@no.com', password: 'no' });
    expect(blocked.status).to.equal(429);
    expect(blocked.headers['retry-after']).to.match(/^\d+$/);
  });
});
```

- [ ] **Step 2: profile tokens (full flow against real DB)**

```ts
// test/integration/profile-tokens.spec.ts
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { profileRouter } from '../../src/app/routers/profile';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { prisma } from '../../src/prisma';

describe('profile/tokens (integration)', function () {
  this.timeout(30_000);
  let user: any; let cookie: string;

  before(async () => {
    user = await Container.get(UserService).createUser({
      email: 'tokens-it@xenon.local', name: 'Tokens IT', password: 'tokens-12', role: 'ADMIN',
    });
    const session = await Container.get(UserSessionService).create(user.id);
    cookie = `xenon_dashboard_session=${session.id}`;
  });
  after(async () => {
    await prisma.apiKey.deleteMany({ where: { userId: user.id } });
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('creates and lists a token; rotating accessKey keeps the token valid', async () => {
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    app.use('/profile', profileRouter());

    const created = await request(app).post('/profile/tokens').set('Cookie', cookie).send({ name: 'CI' });
    expect(created.status).to.equal(201);
    const token = created.body.token as string;

    const list = await request(app).get('/profile/tokens').set('Cookie', cookie);
    expect(list.body.length).to.equal(1);

    // Use the token via header (accessKey + token).
    const me = await request(app).get('/profile/access-key').set('Cookie', cookie);
    const ak = me.body.accessKey;
    const headerCheck = await request(app).get('/profile/tokens')
      .set('x-xenon-access-key', ak).set('x-xenon-token', token);
    expect(headerCheck.status).to.equal(200);

    // Rotate accessKey, then ensure the same token still resolves with the new one.
    const rotated = await request(app).post('/profile/access-key/rotate').set('Cookie', cookie);
    const newAk = rotated.body.accessKey;
    expect(newAk).to.not.equal(ak);
    const afterRotate = await request(app).get('/profile/tokens')
      .set('x-xenon-access-key', newAk).set('x-xenon-token', token);
    expect(afterRotate.status).to.equal(200);

    // Old accessKey + same token → 401
    const oldFails = await request(app).get('/profile/tokens')
      .set('x-xenon-access-key', ak).set('x-xenon-token', token);
    expect(oldFails.status).to.equal(401);
  });
});
```

- [ ] **Step 3: legacy compat**

```ts
// test/integration/legacy-key-compat.spec.ts
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';

describe('legacy x-xenon-api-key compatibility', function () {
  this.timeout(30_000);
  let user: any; let raw: string;
  before(async () => {
    user = await Container.get(UserService).createUser({
      email: 'legacy-it@xenon.local', name: 'Legacy IT', password: 'leg-test-12', role: 'ADMIN',
    });
    const k = await Container.get(ApiKeyService).create({
      name: 'legacy', scopes: ['admin'], userId: user.id,
    });
    raw = k.raw;
  });
  after(async () => {
    await prisma.apiKey.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('flag on → x-xenon-api-key works', async () => {
    (config as any).acceptLegacyKey = true;
    const app = express();
    app.use(authMiddleware);
    app.get('/x', (req, res) => res.json(req.auth));
    const r = await request(app).get('/x').set('x-xenon-api-key', raw);
    expect(r.status).to.equal(200);
    expect(r.body.userId).to.equal(user.id);
  });
  it('flag off → x-xenon-api-key 401s', async () => {
    (config as any).acceptLegacyKey = false;
    const app = express();
    app.use(authMiddleware);
    app.get('/x', (req, res) => res.json(req.auth));
    const r = await request(app).get('/x').set('x-xenon-api-key', raw);
    expect(r.status).to.equal(401);
    (config as any).acceptLegacyKey = true; // restore
  });
});
```

- [ ] **Step 4: migration idempotency**

```ts
// test/integration/migration.spec.ts
import { expect } from 'chai';
import { bootstrapIdentity } from '../../src/services/identity/bootstrap';
import { prisma } from '../../src/prisma';

describe('bootstrapIdentity idempotency (integration)', function () {
  this.timeout(30_000);

  it('running twice does not create duplicate users', async () => {
    const before = await prisma.user.count();
    await bootstrapIdentity();
    const after1 = await prisma.user.count();
    await bootstrapIdentity();
    const after2 = await prisma.user.count();
    expect(after2).to.equal(after1);
    expect(after1).to.be.greaterThanOrEqual(before);
  });
});
```

- [ ] **Step 5: Run them all**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/integration/auth-flow.spec.ts test/integration/auth-rate-limit.spec.ts test/integration/profile-tokens.spec.ts test/integration/legacy-key-compat.spec.ts test/integration/migration.spec.ts
```

- [ ] **Step 6: Commit**

```
git add test/integration/auth-rate-limit.spec.ts test/integration/profile-tokens.spec.ts test/integration/legacy-key-compat.spec.ts test/integration/migration.spec.ts
git commit -m "test(integration): rate limit, profile tokens, legacy compat, migration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 26: WebDriver capability — accept `df:options.accessKey` + `df:options.token`

**Files:**
- Modify: `src/XenonCapabilityManager.ts`
- Modify: `src/services/SessionLifecycleService.ts`

> **Why:** the spec requires that WebDriver session creation accepts the docs-faithful pair `df:options.{accessKey, token}`. Today only the single-secret `xenon:accessKey` (and `xe:`/`appium:` variants) is recognized. We add a new extractor that returns *both* the accessKey and the token, then teach `authorizeSessionRequest` to verify the pair.

- [ ] **Step 1: Add `extractAccessKeyTokenPair()` to `XenonCapabilityManager.ts`**

After the existing `extractAccessKeyCap` (around line 172), add:

```ts
// Returns the (accessKey, token) pair from df:options.{accessKey,token} or
// equivalently df:options.{access_key,token}. Returns undefined if either
// piece is missing — callers fall back to extractAccessKeyCap (legacy).
export function extractAccessKeyTokenPair(
  caps: ISessionCapability,
): { accessKey: string; token: string } | undefined {
  const merged = Object.assign({}, caps.firstMatch?.[0] || {}, caps.alwaysMatch || {});
  const dfOptions =
    merged['df:options'] ??
    merged['xenon:df:options'] ??
    merged['appium:df:options'];
  if (!dfOptions || typeof dfOptions !== 'object') return undefined;
  const accessKey = (dfOptions as any).accessKey ?? (dfOptions as any).access_key;
  const token     = (dfOptions as any).token;
  if (typeof accessKey !== 'string' || typeof token !== 'string') return undefined;
  if (!accessKey || !token) return undefined;
  return { accessKey, token };
}
```

- [ ] **Step 2: Update `SessionLifecycleService.authorizeSessionRequest`**

In `src/services/SessionLifecycleService.ts`, around line 196, replace the existing extraction block:

```ts
const raw = extractAccessKeyCap(caps);
if (!raw) {
  this.logger.warn(...);
  return { apiKeyId: null, callerTeamId: null, scoped: false };
}

const { ApiKeyService } = await import('./ApiKeyService');
const svc = Container.get(ApiKeyService);
const row = await svc.verify(raw);
```

with:

```ts
const { ApiKeyService } = await import('./ApiKeyService');
const svc = Container.get(ApiKeyService);

// Path 1: df:options.{accessKey, token} pair (docs-faithful).
const pair = extractAccessKeyTokenPair(caps);
let row = pair ? await svc.verifyPair(pair.accessKey, pair.token) : null;

// Path 2: legacy xenon:accessKey (single secret) — only if back-compat is on
// AND the pair path didn't already authenticate.
if (!row && xenonConfig.acceptLegacyKey) {
  const raw = extractAccessKeyCap(caps);
  if (raw) row = await svc.verify(raw);
}

if (!row) {
  this.logger.warn(
    'Session created without valid credentials. Pass `df:options.accessKey` + `df:options.token` (preferred) or `xenon:accessKey` (legacy).',
  );
  return { apiKeyId: null, callerTeamId: null, scoped: false };
}
if (!svc.hasScope(row, ['sessions'])) {
  this.logger.error('Rejecting session: credentials lack the `sessions` scope');
  throw new appiumErrors.InvalidArgumentError(
    'credentials are invalid, revoked, or lack the `sessions` scope',
  );
}
```

Update the import in `SessionLifecycleService.ts` (line 35-36) to include the new helper:

```ts
import {
  extractAccessKeyCap,
  extractTeamCap,
  extractAccessKeyTokenPair,
} from '../XenonCapabilityManager';
```

- [ ] **Step 3: Add a unit test**

```ts
// test/unit/extract-access-key-token-pair.test.ts
import { expect } from 'chai';
import { extractAccessKeyTokenPair } from '../../src/XenonCapabilityManager';

describe('extractAccessKeyTokenPair', () => {
  it('returns the pair when df:options has both', () => {
    const r = extractAccessKeyTokenPair({
      alwaysMatch: { 'df:options': { accessKey: 'xen_abc', token: 'tok' } },
    } as any);
    expect(r).to.deep.equal({ accessKey: 'xen_abc', token: 'tok' });
  });
  it('returns undefined when token is missing', () => {
    const r = extractAccessKeyTokenPair({
      alwaysMatch: { 'df:options': { accessKey: 'xen_abc' } },
    } as any);
    expect(r).to.be.undefined;
  });
  it('returns undefined when df:options is absent', () => {
    const r = extractAccessKeyTokenPair({ alwaysMatch: {} } as any);
    expect(r).to.be.undefined;
  });
});
```

- [ ] **Step 4: Run**

```
npx mocha --require ts-node/register --timeout 30000 test/unit/extract-access-key-token-pair.test.ts
```
Expected: 3 passing.

- [ ] **Step 5: Commit**

```
git add src/XenonCapabilityManager.ts src/services/SessionLifecycleService.ts test/unit/extract-access-key-token-pair.test.ts
git commit -m "feat(session): accept df:options.accessKey + df:options.token

WebDriver clients can now authenticate sessions with the docs-faithful
(accessKey, token) pair. Legacy xenon:accessKey (single secret) is still
accepted when XENON_ACCEPT_LEGACY_KEY=true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 27: Manual verification

**Files:** none — this task is about running the system.

- [ ] **Step 1: Build everything and start the dev loop**

```
npm run dev
```

Wait for "Started Xenon" or equivalent log line.

- [ ] **Step 2: Verify each scenario from the spec**

In a browser at `http://localhost:4723/xenon/`:

1. The first navigation redirects to `/login`.
2. Sign in with `admin@xenon.local` / `Admin@123` → land on `/overview`.
3. Open the user dropdown in the header → click **Profile** → land on `/profile`.
4. **Password & Authentication** tab → enter current password, new password, confirm → click Update → see green confirmation.
5. **API Tokens** tab → click **Generate New Token** → enter "manual-test" → Create → secret modal appears once → click Done → row appears in the table.
6. From a terminal, exercise the (accessKey, token) pair:
   ```
   curl -i -H "x-xenon-access-key: <accessKey from /profile>" -H "x-xenon-token: <token from modal>" http://localhost:4723/xenon/api/devices
   ```
   Expected: 200.
7. Click **Logout** in the header dropdown → land on `/login`.
8. Try 6 bad logins fast — the 6th should respond 429.
9. After 5 minutes (or restart the server), bad-login bucket clears.

- [ ] **Step 3: Capture findings**

If anything fails, fix in the appropriate task and re-run. If everything passes, no commit needed for this task.

- [ ] **Step 4: Final cleanup commit**

If any small README/CLAUDE.md updates surfaced during manual verification, capture them now:

```
git add -A
git diff --cached --stat
git commit -m "docs(auth): notes from manual verification" || echo "no changes"
```

---

## Self-Review Checklist (pre-merge)

Run through this before opening the PR:

- [ ] Spec section 4 (Frontend) — `/login`, `/profile`, header dropdown, route guard, ApiKeyGate demoted: **all touched in tasks 19–24**.
- [ ] Spec section 5 (Operational) — bootstrap, reset env var, rate limit, session TTL, env vars: **tasks 11, 15, 17**.
- [ ] Spec section 3 (API surface) — every endpoint in the table: **tasks 13, 14**.
- [ ] Spec section 3 (WebDriver capabilities) — `df:options.{accessKey,token}` accepted; `xenon:accessKey` legacy-gated: **task 26**.
- [ ] Spec section 2 (Data model) — User, UserSession, ApiKey.userId: **tasks 2, 16**.
- [ ] Role → scopes derivation table — used in `scopesForRole()` (Task 9) and in profile token creation (Task 14).
- [ ] No backend route writes a password to logs.
- [ ] Generic 401 on bad credentials *and* unknown email (Task 13 explicitly tests both).
- [ ] Cookie set with `httpOnly`, `secure` (when proto allows), `sameSite=strict` (Task 13).
- [ ] `change-password` deletes other sessions (Task 13).
- [ ] `accessKey rotate` keeps tokens valid (Task 25 integration test).
- [ ] Migration idempotent (Task 25 integration test).
- [ ] Hourly session cleanup runs (Task 17, no test — accepted because it's a 5-line wrapper).

---

## Out of scope for this plan (deferred to later phases)

- Role enforcement on every route (Phase 2). `scopeGuard` is unchanged here.
- User CRUD UI (`/users`) — Phase 3.
- Team-membership join table + manage-members UI — Phase 3.
- Per-node `(accessKey, token)` for hub-node channel — Phase 4.
- Sidebar / menu-items parity with docs — Phase 5.
- Password reset via email, 2FA, OAuth/SSO — separate workstreams.
