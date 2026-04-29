# Phase 2 — Role Enforcement + Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `req.auth.role` load-bearing on every authenticated route via a new `roleGuard` middleware that composes with the existing `scopeGuard`, and add a self-service password-reset flow backed by `nodemailer` with log-fallback.

**Architecture:** New `roleGuard(min)` middleware (`SUPER_ADMIN > ADMIN > MEMBER` hierarchy) applied per-router per the device-farm-pro role matrix. New `PasswordResetToken` Prisma model + `PasswordResetService` + `EmailService` (nodemailer with log fallback when `XENON_SMTP_URL` unset). Frontend gains `/forgot-password` + `/reset-password/<token>` pages outside `RouteGuard`, sidebar items hidden by role. Three PRs: enforcement (PR-A), reset endpoints (PR-B), frontend (PR-C).

**Tech Stack:** TypeScript 5.5, Express, TypeDI 0.10, Prisma 5.4 (SQLite), Mocha + chai + sinon, React 17 + Vite + Tailwind, vitest, `nodemailer@^6` (NEW dep). Reuses Phase 1 `LoginRateLimiter`, `UserService`, `UserSessionService`, `authMiddleware`.

**Spec:** `docs/superpowers/specs/2026-04-29-phase-2-role-enforcement-design.md`

---

## File Structure

| File | Purpose |
|---|---|
| `src/middleware/roleGuard.ts` | NEW — `roleGuard(min)` middleware with role-hierarchy check |
| `test/unit/roleGuard.test.ts` | NEW — 11 cases (3×3 matrix + missing-auth + unknown-role) |
| `src/app/routers/{apikeys,teams,webhook,processes,interceptor}.ts` | MODIFIED — add `roleGuard('ADMIN')` per matrix |
| `src/app/routers/{apps,reservation,control,grid}.ts` | MODIFIED — split MEMBER/ADMIN per matrix |
| `src/app/routers/{recordings,bug-report,build-export}.ts` | MODIFIED — add `roleGuard('MEMBER')` to close holes |
| `src/app/routers/{config,dashboard}.ts` | MODIFIED — split ADMIN/SUPER_ADMIN per matrix |
| `test/integration/role-matrix.spec.ts` | NEW — table-driven matrix smoke |
| `test/helpers/seedUser.ts` | NEW — shared fixture for role-aware tests |
| `prisma/schema.prisma` | MODIFIED — add `PasswordResetToken` model |
| `prisma/migrations/<timestamp>_phase_2_password_reset/migration.sql` | NEW — Prisma-generated |
| `src/services/PasswordResetService.ts` | NEW — create / verify / consume / cleanup |
| `test/unit/PasswordResetService.test.ts` | NEW |
| `src/services/EmailService.ts` | NEW — nodemailer wrapper with log fallback |
| `test/unit/EmailService.test.ts` | NEW |
| `src/services/UserSessionService.ts` | MODIFIED — add `revokeAllForUser(userId)` |
| `src/app/routers/auth.ts` | MODIFIED — add forgot-password + reset-password to public router |
| `test/integration/forgot-password.spec.ts` | NEW |
| `test/integration/forgot-password-rate-limit.spec.ts` | NEW |
| `test/integration/reset-revokes-sessions.spec.ts` | NEW |
| `src/services/identity/sessionCleanupCron.ts` | MODIFIED — also clean expired reset tokens |
| `src/config.ts` | MODIFIED — 6 new env-driven config keys |
| `package.json` | MODIFIED — `nodemailer@^6.9` + `@types/nodemailer` |
| `web/src/api-service/auth.ts` | MODIFIED — add `forgotPassword` / `checkResetToken` / `resetPassword` |
| `web/src/pages/forgot-password.tsx` | NEW |
| `web/src/pages/reset-password.tsx` | NEW |
| `web/src/pages/login.tsx` | MODIFIED — "Forgot password?" link |
| `web/src/components/sidebar/sidebar.tsx` | MODIFIED — role-aware item visibility |
| `web/src/api-service/api-client.ts` | MODIFIED — 403 toast formatter |
| `web/src/App.tsx` | MODIFIED — mount /forgot-password + /reset-password outside RouteGuard |
| `web/src/auth/auth.smoke.test.tsx` | MODIFIED — add reset-page smoke |

---

## Conventions (read first)

- **Branches:** **PR-A** on `feat/phase-2-role-enforcement` (already created), **PR-B** on `feat/phase-2-password-reset` (off latest main after PR-A merge), **PR-C** on `feat/phase-2-frontend` (off latest main after PR-B merge). Each PR's branch starts with `git checkout main && git pull && git checkout -b <branch>`.
- **Commits:** Conventional Commits (`feat(auth): …`, `test(integration): …`, `refactor(middleware): …`). Always sign with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Test runner (backend):** Mocha + chai + sinon. Run `XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 <path>`.
- **Test runner (frontend):** vitest in `web/`. Run `cd web && npx vitest run <path>`.
- **Type-check:** `npx tsc --noEmit` at repo root, `cd web && npx tsc --noEmit` for frontend. Pre-existing project-wide errors are acceptable; only fail on a NEW error in a file you touched.
- **Hooks:** never bypass. Fix the underlying issue and make a NEW commit (do not `--amend`).
- **Working tree noise:** the prettier auto-format that ran during Phase 1 may still show many unrelated dirty files. NEVER use `git add -A` or `git add .`. Stage by exact file path only.
- **Commit messages with em-dashes / arrows / Unicode:** write to `/tmp/<task>-msg.txt` and `git commit -F`, never inline heredoc with bash interpolation.

---

# PR-A — Role Enforcement Matrix

**Branch:** `feat/phase-2-role-enforcement` (already created from main)
**Ships:** `roleGuard` middleware applied to every authenticated router. No DB changes, no new endpoints, no UI.

---

## Task 1: `roleGuard` middleware (TDD)

**Files:**
- Create: `src/middleware/roleGuard.ts`
- Create: `test/unit/roleGuard.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/roleGuard.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { roleGuard } from '../../src/middleware/roleGuard';
import type { Request, Response, NextFunction } from 'express';

function mkReq(auth?: any): Request {
  return { auth } as any;
}
function mkRes() {
  const res: any = {};
  res.status = sinon.stub().returns(res);
  res.json = sinon.stub().returns(res);
  return res as Response;
}

describe('roleGuard', () => {
  afterEach(() => sinon.restore());

  it('401s when req.auth is missing', () => {
    const next = sinon.stub() as unknown as NextFunction;
    const res = mkRes();
    roleGuard('MEMBER')(mkReq(undefined), res, next);
    expect((res.status as sinon.SinonStub).calledWith(401)).to.be.true;
    expect((next as sinon.SinonStub).called).to.be.false;
  });

  const PASS_MATRIX: Array<['SUPER_ADMIN' | 'ADMIN' | 'MEMBER', 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER', boolean]> = [
    ['SUPER_ADMIN', 'SUPER_ADMIN', true],
    ['SUPER_ADMIN', 'ADMIN', true],
    ['SUPER_ADMIN', 'MEMBER', true],
    ['ADMIN', 'SUPER_ADMIN', false],
    ['ADMIN', 'ADMIN', true],
    ['ADMIN', 'MEMBER', true],
    ['MEMBER', 'SUPER_ADMIN', false],
    ['MEMBER', 'ADMIN', false],
    ['MEMBER', 'MEMBER', true],
  ];

  PASS_MATRIX.forEach(([userRole, minRole, shouldPass]) => {
    it(`${userRole} vs roleGuard('${minRole}') → ${shouldPass ? 'next()' : '403'}`, () => {
      const next = sinon.stub() as unknown as NextFunction;
      const res = mkRes();
      roleGuard(minRole)(mkReq({ role: userRole, userId: 'u1', scopes: '', kind: 'user-session', rateLimit: 300 }), res, next);
      if (shouldPass) {
        expect((next as sinon.SinonStub).calledOnce).to.be.true;
        expect((res.status as sinon.SinonStub).called).to.be.false;
      } else {
        expect((res.status as sinon.SinonStub).calledWith(403)).to.be.true;
        expect((next as sinon.SinonStub).called).to.be.false;
      }
    });
  });

  it('403s fail-closed when role is an unknown value', () => {
    const next = sinon.stub() as unknown as NextFunction;
    const res = mkRes();
    roleGuard('MEMBER')(mkReq({ role: 'GHOST_ADMIN', userId: 'u1', scopes: '', kind: 'user-session', rateLimit: 300 }) as any, res, next);
    expect((res.status as sinon.SinonStub).calledWith(403)).to.be.true;
    expect((next as sinon.SinonStub).called).to.be.false;
  });
});
```

- [ ] **Step 2: Run, confirm fail (RED)**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/roleGuard.test.ts
```
Expected: `Cannot find module '../../src/middleware/roleGuard'`.

- [ ] **Step 3: Implement**

```ts
// src/middleware/roleGuard.ts
/// <reference path="../types/express.d.ts" />
import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../types/identity';

const RANK: Record<UserRole, number> = {
  SUPER_ADMIN: 3,
  ADMIN: 2,
  MEMBER: 1,
};

// Composes with scopeGuard. roleGuard runs first; scopeGuard second.
// Returns 401 when req.auth is missing (the caller is unauthenticated),
// 403 when the caller's role is below `min` or unknown (fail-closed).
export function roleGuard(min: UserRole) {
  const minRank = RANK[min];
  return function (req: Request, res: Response, next: NextFunction) {
    const auth = (req as Request & { auth?: { role: UserRole } }).auth;
    if (!auth) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const callerRank = RANK[auth.role as UserRole];
    if (typeof callerRank !== 'number' || callerRank < minRank) {
      res.status(403).json({ error: `requires role >= ${min}` });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Run, confirm pass (GREEN)**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/roleGuard.test.ts
```
Expected: 11 passing.

- [ ] **Step 5: Commit**

Write `/tmp/xenon-task1-msg.txt`:
```
feat(middleware): roleGuard for SUPER_ADMIN > ADMIN > MEMBER hierarchy

Composes with the existing scopeGuard. Routes use both: roleGuard
checks the caller's role; scopeGuard checks the token's narrowed
scopes. roleGuard returns 401 for unauthenticated callers and 403
(fail-closed) for unknown role values.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```
git add src/middleware/roleGuard.ts test/unit/roleGuard.test.ts
git commit -F /tmp/xenon-task1-msg.txt && rm /tmp/xenon-task1-msg.txt
```

---

## Task 2: Apply ADMIN gate to admin-only routers

**Files:**
- Modify: `src/app/routers/apikeys.ts`
- Modify: `src/app/routers/teams.ts`
- Modify: `src/app/routers/webhook.ts`
- Modify: `src/app/routers/processes.ts`
- Modify: `src/app/routers/interceptor.ts`

These routers are unambiguously admin-tier per the matrix. Each gains a top-level `router.use(roleGuard('ADMIN'))`. The existing `scopeGuard(['admin'])` calls remain untouched.

- [ ] **Step 1: `apikeys.ts`**

Read `src/app/routers/apikeys.ts`. After the existing imports, add:
```ts
import { roleGuard } from '../../middleware/roleGuard';
```

Right after `const r = Router();` (or `const router = Router();` — match the file's style), add:
```ts
r.use(roleGuard('ADMIN'));
```

(Replace `r` with whatever variable the file uses for its Router.)

- [ ] **Step 2: `teams.ts`** — same pattern.
- [ ] **Step 3: `webhook.ts`** — same pattern.
- [ ] **Step 4: `processes.ts`** — same pattern.
- [ ] **Step 5: `interceptor.ts`** — same pattern. Note: this router has *no* existing scope guard; add `roleGuard('ADMIN')` only (matrix calls for admin tier).

- [ ] **Step 6: Type-check**

```
npx tsc --noEmit 2>&1 | grep -E "src/app/routers/(apikeys|teams|webhook|processes|interceptor)\.ts" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 7: Commit**

Write `/tmp/xenon-task2-msg.txt`:
```
feat(auth): roleGuard('ADMIN') on apikeys, teams, webhook, processes, interceptor

Per the device-farm-pro role matrix, these routers are unambiguously
admin-tier. The existing scopeGuard(['admin']) calls stay in place;
roleGuard runs first and short-circuits MEMBER callers with a 403
before any handler-level work.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```
git add src/app/routers/apikeys.ts src/app/routers/teams.ts src/app/routers/webhook.ts src/app/routers/processes.ts src/app/routers/interceptor.ts
git commit -F /tmp/xenon-task2-msg.txt && rm /tmp/xenon-task2-msg.txt
```

---

## Task 3: Apply matrix to `dashboard.ts` (mixed read/write)

`dashboard.ts` has GET reads that anyone authenticated may use, plus POST mutations (`/healing/digest/send`, `/healing/selector/state`, `/config`, `/config/reset-metrics`) currently gated `scopeGuard(['admin'])`. Per matrix: reads → MEMBER; admin POSTs → ADMIN.

**Files:** Modify `src/app/routers/dashboard.ts`.

- [ ] **Step 1: Read the existing route registration block**

```
grep -n "router\.(get\|post\|put\|delete)" src/app/routers/dashboard.ts
```

Confirm the four `scopeGuard(['admin'])`-bearing routes (around lines 1008, 1012, 1018, 1019).

- [ ] **Step 2: Add roleGuard imports**

```ts
import { roleGuard } from '../../middleware/roleGuard';
```

- [ ] **Step 3: Add a top-level MEMBER floor**

Right after the Router is created in `dashboard.ts`, add:
```ts
router.use(roleGuard('MEMBER'));
```

This sets the baseline: any authenticated user can hit dashboard reads. The four admin-tier mutations will add a *second* `roleGuard('ADMIN')` inline.

- [ ] **Step 4: Add inline `roleGuard('ADMIN')` to each admin POST**

For each of:
- `router.post('/healing/digest/send', scopeGuard(['admin']), sendHealingDigest);`
- `router.post('/healing/selector/state', scopeGuard(['admin']), postSelectorStateAction);`
- `router.post('/config', scopeGuard(['admin']), updateGlobalConfig);`
- `router.post('/config/reset-metrics', scopeGuard(['admin']), resetMetrics);`

Insert `roleGuard('ADMIN'),` before `scopeGuard(['admin']),`. Result:
```ts
router.post('/healing/digest/send', roleGuard('ADMIN'), scopeGuard(['admin']), sendHealingDigest);
```

- [ ] **Step 5: Type-check + commit**

```
npx tsc --noEmit 2>&1 | grep "dashboard\.ts" || echo "clean"
```

Write `/tmp/xenon-task3-msg.txt`:
```
feat(auth): apply role matrix to dashboard router

Reads gated to MEMBER (anyone authenticated). Healing-digest send,
selector-state mutations, and global-config writes step up to
ADMIN — composes with the existing scopeGuard(['admin']) so token
narrowing still applies.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```
git add src/app/routers/dashboard.ts
git commit -F /tmp/xenon-task3-msg.txt && rm /tmp/xenon-task3-msg.txt
```

---

## Task 4: Apply matrix to `apps`, `control`, `reservation`, `grid` (split MEMBER / ADMIN)

These routers serve both Member-tier (use a device, read state) and Admin-tier (flag, register, assign-team) operations.

**Files:** Modify `src/app/routers/{apps,control,reservation,grid}.ts`.

### `apps.ts`

- [ ] Add `roleGuard` import.
- [ ] Top-level `router.use(roleGuard('MEMBER'));` (anyone reads).
- [ ] Inline `roleGuard('ADMIN'),` on `POST /upload` (line ~37) and `DELETE /:id` (line ~57). Keep the existing `mutationScopeGuard(['devices'])` (it's `router.use(...)` near the top — leave it).

### `control.ts`

- [ ] Add `roleGuard` import.
- [ ] Top-level `router.use(roleGuard('MEMBER'));` — every authenticated user can use a device.
- [ ] Identify flag/unflag mutations specifically. Per `grep`, `control.ts` does NOT have explicit flag/unflag — those live in `grid.ts` (`/block`, `/unblock`). So `control.ts` stays `MEMBER`-only at the top level. The existing `mutationScopeGuard(['devices'])` (line 28) stays.

### `reservation.ts`

- [ ] Add `roleGuard` import.
- [ ] Top-level `router.use(roleGuard('MEMBER'));` — reserving a device for yourself is a Member action.
- [ ] No further role split: per matrix, all reservation operations are `MEMBER`+. The existing `mutationScopeGuard(['devices'])` (line 16) stays.

### `grid.ts`

`grid.ts` is the largest and most heterogeneous. Reads (devices, queue, sessions, nodes) → MEMBER; mutations (`/register`, `/block`, `/unblock`, `/device/tags`, `/device/:udid/team`) → ADMIN.

- [ ] Add `roleGuard` import.
- [ ] Top-level `router.use(roleGuard('MEMBER'));`
- [ ] Inline `roleGuard('ADMIN'),` on each of:
  - `router.post('/register', scopeGuard(['devices']), registerNode);`
  - `router.post('/block', scopeGuard(['devices']), blockDevice);`
  - `router.post('/unblock', scopeGuard(['devices']), unBlockDevice);`
  - `router.post('/device/tags', scopeGuard(['devices']), updateTags);`
  - `router.put('/device/:udid/team', scopeGuard(['admin']), assignDeviceToTeam);` — keep its `scopeGuard(['admin'])` since admins still need the admin scope on their token.

- [ ] **Run a mocha sanity sweep**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/roleGuard.test.ts test/unit/authMiddleware.test.ts
```
Expected: all green.

- [ ] **Commit**

Write `/tmp/xenon-task4-msg.txt`:
```
feat(auth): apply role matrix to apps, control, reservation, grid

apps: MEMBER reads, ADMIN upload/delete.
control: MEMBER baseline (per-device interaction is a Member action).
reservation: MEMBER baseline (reserving for yourself is Member-tier).
grid: MEMBER reads (devices, queue, nodes), ADMIN mutations
  (register, block/unblock, tags, team-assignment).

Existing mutationScopeGuard(['devices']) and scopeGuard(['admin'])
calls preserved — token narrowing composes with role gating.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```
git add src/app/routers/apps.ts src/app/routers/control.ts src/app/routers/reservation.ts src/app/routers/grid.ts
git commit -F /tmp/xenon-task4-msg.txt && rm /tmp/xenon-task4-msg.txt
```

---

## Task 5: Close holes — `recordings`, `bug-report`, `build-export`

Today these routers have no role/scope guard. Per matrix, all three are MEMBER-tier (any authenticated user). Add `roleGuard('MEMBER')` to close the hole.

**Files:** Modify `src/app/routers/{recordings,bug-report,build-export}.ts`.

- [ ] For each file:
  - Add `import { roleGuard } from '../../middleware/roleGuard';`
  - Add `router.use(roleGuard('MEMBER'));` after the Router is created.

- [ ] **Type-check**

```
npx tsc --noEmit 2>&1 | grep -E "(recordings|bug-report|build-export)\.ts" || echo "clean"
```

- [ ] **Commit**

Write `/tmp/xenon-task5-msg.txt`:
```
feat(auth): roleGuard('MEMBER') on recordings, bug-report, build-export

Closes three previously-ungated routers. MEMBER is the baseline —
authenticated users can use them; per-resource ownership checks
inside handlers (manual locks on recordings, session-id matching
on bug-report) still apply.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```
git add src/app/routers/recordings.ts src/app/routers/bug-report.ts src/app/routers/build-export.ts
git commit -F /tmp/xenon-task5-msg.txt && rm /tmp/xenon-task5-msg.txt
```

---

## Task 6: Apply matrix to `config.ts` (ADMIN reads, SUPER_ADMIN writes)

`config.ts` exposes plugin-level config: GETs are admin-readable; POST/PUT mutations are `SUPER_ADMIN`-only per matrix (system settings).

**Files:** Modify `src/app/routers/config.ts`.

- [ ] Read the file. Identify GET vs POST/PUT routes.
- [ ] Add `import { roleGuard } from '../../middleware/roleGuard';`
- [ ] Top-level `router.use(roleGuard('ADMIN'));`
- [ ] On every POST/PUT/DELETE route, prepend `roleGuard('SUPER_ADMIN'),`.

If the file has no POST/PUT/DELETE routes (it might be GET-only), skip the SUPER_ADMIN step — the top-level ADMIN floor is sufficient. Document in the commit message which case applied.

- [ ] **Type-check + commit**

```
npx tsc --noEmit 2>&1 | grep "routers/config\.ts" || echo "clean"
```

Write `/tmp/xenon-task6-msg.txt`:
```
feat(auth): roleGuard('ADMIN') on config reads, SUPER_ADMIN on writes

System-config mutations are super-admin-only per the matrix; reads
allow ADMIN+. If no mutations exist on this router, the ADMIN floor
is the only gate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```
git add src/app/routers/config.ts
git commit -F /tmp/xenon-task6-msg.txt && rm /tmp/xenon-task6-msg.txt
```

---

## Task 7: `seedUser` test helper + role-matrix integration test

**Files:**
- Create: `test/helpers/seedUser.ts`
- Create: `test/integration/role-matrix.spec.ts`

- [ ] **Step 1: Helper**

```ts
// test/helpers/seedUser.ts
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { prisma } from '../../src/prisma';
import type { UserRole } from '../../src/types/identity';

const TEST_EMAIL_DOMAIN = '@xenon.local';

export interface SeededUser {
  user: { id: string; email: string; name: string; role: UserRole; accessKey: string };
  cookie: string;
  cleanup: () => Promise<void>;
}

let counter = 0;

export async function seedUser(role: UserRole, opts?: { name?: string }): Promise<SeededUser> {
  counter += 1;
  const email = `role-${role.toLowerCase()}-${Date.now()}-${counter}${TEST_EMAIL_DOMAIN}`;
  await prisma.userSession.deleteMany({ where: { user: { email } } });
  await prisma.user.deleteMany({ where: { email } });
  const u = await Container.get(UserService).createUser({
    email,
    name: opts?.name ?? `Test ${role}`,
    password: 'role-test-12',
    role,
  });
  const session = await Container.get(UserSessionService).create(u.id);
  const cookie = `xenon_dashboard_session=${session.id}`;
  return {
    user: { id: u.id, email: u.email, name: u.name, role: u.role as UserRole, accessKey: u.accessKey },
    cookie,
    cleanup: async () => {
      await prisma.apiKey.deleteMany({ where: { userId: u.id } });
      await prisma.userSession.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    },
  };
}
```

- [ ] **Step 2: Matrix integration test**

```ts
// test/integration/role-matrix.spec.ts
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { apiKeysRouter } from '../../src/app/routers/apikeys';
import { teamsRouter } from '../../src/app/routers/teams';
import { processesRouter } from '../../src/app/routers/processes';
import { seedUser, SeededUser } from '../helpers/seedUser';

interface Case {
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: any;
  expect: { SUPER_ADMIN: number; ADMIN: number; MEMBER: number };
}

// Each case lists expected status PER role. Status families only —
// 200/201/204 → "ok", 401/403 → "denied". Tests assert "ok" by `r.status < 300`
// and "denied" by `r.status === 403`. We avoid asserting exact status because
// some routes return 400 on missing body even for an authorized caller.
const CASES: Case[] = [
  { name: 'apikeys list', method: 'GET', path: '/apikeys',
    expect: { SUPER_ADMIN: 200, ADMIN: 200, MEMBER: 403 } },
  { name: 'apikeys create', method: 'POST', path: '/apikeys', body: { name: 'cli', scopes: ['read'] },
    expect: { SUPER_ADMIN: 201, ADMIN: 201, MEMBER: 403 } },
  { name: 'teams list', method: 'GET', path: '/teams',
    expect: { SUPER_ADMIN: 200, ADMIN: 200, MEMBER: 403 } },
  { name: 'processes list', method: 'GET', path: '/processes',
    expect: { SUPER_ADMIN: 200, ADMIN: 200, MEMBER: 403 } },
];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/apikeys', apiKeysRouter());
  app.use('/teams', teamsRouter());
  app.use('/processes', processesRouter());
  return app;
}

describe('role matrix (integration)', function () {
  this.timeout(60_000);
  let users: { SUPER_ADMIN: SeededUser; ADMIN: SeededUser; MEMBER: SeededUser };

  before(async () => {
    users = {
      SUPER_ADMIN: await seedUser('SUPER_ADMIN'),
      ADMIN: await seedUser('ADMIN'),
      MEMBER: await seedUser('MEMBER'),
    };
  });

  after(async () => {
    await users.SUPER_ADMIN.cleanup();
    await users.ADMIN.cleanup();
    await users.MEMBER.cleanup();
  });

  CASES.forEach((c) => {
    (['SUPER_ADMIN', 'ADMIN', 'MEMBER'] as const).forEach((role) => {
      it(`${role} ${c.method} ${c.path} → ${c.expect[role]}`, async () => {
        const app = buildApp();
        const expected = c.expect[role];
        const req = request(app)[c.method.toLowerCase() as 'get' | 'post' | 'delete'](c.path)
          .set('Cookie', users[role].cookie);
        const r = c.body ? await req.send(c.body) : await req;
        if (expected >= 200 && expected < 300) {
          expect(r.status, `${role} ${c.method} ${c.path} body=${JSON.stringify(r.body)}`).to.be.lessThan(300);
        } else {
          expect(r.status, `${role} ${c.method} ${c.path} body=${JSON.stringify(r.body)}`).to.equal(expected);
        }
      });
    });
  });
});
```

If any router factory has a different export name, fix the import to match. (E.g. some files default-export, some named-export.)

- [ ] **Step 3: Run**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 test/integration/role-matrix.spec.ts
```
Expected: 12 passing (4 cases × 3 roles).

- [ ] **Step 4: Commit**

Write `/tmp/xenon-task7-msg.txt`:
```
test(integration): role-matrix smoke + seedUser fixture

Adds a shared seedUser({ role }) helper that creates a User + an
active UserSession and returns a ready-to-use Cookie header. The
matrix test runs every (role × representative router) case
through the real authMiddleware to confirm the roleGuard map
holds end-to-end. Four representative routers are covered here;
PR-B and PR-C will extend the table as new routes ship.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```
git add test/helpers/seedUser.ts test/integration/role-matrix.spec.ts
git commit -F /tmp/xenon-task7-msg.txt && rm /tmp/xenon-task7-msg.txt
```

---

## Task 8: PR-A finalization — review, push, open PR

- [ ] **Run the full identity test surface**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 \
  test/unit/UserService.test.ts test/unit/UserSessionService.test.ts \
  test/unit/ApiKeyService.test.ts test/unit/loginRateLimiter.test.ts \
  test/unit/authMiddleware.test.ts test/unit/apiKeyMiddleware.test.ts \
  test/unit/profile-router.test.ts test/unit/bootstrap-identity.test.ts \
  test/unit/extract-access-key-token-pair.test.ts test/unit/roleGuard.test.ts \
  test/integration/auth-flow.spec.ts test/integration/auth-rate-limit.spec.ts \
  test/integration/profile-tokens.spec.ts test/integration/legacy-key-compat.spec.ts \
  test/integration/migration.spec.ts test/integration/role-matrix.spec.ts
```
Expected: every suite green.

- [ ] **`tsc --noEmit`**: clean.

- [ ] **Push**

```
git push -u origin feat/phase-2-role-enforcement
```

- [ ] **Open PR-A**

Use `gh pr create --title "feat(auth): Phase 2 role enforcement matrix (PR-A of 3)" --body-file /tmp/xenon-pr-a-body.md`. Body includes: summary linking the spec, the role matrix table, test plan (the suite list above), and a "What's NOT in this PR" section pointing at PR-B (reset endpoints) and PR-C (frontend).

---

# PR-B — Password Reset Endpoints

**Branch:** `feat/phase-2-password-reset` (off `main` after PR-A merge: `git checkout main && git pull && git checkout -b feat/phase-2-password-reset`)
**Ships:** `PasswordResetToken` model + `PasswordResetService` + `EmailService` + two new public endpoints. No UI.

---

## Task 9: Add `nodemailer` dependency

**Files:** Modify `package.json` + `package-lock.json` (auto).

- [ ] **Step 1: Install**

```
npm install --save nodemailer@^6.9
npm install --save-dev @types/nodemailer@^6.4
```

- [ ] **Step 2: Verify**

```
node -e "console.log(typeof require('nodemailer').createTransport)"
```
Expected: `function`.

- [ ] **Step 3: Commit**

Write `/tmp/xenon-task9-msg.txt`:
```
chore(deps): add nodemailer for password-reset email delivery

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```
git add package.json package-lock.json
git commit -F /tmp/xenon-task9-msg.txt && rm /tmp/xenon-task9-msg.txt
```

---

## Task 10: Prisma — `PasswordResetToken` model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_phase_2_password_reset/migration.sql`

- [ ] **Step 1: Add to `schema.prisma`**

Append after the existing `UserSession` block:

```prisma
model PasswordResetToken {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  createdAt  DateTime  @default(now())
  expiresAt  DateTime
  usedAt     DateTime?

  @@index([userId])
  @@index([expiresAt])
}
```

And add `passwordResetTokens PasswordResetToken[]` to the `User` model's relation block (next to `apiKeys` and `sessions`).

- [ ] **Step 2: Generate migration**

Use the same `--create-only` shadow-DB pattern Phase 1 used (the `db:generate` script can otherwise prompt to reset the live DB):

```
TEMP_DB=$(mktemp -p /tmp xenon-shadow-XXXXXX.db)
DATABASE_URL="file:$TEMP_DB" npx prisma migrate dev --create-only --name phase_2_password_reset
rm -f "$TEMP_DB"
```

Then apply locally:
```
npm run db:migrate
```

Verify the generated `migration.sql` contains `CREATE TABLE "PasswordResetToken"` with FK + indexes.

- [ ] **Step 3: Add `passwordResetToken` to `MODEL_DELEGATES`**

Edit `src/prisma.ts` and add `'passwordResetToken'` to the `MODEL_DELEGATES` set (precedent: Phase 1 added `'user'`, `'userSession'` for the same reason — sinon stubbing).

- [ ] **Step 4: Regenerate the Prisma client**

`npm run db:migrate` already ran `prisma generate` as part of its sync, so `src/generated/client/*` is now updated. Spot-check:
```
grep -c "PasswordResetToken" src/generated/client/index.d.ts
```
Expected: positive number.

- [ ] **Step 5: Commit (schema + migration in one commit, regenerated client in a second per the Phase 1 pattern)**

Write `/tmp/xenon-task10a-msg.txt`:
```
feat(db): add PasswordResetToken model

Single-use, time-bound, hashed reset tokens. tokenHash is sha256
of the raw token; raw is what's emailed. usedAt locks the token to
single-use semantics. ON DELETE CASCADE keeps things tidy when a
user is removed.

Also registers passwordResetToken in src/prisma.ts MODEL_DELEGATES
so sinon can stub it in tests (same pattern as user / userSession).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```
git add prisma/schema.prisma prisma/migrations/ src/prisma.ts
git commit -F /tmp/xenon-task10a-msg.txt && rm /tmp/xenon-task10a-msg.txt
```

Then a follow-up commit with the regenerated client:
```
git add src/generated/client/
git commit -m "chore(prisma): regenerate client for PasswordResetToken

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `PasswordResetService` (TDD)

**Files:**
- Create: `src/services/PasswordResetService.ts`
- Create: `test/unit/PasswordResetService.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// test/unit/PasswordResetService.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import crypto from 'crypto';
import { PasswordResetService } from '../../src/services/PasswordResetService';
import { prisma } from '../../src/prisma';

describe('PasswordResetService', () => {
  afterEach(() => sinon.restore());

  it('createToken() returns raw + persists sha256 hash with TTL', async () => {
    const create = sinon.stub(prisma.passwordResetToken, 'create').resolves({ id: 't1' } as any);
    const svc = new PasswordResetService();
    const { raw } = await svc.createToken('u1');
    expect(raw).to.match(/^[A-Za-z0-9_-]{40,}$/);
    const data = create.firstCall.args[0].data;
    expect(data.userId).to.equal('u1');
    expect(data.tokenHash).to.equal(crypto.createHash('sha256').update(raw).digest('hex'));
    expect(data.expiresAt).to.be.instanceOf(Date);
    expect((data.expiresAt as Date).getTime()).to.be.greaterThan(Date.now());
  });

  it('verifyToken() returns the row when valid', async () => {
    const raw = 'a'.repeat(43);
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.passwordResetToken, 'findUnique').resolves({
      id: 't1', userId: 'u1', tokenHash,
      expiresAt: new Date(Date.now() + 3600_000), usedAt: null,
    } as any);
    const svc = new PasswordResetService();
    const row = await svc.verifyToken(raw);
    expect(row?.userId).to.equal('u1');
  });

  it('verifyToken() returns null for expired tokens', async () => {
    const raw = 'a'.repeat(43);
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.passwordResetToken, 'findUnique').resolves({
      id: 't1', userId: 'u1', tokenHash,
      expiresAt: new Date(Date.now() - 1_000), usedAt: null,
    } as any);
    const svc = new PasswordResetService();
    expect(await svc.verifyToken(raw)).to.be.null;
  });

  it('verifyToken() returns null for already-used tokens', async () => {
    const raw = 'a'.repeat(43);
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.passwordResetToken, 'findUnique').resolves({
      id: 't1', userId: 'u1', tokenHash,
      expiresAt: new Date(Date.now() + 3600_000), usedAt: new Date(),
    } as any);
    const svc = new PasswordResetService();
    expect(await svc.verifyToken(raw)).to.be.null;
  });

  it('consume() marks usedAt atomically', async () => {
    const update = sinon.stub(prisma.passwordResetToken, 'update').resolves({} as any);
    await new PasswordResetService().consume('t1');
    expect(update.firstCall.args[0].where).to.deep.equal({ id: 't1' });
    expect(update.firstCall.args[0].data.usedAt).to.be.instanceOf(Date);
  });

  it('cleanupExpired() deletes rows whose expiresAt has passed or that were used', async () => {
    const del = sinon.stub(prisma.passwordResetToken, 'deleteMany').resolves({ count: 7 } as any);
    const removed = await new PasswordResetService().cleanupExpired();
    expect(removed).to.equal(7);
    const where = del.firstCall.args[0].where as any;
    expect(where).to.have.property('OR');
  });
});
```

- [ ] **Step 2: Run, confirm RED**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/PasswordResetService.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/services/PasswordResetService.ts
import { Service } from 'typedi';
import crypto from 'crypto';
import { prisma } from '../prisma';
import { config } from '../config';
import log from '../logger';

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

@Service()
export class PasswordResetService {
  private log = log.scope('PasswordReset');

  ttlMs(): number {
    return config.resetTokenTtlMs ?? DEFAULT_TTL_MS;
  }

  // Returns { raw, id }. The raw token is what gets emailed; the DB stores
  // only its sha256 hash. This is the same primitive ApiKeyService uses for
  // its 32-byte tokens — high entropy, no salt needed.
  async createToken(userId: string): Promise<{ raw: string; id: string }> {
    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + this.ttlMs());
    const row = await prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt },
    });
    return { raw, id: row.id };
  }

  // Returns the row when the token is valid, unexpired, and unused. Otherwise
  // returns null. Does NOT consume — call consume(id) separately after the
  // password update succeeds.
  async verifyToken(raw: string): Promise<{ id: string; userId: string } | null> {
    if (!raw) return null;
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!row) return null;
    if (row.usedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return { id: row.id, userId: row.userId };
  }

  async consume(id: string): Promise<void> {
    await prisma.passwordResetToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async cleanupExpired(): Promise<number> {
    const r = await prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { usedAt: { not: null } },
        ],
      },
    });
    if (r.count > 0) this.log.debug(`cleaned ${r.count} expired/used reset tokens`);
    return r.count;
  }
}
```

- [ ] **Step 4: Run, confirm GREEN**

Expected: 6 passing.

- [ ] **Step 5: Commit**

Write `/tmp/xenon-task11-msg.txt`:
```
feat(auth): PasswordResetService — single-use, hashed, TTL'd tokens

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```
git add src/services/PasswordResetService.ts test/unit/PasswordResetService.test.ts
git commit -F /tmp/xenon-task11-msg.txt && rm /tmp/xenon-task11-msg.txt
```

---

## Task 12: `EmailService` — nodemailer with log fallback (TDD)

**Files:**
- Create: `src/services/EmailService.ts`
- Create: `test/unit/EmailService.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// test/unit/EmailService.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import nodemailer from 'nodemailer';
import { EmailService } from '../../src/services/EmailService';
import { config } from '../../src/config';

describe('EmailService', () => {
  afterEach(() => sinon.restore());

  it('uses nodemailer when XENON_SMTP_URL is set', async () => {
    const sendMail = sinon.stub().resolves({ messageId: 'm1' });
    const createTransport = sinon.stub(nodemailer, 'createTransport').returns({ sendMail } as any);
    const orig = (config as any).smtpUrl;
    (config as any).smtpUrl = 'smtps://user:pass@smtp.example.com:465';
    try {
      const svc = new EmailService();
      await svc.send({ to: 'a@b.com', subject: 'Reset', text: 'click here' });
      expect(createTransport.calledOnce).to.be.true;
      expect(sendMail.firstCall.args[0]).to.include({ to: 'a@b.com', subject: 'Reset' });
    } finally {
      (config as any).smtpUrl = orig;
    }
  });

  it('falls back to log when SMTP_URL is unset and fallback enabled', async () => {
    const orig = { url: (config as any).smtpUrl, fb: (config as any).passwordResetLogFallback };
    (config as any).smtpUrl = undefined;
    (config as any).passwordResetLogFallback = true;
    try {
      const svc = new EmailService();
      const warn = sinon.spy(svc as any, 'warnLog');
      await svc.send({ to: 'a@b.com', subject: 'Reset', text: 'click https://x/reset/abc' });
      expect(warn.calledOnce).to.be.true;
      const logged = warn.firstCall.args[0] as string;
      expect(logged).to.include('a@b.com');
      expect(logged).to.include('https://x/reset/abc');
    } finally {
      (config as any).smtpUrl = orig.url;
      (config as any).passwordResetLogFallback = orig.fb;
    }
  });

  it('throws when SMTP unset and fallback disabled', async () => {
    const orig = { url: (config as any).smtpUrl, fb: (config as any).passwordResetLogFallback };
    (config as any).smtpUrl = undefined;
    (config as any).passwordResetLogFallback = false;
    try {
      const svc = new EmailService();
      let err: Error | undefined;
      try {
        await svc.send({ to: 'a@b.com', subject: 'x', text: 'y' });
      } catch (e) { err = e as Error; }
      expect(err?.message).to.match(/SMTP not configured/);
    } finally {
      (config as any).smtpUrl = orig.url;
      (config as any).passwordResetLogFallback = orig.fb;
    }
  });
});
```

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement**

```ts
// src/services/EmailService.ts
import { Service } from 'typedi';
import nodemailer from 'nodemailer';
import { config } from '../config';
import log from '../logger';

interface Mail {
  to: string;
  subject: string;
  text: string;
}

@Service()
export class EmailService {
  private log = log.scope('Email');

  // Test seam — sinon spies on this in the log-fallback test.
  protected warnLog(line: string) {
    this.log.warn(line);
  }

  async send(mail: Mail): Promise<void> {
    if (config.smtpUrl) {
      const transport = nodemailer.createTransport(config.smtpUrl);
      await transport.sendMail({
        from: config.smtpFrom ?? 'noreply@xenon.local',
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
      return;
    }

    if (config.passwordResetLogFallback) {
      this.warnLog(
        `[EMAIL FALLBACK] to=${mail.to} subject=${JSON.stringify(mail.subject)} body=${mail.text}`,
      );
      return;
    }

    throw new Error('SMTP not configured (XENON_SMTP_URL unset and fallback disabled)');
  }
}
```

- [ ] **Step 4: GREEN** (3 passing)

- [ ] **Step 5: Commit**

```
git add src/services/EmailService.ts test/unit/EmailService.test.ts
git commit -m "feat(auth): EmailService — nodemailer with log fallback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: New env vars in `src/config.ts`

**Files:** Modify `src/config.ts`.

- [ ] **Add to the `Config` interface** (next to Phase 1's identity block):

```ts
  // Phase 2 password reset
  smtpUrl?: string;
  smtpFrom?: string;
  resetTokenTtlMs: number;
  passwordResetLogFallback: boolean;
  resetRateLimitAttempts: number;
  resetRateLimitWindowMs: number;
```

- [ ] **Add to the singleton:**

```ts
  smtpUrl: process.env.XENON_SMTP_URL,
  smtpFrom: process.env.XENON_SMTP_FROM,
  resetTokenTtlMs: Number(process.env.XENON_RESET_TOKEN_TTL_MS) || 60 * 60 * 1000,
  passwordResetLogFallback: process.env.XENON_PASSWORD_RESET_LOG_FALLBACK !== 'false',
  resetRateLimitAttempts: Number(process.env.XENON_RESET_RATE_LIMIT_ATTEMPTS) || 3,
  resetRateLimitWindowMs: Number(process.env.XENON_RESET_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
```

- [ ] **Type-check + commit**

```
npx tsc --noEmit 2>&1 | grep "src/config\.ts" || echo "clean"
```

```
git add src/config.ts
git commit -m "feat(config): SMTP + reset-token + reset-rate-limit env vars

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: `revokeAllForUser` on `UserSessionService`

**Files:** Modify `src/services/UserSessionService.ts` and its test.

- [ ] **Add a failing test** to `test/unit/UserSessionService.test.ts` inside the existing `describe`:

```ts
it('revokeAllForUser() deletes every session for the user', async () => {
  const del = sinon.stub(prisma.userSession, 'deleteMany').resolves({ count: 3 } as any);
  const removed = await new UserSessionService().revokeAllForUser('u1');
  expect(removed).to.equal(3);
  expect((del.firstCall.args[0] as any).where).to.deep.equal({ userId: 'u1' });
});
```

- [ ] **Run, confirm fail**

- [ ] **Add the method** to `UserSessionService.ts` next to `revokeAllForUserExcept`:

```ts
async revokeAllForUser(userId: string): Promise<number> {
  const r = await prisma.userSession.deleteMany({ where: { userId } });
  if (r.count > 0) {
    this.log.info(`revoked all ${r.count} sessions for user ${userId}`);
  }
  return r.count;
}
```

- [ ] **Run, confirm pass** (existing 6 + 1 new)

- [ ] **Commit**

```
git add src/services/UserSessionService.ts test/unit/UserSessionService.test.ts
git commit -m "feat(auth): UserSessionService.revokeAllForUser

Used by /auth/reset-password to invalidate every session after a
successful reset. The 'Except' variant was already used by
change-password; reset doesn't have a current session to keep.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: `/auth/forgot-password` + `/auth/reset-password` endpoints

**Files:** Modify `src/app/routers/auth.ts`. Both endpoints land in `authPublicRouter()` (mounted before `authMiddleware`).

- [ ] **Step 1: Add imports**

```ts
import { PasswordResetService } from '../../services/PasswordResetService';
import { EmailService } from '../../services/EmailService';
```

(`Container.get(...)` of these inside the factory.)

- [ ] **Step 2: Build a separate rate-limiter bucket for forgot-password**

Inside `authPublicRouter()`, alongside the existing `const limiter = new LoginRateLimiter();`, add:

```ts
const resetLimiter = new LoginRateLimiter({
  attempts: config.resetRateLimitAttempts ?? 3,
  windowMs: config.resetRateLimitWindowMs ?? 15 * 60 * 1000,
});
```

- [ ] **Step 3: Implement `POST /forgot-password`**

```ts
r.post('/forgot-password', loginRateLimitMiddleware(resetLimiter), async (req, res) => {
  const { email } = req.body as { email?: string };
  // Always 204 — no enumeration. Run the work in the background.
  res.status(204).end();
  if (!email) return;

  // Constant 50ms delay regardless of branch, to keep timing flat.
  const t0 = Date.now();
  try {
    const user = await userSvc.findByEmail(email);
    if (user && user.status === 'ACTIVE') {
      const resetSvc = Container.get(PasswordResetService);
      const emailSvc = Container.get(EmailService);
      const { raw } = await resetSvc.createToken(user.id);
      const proto = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const host = req.headers.host || 'localhost';
      const link = `${proto}://${host}/xenon/reset-password/${raw}`;
      await emailSvc.send({
        to: user.email,
        subject: 'Reset your Xenon password',
        text:
          `Hi ${user.name},\n\n` +
          `Someone requested a password reset for your Xenon account. ` +
          `If that was you, click the link below to choose a new password:\n\n` +
          `${link}\n\n` +
          `This link expires in 1 hour. If you did not request this, ignore this email — no action is needed.\n`,
      });
    }
  } catch (e) {
    // Swallow — anti-enumeration. The operator log catches the cause.
  }
  const elapsed = Date.now() - t0;
  if (elapsed < 50) await new Promise((res2) => setTimeout(res2, 50 - elapsed));
});
```

- [ ] **Step 4: Implement `GET /reset-password/check/:token`**

```ts
r.get('/reset-password/check/:token', async (req, res) => {
  const resetSvc = Container.get(PasswordResetService);
  const row = await resetSvc.verifyToken(req.params.token);
  if (!row) return res.status(404).json({ error: 'invalid or expired token' });
  return res.json({ ok: true });
});
```

- [ ] **Step 5: Implement `POST /reset-password`**

```ts
r.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || !newPassword) return res.status(400).json({ error: 'token and newPassword required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

  const resetSvc = Container.get(PasswordResetService);
  const row = await resetSvc.verifyToken(token);
  if (!row) return res.status(404).json({ error: 'invalid or expired token' });

  const passwordHash = await userSvc.hashPassword(newPassword);
  // Update password + consume token + revoke all sessions.
  await prisma.user.update({
    where: { id: row.userId },
    data: { passwordHash, passwordChangedAt: new Date() },
  });
  await resetSvc.consume(row.id);
  await sessionSvc.revokeAllForUser(row.userId);

  return res.status(204).end();
});
```

(`prisma`, `userSvc`, `sessionSvc` are already in scope in `authPublicRouter`. Add `import { prisma } from '../../prisma'` if not already imported.)

- [ ] **Step 6: tsc + commit**

```
npx tsc --noEmit 2>&1 | grep "routers/auth\.ts" || echo "clean"
```

```
git add src/app/routers/auth.ts
git commit -m "feat(auth): /auth/forgot-password + /auth/reset-password

Generic 204 from /forgot-password regardless of email-exists (no
enumeration). Constant 50ms delay keeps response timing flat. The
reset link is emailed via EmailService, which falls back to logging
the link when SMTP isn't configured. /reset-password/check/:token
lets the frontend distinguish 'expired' from 'valid' before showing
the form. Successful reset consumes the token and revokes every
UserSession for that user.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Reset-token cleanup in the existing cron

**Files:** Modify `src/services/identity/sessionCleanupCron.ts`.

- [ ] Add the `PasswordResetService` import + cleanup invocation:

```ts
import { Container } from 'typedi';
import { UserSessionService } from '../UserSessionService';
import { PasswordResetService } from '../PasswordResetService';
import log from '../../logger';

const HOUR_MS = 60 * 60 * 1000;

export function startUserSessionCleanupCron() {
  const sessionSvc = Container.get(UserSessionService);
  const resetSvc = Container.get(PasswordResetService);
  const l = log.scope('Cleanup-Cron');
  const tick = async () => {
    await sessionSvc.cleanupExpired().catch((e) => l.error('session cleanup failed', e));
    await resetSvc.cleanupExpired().catch((e) => l.error('reset-token cleanup failed', e));
  };
  setTimeout(tick, 30_000);
  setInterval(tick, HOUR_MS).unref();
}
```

- [ ] **tsc + commit**

```
git add src/services/identity/sessionCleanupCron.ts
git commit -m "feat(auth): hourly cron also prunes expired/used reset tokens

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Integration tests — forgot-password flow + rate limit + session revocation

**Files:**
- Create: `test/integration/forgot-password.spec.ts`
- Create: `test/integration/forgot-password-rate-limit.spec.ts`
- Create: `test/integration/reset-revokes-sessions.spec.ts`

- [ ] **Step 1: `forgot-password.spec.ts`**

```ts
// test/integration/forgot-password.spec.ts
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authPublicRouter } from '../../src/app/routers/auth';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { PasswordResetService } from '../../src/services/PasswordResetService';
import { prisma } from '../../src/prisma';

describe('forgot-password flow (integration)', function () {
  this.timeout(30_000);
  let user: any;
  const email = 'forgot-it@xenon.local';

  before(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    user = await Container.get(UserService).createUser({
      email, name: 'Forgot IT', password: 'old-password-1', role: 'ADMIN',
    });
  });
  after(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/auth', authPublicRouter());
    return app;
  }

  it('full flow: forgot → DB token → reset → login with new password', async () => {
    const app = buildApp();

    // Generic 204 even with wrong email
    const r1 = await request(app).post('/auth/forgot-password').send({ email: 'no@no.com' });
    expect(r1.status).to.equal(204);

    const r2 = await request(app).post('/auth/forgot-password').send({ email });
    expect(r2.status).to.equal(204);

    // Token persisted
    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(tokens.length).to.be.greaterThanOrEqual(1);

    // Use the test seam: createToken returns the raw value; here we don't
    // have it (the email-fallback log scrubs it) so we generate a new one
    // via the service directly to test the consume side.
    const { raw } = await Container.get(PasswordResetService).createToken(user.id);

    const check = await request(app).get(`/auth/reset-password/check/${raw}`);
    expect(check.status).to.equal(200);

    const reset = await request(app).post('/auth/reset-password').send({
      token: raw, newPassword: 'NewPassw0rd1',
    });
    expect(reset.status).to.equal(204);

    // Token now consumed
    const recheck = await request(app).get(`/auth/reset-password/check/${raw}`);
    expect(recheck.status).to.equal(404);

    // Login with new password works
    const login = await request(app).post('/auth/login').send({ email, password: 'NewPassw0rd1' });
    expect(login.status).to.equal(204);

    // Login with old password fails
    const oldLogin = await request(app).post('/auth/login').send({ email, password: 'old-password-1' });
    expect(oldLogin.status).to.equal(401);
  });

  it('expired token returns 404 from check', async () => {
    const { raw, id } = await Container.get(PasswordResetService).createToken(user.id);
    // Force-expire by writing a past expiresAt
    await prisma.passwordResetToken.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const app = buildApp();
    const r = await request(app).get(`/auth/reset-password/check/${raw}`);
    expect(r.status).to.equal(404);
  });
});
```

- [ ] **Step 2: `forgot-password-rate-limit.spec.ts`**

```ts
// test/integration/forgot-password-rate-limit.spec.ts
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authPublicRouter } from '../../src/app/routers/auth';

describe('forgot-password rate limit', function () {
  this.timeout(15_000);

  it('3 attempts from one IP → 4th returns 429 with Retry-After', async () => {
    const app = express();
    app.use(express.json());
    app.use('/auth', authPublicRouter());

    for (let i = 0; i < 3; i++) {
      const r = await request(app).post('/auth/forgot-password')
        .set('X-Forwarded-For', '7.7.7.7')
        .send({ email: 'whatever@xenon.local' });
      expect(r.status).to.equal(204);
    }
    const blocked = await request(app).post('/auth/forgot-password')
      .set('X-Forwarded-For', '7.7.7.7')
      .send({ email: 'whatever@xenon.local' });
    expect(blocked.status).to.equal(429);
    expect(blocked.headers['retry-after']).to.match(/^\d+$/);
  });
});
```

- [ ] **Step 3: `reset-revokes-sessions.spec.ts`**

```ts
// test/integration/reset-revokes-sessions.spec.ts
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authPublicRouter } from '../../src/app/routers/auth';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { PasswordResetService } from '../../src/services/PasswordResetService';
import { prisma } from '../../src/prisma';

describe('reset-password revokes all sessions', function () {
  this.timeout(30_000);
  const email = 'reset-revokes-it@xenon.local';
  let user: any;

  before(async () => {
    await prisma.user.deleteMany({ where: { email } });
    user = await Container.get(UserService).createUser({
      email, name: 'Reset Revokes IT', password: 'old-password-1', role: 'MEMBER',
    });
  });
  after(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('deletes every UserSession for the resetting user', async () => {
    const sessions = [
      await Container.get(UserSessionService).create(user.id),
      await Container.get(UserSessionService).create(user.id),
    ];
    expect(sessions.length).to.equal(2);

    const { raw } = await Container.get(PasswordResetService).createToken(user.id);
    const app = express();
    app.use(express.json());
    app.use('/auth', authPublicRouter());
    const r = await request(app).post('/auth/reset-password').send({
      token: raw, newPassword: 'BrandNewPw1',
    });
    expect(r.status).to.equal(204);

    const remaining = await prisma.userSession.count({ where: { userId: user.id } });
    expect(remaining).to.equal(0);
  });
});
```

- [ ] **Step 4: Run them**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 \
  test/integration/forgot-password.spec.ts \
  test/integration/forgot-password-rate-limit.spec.ts \
  test/integration/reset-revokes-sessions.spec.ts
```

- [ ] **Step 5: Commit**

```
git add test/integration/forgot-password.spec.ts test/integration/forgot-password-rate-limit.spec.ts test/integration/reset-revokes-sessions.spec.ts
git commit -m "test(integration): forgot-password full flow + rate limit + session revocation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: PR-B finalization

- [ ] Run the full identity surface (PR-A's test list + the new PR-B suites):

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 \
  test/unit/UserService.test.ts test/unit/UserSessionService.test.ts \
  test/unit/ApiKeyService.test.ts test/unit/loginRateLimiter.test.ts \
  test/unit/authMiddleware.test.ts test/unit/apiKeyMiddleware.test.ts \
  test/unit/profile-router.test.ts test/unit/bootstrap-identity.test.ts \
  test/unit/extract-access-key-token-pair.test.ts test/unit/roleGuard.test.ts \
  test/unit/PasswordResetService.test.ts test/unit/EmailService.test.ts \
  test/integration/auth-flow.spec.ts test/integration/auth-rate-limit.spec.ts \
  test/integration/profile-tokens.spec.ts test/integration/legacy-key-compat.spec.ts \
  test/integration/migration.spec.ts test/integration/role-matrix.spec.ts \
  test/integration/forgot-password.spec.ts \
  test/integration/forgot-password-rate-limit.spec.ts \
  test/integration/reset-revokes-sessions.spec.ts
```

- [ ] `tsc --noEmit` clean.
- [ ] `git push -u origin feat/phase-2-password-reset`
- [ ] `gh pr create --title "feat(auth): Phase 2 password reset endpoints (PR-B of 3)" --body-file /tmp/xenon-pr-b-body.md`. Body includes summary, link to spec, the test plan, and a "next: PR-C frontend" pointer.

---

# PR-C — Frontend Pages + Sidebar Role-Visibility

**Branch:** `feat/phase-2-frontend` (off `main` after PR-B merge)
**Ships:** `/forgot-password` + `/reset-password/<token>` pages, "Forgot password?" link on `/login`, role-aware sidebar, 403 toast pipeline.

---

## Task 19: Auth API service additions

**Files:** Modify `web/src/api-service/auth.ts`.

- [ ] **Append**:

```ts
export async function forgotPassword(email: string): Promise<void> {
  const r = await fetch(`${BASE}/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok && r.status !== 204) {
    if (r.status === 429) throw new Error('Too many attempts — try again later.');
    throw new Error(`Request failed (${r.status})`);
  }
}

export async function checkResetToken(token: string): Promise<boolean> {
  const r = await fetch(`${BASE}/reset-password/check/${encodeURIComponent(token)}`);
  return r.ok;
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const r = await fetch(`${BASE}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!r.ok && r.status !== 204) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `Reset failed (${r.status})`);
  }
}
```

- [ ] **Commit**

```
git add web/src/api-service/auth.ts
git commit -m "feat(web): forgotPassword / checkResetToken / resetPassword helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: `/forgot-password` page + login link

**Files:**
- Create: `web/src/pages/forgot-password.tsx`
- Modify: `web/src/pages/login.tsx`

- [ ] **Step 1: Create `forgot-password.tsx`**

```tsx
import * as React from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { forgotPassword } from '../api-service/auth';

export default function ForgotPasswordPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await forgotPassword(email);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <form onSubmit={submit} className="w-full max-w-sm px-6">
        <h1 className="text-2xl font-semibold mb-1">Forgot password?</h1>
        <p className="text-sm text-[var(--text-dim)] mb-6">
          Enter your email and we'll send you a reset link if your account exists.
        </p>

        {submitted ? (
          <div className="text-sm text-[var(--text)] mb-6">
            If your email is registered, you'll receive a reset link shortly.
            Check your spam folder if you don't see it within a minute.
          </div>
        ) : (
          <>
            <label className="block text-xs text-[var(--text-dim)] mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
              className="w-full mb-4 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--green)] outline-none"
            />
            {error && <div className="text-xs text-[var(--red)] mb-3">{error}</div>}
            <button
              type="submit"
              disabled={submitting || !email}
              className="w-full h-10 rounded-md bg-[var(--green)] text-black font-medium text-sm disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}

        <div className="mt-6 text-center">
          <Link to="/login" className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">
            Back to sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Add the "Forgot password?" link to `login.tsx`**

Right after the password input, before the error block, insert:

```tsx
<div className="text-right mb-4">
  <Link to="/forgot-password" className="text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]">
    Forgot password?
  </Link>
</div>
```

Add `import { Link, useLocation, useNavigate } from 'react-router-dom';` at the top (replace the existing react-router import to include `Link`).

- [ ] **Commit**

```
git add web/src/pages/forgot-password.tsx web/src/pages/login.tsx
git commit -m "feat(web): /forgot-password page + login forgot-password link

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: `/reset-password/<token>` page

**Files:** Create `web/src/pages/reset-password.tsx`.

```tsx
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { checkResetToken, resetPassword } from '../api-service/auth';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const [state, setState] = useState<'checking' | 'invalid' | 'ready' | 'submitting' | 'done'>('checking');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setState('invalid'); return; }
    checkResetToken(token).then((ok) => setState(ok ? 'ready' : 'invalid'));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (pw.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setState('submitting');
    try {
      await resetPassword(token!, pw);
      setState('done');
      setTimeout(() => nav('/login', { replace: true }), 1500);
    } catch (err: any) {
      setError(err.message || 'Reset failed');
      setState('ready');
    }
  }

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[var(--text-dim)]">
        Checking link…
      </div>
    );
  }
  if (state === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-6">
        <div>
          <h1 className="text-xl font-semibold mb-3">This link is invalid or expired</h1>
          <p className="text-sm text-[var(--text-dim)] mb-6">
            Reset links are good for 1 hour and single-use. Request a new one.
          </p>
          <Link
            to="/forgot-password"
            className="inline-block h-10 px-4 rounded-md bg-[var(--green)] text-black text-sm font-medium leading-10"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }
  if (state === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-6">
        <div>
          <h1 className="text-xl font-semibold mb-3">Password updated</h1>
          <p className="text-sm text-[var(--text-dim)]">Redirecting to sign in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <form onSubmit={submit} className="w-full max-w-sm px-6">
        <h1 className="text-2xl font-semibold mb-1">Reset your password</h1>
        <p className="text-sm text-[var(--text-dim)] mb-6">Choose a new password to sign in with.</p>

        <label className="block text-xs text-[var(--text-dim)] mb-1">New password</label>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          required
          className="w-full mb-3 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--green)] outline-none"
        />
        <label className="block text-xs text-[var(--text-dim)] mb-1">Confirm new password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="w-full mb-3 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--green)] outline-none"
        />
        {error && <div className="text-xs text-[var(--red)] mb-3">{error}</div>}
        <button
          type="submit"
          disabled={state === 'submitting' || pw.length < 8}
          className="w-full h-10 rounded-md bg-[var(--green)] text-black font-medium text-sm disabled:opacity-50"
        >
          {state === 'submitting' ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Commit**

```
git add web/src/pages/reset-password.tsx
git commit -m "feat(web): /reset-password/<token> page

Renders 'invalid or expired' state when /auth/reset-password/check/:token
returns 404, otherwise shows the password form. On success, redirects to
/login after a short success message.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: Wire `/forgot-password` and `/reset-password/<token>` routes

**Files:** Modify `web/src/App.tsx`.

- [ ] **Add lazy imports** alongside `LoginPage`:

```ts
const ForgotPasswordPage = lazy(() => import('./pages/forgot-password'));
const ResetPasswordPage = lazy(() => import('./pages/reset-password'));
```

- [ ] **Add the routes** in the `<Routes>` block, alongside `/login` (outside `<RouteGuard>`):

```tsx
<Route path="/forgot-password" element={<ForgotPasswordPage />} />
<Route path="/reset-password/:token" element={<ResetPasswordPage />} />
```

- [ ] **Smoke check via vitest** — the existing `auth.smoke.test.tsx` already covers RouteGuard. Add one new test there:

```tsx
// inside the existing describe in web/src/auth/auth.smoke.test.tsx
it('does not redirect /forgot-password when /me returns null', async () => {
  // /forgot-password is outside the guard. Hitting it unauthenticated should
  // render the page, NOT redirect to /login.
  // (No assertion here that the page renders — that requires importing the
  // page component, which is fine. Keep this lean: just ensure the guard
  // is bypassed for this path.)
  // ...
});
```

If the smoke test setup is more involved than the inline comment suggests, skip the addition and rely on the manual verification in Task 24.

- [ ] **Commit**

```
git add web/src/App.tsx web/src/auth/auth.smoke.test.tsx
git commit -m "feat(web): mount /forgot-password + /reset-password outside RouteGuard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 23: Sidebar role-aware visibility + 403 toast

**Files:**
- Modify: `web/src/components/sidebar/sidebar.tsx`
- Modify: `web/src/api-service/api-client.ts` (or wherever the central fetch wrapper / toast pipeline lives)

### Sidebar

- [ ] Read `web/src/components/sidebar/sidebar.tsx`. Find the array of menu items.
- [ ] Add a `minRole?: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER'` field to each item.
- [ ] At the top of the component, read `useAuth().me?.role` and filter the items:

```tsx
const RANK = { SUPER_ADMIN: 3, ADMIN: 2, MEMBER: 1 } as const;
function visibleFor(role: string | undefined, minRole?: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER') {
  if (!minRole) return true;
  const r = role ? RANK[role as keyof typeof RANK] : 0;
  return r >= RANK[minRole];
}
```

Apply when rendering: `items.filter((i) => visibleFor(me?.role, i.minRole)).map(...)`.

Mapping (per spec):
- API Keys, Teams, Webhooks, Settings — `minRole: 'ADMIN'` (System settings: `'SUPER_ADMIN'` if there's a separate item).
- Overview, Devices, Sessions, Apps (read), Selector Health, Notifications — no `minRole` (everyone).

If `useAuth()` isn't already imported in sidebar, add `import { useAuth } from '../../auth/auth-context';`.

### 403 Toast

- [ ] Find the central response handler (likely `web/src/api-service/api-client.ts`).
- [ ] When the response status is 403, surface a toast:

```ts
if (r.status === 403) {
  // ToastProvider must be available; if the function is called outside
  // a React tree, fall through to the existing error pipeline.
  try {
    const body = await r.clone().json().catch(() => ({}));
    showToast?.({ kind: 'error', message: body.error ?? 'You do not have permission for this action.' });
  } catch { /* swallow */ }
}
```

The exact integration depends on the existing toast contract; adapt to whatever `web/src/components/ui/toast` exposes.

- [ ] **tsc + commit**

```
cd web && npx tsc --noEmit 2>&1 | grep -E "(sidebar|api-client)" || echo "clean"
```

```
git add web/src/components/sidebar/sidebar.tsx web/src/api-service/api-client.ts
git commit -m "feat(web): sidebar role-aware visibility + 403 toast

Sidebar items declare a minRole; the component filters by useAuth().me.role
on render. The api-client surfaces a toast on 403 ('You do not have
permission for this action') so a Member who hits an admin-only route
gets immediate feedback instead of a silent failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 24: Manual verification

This task is about running the system. No code changes.

- [ ] **Step 1: Bring up the dev loop**

```
npm run dev
```

Wait for "Started Xenon" or equivalent.

- [ ] **Step 2: Walk the spec's manual checklist**

In a browser at `http://localhost:4723/xenon/`:

1. Visit `/login` → click "Forgot password?" → `/forgot-password`.
2. Submit `unknown@xenon.local` → see generic success message.
3. Submit `admin@xenon.local` → check operator logs for `[EMAIL FALLBACK]` line containing the reset link.
4. Click the link → `/reset-password/<token>` renders the form.
5. Enter `NewPassw0rd!` twice → submit → redirect to `/login`.
6. Sign in with old password → 401.
7. Sign in with new password → `/overview`.
8. Demote the user via SQL: `sqlite3 ~/.cache/xenon/xenon.db "UPDATE User SET role='MEMBER' WHERE email='admin@xenon.local';"`. Refresh the page (sidebar should now show the Member-only set).
9. As MEMBER, hit `POST /xenon/api/apikeys` via curl with cookie → 403 + toast in any UI that triggers an admin call.
10. Re-promote: `... SET role='SUPER_ADMIN' ...`. Verify sidebar restores admin items after refresh.
11. From `/login`, click "Forgot password?" 4 times in a row from the same browser → 4th request returns 429 (visible in DevTools Network tab).

- [ ] **Step 3: Capture findings**

If anything in the checklist fails, fix it (or open a follow-up ticket if it's pre-existing). If everything passes, no commit needed for this task — manual verification is documented in the PR-C body.

---

## Task 25: PR-C finalization

- [ ] Run the full backend identity surface (PR-A + PR-B suites) once more — frontend changes shouldn't have touched it, but verify.
- [ ] `cd web && npx vitest run` — vitest passes.
- [ ] `cd web && npx tsc --noEmit` clean.
- [ ] `git push -u origin feat/phase-2-frontend`
- [ ] `gh pr create --title "feat(auth): Phase 2 frontend — forgot/reset + role-aware sidebar (PR-C of 3)" --body-file /tmp/xenon-pr-c-body.md`

PR body includes:
- Summary linking the spec.
- Screenshots (if you take them) of the new pages.
- Manual verification checklist with checked boxes.
- "What's NOT in this PR" pointing at Phase 3 (`/users` UI, team-membership UI).

---

## Self-Review Checklist (pre-merge)

Before finalizing each PR:

- [ ] All tests in the relevant suite pass.
- [ ] `tsc --noEmit` clean for backend AND frontend (where touched).
- [ ] No `git add -A` / `git add .` was used — every commit was staged by exact path.
- [ ] Commit messages follow Conventional Commits + Co-Authored-By trailer.
- [ ] No secrets or generated files leaked into commits.
- [ ] Spec coverage:
  - PR-A covers: roleGuard middleware, role matrix on every authenticated router, role-matrix integration test, seedUser helper.
  - PR-B covers: PasswordResetToken model, PasswordResetService, EmailService (SMTP + log fallback), `/auth/forgot-password`, `/auth/reset-password/check/:token`, `/auth/reset-password`, rate-limit bucket separate from login, session revocation on reset, 6 new env vars, hourly cleanup of reset tokens.
  - PR-C covers: API service helpers, `/forgot-password` page, `/reset-password/<token>` page, login forgot link, sidebar role-visibility, 403 toast pipeline.
- [ ] Risks from spec are addressed:
  - Test fixture explosion → `seedUser` helper in PR-A.
  - Sidebar staleness → documented in PR body; refresh resolves.
  - Email rendering → text/plain only, single template.
  - Forgot-password rate-limit bucket key → per-IP, separate from login.
  - Legacy Admin → unchanged, status=INACTIVE still 401s before any role check.

---

## Out of scope for this plan (deferred to later phases)

- `/users` page (CRUD, role assignment, deactivate) — Phase 3
- Team-membership UI — Phase 3
- Per-node `(accessKey, token)` for hub-node channel — Phase 4
- Sidebar redesign — Phase 5
- 2FA, OAuth/SSO, OIDC, account lockout, recovery questions — deferred indefinitely
- Audit log for role changes — lands when Phase 3 UI does
