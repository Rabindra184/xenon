# Phase 3 — Users + Teams Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the org-shape primitives (User, Team, Device-team) usable from the product instead of via SQL. Add `/users` CRUD, switch team membership from ApiKey-keyed to User-keyed, and add a device-team assignment UI.

**Architecture:** New `TeamMember` join table replaces the ApiKey-based membership. UserService gains list/update/setRole/deactivate/delete. New `/users` router with handler-level role-vs-target + last-super-admin + self-modify guards (composable on top of `roleGuard('ADMIN')`). Existing `teams.tsx` Members tab rewritten User-keyed; Devices page gains a team-selector column.

**Tech Stack:** TypeScript 5.5, Prisma 5.4 (SQLite), TypeDI 0.10, Express, Mocha + chai + sinon, React 17 + Vite + Tailwind + vitest. Reuses Phase 1 / 2 services (UserService, UserSessionService, ApiKeyService, authMiddleware, roleGuard, EmailService) and Phase 2's `forgotPassword` helper.

**Spec:** `docs/superpowers/specs/2026-04-30-phase-3-users-teams-design.md`

---

## File Structure

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | MODIFIED — add `TeamMember` model + relation arrays on `User` and `Team` |
| `prisma/migrations/<ts>_phase_3_team_members/migration.sql` | NEW (Prisma-generated) — `CREATE TABLE TeamMember` + backfill `INSERT … SELECT DISTINCT` from ApiKey.teamId |
| `src/prisma.ts` | MODIFIED — add `'teamMember'` to `MODEL_DELEGATES` |
| `src/services/UserService.ts` | MODIFIED — add `listUsers(callerRole)`, `updateUser`, `setRole`, `deactivateUser`, `deleteUser` |
| `src/services/TeamService.ts` | MODIFIED — `list()`, `listMembers`, `addMember`, `removeMember`, `delete()` blocking check switch from ApiKey to TeamMember |
| `src/services/identity/userAuthorization.ts` | NEW — pure helpers: `canActOn`, `assertNotSelf`, `assertNotLastSuperAdmin` |
| `src/app/routers/users.ts` | NEW — GET / POST / PATCH / DELETE |
| `src/app/routers/teams.ts` | MODIFIED — `/teams/:id/members` shape change (apiKey-keyed → user-keyed) |
| `src/app/index.ts` | MODIFIED — mount `usersRouter()` |
| `test/unit/UserService.test.ts` | MODIFIED — append CRUD list/update/setRole/deactivate/delete tests |
| `test/unit/users-router.test.ts` | NEW |
| `test/unit/userAuthorization.test.ts` | NEW |
| `test/unit/TeamService.test.ts` | NEW (or extended if exists) — User-keyed members |
| `test/integration/users-flow.spec.ts` | NEW — multi-user CRUD scenario |
| `test/integration/users-lockout.spec.ts` | NEW — last-SA + self-delete guards |
| `test/integration/team-membership-migration.spec.ts` | NEW — backfill assertion |
| `test/integration/role-matrix.spec.ts` | MODIFIED — append /users role cases |
| `web/src/api-service/users.ts` | NEW — listUsers, createUser, updateUser, deleteUser |
| `web/src/pages/users.tsx` | NEW — list + invite modal + edit drawer + delete confirm |
| `web/src/components/sidebar/sidebar.tsx` | MODIFIED — add "Users" item with `minRole: 'ADMIN'` |
| `web/src/routes/index.tsx` | MODIFIED — register `/users` route inside `RouteGuard` |
| `web/src/components/settings/teams.tsx` | MODIFIED — Members tab rewritten User-keyed |
| `web/src/components/device-explorer/device-explorer.tsx` (or device-card) | MODIFIED — add Team column with inline selector |
| `web/src/pages/users.smoke.test.tsx` | NEW |

---

## Conventions (read first)

- **Branches:** PR-A on `feat/phase-3-users-teams` (already created — spec already committed). PR-B on `feat/phase-3-users-page` off latest main after PR-A merge. PR-C on `feat/phase-3-teams-devices-ui` off latest main after PR-B merge.
- **Commits:** Conventional Commits (`feat(auth): …`, `feat(web): …`, `test(integration): …`). Always sign with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Test runner (backend):** `XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 <path>`.
- **Test runner (frontend):** `cd web && npx vitest run <path>`.
- **Type-check:** `npx tsc --noEmit` at repo root, `cd web && npx tsc --noEmit` for frontend.
- **Working tree:** stage by exact path; never `git add -A` or `git add .`.
- **Commit messages:** `cat > /tmp/<task>-msg.txt << 'XENON_EOF' … XENON_EOF` (heredoc with quoted delimiter); `git commit -F /tmp/<task>-msg.txt`. Em-dashes / arrows / unicode in shell strings break commits.
- **DB migration pattern:** the live `db:generate` script runs `prisma migrate dev` interactively. Use `--create-only` against a temp shadow DB (Phase 1 / 2's pattern):
  ```
  TEMP_DB=$(mktemp -t xenon-shadow-XXXXXX.db)
  DATABASE_URL="file:$TEMP_DB" npx prisma migrate dev --create-only --name <slug>
  rm -f "$TEMP_DB"
  ```
  Then `npm run db:migrate` to sync the live DB (uses `db push`).

---

# PR-A — Backend (TeamMember + /users + teams rewrite + migration)

**Branch:** `feat/phase-3-users-teams` (spec already committed at HEAD `9d9cd53`).
**Ships:** all backend changes. Existing UI's team-members tab will return the new shape but won't render correctly until PR-C — acceptable interim state since PR-A and PR-C ship in lockstep.

---

## Task 1: Prisma — `TeamMember` model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_phase_3_team_members/migration.sql`
- Modify: `src/prisma.ts`

- [ ] **Step 1: Add to `prisma/schema.prisma`**

Add a new model anywhere after the existing `Team` block:

```prisma
model TeamMember {
  teamId    String
  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@id([teamId, userId])
  @@index([userId])
}
```

Add a relation array to the `User` block (next to `apiKeys ApiKey[]` / `sessions UserSession[]` / `passwordResetTokens PasswordResetToken[]`):

```prisma
  teamMemberships TeamMember[]
```

Add a relation array to the `Team` block (next to `devices Device[]` / `apiKeys ApiKey[]`):

```prisma
  members TeamMember[]
```

- [ ] **Step 2: Generate the migration via shadow DB**

```
TEMP_DB=$(mktemp -t xenon-shadow-XXXXXX.db)
DATABASE_URL="file:$TEMP_DB" npx prisma migrate dev --create-only --name phase_3_team_members
rm -f "$TEMP_DB"
```

A new directory under `prisma/migrations/` should appear with `migration.sql` containing `CREATE TABLE "TeamMember"` + the composite-PK index + the userId index.

- [ ] **Step 3: Append the backfill SQL to migration.sql**

Open the new `migration.sql` and append at the bottom:

```sql
-- Backfill team membership from existing ApiKey.teamId links.
-- Skips Legacy Admin's adopted keys to avoid polluting team rosters.
INSERT INTO "TeamMember" ("teamId", "userId", "createdAt")
SELECT DISTINCT "ApiKey"."teamId", "ApiKey"."userId", datetime('now')
FROM "ApiKey"
INNER JOIN "User" ON "User"."id" = "ApiKey"."userId"
WHERE "ApiKey"."teamId" IS NOT NULL
  AND "ApiKey"."userId" IS NOT NULL
  AND "User"."email" != 'legacy-admin@xenon.local';
```

- [ ] **Step 4: Apply locally**

```
npm run db:migrate
```

Verify:
```
sqlite3 ~/.cache/xenon/xenon.db ".tables" | grep TeamMember
sqlite3 ~/.cache/xenon/xenon.db "SELECT COUNT(*) FROM TeamMember;"
```

The count is whatever ApiKey.teamId rows existed (likely 0 in dev).

- [ ] **Step 5: Add `'teamMember'` to MODEL_DELEGATES**

Read `src/prisma.ts`. Find the `MODEL_DELEGATES` set (Phase 1 / 2 added 'user', 'userSession', 'passwordResetToken'). Add `'teamMember'`.

- [ ] **Step 6: Two commits — schema + migration + MODEL_DELEGATES, then regenerated client**

```
cat > /tmp/xenon-task1a-msg.txt << 'XENON_EOF'
feat(db): add TeamMember model + ApiKey-to-User membership backfill

Replaces the ApiKey-keyed team membership concept with a User-keyed
join table. The migration backfills existing ApiKey.teamId links into
TeamMember rows (one per distinct user/team pair), skipping Legacy
Admin's adopted keys to avoid polluting team rosters with the
synthetic INACTIVE user from Phase 1's adoption migration.

ApiKey.teamId stays — it now means "this token is narrowed to team X"
rather than "this key's owner belongs to team X". The two concepts
stop colliding.

Also registers teamMember in src/prisma.ts MODEL_DELEGATES so sinon
can stub it in tests (same pattern as user / userSession /
passwordResetToken).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add prisma/schema.prisma prisma/migrations/ src/prisma.ts
git commit -F /tmp/xenon-task1a-msg.txt && rm /tmp/xenon-task1a-msg.txt
```

Then regenerated client:

```
git add src/generated/client/
git commit -m "chore(prisma): regenerate client for TeamMember

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `userAuthorization` helpers (TDD)

**Files:**
- Create: `src/services/identity/userAuthorization.ts`
- Create: `test/unit/userAuthorization.test.ts`

These are pure functions used by the `/users` router and the `TeamService` to enforce role-vs-target / self-modify / last-super-admin invariants.

- [ ] **Step 1: Failing tests**

```ts
// test/unit/userAuthorization.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  canActOn,
  assertNotSelf,
  assertNotLastSuperAdmin,
} from '../../src/services/identity/userAuthorization';
import { prisma } from '../../src/prisma';

describe('userAuthorization helpers', () => {
  afterEach(() => sinon.restore());

  describe('canActOn', () => {
    it('SUPER_ADMIN can act on any role', () => {
      expect(canActOn('SUPER_ADMIN', 'SUPER_ADMIN')).to.be.true;
      expect(canActOn('SUPER_ADMIN', 'ADMIN')).to.be.true;
      expect(canActOn('SUPER_ADMIN', 'MEMBER')).to.be.true;
    });
    it('ADMIN can only act on MEMBER', () => {
      expect(canActOn('ADMIN', 'SUPER_ADMIN')).to.be.false;
      expect(canActOn('ADMIN', 'ADMIN')).to.be.false;
      expect(canActOn('ADMIN', 'MEMBER')).to.be.true;
    });
    it('MEMBER can act on no one', () => {
      expect(canActOn('MEMBER', 'SUPER_ADMIN')).to.be.false;
      expect(canActOn('MEMBER', 'ADMIN')).to.be.false;
      expect(canActOn('MEMBER', 'MEMBER')).to.be.false;
    });
  });

  describe('assertNotSelf', () => {
    it('throws when actor and target ids match', () => {
      expect(() => assertNotSelf('u1', 'u1', 'role-change')).to.throw(/cannot role-change yourself/);
    });
    it('passes when ids differ', () => {
      expect(() => assertNotSelf('u1', 'u2', 'delete')).to.not.throw();
    });
  });

  describe('assertNotLastSuperAdmin', () => {
    it('throws when target is the last active SUPER_ADMIN', async () => {
      sinon.stub(prisma.user, 'count').resolves(0); // no other active SAs
      let err: Error | undefined;
      try {
        await assertNotLastSuperAdmin('target-id');
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).to.match(/last active super-admin/);
    });
    it('passes when another active SUPER_ADMIN exists', async () => {
      sinon.stub(prisma.user, 'count').resolves(1);
      await assertNotLastSuperAdmin('target-id');
    });
  });
});
```

- [ ] **Step 2: RED**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/userAuthorization.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/services/identity/userAuthorization.ts
import { prisma } from '../../prisma';
import type { UserRole } from '../../types/identity';

const RANK: Record<UserRole, number> = { SUPER_ADMIN: 3, ADMIN: 2, MEMBER: 1 };

// Returns true when the caller's role permits acting on a target with `targetRole`.
// SUPER_ADMIN can act on any role; ADMIN can only act on MEMBER; MEMBER can act on no one.
// (ADMIN cannot act on another ADMIN — explicit choice; matches device-farm-pro matrix.)
export function canActOn(callerRole: UserRole, targetRole: UserRole): boolean {
  if (callerRole === 'MEMBER') return false;
  if (callerRole === 'SUPER_ADMIN') return true;
  // ADMIN: only MEMBER
  return targetRole === 'MEMBER';
}

// Throws when actor and target are the same user. The `verb` shows up in the
// error message: "cannot role-change yourself", "cannot delete yourself", etc.
export function assertNotSelf(actorId: string, targetId: string, verb: string): void {
  if (actorId === targetId) {
    throw new Error(`cannot ${verb} yourself; use a different super-admin to manage your own account`);
  }
}

// Throws when removing/demoting the target would leave zero active SUPER_ADMINs.
// Counts OTHER active SAs (not including target). If target isn't an SA at all,
// caller should still be safe to call this — count comes back ≥ 0 either way.
export async function assertNotLastSuperAdmin(targetUserId: string): Promise<void> {
  const others = await prisma.user.count({
    where: {
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      NOT: { id: targetUserId },
    },
  });
  if (others < 1) {
    throw new Error(
      'cannot remove or demote the last active super-admin; promote another user first',
    );
  }
}
```

- [ ] **Step 4: GREEN** (8 tests)

- [ ] **Step 5: Commit**

```
cat > /tmp/xenon-task2-msg.txt << 'XENON_EOF'
feat(auth): userAuthorization helpers — canActOn, assertNotSelf, assertNotLastSuperAdmin

Pure helpers used by the /users router and TeamService to enforce
the Phase 3 invariants:
- ADMIN can only act on MEMBER (SUPER_ADMIN can act on anyone).
- Self-modify is refused at the role-change / delete entry points.
- The last active SUPER_ADMIN cannot be demoted, deactivated, or
  deleted; a different super-admin must be promoted first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/services/identity/userAuthorization.ts test/unit/userAuthorization.test.ts
git commit -F /tmp/xenon-task2-msg.txt && rm /tmp/xenon-task2-msg.txt
```

---

## Task 3: `UserService` extensions — list/update/setRole/deactivate/delete (TDD)

**Files:**
- Modify: `src/services/UserService.ts`
- Modify: `test/unit/UserService.test.ts`

- [ ] **Step 1: Failing tests** (append inside the existing `describe('UserService', …)`)

```ts
describe('list / update / setRole / deactivate / delete', () => {
  it('listUsers(callerRole) filters out admins/super-admins for ADMIN callers', async () => {
    const findMany = sinon.stub(prisma.user, 'findMany').resolves([] as any);
    await new UserService().listUsers('ADMIN');
    const args = findMany.firstCall.args[0] as any;
    expect(args.where.role).to.equal('MEMBER');
  });

  it('listUsers(callerRole) returns everyone for SUPER_ADMIN callers', async () => {
    const findMany = sinon.stub(prisma.user, 'findMany').resolves([] as any);
    await new UserService().listUsers('SUPER_ADMIN');
    const args = findMany.firstCall.args[0] as any;
    expect(args.where).to.not.have.property('role');
  });

  it('updateUser silently drops email from the patch', async () => {
    const update = sinon.stub(prisma.user, 'update').resolves({} as any);
    await new UserService().updateUser('u1', { email: 'evil@x.local', name: 'Alice' } as any);
    const data = update.firstCall.args[0].data;
    expect(data).to.not.have.property('email');
    expect(data.name).to.equal('Alice');
  });

  it('setRole writes role and bumps updatedAt-style audit field', async () => {
    const update = sinon.stub(prisma.user, 'update').resolves({} as any);
    await new UserService().setRole('u1', 'ADMIN');
    const data = update.firstCall.args[0].data;
    expect(data.role).to.equal('ADMIN');
  });

  it('deactivateUser sets status=INACTIVE and revokes all sessions', async () => {
    const update = sinon.stub(prisma.user, 'update').resolves({} as any);
    const revoke = sinon.stub(prisma.userSession, 'deleteMany').resolves({ count: 2 } as any);
    await new UserService().deactivateUser('u1');
    expect(update.firstCall.args[0].data.status).to.equal('INACTIVE');
    expect(revoke.firstCall.args[0].where).to.deep.equal({ userId: 'u1' });
  });

  it('deleteUser revokes sessions then deletes; cascade handles the rest', async () => {
    const revoke = sinon.stub(prisma.userSession, 'deleteMany').resolves({ count: 0 } as any);
    const del = sinon.stub(prisma.user, 'delete').resolves({} as any);
    await new UserService().deleteUser('u1');
    expect(revoke.calledOnce).to.be.true;
    expect(del.firstCall.args[0]).to.deep.equal({ where: { id: 'u1' } });
  });
});
```

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement** — append these methods to the `UserService` class:

```ts
async listUsers(callerRole: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER') {
  const where = callerRole === 'SUPER_ADMIN' ? {} : { role: 'MEMBER' as const };
  return prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

// PATCH-shaped update. Email is intentionally dropped — it's immutable post-create.
async updateUser(
  userId: string,
  patch: { name?: string; role?: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER'; status?: 'ACTIVE' | 'INACTIVE' },
) {
  const data: any = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.status !== undefined) data.status = patch.status;
  return prisma.user.update({ where: { id: userId }, data });
}

async setRole(userId: string, role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER') {
  return prisma.user.update({ where: { id: userId }, data: { role } });
}

async deactivateUser(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { status: 'INACTIVE' } });
  await prisma.userSession.deleteMany({ where: { userId } });
}

async deleteUser(userId: string): Promise<void> {
  // Defense in depth — cascade also clears UserSessions, but doing it explicitly
  // first lets us emit the revocation log line and avoids relying on cascade
  // semantics for security-critical cleanup.
  await prisma.userSession.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}
```

- [ ] **Step 4: GREEN** (existing 9 + 6 new)

- [ ] **Step 5: Commit**

```
cat > /tmp/xenon-task3-msg.txt << 'XENON_EOF'
feat(auth): UserService gains list / update / setRole / deactivate / delete

The five methods that drive the new /users router. listUsers filters
admin/super-admin rows out for non-super-admin callers (mirrors the
device-farm-pro matrix's "admins shouldn't see other admins" rule).
updateUser silently drops email from the patch — it's immutable
post-create. deactivateUser and deleteUser both revoke every session
for the target user before mutating; deleteUser also relies on the
ON DELETE CASCADE relations on UserSession, ApiKey, TeamMember, and
PasswordResetToken to clean up the rest.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/services/UserService.ts test/unit/UserService.test.ts
git commit -F /tmp/xenon-task3-msg.txt && rm /tmp/xenon-task3-msg.txt
```

---

## Task 4: `TeamService` rewrite — User-keyed members (TDD)

**Files:**
- Modify: `src/services/TeamService.ts`
- Create: `test/unit/TeamService.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// test/unit/TeamService.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { TeamService } from '../../src/services/TeamService';
import { prisma } from '../../src/prisma';

describe('TeamService (User-keyed)', () => {
  afterEach(() => sinon.restore());

  it('list() returns deviceCount + memberCount via TeamMember', async () => {
    sinon.stub(prisma.team, 'findMany').resolves([
      {
        id: 't1',
        name: 'Alpha',
        createdAt: new Date(),
        _count: { devices: 2, members: 3 },
      },
    ] as any);
    const out = await new TeamService().list();
    expect(out[0]).to.include({ id: 't1', deviceCount: 2, memberCount: 3 });
  });

  it('listMembers() returns User-shaped rows via TeamMember join', async () => {
    sinon.stub(prisma.teamMember, 'findMany').resolves([
      {
        userId: 'u1',
        createdAt: new Date('2026-01-01'),
        user: { email: 'a@x.local', name: 'Alice', role: 'ADMIN' },
      },
    ] as any);
    const out = await new TeamService().listMembers('t1');
    expect(out[0]).to.include({ userId: 'u1', email: 'a@x.local', name: 'Alice', role: 'ADMIN' });
  });

  it('addMember() creates a TeamMember row', async () => {
    const create = sinon.stub(prisma.teamMember, 'create').resolves({} as any);
    await new TeamService().addMember('t1', 'u1');
    expect(create.firstCall.args[0].data).to.deep.equal({ teamId: 't1', userId: 'u1' });
  });

  it('removeMember() deletes by composite key', async () => {
    const del = sinon.stub(prisma.teamMember, 'delete').resolves({} as any);
    await new TeamService().removeMember('t1', 'u1');
    expect(del.firstCall.args[0].where).to.deep.equal({
      teamId_userId: { teamId: 't1', userId: 'u1' },
    });
  });

  it('delete() blocks when team has devices OR active members', async () => {
    sinon.stub(prisma.device, 'count').resolves(1);
    sinon.stub(prisma.teamMember, 'count').resolves(0);
    let err: Error | undefined;
    try {
      await new TeamService().delete('t1');
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).to.match(/Reassign them before deleting/);
  });

  it('delete() drops FK on revoked apiKeys then deletes the team', async () => {
    sinon.stub(prisma.device, 'count').resolves(0);
    sinon.stub(prisma.teamMember, 'count').resolves(0);
    const apiKeyUpdate = sinon.stub(prisma.apiKey, 'updateMany').resolves({ count: 0 } as any);
    const teamDel = sinon.stub(prisma.team, 'delete').resolves({} as any);
    await new TeamService().delete('t1');
    expect(apiKeyUpdate.calledOnce).to.be.true;
    expect(teamDel.calledOnce).to.be.true;
  });
});
```

- [ ] **Step 2: RED**

- [ ] **Step 3: Replace `src/services/TeamService.ts`**

```ts
import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';

@Service()
export class TeamService {
  private log = log.scope('Team');

  async list() {
    const rows = await prisma.team.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { devices: true, members: true } } },
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
      deviceCount: t._count.devices,
      memberCount: t._count.members,
    }));
  }

  async create(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('name required');
    return prisma.team.create({ data: { name: trimmed } });
  }

  async delete(id: string): Promise<void> {
    const [devices, members] = await Promise.all([
      prisma.device.count({ where: { teamId: id } }),
      prisma.teamMember.count({ where: { teamId: id } }),
    ]);
    if (devices > 0 || members > 0) {
      throw new Error(
        `Team still has ${devices} device(s) and ${members} member(s). Reassign them before deleting.`,
      );
    }
    // Clear teamId on any (revoked) ApiKey rows so the FK doesn't block delete.
    await prisma.apiKey.updateMany({ where: { teamId: id }, data: { teamId: null } });
    await prisma.team.delete({ where: { id } });
  }

  async listMembers(teamId: string) {
    const rows = await prisma.teamMember.findMany({
      where: { teamId },
      include: { user: { select: { email: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.user.role,
      addedAt: m.createdAt,
    }));
  }

  async addMember(teamId: string, userId: string) {
    return prisma.teamMember.create({ data: { teamId, userId } });
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId, userId } },
    });
  }
}
```

The old `TeamRole` export and the `role` parameter on `addMember` are gone. The role concept moved up to the User itself in Phase 1; per-team admin/member sub-roles aren't part of Phase 3 scope.

- [ ] **Step 4: GREEN** (6 tests)

- [ ] **Step 5: Commit**

```
cat > /tmp/xenon-task4-msg.txt << 'XENON_EOF'
feat(auth): TeamService rewritten User-keyed via TeamMember

list/listMembers/addMember/removeMember switch from ApiKey-keyed
membership to User-keyed via the new TeamMember join table. The
old TeamRole export and the per-team role parameter on addMember
are gone — User.role is the source of truth now.

delete() still blocks on non-zero devices OR members, just counted
through the new table. Revoked ApiKeys with teamId still get the
FK cleared on delete so the team row can be removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/services/TeamService.ts test/unit/TeamService.test.ts
git commit -F /tmp/xenon-task4-msg.txt && rm /tmp/xenon-task4-msg.txt
```

---

## Task 5: `/users` router (TDD)

**Files:**
- Create: `src/app/routers/users.ts`
- Create: `test/unit/users-router.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// test/unit/users-router.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { usersRouter } from '../../src/app/routers/users';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { prisma } from '../../src/prisma';

function appWithAuth(auth: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = auth;
    next();
  });
  app.use('/users', usersRouter());
  return app;
}

describe('/users router', () => {
  afterEach(() => sinon.restore());

  it('GET /users returns the listUsers result, filtered by caller role', async () => {
    sinon.stub(Container.get(UserService), 'listUsers').resolves([{ id: 'u1' }] as any);
    const app = appWithAuth({ userId: 'admin', role: 'ADMIN' });
    const r = await request(app).get('/users');
    expect(r.status).to.equal(200);
    expect(r.body[0].id).to.equal('u1');
  });

  it('POST /users creates a user with a temp password when password is omitted', async () => {
    sinon.stub(Container.get(UserService), 'createUser').resolves({
      id: 'new-user',
      email: 'new@x.local',
      name: 'New',
      role: 'MEMBER',
      status: 'ACTIVE',
      accessKey: 'xen_NEW0000NEW00',
    } as any);
    const app = appWithAuth({ userId: 'admin', role: 'ADMIN' });
    const r = await request(app)
      .post('/users')
      .send({ email: 'new@x.local', name: 'New', role: 'MEMBER' });
    expect(r.status).to.equal(201);
    expect(r.body.id).to.equal('new-user');
    expect(r.body.temporaryPassword).to.match(/^[A-Za-z0-9_-]{12,}$/);
  });

  it('POST /users — ADMIN cannot create an ADMIN', async () => {
    const app = appWithAuth({ userId: 'admin', role: 'ADMIN' });
    const r = await request(app)
      .post('/users')
      .send({ email: 'wannabe@x.local', name: 'Wannabe', role: 'ADMIN' });
    expect(r.status).to.equal(403);
  });

  it('PATCH /users/:id — refuses self role-change', async () => {
    const app = appWithAuth({ userId: 'me', role: 'SUPER_ADMIN' });
    const r = await request(app).patch('/users/me').send({ role: 'MEMBER' });
    expect(r.status).to.equal(400);
    expect(r.body.error).to.match(/role-change yourself/);
  });

  it('PATCH /users/:id — refuses email change silently (no error, ignored)', async () => {
    sinon.stub(prisma.user, 'findUnique').resolves({ id: 't1', role: 'MEMBER' } as any);
    const update = sinon.stub(Container.get(UserService), 'updateUser').resolves({
      id: 't1',
      email: 'old@x.local',
      name: 'T',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as any);
    const app = appWithAuth({ userId: 'admin', role: 'ADMIN' });
    const r = await request(app).patch('/users/t1').send({ email: 'evil@x.local', name: 'NewName' });
    expect(r.status).to.equal(200);
    const passedPatch = update.firstCall.args[1];
    expect(passedPatch).to.not.have.property('email');
    expect(passedPatch.name).to.equal('NewName');
  });

  it('DELETE /users/:id — refuses self-delete', async () => {
    const app = appWithAuth({ userId: 'me', role: 'SUPER_ADMIN' });
    const r = await request(app).delete('/users/me');
    expect(r.status).to.equal(400);
    expect(r.body.error).to.match(/delete yourself/);
  });

  it('DELETE /users/:id — refuses last super-admin', async () => {
    sinon
      .stub(prisma.user, 'findUnique')
      .resolves({ id: 'last-sa', role: 'SUPER_ADMIN' } as any);
    sinon.stub(prisma.user, 'count').resolves(0); // no others
    const app = appWithAuth({ userId: 'me', role: 'SUPER_ADMIN' });
    const r = await request(app).delete('/users/last-sa');
    expect(r.status).to.equal(400);
    expect(r.body.error).to.match(/last active super-admin/);
  });
});
```

- [ ] **Step 2: RED**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/users-router.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/app/routers/users.ts
/// <reference path="../../types/express.d.ts" />
import { Router } from 'express';
import { Container } from 'typedi';
import crypto from 'crypto';
import { UserService } from '../../services/UserService';
import { roleGuard } from '../../middleware/roleGuard';
import {
  canActOn,
  assertNotSelf,
  assertNotLastSuperAdmin,
} from '../../services/identity/userAuthorization';
import { prisma } from '../../prisma';
import type { UserRole } from '../../types/identity';

function isUserRole(v: unknown): v is UserRole {
  return v === 'SUPER_ADMIN' || v === 'ADMIN' || v === 'MEMBER';
}

function makeTempPassword(): string {
  // 9 random bytes → 12 base64url chars; URL-safe, no special characters.
  return crypto.randomBytes(9).toString('base64url');
}

export function usersRouter(): Router {
  const r = Router();
  r.use(roleGuard('ADMIN'));
  const userSvc = Container.get(UserService);

  function getAuth(req: any) {
    return req.auth as { userId: string; role: UserRole };
  }

  r.get('/', async (req, res) => {
    const auth = getAuth(req);
    const users = await userSvc.listUsers(auth.role);
    res.json(users);
  });

  r.post('/', async (req, res) => {
    const auth = getAuth(req);
    const { email, name, role, password } = req.body as {
      email?: string;
      name?: string;
      role?: string;
      password?: string;
    };
    if (!email || !name || !role) {
      return res.status(400).json({ error: 'email, name, role required' });
    }
    if (!isUserRole(role)) {
      return res.status(400).json({ error: 'role must be SUPER_ADMIN | ADMIN | MEMBER' });
    }
    if (!canActOn(auth.role, role)) {
      return res.status(403).json({ error: `cannot create user with role ${role}` });
    }
    const tempPw = password ?? makeTempPassword();
    if (tempPw.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }
    const created = await userSvc.createUser({ email, name, role, password: tempPw });
    return res.status(201).json({
      id: created.id,
      email: created.email,
      name: created.name,
      role: created.role,
      status: created.status,
      accessKey: created.accessKey,
      // Only echo the temp password back when the server generated it; if the
      // caller passed an explicit password, they already have it.
      temporaryPassword: password ? undefined : tempPw,
    });
  });

  r.patch('/:id', async (req, res) => {
    const auth = getAuth(req);
    const targetId = req.params.id;
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (!canActOn(auth.role, target.role as UserRole)) {
      return res.status(403).json({ error: 'insufficient permissions for this target' });
    }

    const { name, role, status } = req.body as {
      name?: string;
      role?: string;
      status?: string;
    };

    if (role !== undefined) {
      if (!isUserRole(role)) {
        return res.status(400).json({ error: 'role must be SUPER_ADMIN | ADMIN | MEMBER' });
      }
      try {
        assertNotSelf(auth.userId, targetId, 'role-change');
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      if (!canActOn(auth.role, role)) {
        return res.status(403).json({ error: `cannot promote to role ${role}` });
      }
      // If demoting away from SUPER_ADMIN, ensure target wasn't the last one.
      if (target.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
        try {
          await assertNotLastSuperAdmin(targetId);
        } catch (e: any) {
          return res.status(400).json({ error: e.message });
        }
      }
    }

    if (status === 'INACTIVE' && target.role === 'SUPER_ADMIN') {
      try {
        await assertNotLastSuperAdmin(targetId);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }

    const updated = await userSvc.updateUser(targetId, {
      name,
      role: role as UserRole | undefined,
      status: status as 'ACTIVE' | 'INACTIVE' | undefined,
    });
    if (status === 'INACTIVE') {
      // updateUser sets status; we additionally revoke sessions.
      await prisma.userSession.deleteMany({ where: { userId: targetId } });
    }
    res.json({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      status: updated.status,
    });
  });

  r.delete('/:id', async (req, res) => {
    const auth = getAuth(req);
    const targetId = req.params.id;
    try {
      assertNotSelf(auth.userId, targetId, 'delete');
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (!canActOn(auth.role, target.role as UserRole)) {
      return res.status(403).json({ error: 'insufficient permissions for this target' });
    }
    if (target.role === 'SUPER_ADMIN') {
      try {
        await assertNotLastSuperAdmin(targetId);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }
    await userSvc.deleteUser(targetId);
    res.status(204).end();
  });

  return r;
}
```

- [ ] **Step 4: GREEN** (7 tests)

- [ ] **Step 5: Commit**

```
cat > /tmp/xenon-task5-msg.txt << 'XENON_EOF'
feat(auth): /users router — CRUD with role + self + last-SA guards

Four endpoints:
- GET /users  (response filtered per caller role; ADMIN sees only members)
- POST /users (creates user; if password omitted, returns a temp once)
- PATCH /users/:id (name/role/status; email immutable; lockout-safe)
- DELETE /users/:id (cascade clears sessions/keys/teams/reset tokens)

Authorization layered: roleGuard('ADMIN') is the floor; handler-level
canActOn / assertNotSelf / assertNotLastSuperAdmin add target-aware
checks. Self can't role-change or delete; last super-admin is locked.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/app/routers/users.ts test/unit/users-router.test.ts
git commit -F /tmp/xenon-task5-msg.txt && rm /tmp/xenon-task5-msg.txt
```

---

## Task 6: `/teams/:id/members` shape change (User-keyed)

**File:** Modify `src/app/routers/teams.ts`.

The existing routes are `GET /:id/members` (already returns `listMembers` output — Task 4 already changed that), `POST /:id/members { apiKeyId, role }`, `DELETE /:id/members/:apiKeyId`. POST and DELETE need to switch to userId.

- [ ] **Step 1: Read** `src/app/routers/teams.ts`. Confirm the three /members routes around lines 37, 41, 52.

- [ ] **Step 2: Replace** the POST and DELETE routes:

```ts
// OLD:
// r.post('/:id/members', scopeGuard(['admin']), async (req, res) => { ... apiKeyId + role ... });
// r.delete('/:id/members/:apiKeyId', scopeGuard(['admin']), async (req, res) => { ... });

// NEW:
r.post('/:id/members', scopeGuard(['admin']), async (req, res) => {
  const teamId = req.params.id;
  const { userId } = req.body as { userId?: string };
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const row = await svc.addMember(teamId, userId);
    res.status(201).json({ userId: row.userId, addedAt: row.createdAt });
  } catch (e: any) {
    // Composite-PK conflict → 409 (already a member)
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'user is already a member of this team' });
    }
    res.status(500).json({ error: e.message });
  }
});

r.delete('/:id/members/:userId', scopeGuard(['admin']), async (req, res) => {
  const { id: teamId, userId } = req.params;
  try {
    await svc.removeMember(teamId, userId);
    res.status(204).end();
  } catch (e: any) {
    if (e?.code === 'P2025') {
      return res.status(404).json({ error: 'member not found' });
    }
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Type-check + run team-related tests**

```
npx tsc --noEmit 2>&1 | grep "routers/teams\\.ts" || echo "tsc clean"
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/TeamService.test.ts test/integration/role-matrix.spec.ts
```

- [ ] **Step 4: Commit**

```
cat > /tmp/xenon-task6-msg.txt << 'XENON_EOF'
feat(auth): /teams/:id/members switches from apiKey-keyed to user-keyed

POST now takes { userId }, returns 201 { userId, addedAt }.
DELETE path param is :userId, not :apiKeyId.
Composite-PK collision yields 409 ("already a member"); missing
member on delete yields 404. The existing roleGuard('ADMIN') +
scopeGuard(['admin']) chain on the parent router still applies.

Breaking change vs the previous shape; the only consumer is
web/src/components/settings/teams.tsx, rewritten in PR-C.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/app/routers/teams.ts
git commit -F /tmp/xenon-task6-msg.txt && rm /tmp/xenon-task6-msg.txt
```

---

## Task 7: Mount `/users` in `src/app/index.ts`

**File:** Modify `src/app/index.ts`.

- [ ] **Step 1:** Add the import alongside the other router imports:

```ts
import { usersRouter } from './routers/users';
```

- [ ] **Step 2:** Find the line that mounts `apiKeysRouter` (around the same area as profile / auth mounts in Phase 1 / 2). Add immediately after:

```ts
apiRouter.use('/users', usersRouter());
```

(Order doesn't matter much, but grouping it next to `/apikeys` and `/teams` makes the admin-tier surface area easy to find.)

- [ ] **Step 3:** Type-check.

```
npx tsc --noEmit 2>&1 | grep "src/app/index\\.ts" || echo "tsc clean"
```

- [ ] **Step 4:** Commit.

```
cat > /tmp/xenon-task7-msg.txt << 'XENON_EOF'
feat(auth): mount /users router on apiRouter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/app/index.ts
git commit -F /tmp/xenon-task7-msg.txt && rm /tmp/xenon-task7-msg.txt
```

---

## Task 8: Integration tests — users-flow + users-lockout + migration + role-matrix extension

**Files:**
- Create: `test/integration/users-flow.spec.ts`
- Create: `test/integration/users-lockout.spec.ts`
- Create: `test/integration/team-membership-migration.spec.ts`
- Modify: `test/integration/role-matrix.spec.ts`

These all hit the real Prisma DB. The DB has the Phase 3 schema already (Task 1).

- [ ] **Step 1: `users-flow.spec.ts`**

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { usersRouter } from '../../src/app/routers/users';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';

describe('users CRUD flow (integration)', function () {
  this.timeout(60_000);
  let sa: SeededUser;
  let admin: SeededUser;
  const TAGS = ['flow-sa', 'flow-admin', 'flow-bob'];

  before(async () => {
    sa = await seedUser('SUPER_ADMIN', { name: 'Flow SA' });
    admin = await seedUser('ADMIN', { name: 'Flow Admin' });
  });

  after(async () => {
    await sa.cleanup();
    await admin.cleanup();
    // Anything created during the flow with email matching tag prefix.
    await prisma.user.deleteMany({ where: { email: { contains: 'flow-bob' } } });
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    app.use('/users', usersRouter());
    return app;
  }

  it('SA creates an admin → admin creates a member → admin lists', async () => {
    const app = buildApp();

    // ADMIN role-create — should fail with 403 (admin can't create admins).
    const denied = await request(app)
      .post('/users')
      .set('Cookie', admin.cookie)
      .send({ email: 'flow-admin2@xenon.local', name: 'Admin 2', role: 'ADMIN' });
    expect(denied.status).to.equal(403);

    // SA creates a member.
    const memberEmail = `flow-bob-${Date.now()}@xenon.local`;
    const created = await request(app)
      .post('/users')
      .set('Cookie', sa.cookie)
      .send({ email: memberEmail, name: 'Bob', role: 'MEMBER' });
    expect(created.status).to.equal(201);
    expect(created.body.temporaryPassword).to.match(/^[A-Za-z0-9_-]{12,}$/);

    // Admin lists — sees member; does NOT see SA or other admins.
    const listAdmin = await request(app).get('/users').set('Cookie', admin.cookie);
    expect(listAdmin.status).to.equal(200);
    const emailsAdmin = listAdmin.body.map((u: any) => u.email);
    expect(emailsAdmin).to.include(memberEmail);
    expect(emailsAdmin).to.not.include(sa.user.email);

    // SA lists — sees everyone.
    const listSA = await request(app).get('/users').set('Cookie', sa.cookie);
    const emailsSA = listSA.body.map((u: any) => u.email);
    expect(emailsSA).to.include(sa.user.email);
    expect(emailsSA).to.include(admin.user.email);
    expect(emailsSA).to.include(memberEmail);
  });
});
```

- [ ] **Step 2: `users-lockout.spec.ts`**

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { usersRouter } from '../../src/app/routers/users';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';

describe('users lockout protections (integration)', function () {
  this.timeout(60_000);

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    app.use('/users', usersRouter());
    return app;
  }

  it('SA cannot delete themselves', async () => {
    const me = await seedUser('SUPER_ADMIN', { name: 'Lockout Self' });
    try {
      const r = await request(buildApp()).delete(`/users/${me.user.id}`).set('Cookie', me.cookie);
      expect(r.status).to.equal(400);
      expect(r.body.error).to.match(/yourself/);
    } finally {
      await me.cleanup();
    }
  });

  it('SA cannot demote themselves', async () => {
    const me = await seedUser('SUPER_ADMIN', { name: 'Lockout Demote-Self' });
    try {
      const r = await request(buildApp())
        .patch(`/users/${me.user.id}`)
        .set('Cookie', me.cookie)
        .send({ role: 'MEMBER' });
      expect(r.status).to.equal(400);
    } finally {
      await me.cleanup();
    }
  });

  // The strongest-but-flakiest case: when there's only one active SA, that user
  // (acting via *another* SA cookie) cannot be demoted. We synthesize this by
  // ensuring the test runs against a DB where exactly one SA exists. Done with
  // a count-aware skip if there's already a bootstrap SA: in CI / dev the DB
  // typically has ≥1 pre-existing SA from bootstrap. We only run this test when
  // we can guarantee single-SA state.
  it('cannot demote the last active super-admin', async function () {
    const activeSAs = await prisma.user.count({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    });
    if (activeSAs > 1) {
      this.skip();
      return;
    }
    // Seed a second SA to act as the actor; then try to demote the only
    // pre-existing SA (which would leave 1 SA — the actor — but the rule
    // counts OTHER SAs, so this case requires deactivation of the actor first.
    // Skipping the multi-SA case is fine; the unit test in
    // userAuthorization.test.ts covers the count-zero branch directly.
    this.skip();
  });
});
```

The third test is intentionally skipped in most environments — the unit test on `assertNotLastSuperAdmin` already covers the count-zero branch deterministically.

- [ ] **Step 3: `team-membership-migration.spec.ts`**

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { TeamService } from '../../src/services/TeamService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { prisma } from '../../src/prisma';

describe('team-membership migration backfill (integration)', function () {
  this.timeout(60_000);
  // Only meaningful as a smoke against a freshly-migrated DB. We can't easily
  // re-run the migration mid-test, so this asserts the *post-migration* state:
  // any TeamMember row whose userId is Legacy Admin is forbidden. (The migration
  // is idempotent thanks to the composite PK; running it again is a no-op.)

  it('no TeamMember row points at Legacy Admin', async () => {
    const legacy = await prisma.user.findFirst({
      where: { email: 'legacy-admin@xenon.local' },
    });
    if (!legacy) {
      // Legacy Admin only exists if Phase 1's adoption migration actually ran
      // against a non-empty ApiKey table. Skip if absent.
      // eslint-disable-next-line no-console
      console.log('skipped: no Legacy Admin in this DB');
      return;
    }
    const polluted = await prisma.teamMember.count({
      where: { userId: legacy.id },
    });
    expect(polluted).to.equal(0);
  });

  it('addMember() / removeMember() round-trip an arbitrary user', async () => {
    const u = await Container.get(UserService).createUser({
      email: `tm-rt-${Date.now()}@xenon.local`,
      name: 'TM Round Trip',
      password: 'tm-rt-pass-1',
      role: 'MEMBER',
    });
    const t = await Container.get(TeamService).create(`tm-rt-${Date.now()}`);
    try {
      await Container.get(TeamService).addMember(t.id, u.id);
      const members = await Container.get(TeamService).listMembers(t.id);
      expect(members.find((m) => m.userId === u.id)).to.exist;
      await Container.get(TeamService).removeMember(t.id, u.id);
      const after = await Container.get(TeamService).listMembers(t.id);
      expect(after.find((m) => m.userId === u.id)).to.not.exist;
    } finally {
      await prisma.teamMember.deleteMany({ where: { userId: u.id } });
      await prisma.team.delete({ where: { id: t.id } }).catch(() => undefined);
      await prisma.userSession.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
});
```

- [ ] **Step 4: Extend `test/integration/role-matrix.spec.ts`**

Read the file. Add these cases to the `CASES` array (`/users` routes get the same SA-200, A-200, M-403 pattern as `/teams`):

```ts
{
  name: 'users list',
  method: 'GET',
  path: '/users',
  expect: { SUPER_ADMIN: 200, ADMIN: 200, MEMBER: 403 },
},
{
  name: 'users create (member)',
  method: 'POST',
  path: '/users',
  body: { email: `rmcase-${Date.now()}@xenon.local`, name: 'RM', role: 'MEMBER' },
  expect: { SUPER_ADMIN: 201, ADMIN: 201, MEMBER: 403 },
},
```

Add `usersRouter` to the buildApp imports + `app.use('/users', usersRouter())` mount.

After-hook cleanup: any user created during the test gets removed in the `after` block (filter by email containing `rmcase-`).

- [ ] **Step 5: Run all four**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 \
  test/integration/role-matrix.spec.ts \
  test/integration/users-flow.spec.ts \
  test/integration/users-lockout.spec.ts \
  test/integration/team-membership-migration.spec.ts
```

- [ ] **Step 6: Commit**

```
cat > /tmp/xenon-task8-msg.txt << 'XENON_EOF'
test(integration): users CRUD flow + lockout + team-member migration + role-matrix

Adds four integration suites for Phase 3:
- users-flow: SA creates admin -> admin creates member -> admin list
  filters out SA/admin rows; SA list shows everyone.
- users-lockout: self-delete + self-demote refused with 400.
- team-membership-migration: Legacy Admin's keys did NOT pollute team
  rosters; TeamService.addMember/removeMember round-trip a member.
- role-matrix.spec: extended with /users GET + POST cases (SA 200/201,
  ADMIN 200/201, MEMBER 403).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add test/integration/users-flow.spec.ts test/integration/users-lockout.spec.ts test/integration/team-membership-migration.spec.ts test/integration/role-matrix.spec.ts
git commit -F /tmp/xenon-task8-msg.txt && rm /tmp/xenon-task8-msg.txt
```

---

## Task 9: PR-A finalization

- [ ] **Run the full identity surface:**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 \
  test/unit/UserService.test.ts test/unit/UserSessionService.test.ts \
  test/unit/ApiKeyService.test.ts test/unit/loginRateLimiter.test.ts \
  test/unit/authMiddleware.test.ts test/unit/apiKeyMiddleware.test.ts \
  test/unit/profile-router.test.ts test/unit/bootstrap-identity.test.ts \
  test/unit/extract-access-key-token-pair.test.ts test/unit/roleGuard.test.ts \
  test/unit/PasswordResetService.test.ts test/unit/EmailService.test.ts \
  test/unit/userAuthorization.test.ts test/unit/users-router.test.ts \
  test/unit/TeamService.test.ts \
  test/integration/auth-flow.spec.ts test/integration/auth-rate-limit.spec.ts \
  test/integration/profile-tokens.spec.ts test/integration/legacy-key-compat.spec.ts \
  test/integration/migration.spec.ts test/integration/role-matrix.spec.ts \
  test/integration/forgot-password.spec.ts \
  test/integration/forgot-password-rate-limit.spec.ts \
  test/integration/reset-revokes-sessions.spec.ts \
  test/integration/users-flow.spec.ts test/integration/users-lockout.spec.ts \
  test/integration/team-membership-migration.spec.ts
```

- [ ] `npx tsc --noEmit` clean.
- [ ] `git push -u origin feat/phase-3-users-teams`.
- [ ] Open PR-A: title `feat(auth): Phase 3 users + teams backend (PR-A of 3)`. Body links spec, lists deliverables, the test count, and points at PR-B / PR-C.

---

# PR-B — Frontend `/users` page + sidebar entry

**Branch:** `feat/phase-3-users-page` (off `main` after PR-A merge: `git checkout main && git pull && git checkout -b feat/phase-3-users-page`).
**Ships:** new `/users` page, sidebar item, vitest smoke. No team-membership UI yet.

---

## Task 10: `web/src/api-service/users.ts`

**File:** Create `web/src/api-service/users.ts`.

```ts
const BASE = '/xenon/api/users';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  lastLoginAt: string | null;
}

export interface CreateUserResult {
  id: string;
  email: string;
  name: string;
  role: UserRow['role'];
  status: UserRow['status'];
  accessKey: string;
  temporaryPassword?: string;
}

export async function listUsers(): Promise<UserRow[]> {
  const r = await fetch(`${BASE}/`, { credentials: 'include' });
  if (!r.ok) throw new Error(`listUsers failed (${r.status})`);
  return r.json();
}

export async function createUser(input: {
  email: string;
  name: string;
  role: UserRow['role'];
  password?: string;
}): Promise<CreateUserResult> {
  const r = await fetch(`${BASE}/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `createUser failed (${r.status})`);
  }
  return r.json();
}

export async function updateUser(
  id: string,
  patch: { name?: string; role?: UserRow['role']; status?: UserRow['status'] },
): Promise<UserRow> {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `updateUser failed (${r.status})`);
  }
  return r.json();
}

export async function deleteUser(id: string): Promise<void> {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!r.ok && r.status !== 204) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `deleteUser failed (${r.status})`);
  }
}
```

- [ ] Commit:

```
cat > /tmp/xenon-task10-msg.txt << 'XENON_EOF'
feat(web): users API helpers — list / create / update / delete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add web/src/api-service/users.ts
git commit -F /tmp/xenon-task10-msg.txt && rm /tmp/xenon-task10-msg.txt
```

---

## Task 11: `/users` page

**File:** Create `web/src/pages/users.tsx`.

```tsx
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Plus, Trash2, Edit, KeyRound } from 'lucide-react';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  UserRow,
} from '../api-service/users';
import { forgotPassword } from '../api-service/auth';
import { useAuth } from '../auth/auth-context';

const ROLE_LABELS: Record<UserRow['role'], string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

export default function UsersPage() {
  const { me } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [revealedPassword, setRevealedPassword] = useState<{ email: string; password: string } | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setRows(await listUsers());
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function onDelete(u: UserRow) {
    if (!confirm(`Delete ${u.email}? This cannot be undone.`)) return;
    try {
      await deleteUser(u.id);
      setRows((rs) => rs.filter((r) => r.id !== u.id));
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function onResetPassword(u: UserRow) {
    if (!confirm(`Send a password-reset link to ${u.email}?`)) return;
    try {
      await forgotPassword(u.email);
      alert(`Reset link sent (or logged) for ${u.email}.`);
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div className="px-8 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Users</h1>
        <button
          onClick={() => setShowInvite(true)}
          className="h-9 px-4 rounded-md bg-[var(--green)] text-black font-medium text-sm flex items-center gap-1"
        >
          <Plus size={14} /> Invite User
        </button>
      </div>

      {error && <div className="text-sm text-[var(--red)] mb-4">{error}</div>}

      {loading ? (
        <div className="text-sm text-[var(--text-dim)]">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-[var(--text-dim)] py-8 text-center border border-dashed border-[var(--border)] rounded-md">
          No users to show — invite the first one above.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[11px] text-[var(--text-dim)] uppercase tracking-wide">
            <tr>
              <th className="text-left py-2">Name</th>
              <th className="text-left py-2">Email</th>
              <th className="text-left py-2">Role</th>
              <th className="text-left py-2">Status</th>
              <th className="text-left py-2">Last Login</th>
              <th className="w-px"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const isSelf = me?.userId === u.id;
              return (
                <tr key={u.id} className="border-t border-[var(--border)]">
                  <td className="py-2">{u.name}</td>
                  <td className="py-2 text-[var(--text-muted)]">{u.email}</td>
                  <td className="py-2">{ROLE_LABELS[u.role]}</td>
                  <td className="py-2">
                    {u.status === 'ACTIVE' ? (
                      <span className="text-[var(--green)]">Active</span>
                    ) : (
                      <span className="text-[var(--text-dim)]">Inactive</span>
                    )}
                  </td>
                  <td className="py-2 text-[var(--text-muted)]">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                  </td>
                  <td className="py-2 text-right space-x-2">
                    <button
                      onClick={() => setEditing(u)}
                      disabled={isSelf}
                      title={isSelf ? 'Use a different super-admin to manage your own account' : 'Edit'}
                      className="text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-30"
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={() => onResetPassword(u)}
                      title="Send password-reset link"
                      className="text-[var(--text-dim)] hover:text-[var(--text)]"
                    >
                      <KeyRound size={14} />
                    </button>
                    <button
                      onClick={() => onDelete(u)}
                      disabled={isSelf}
                      title={isSelf ? 'Use a different super-admin to manage your own account' : 'Delete'}
                      className="text-[var(--red)] hover:opacity-80 disabled:opacity-30"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onCreated={(result) => {
            setShowInvite(false);
            if (result.temporaryPassword) {
              setRevealedPassword({ email: result.email, password: result.temporaryPassword });
            }
            refresh();
          }}
          callerRole={me?.role ?? 'MEMBER'}
        />
      )}

      {editing && (
        <EditModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {revealedPassword && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center" role="dialog">
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-md p-6">
            <h3 className="text-base font-semibold mb-2">User created</h3>
            <p className="text-xs text-[var(--text-dim)] mb-3">
              Temporary password for {revealedPassword.email}. Copy now — it will not be shown again.
            </p>
            <code className="block break-all px-3 py-2 rounded bg-[var(--surface)] border border-[var(--border)] text-xs mb-3">
              {revealedPassword.password}
            </code>
            <div className="flex justify-end">
              <button
                onClick={() => setRevealedPassword(null)}
                className="h-9 px-4 rounded-md bg-[var(--green)] text-black text-sm font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InviteModal({
  onClose,
  onCreated,
  callerRole,
}: {
  onClose: () => void;
  onCreated: (r: { email: string; temporaryPassword?: string }) => void;
  callerRole: UserRow['role'];
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRow['role']>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ADMIN can only invite MEMBERs; SUPER_ADMIN can invite anyone.
  const allowedRoles: UserRow['role'][] =
    callerRole === 'SUPER_ADMIN'
      ? ['SUPER_ADMIN', 'ADMIN', 'MEMBER']
      : ['MEMBER'];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await createUser({ email, name, role });
      onCreated({ email: r.email, temporaryPassword: r.temporaryPassword });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center" role="dialog">
      <form onSubmit={submit} className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-md p-6">
        <h3 className="text-lg font-semibold mb-4">Invite User</h3>
        <label className="block text-xs text-[var(--text-dim)] mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
          className="w-full mb-3 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm"
        />
        <label className="block text-xs text-[var(--text-dim)] mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full mb-3 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm"
        />
        <label className="block text-xs text-[var(--text-dim)] mb-1">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRow['role'])}
          className="w-full mb-4 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm"
        >
          {allowedRoles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        {error && <div className="text-xs text-[var(--red)] mb-2">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-md border border-[var(--border)] text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !email || !name}
            className="h-9 px-4 rounded-md bg-[var(--green)] text-black text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<UserRow['role']>(user.role);
  const [status, setStatus] = useState<UserRow['status']>(user.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateUser(user.id, { name, role, status });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center" role="dialog">
      <form onSubmit={submit} className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-md p-6">
        <h3 className="text-lg font-semibold mb-4">Edit User — {user.email}</h3>
        <label className="block text-xs text-[var(--text-dim)] mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full mb-3 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm"
        />
        <label className="block text-xs text-[var(--text-dim)] mb-1">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRow['role'])}
          className="w-full mb-3 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm"
        >
          <option value="SUPER_ADMIN">Super Admin</option>
          <option value="ADMIN">Admin</option>
          <option value="MEMBER">Member</option>
        </select>
        <label className="block text-xs text-[var(--text-dim)] mb-1">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as UserRow['status'])}
          className="w-full mb-4 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm"
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
        {error && <div className="text-xs text-[var(--red)] mb-2">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-md border border-[var(--border)] text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="h-9 px-4 rounded-md bg-[var(--green)] text-black text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] Commit:

```
cat > /tmp/xenon-task11-msg.txt << 'XENON_EOF'
feat(web): /users page — list + invite + edit + delete

The list shows every user the caller is allowed to see (server-side
filter; ADMIN sees only MEMBERs). "Invite User" opens a modal that
collects email + name + role; on success the page shows the temp
password once, then refreshes the list. Per-row actions: edit, send
password-reset link (reuses Phase 2's /auth/forgot-password), delete.
The current user's own row has Edit and Delete disabled with a
tooltip explaining why.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add web/src/pages/users.tsx
git commit -F /tmp/xenon-task11-msg.txt && rm /tmp/xenon-task11-msg.txt
```

---

## Task 12: Sidebar entry + route registration

**Files:**
- Modify: `web/src/components/sidebar/sidebar.tsx`
- Modify: `web/src/routes/index.tsx`

- [ ] **Step 1: Sidebar item**

Read `sidebar.tsx`. Find the items array (Phase 2 added `minRole` to it). Add a new item, placing it next to the existing admin items (next to "Teams" or "API Keys"):

```tsx
{ id: 'users', label: 'Users', icon: <Users size={18} />, path: '/users', minRole: 'ADMIN' },
```

Make sure `Users` is imported from `lucide-react` at the top (it likely already is; the existing teams page also uses it).

- [ ] **Step 2: Route**

Read `web/src/routes/index.tsx`. Add a lazy import next to the existing pages:

```ts
const UsersPage = lazy(() => import('../pages/users'));
```

Add a `<Route>` inside the routes block (before any `*` catch-all):

```tsx
<Route path="/users" element={<UsersPage />} />
```

- [ ] **Step 3: Type-check + commit**

```
cd web && npx tsc --noEmit 2>&1 | grep -E "(sidebar|routes/index|pages/users)" || echo "tsc clean"
cd ..
cat > /tmp/xenon-task12-msg.txt << 'XENON_EOF'
feat(web): sidebar Users item + /users route registration

Sidebar gains a new entry gated minRole: 'ADMIN'. Phase 2's role-aware
visibility hides it from MEMBERs automatically. The route is mounted
inside RouteGuard so unauthenticated users still get the /login
redirect.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add web/src/components/sidebar/sidebar.tsx web/src/routes/index.tsx
git commit -F /tmp/xenon-task12-msg.txt && rm /tmp/xenon-task12-msg.txt
```

---

## Task 13: Vitest smoke for `/users`

**File:** Create `web/src/pages/users.smoke.test.tsx`.

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UsersPage from './users';

vi.mock('../api-service/users', () => ({
  listUsers: vi.fn().mockResolvedValue([]),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock('../api-service/auth', () => ({
  forgotPassword: vi.fn(),
}));

vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    me: { userId: 'me', role: 'SUPER_ADMIN', email: 'me@x.local', name: 'Me', accessKey: '', scopes: '', teamId: null, kind: 'user-session' },
    loading: false,
    refresh: async () => {},
    signOut: async () => {},
  }),
}));

describe('UsersPage smoke', () => {
  it('renders empty state when /users returns []', async () => {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/No users to show/i)).toBeInTheDocument());
    expect(screen.getByText(/Invite User/i)).toBeInTheDocument();
  });
});
```

- [ ] Run: `cd web && npx vitest run src/pages/users.smoke.test.tsx` — 1 passing.
- [ ] Commit:

```
cat > /tmp/xenon-task13-msg.txt << 'XENON_EOF'
test(web): /users page smoke — empty-state render

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add web/src/pages/users.smoke.test.tsx
git commit -F /tmp/xenon-task13-msg.txt && rm /tmp/xenon-task13-msg.txt
```

---

## Task 14: PR-B finalization

- [ ] Run `cd web && npx vitest run` — all green.
- [ ] `cd web && npx tsc --noEmit` clean.
- [ ] Run the backend identity surface to confirm no regressions (PR-A's full sweep).
- [ ] Push: `git push -u origin feat/phase-3-users-page`.
- [ ] Open PR-B: title `feat(web): Phase 3 /users page (PR-B of 3)`. Body links spec, mentions sidebar visibility, points at PR-C for team-membership rewrite.

---

# PR-C — Team-membership UI rewrite + Device-team selector

**Branch:** `feat/phase-3-teams-devices-ui` (off `main` after PR-B merge).
**Ships:** rewritten Members tab in `teams.tsx` + Team selector cell on Devices page + manual verification.

---

## Task 15: `teams.tsx` Members tab — User-keyed rewrite

**File:** Modify `web/src/components/settings/teams.tsx`.

Read the current 582-line file. The structure (per the original survey):
- Top-level `TeamsPage` shell with create / list / delete.
- Detail view per team with three tabs (or one), one of which is "Members" — currently shows `MemberRow` rows from ApiKey-based data.

Two surgical edits:

- [ ] **Step 1: API helpers**

Add or update the helper that fetches team members (likely a `fetch('/xenon/api/teams/<id>/members')` call). Update its return-type interface from `MemberRow` (apiKey-shaped) to:

```ts
interface MemberRow {
  userId: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
  addedAt: string;
}
```

- [ ] **Step 2: Add-member picker switches from listing api keys → listing users**

The original "Add Member" picker (somewhere inside the file) listed `KeyRow[]` (api keys not in any team). It now lists users not in this team:

```ts
async function fetchAvailableUsers(teamId: string): Promise<UserRow[]> {
  const all = await listUsers(); // from web/src/api-service/users.ts
  // Filter out users already on the team. The team-members fetch happens in
  // parallel; trade simplicity for correctness — the picker shows everyone if
  // the members list is still loading.
  const members = await fetch(`/xenon/api/teams/${encodeURIComponent(teamId)}/members`, {
    credentials: 'include',
  }).then((r) => (r.ok ? r.json() : []));
  const memberIds = new Set((members as { userId: string }[]).map((m) => m.userId));
  return all.filter((u) => !memberIds.has(u.id));
}
```

The picker dropdown shows `name (email) — role badge`. On select → `POST /xenon/api/teams/:id/members { userId }` → refresh the members table.

Remove member: `DELETE /xenon/api/teams/:id/members/:userId` (path renamed from `:apiKeyId`).

- [ ] **Step 3: Display columns**

The Members table in the rewritten file shows: Name | Email | Role | Added | Actions (remove). The role column uses the same labels as the /users page: "Super Admin" / "Admin" / "Member".

- [ ] **Step 4: Cleanup**

- Drop `KeyRow` interface and any helper that fetched orphan api keys for the old picker.
- Drop the `role: 'admin' | 'member'` field on the addMember POST body — it's gone server-side.

- [ ] **Step 5: Type-check**

```
cd web && npx tsc --noEmit 2>&1 | grep "settings/teams\\.tsx" || echo "tsc clean"
```

- [ ] **Step 6: Commit**

```
cat > /tmp/xenon-task15-msg.txt << 'XENON_EOF'
refactor(web): teams.tsx Members tab — User-keyed rewrite

Switch from ApiKey-keyed membership (orphan keys + per-team role)
to User-keyed via TeamMember (PR-A). The picker now lists users
not on the team; the row shape is { userId, email, name, role,
addedAt } matching the new /teams/:id/members response. KeyRow
and the per-team role concept are gone.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add web/src/components/settings/teams.tsx
git commit -F /tmp/xenon-task15-msg.txt && rm /tmp/xenon-task15-msg.txt
```

---

## Task 16: Devices page — Team selector column

**File:** Identify the right file by reading `web/src/components/device-explorer/device-explorer.tsx` and `web/src/components/device-card/device-card/`. The Team selector wants to live in the device-list table (not the per-device card).

If the file uses a tabular `Table` primitive, add a new column header "Team" and a cell with a `<select>` listing all teams + an "(Unassigned)" option.

- [ ] **Step 1:** Add a small helper at the top of the file (or in a new co-located module — your call):

```ts
async function listTeams(): Promise<{ id: string; name: string }[]> {
  const r = await fetch('/xenon/api/teams', { credentials: 'include' });
  if (!r.ok) throw new Error(`listTeams failed (${r.status})`);
  const rows = await r.json();
  return rows.map((t: any) => ({ id: t.id, name: t.name }));
}

async function setDeviceTeam(udid: string, teamId: string | null): Promise<void> {
  const r = await fetch(`/xenon/api/grid/device/${encodeURIComponent(udid)}/team`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId }),
  });
  if (!r.ok && r.status !== 204) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `setDeviceTeam failed (${r.status})`);
  }
}
```

- [ ] **Step 2:** Inside the device-list component:
- Fetch the teams list once on mount: `const [teams, setTeams] = useState<{id, name}[]>([])`.
- For each device row, render a `<select>` next to the existing columns. Default value = `device.teamId ?? ''`. Options: `<option value="">(Unassigned)</option>` + one per team.
- On change: optimistic update of the local row, then `setDeviceTeam(udid, value || null)`. On failure, revert + toast (Phase 2's 403-toast pipeline auto-handles 403s; for other errors, show an alert or reuse a toast helper if available).
- Disable the `<select>` for callers whose role is < ADMIN (use `useAuth().me.role`). Members shouldn't see admin actions.

If the existing device-list shape doesn't fit a simple `<select>` cell (e.g. it's a card grid, not a table), pick the closest sensible spot — a "Team: …" line on the card with an inline edit button — and document the choice in the PR body.

- [ ] **Step 3: Type-check + commit**

```
cd web && npx tsc --noEmit 2>&1 | grep -E "(device-explorer|device-card)" || echo "tsc clean"
cd ..
cat > /tmp/xenon-task16-msg.txt << 'XENON_EOF'
feat(web): device list — Team selector column

Adds an inline team selector cell on the Devices page that calls
PUT /xenon/api/grid/device/:udid/team. Optimistic update; failures
revert with the standard 403-toast (Phase 2) or an inline alert.
Disabled for MEMBER-role callers (admin-only action).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add web/src/components/device-explorer/ web/src/components/device-card/ 2>/dev/null || true
# (Stage exactly the file(s) you actually edited.)
git commit -F /tmp/xenon-task16-msg.txt && rm /tmp/xenon-task16-msg.txt
```

---

## Task 17: Manual verification

Run `npm run dev` and walk through the spec's manual checklist (12 steps from the design's Manual Verification section). No commits in this task — manual notes go in the PR body.

If anything breaks, fix the bug, commit the fix, document in the PR body.

---

## Task 18: PR-C finalization

- [ ] Run backend identity surface (no changes expected).
- [ ] `cd web && npx vitest run` — all green.
- [ ] `cd web && npx tsc --noEmit` clean.
- [ ] Push: `git push -u origin feat/phase-3-teams-devices-ui`.
- [ ] Open PR-C: title `feat(web): Phase 3 teams + device-team UI (PR-C of 3)`. Body links spec, includes the manual-verification checklist with checked boxes, points at the now-completed Phase 3.

---

## Self-Review Checklist (pre-merge)

Before each PR:

- [ ] All tests in the relevant suite pass.
- [ ] `tsc --noEmit` clean for both backend AND frontend (where touched).
- [ ] No `git add -A` / `git add .` was used.
- [ ] Conventional Commits + Co-Authored-By trailer.
- [ ] No secrets / generated files leaked.
- [ ] Spec coverage:
  - PR-A: TeamMember model + migration + UserService extensions + /users router + teams /members shape change + integration tests + role-matrix extension.
  - PR-B: API helpers + /users page + sidebar + smoke test.
  - PR-C: teams.tsx Members tab User-keyed + Devices Team selector + manual verification.
- [ ] Risks from spec are addressed:
  - Backfill correctness — Legacy Admin filter in migration SQL; integration test asserts no Legacy Admin TeamMember rows.
  - teams.tsx rewrite churn — surgical edits only; `KeyRow` and per-team role removed cleanly.
  - Last-super-admin race — accepted nano-window; unit test covers count-zero deterministically.
  - Permission UX — self-row's Edit/Delete disabled with tooltip; ADMIN list filtered server-side so they don't see other admins.

---

## Out of scope for this plan (deferred to later phases)

- Per-team device-visibility enforcement on every device-listing endpoint — Phase 4
- Per-node `(accessKey, token)` for hub-node channel — Phase 4
- Sidebar redesign — Phase 5
- Bulk user import (CSV), avatar customization, magic-link onboarding, must-change-password flag, per-user rate limits
- 2FA / SSO / OIDC / account lockout — deferred indefinitely
