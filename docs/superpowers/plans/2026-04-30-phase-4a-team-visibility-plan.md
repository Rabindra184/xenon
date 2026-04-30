# Phase 4A — Per-team Device Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phase 3's `TeamMember` rows actually gate what members see — close the documented gap where today every authenticated user sees fleet-wide devices, queue, sessions, recordings, and builds regardless of team membership.

**Architecture:** `authMiddleware` populates `req.auth.teamIds: string[] | undefined` once per request (admins → undefined, members → their TeamMember rows, token-narrowed callers → `[apiKey.teamId]`). The existing single-team filter (`callerTeamId`) widens to multi-team (`callerTeamIds`) in three files: `IDeviceFilterOptions`, `prisma-store.ts`, `device-store.ts`. Every list-style read passes `req.auth.teamIds` into the data layer; SQL becomes `WHERE teamId IS NULL OR teamId IN (...)`.

**Tech Stack:** TypeScript 5.5, Prisma 5.4 (SQLite), Express, TypeDI, Mocha + chai + sinon, React 17 + vitest. No new dependencies, no schema changes.

**Spec:** `docs/superpowers/specs/2026-04-30-phase-4a-team-visibility-design.md`

---

## File Structure

| File | Purpose |
|---|---|
| `src/interfaces/IDeviceFilterOptions.ts` | MODIFIED — `callerTeamId?: string \| null` → `callerTeamIds?: string[]` |
| `src/types/express.d.ts` | MODIFIED — add `teamIds?: string[]` to `req.auth` |
| `src/middleware/authMiddleware.ts` | MODIFIED — populate `req.auth.teamIds` per resolution path (cookie/api-key/legacy) |
| `src/data-service/prisma-store.ts` | MODIFIED — filter SQL: `WHERE teamId IS NULL OR teamId IN (...)` |
| `src/data-service/device-store.ts` | MODIFIED — in-memory filter switches to array semantics |
| `src/device-utils.ts` | MODIFIED — `allocateDeviceForSession` accepts `callerTeamIds` |
| `src/services/SessionLifecycleService.ts` | MODIFIED — `authorizeSessionRequest` returns `callerTeamIds`; token-narrowing precedence (`ApiKey.teamId` → `[teamId]`) |
| `src/app/routers/grid.ts` | MODIFIED — `/devices`, `/device`, `/device/:platform` read `req.auth.teamIds` and pass through |
| `src/app/routers/dashboard.ts` | MODIFIED — session/build listing reads filter by team-visible udids |
| `src/app/routers/recordings.ts` | MODIFIED — recording listings filter by team-visible udids |
| `src/services/recording/*` (read helpers) | MODIFIED — accept and apply `callerTeamIds` on listings |
| `src/app/routers/auth.ts` | MODIFIED — `GET /auth/me` adds `teamIds` to the response |
| `web/src/api-service/auth.ts` | MODIFIED — `MePayload.teamIds: string[] \| null` |
| `web/src/pages/profile/profile-page.tsx` (or password-tab co-located shell) | MODIFIED — render "Your teams" line |
| `web/src/components/session-detail/session-detail-page.tsx` | MODIFIED — on 404, redirect to `/sessions` with toast |
| `test/unit/authMiddleware.test.ts` | MODIFIED — assert `req.auth.teamIds` per resolution path |
| `test/unit/team-filter.test.ts` | NEW — filter SQL shape per `callerTeamIds` value |
| `test/integration/team-visibility-grid.spec.ts` | NEW |
| `test/integration/team-visibility-dashboard.spec.ts` | NEW |
| `test/integration/team-visibility-recordings.spec.ts` | NEW |
| `test/integration/role-matrix.spec.ts` | MODIFIED — add team-scoped /grid/devices case |

---

## Conventions (read first)

- **Branches:** PR-A on `feat/phase-4a-team-visibility` (already created — spec at HEAD `5f17309`). PR-B on `feat/phase-4a-readsets` off latest main after PR-A merge. PR-C on `feat/phase-4a-frontend` off latest main after PR-B merge.
- **Commits:** Conventional Commits + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Test runner:** `XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 <path>`.
- **Type-check:** `npx tsc --noEmit` (root) and `cd web && npx tsc --noEmit` (frontend).
- **Working tree:** stage by exact path; never `git add -A`.
- **Commit messages:** `cat > /tmp/<task>-msg.txt << 'XENON_EOF' … XENON_EOF` (heredoc with quoted delimiter); `git commit -F /tmp/<task>-msg.txt`.
- **`callerTeamId` legacy callsite map:** before starting, run `grep -rnE "callerTeamId" src/ test/ 2>/dev/null` and confirm the surface the plan touches matches what's actually there.

---

# PR-A — Backend filter widening + /grid/devices

**Branch:** `feat/phase-4a-team-visibility` (spec already committed at HEAD `5f17309`).
**Ships:** filter signature widening, `req.auth.teamIds` population, `/grid/devices` honouring it, plus the unit + integration test bedrock. Other reads still see fleet-wide data — closed in PR-B.

---

## Task 1: Widen the filter interface

**File:** Modify `src/interfaces/IDeviceFilterOptions.ts`.

- [ ] **Step 1: Read the current file**

```
sed -n '1,30p' src/interfaces/IDeviceFilterOptions.ts
```

Line 21 today: `callerTeamId?: string | null;`.

- [ ] **Step 2: Replace the field**

Edit `src/interfaces/IDeviceFilterOptions.ts` line 21:

```ts
// OLD:
callerTeamId?: string | null;

// NEW:
// Team-scope filter. Undefined = no filter (admin / unscoped). Empty array =
// only shared-pool devices (teamId IS NULL). Non-empty array = shared pool +
// devices in any of the listed teams. The widening from single → set is for
// Phase 3's User-keyed multi-team membership; token-narrowed callers pass a
// single-element array.
callerTeamIds?: string[];
```

- [ ] **Step 3: Type-check (will surface every callsite)**

```
npx tsc --noEmit 2>&1 | grep "callerTeamId" | head -20
```

This will list every consumer that breaks — primarily `prisma-store.ts:122`, `device-store.ts:83`, `device-utils.ts:124`, `SessionLifecycleService.ts:138/237`. Tasks 2 + 4 + 5 + 6 fix each in turn.

- [ ] **Step 4: Commit (no functional change yet — type breakage to be fixed in subsequent tasks)**

The interface change shouldn't be committed alone if it breaks the project compile. Defer the commit until Task 6 lands — fold this change into Task 6's commit, OR pause this task and skip directly to Tasks 4-6 (in any order), then come back to commit all 5 files together.

**Strategy: do NOT commit this file alone.** Continue with Tasks 2-6, stage all of them together at the end, and use a single commit. The first commit happens in Task 6.

(The plan presents these as separate tasks for clarity; the implementer should defer the staging until they're all consistent.)

---

## Task 2: `authMiddleware` populates `req.auth.teamIds` (TDD)

**Files:**
- Modify: `src/middleware/authMiddleware.ts`
- Modify: `src/types/express.d.ts`
- Modify: `test/unit/authMiddleware.test.ts`

- [ ] **Step 1: Extend the Request augmentation**

Edit `src/types/express.d.ts`. Find the existing `auth?: { ... }` block. Add inside it:

```ts
// Phase 4A: per-team device visibility. Populated for member cookie sessions
// from TeamMember rows; populated for token-narrowed (apiKey) callers as
// [apiKey.teamId]; undefined for ADMIN / SUPER_ADMIN cookie sessions and
// admin-tier api-key callers (unscoped). Empty array means "no team
// memberships" (member sees only shared-pool devices).
teamIds?: string[];
```

- [ ] **Step 2: Append failing tests** to `test/unit/authMiddleware.test.ts`

Inside the existing top-level `describe('authMiddleware', …)`, append:

```ts
describe('teamIds population (Phase 4A)', () => {
  it('cookie session for MEMBER fetches TeamMember rows', async () => {
    sinon.stub(Container.get(UserSessionService), 'resolve').resolves({
      id: 's1', userId: 'u1',
    } as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1', role: 'MEMBER', status: 'ACTIVE',
    } as any);
    const tmFind = sinon.stub(prisma.teamMember, 'findMany').resolves([
      { teamId: 't1' }, { teamId: 't2' },
    ] as any);
    const req: any = { headers: { cookie: 'xenon_dashboard_session=s1' } };
    await authMiddleware(req, mkRes() as any, () => {});
    expect(req.auth?.teamIds).to.deep.equal(['t1', 't2']);
    expect(tmFind.firstCall.args[0]).to.deep.include({ where: { userId: 'u1' } });
  });

  it('cookie session for SUPER_ADMIN does NOT fetch TeamMember rows; teamIds undefined', async () => {
    sinon.stub(Container.get(UserSessionService), 'resolve').resolves({
      id: 's1', userId: 'u1',
    } as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1', role: 'SUPER_ADMIN', status: 'ACTIVE',
    } as any);
    const tmFind = sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);
    const req: any = { headers: { cookie: 'xenon_dashboard_session=s1' } };
    await authMiddleware(req, mkRes() as any, () => {});
    expect(req.auth?.teamIds).to.be.undefined;
    expect(tmFind.called).to.be.false;
  });

  it('cookie session for ADMIN does NOT fetch TeamMember rows', async () => {
    sinon.stub(Container.get(UserSessionService), 'resolve').resolves({
      id: 's1', userId: 'u1',
    } as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1', role: 'ADMIN', status: 'ACTIVE',
    } as any);
    const tmFind = sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);
    const req: any = { headers: { cookie: 'xenon_dashboard_session=s1' } };
    await authMiddleware(req, mkRes() as any, () => {});
    expect(req.auth?.teamIds).to.be.undefined;
    expect(tmFind.called).to.be.false;
  });

  it('header (accessKey, token) with team-narrowed key sets teamIds=[apiKey.teamId]', async () => {
    sinon.stub(Container.get(ApiKeyService), 'verifyPair').resolves({
      id: 'k1', userId: 'u1', scopes: 'sessions,read', rateLimit: 300, teamId: 't9',
    } as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1', role: 'MEMBER', status: 'ACTIVE',
    } as any);
    const tmFind = sinon.stub(prisma.teamMember, 'findMany').resolves([
      { teamId: 't9' }, { teamId: 't10' },  // user is in t9 AND t10
    ] as any);
    const req: any = {
      headers: { 'x-xenon-access-key': 'xen_abc', 'x-xenon-token': 'tok' },
    };
    await authMiddleware(req, mkRes() as any, () => {});
    // Token narrows to t9 only — t10 should NOT appear.
    expect(req.auth?.teamIds).to.deep.equal(['t9']);
    // Member-tier api-key path: TeamMember query should be SKIPPED because
    // the token already provides the narrowing.
    expect(tmFind.called).to.be.false;
  });

  it('header (accessKey, token) with no team narrow sets teamIds from TeamMember', async () => {
    sinon.stub(Container.get(ApiKeyService), 'verifyPair').resolves({
      id: 'k1', userId: 'u1', scopes: 'sessions,read', rateLimit: 300, teamId: null,
    } as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1', role: 'MEMBER', status: 'ACTIVE',
    } as any);
    sinon.stub(prisma.teamMember, 'findMany').resolves([{ teamId: 't1' }] as any);
    const req: any = {
      headers: { 'x-xenon-access-key': 'xen_abc', 'x-xenon-token': 'tok' },
    };
    await authMiddleware(req, mkRes() as any, () => {});
    expect(req.auth?.teamIds).to.deep.equal(['t1']);
  });
});
```

Add `import { prisma } from '../../src/prisma';` at the top of the test file if not already present.

- [ ] **Step 3: RED**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/authMiddleware.test.ts
```

Should add 5 failing tests.

- [ ] **Step 4: Implement** — modify `src/middleware/authMiddleware.ts`

Add a small helper near the top of the file (above the exported `authMiddleware` function):

```ts
import { prisma } from '../prisma';

// Compute the request-scoped team-id set. Returns undefined for admin-tier
// callers (unscoped). For member-tier callers without a narrowing apiKey,
// fetches TeamMember rows. For member-tier callers with a team-narrowed
// apiKey, returns just [apiKey.teamId] (the token's narrow always wins).
async function computeTeamIds(opts: {
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
  userId: string;
  apiKeyTeamId?: string | null;
}): Promise<string[] | undefined> {
  if (opts.role === 'SUPER_ADMIN' || opts.role === 'ADMIN') return undefined;
  if (opts.apiKeyTeamId) return [opts.apiKeyTeamId];
  const rows = await prisma.teamMember.findMany({
    where: { userId: opts.userId },
    select: { teamId: true },
  });
  return rows.map((r) => r.teamId);
}
```

Then in each resolution path that populates `req.auth`, also populate `teamIds`. Find the four populate sites (header pair, cookie → UserSession, cookie → ApiKey, legacy x-xenon-api-key) and update each.

For each `req.auth = { kind: ..., userId: ..., role: ..., scopes: ..., ... }` block, add a `teamIds` field. Compute it once just before the assignment:

```ts
// Header (accessKey, token) pair branch:
const teamIds = await computeTeamIds({
  role: user.role as any,
  userId: user.id,
  apiKeyTeamId: row.teamId,
});
req.auth = {
  kind: 'api-key',
  userId: user.id,
  role: user.role as any,
  scopes: row.scopes,
  teamId: row.teamId ?? null,
  apiKeyId: row.id,
  rateLimit: row.rateLimit,
  teamIds,
};
```

Apply the same pattern to:
- Cookie → UserSession branch: `apiKeyTeamId: undefined` (no api key in this path).
- Cookie → ApiKey branch: `apiKeyTeamId: row.teamId`.
- Legacy x-xenon-api-key branch: `apiKeyTeamId: row.teamId`.
- The `authDisabled` short-circuit (top of `authMiddleware`): `teamIds: undefined` — synthetic super-admin is unscoped.

For type compliance, you may need `as any` on the `role` argument since Prisma SQLite returns `string` not the literal union — same pattern Phase 1 used.

- [ ] **Step 5: GREEN**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/authMiddleware.test.ts
```

Existing tests + 5 new should pass.

- [ ] **Step 6: tsc check**

```
npx tsc --noEmit 2>&1 | grep -E "(authMiddleware|express\\.d\\.ts)" || echo "tsc clean for touched files"
```

Note: at this point, OTHER files in the project may show tsc errors because Task 1 widened `IDeviceFilterOptions.callerTeamId` → `callerTeamIds`. Those errors will be cleared by Tasks 4-6.

- [ ] **Step 7: Do NOT commit yet** — wait until Task 6 to commit Tasks 1+2+3 together (the widening is mid-state until then).

---

## Task 3: Update `device-utils.ts` `allocateDeviceForSession` signature

**File:** Modify `src/device-utils.ts`.

- [ ] **Step 1: Change the parameter**

Read `src/device-utils.ts` around lines 110-130. Replace:

```ts
export async function allocateDeviceForSession(
  capability: ISessionCapability,
  deviceTimeOutMs: number,
  deviceQueryIntervalMs: number,
  pluginArgs: IPluginArgs,
  callerTeamId?: string | null,
): Promise<IDevice> {
  const firstMatch = Object.assign({}, capability.firstMatch?.[0] ?? {}, capability.alwaysMatch);
  const filters = getDeviceFiltersFromCapability(firstMatch, pluginArgs);
  // callerTeamId === undefined → unscoped (admin / auth-disabled / back-compat).
  // callerTeamId === null      → caller has no team, only shared pool visible.
  // callerTeamId === '<uuid>'  → team + shared pool visible.
  if (callerTeamId !== undefined) {
    filters.callerTeamId = callerTeamId;
  }
```

with:

```ts
export async function allocateDeviceForSession(
  capability: ISessionCapability,
  deviceTimeOutMs: number,
  deviceQueryIntervalMs: number,
  pluginArgs: IPluginArgs,
  callerTeamIds?: string[],
): Promise<IDevice> {
  const firstMatch = Object.assign({}, capability.firstMatch?.[0] ?? {}, capability.alwaysMatch);
  const filters = getDeviceFiltersFromCapability(firstMatch, pluginArgs);
  // callerTeamIds === undefined → unscoped (admin / auth-disabled / back-compat).
  // callerTeamIds === []        → caller has no team, only shared pool visible.
  // callerTeamIds === [a, b]    → shared pool + any of those teams visible.
  if (callerTeamIds !== undefined) {
    filters.callerTeamIds = callerTeamIds;
  }
```

- [ ] **Step 2: Don't commit yet** — Task 6's bundled commit covers this.

---

## Task 4: `prisma-store.ts` filter SQL update (TDD)

**Files:**
- Modify: `src/data-service/prisma-store.ts`
- Create: `test/unit/team-filter.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// test/unit/team-filter.test.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { PrismaStore } from '../../src/data-service/prisma-store';
import { prisma } from '../../src/prisma';

describe('team filter SQL shape (Phase 4A)', () => {
  afterEach(() => sinon.restore());

  function captureWhere(): { value?: any } {
    const captured: { value?: any } = {};
    sinon.stub(prisma.device, 'findMany').callsFake(async (args: any) => {
      captured.value = args.where;
      return [] as any;
    });
    return captured;
  }

  it('callerTeamIds undefined → no team predicate at all', async () => {
    const captured = captureWhere();
    await new PrismaStore().getDevices({} as any);
    expect(captured.value?.teamId).to.be.undefined;
  });

  it('callerTeamIds === [] → teamId IS NULL only', async () => {
    const captured = captureWhere();
    await new PrismaStore().getDevices({ callerTeamIds: [] } as any);
    expect(captured.value?.teamId).to.equal(null);
  });

  it('callerTeamIds === ["t1", "t2"] → teamId IN (null, t1, t2)', async () => {
    const captured = captureWhere();
    await new PrismaStore().getDevices({ callerTeamIds: ['t1', 't2'] } as any);
    expect(captured.value?.teamId).to.deep.equal({ in: [null, 't1', 't2'] });
  });
});
```

Note: `PrismaStore` may export differently — read the file to confirm its export shape (factory or class).

- [ ] **Step 2: RED**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/team-filter.test.ts
```

- [ ] **Step 3: Implement** — replace the existing block in `src/data-service/prisma-store.ts:120-126`

```ts
// Team scoping (Phase 4A): undefined = unscoped (admin); empty array =
// only shared-pool devices (teamId IS NULL); non-empty = shared pool +
// any listed team. Token-narrowed callers pass a single-element array.
if (Object.prototype.hasOwnProperty.call(filterOptions, 'callerTeamIds')) {
  const ids = filterOptions.callerTeamIds!;
  if (ids.length === 0) {
    where.teamId = null;
  } else {
    where.teamId = { in: [null, ...ids] };
  }
}
```

- [ ] **Step 4: GREEN** (3 tests)

- [ ] **Step 5: Don't commit yet** — Task 6 bundles all 5 files.

---

## Task 5: `device-store.ts` in-memory filter update

**File:** Modify `src/data-service/device-store.ts`.

- [ ] **Step 1: Replace lines 82-90**

```ts
// OLD:
if (Object.prototype.hasOwnProperty.call(filterOptions, 'callerTeamId')) {
  const caller = filterOptions.callerTeamId;
  if (caller) {
    if (device.teamId && device.teamId !== caller) return false;
  } else {
    if (device.teamId) return false;
  }
}

// NEW:
// Phase 4A: undefined = unscoped; empty array = only shared-pool;
// non-empty = shared pool + any listed team.
if (Object.prototype.hasOwnProperty.call(filterOptions, 'callerTeamIds')) {
  const ids = filterOptions.callerTeamIds!;
  if (ids.length === 0) {
    if (device.teamId) return false;
  } else {
    if (device.teamId && !ids.includes(device.teamId)) return false;
  }
}
```

- [ ] **Step 2: Run** (no new test file; the device-store path is exercised via integration in PR-A's Task 8)

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 30000 test/unit/team-filter.test.ts
```

(Should still be 3 passing.)

- [ ] **Step 3: Don't commit yet** — Task 6.

---

## Task 6: `SessionLifecycleService` callerTeamIds + bundled commit

**Files (one commit covering Tasks 1-6):**
- Modify: `src/services/SessionLifecycleService.ts`
- (Plus all files staged in Tasks 1-5)

- [ ] **Step 1: Read current state** in `SessionLifecycleService.ts`

```
grep -nE "callerTeamId" src/services/SessionLifecycleService.ts
```

Around line 199, the function returns `{ apiKeyId, callerTeamId, scoped }`. Around line 138, the caller of `allocateDeviceForSession` passes `authResult.callerTeamId`. Around line 237-241, `callerTeamId` is computed from `row.teamId`.

- [ ] **Step 2: Update the return type and computation**

Change the function signature:

```ts
// Old:
async authorizeSessionRequest(
  caps: ISessionCapability,
): Promise<{ apiKeyId: string | null; callerTeamId: string | null; scoped: boolean }>;

// New:
async authorizeSessionRequest(
  caps: ISessionCapability,
): Promise<{ apiKeyId: string | null; callerTeamIds: string[] | undefined; scoped: boolean }>;
```

In the body, every `return { apiKeyId, callerTeamId: ..., scoped: ... }` becomes:

```ts
return { apiKeyId, callerTeamIds: ..., scoped: ... };
```

And the value computation (around line 237) becomes:

```ts
// Token-narrowed callers see exactly one team; otherwise (admin tokens)
// callerTeamIds is undefined for unscoped access. The unscoped path
// covers admin keys and the legacy single-secret flow.
const callerTeamIds: string[] | undefined = row.teamId ? [row.teamId] : undefined;
```

The `scoped` flag continues to mean "did the caller present credentials at all"; combine semantics so `scoped: true && callerTeamIds === undefined` means "admin / unscoped api-key" and `scoped: true && callerTeamIds === [...]` means "team-narrowed api-key".

- [ ] **Step 3: Update the call site** at line ~138

```ts
// Old:
const device = await allocateDeviceForSession(
  caps,
  ...,
  authResult.scoped ? authResult.callerTeamId : undefined,
);

// New:
const device = await allocateDeviceForSession(
  caps,
  ...,
  authResult.scoped ? authResult.callerTeamIds : undefined,
);
```

- [ ] **Step 4: tsc check across the project**

```
npx tsc --noEmit 2>&1 | grep -E "callerTeamId" | head -10
```

Should be empty after this task — every callsite has been migrated.

```
npx tsc --noEmit 2>&1 | tail -10
```

Should be clean (or only show pre-existing errors unrelated to this work).

- [ ] **Step 5: Run the full identity surface to confirm no regressions**

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
  test/integration/auth-flow.spec.ts test/integration/role-matrix.spec.ts
```

Expected: all green.

- [ ] **Step 6: Commit Tasks 1+2+3+4+5+6 together**

```
cat > /tmp/xenon-p4t6-msg.txt << 'XENON_EOF'
feat(auth): widen callerTeamId -> callerTeamIds for multi-team membership

Phase 3's User-keyed TeamMember table is many-to-many — a member can
belong to multiple teams. The existing single-team filter on the data
layer (callerTeamId) is replaced with an array (callerTeamIds), and
authMiddleware populates req.auth.teamIds once per request from the
caller's TeamMember rows.

Resolution order:
- ADMIN / SUPER_ADMIN cookie sessions: teamIds = undefined (unscoped).
- Token-narrowed (accessKey, token) callers: teamIds = [apiKey.teamId]
  even when the underlying user belongs to other teams. Tokens always
  narrow, never widen.
- MEMBER cookie sessions or non-narrowed api-keys: teamIds is the
  user's full TeamMember set, possibly empty.

Filter SQL becomes WHERE teamId IS NULL OR teamId IN (...). Empty
array means IS NULL only — a member with no team membership sees
shared-pool devices. Undefined keeps the predicate off entirely.

Touches:
- src/interfaces/IDeviceFilterOptions.ts: callerTeamId → callerTeamIds
- src/types/express.d.ts: req.auth.teamIds added
- src/middleware/authMiddleware.ts: computeTeamIds + populate per path
- src/data-service/prisma-store.ts: SQL widening
- src/data-service/device-store.ts: in-memory equivalent
- src/device-utils.ts: allocateDeviceForSession signature
- src/services/SessionLifecycleService.ts: authorizeSessionRequest
  return shape

No application-visible behavior change yet — every read endpoint
still passes undefined to the filter. PR-A's next task wires the
filter onto /grid/devices; PR-B extends to remaining surfaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/interfaces/IDeviceFilterOptions.ts src/types/express.d.ts \
        src/middleware/authMiddleware.ts src/data-service/prisma-store.ts \
        src/data-service/device-store.ts src/device-utils.ts \
        src/services/SessionLifecycleService.ts \
        test/unit/authMiddleware.test.ts test/unit/team-filter.test.ts
git commit -F /tmp/xenon-p4t6-msg.txt && rm /tmp/xenon-p4t6-msg.txt
```

---

## Task 7: Wire `/grid/devices` to `req.auth.teamIds`

**File:** Modify `src/app/routers/grid.ts`.

- [ ] **Step 1: Find `getDevices` handler**

```
grep -n "function getDevices\|router.get('/devices'\|router.get('/device'" src/app/routers/grid.ts
```

- [ ] **Step 2: Read the handler body**

Read the handler. It likely calls `getDevices()` from `src/data-service/device-service.ts`. Trace the call path until you reach `IDeviceFilterOptions`. The handler needs to read `req.auth?.teamIds` and pass it through.

- [ ] **Step 3: Update the handler**

Wherever the handler builds its filter options object (or constructs the `getDevices` argument), add:

```ts
const auth = (req as any).auth as { teamIds?: string[] } | undefined;
if (auth && Object.prototype.hasOwnProperty.call(auth, 'teamIds')) {
  filterOptions.callerTeamIds = auth.teamIds;
}
```

(Use `Object.prototype.hasOwnProperty` rather than `auth.teamIds !== undefined` to preserve the explicit undefined → unscoped semantics. `teamIds === undefined` should NOT set the field — that means "admin"; `teamIds === []` means "no teams".)

Apply the same change to the `/device` and `/device/:platform` handlers in the same file if they share filtering logic.

- [ ] **Step 4: Run integration tests** (will be added in Task 8; for now run existing identity surface)

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 \
  test/integration/role-matrix.spec.ts test/integration/auth-flow.spec.ts
```

- [ ] **Step 5: Commit**

```
cat > /tmp/xenon-p4t7-msg.txt << 'XENON_EOF'
feat(auth): /grid/devices honours req.auth.teamIds

The handler now reads the request-scoped team set populated by
authMiddleware and passes it into the device-service filter. Members
see shared pool + their teams; admins remain unscoped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/app/routers/grid.ts
git commit -F /tmp/xenon-p4t7-msg.txt && rm /tmp/xenon-p4t7-msg.txt
```

---

## Task 8: Integration test — team visibility on `/grid/devices`

**File:** Create `test/integration/team-visibility-grid.spec.ts`.

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import GridRouter from '../../src/app/routers/grid';
import { Container } from 'typedi';
import { TeamService } from '../../src/services/TeamService';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';

describe('team visibility on /grid/devices (integration)', function () {
  this.timeout(60_000);
  let sa: SeededUser;
  let aliceMember: SeededUser;
  let bobUnaffiliated: SeededUser;
  let teamA: { id: string; name: string };
  let teamB: { id: string; name: string };

  // Three test devices: shared (no team), in team A, in team B.
  const SHARED_UDID = `phase4a-shared-${Date.now()}`;
  const TEAM_A_UDID = `phase4a-team-a-${Date.now()}`;
  const TEAM_B_UDID = `phase4a-team-b-${Date.now()}`;

  before(async () => {
    sa = await seedUser('SUPER_ADMIN', { name: 'P4A SA' });
    aliceMember = await seedUser('MEMBER', { name: 'Alice (team A)' });
    bobUnaffiliated = await seedUser('MEMBER', { name: 'Bob (no team)' });

    teamA = await Container.get(TeamService).create(`p4a-team-a-${Date.now()}`);
    teamB = await Container.get(TeamService).create(`p4a-team-b-${Date.now()}`);

    // Alice on team A only.
    await Container.get(TeamService).addMember(teamA.id, aliceMember.user.id);

    // Three devices.
    await prisma.device.create({
      data: { udid: SHARED_UDID, host: 'localhost', name: 'shared', platform: 'iOS', teamId: null } as any,
    });
    await prisma.device.create({
      data: { udid: TEAM_A_UDID, host: 'localhost', name: 'team-a', platform: 'iOS', teamId: teamA.id } as any,
    });
    await prisma.device.create({
      data: { udid: TEAM_B_UDID, host: 'localhost', name: 'team-b', platform: 'iOS', teamId: teamB.id } as any,
    });
  });

  after(async () => {
    await prisma.device.deleteMany({
      where: { udid: { in: [SHARED_UDID, TEAM_A_UDID, TEAM_B_UDID] } },
    });
    await prisma.teamMember.deleteMany({
      where: { teamId: { in: [teamA.id, teamB.id] } },
    });
    await prisma.team.delete({ where: { id: teamA.id } }).catch(() => undefined);
    await prisma.team.delete({ where: { id: teamB.id } }).catch(() => undefined);
    await sa.cleanup();
    await aliceMember.cleanup();
    await bobUnaffiliated.cleanup();
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    GridRouter.register(app as any, {} as any);
    return app;
  }

  function udids(rows: Array<{ udid: string }>): string[] {
    return rows.map((r) => r.udid).sort();
  }

  it('SUPER_ADMIN sees all three devices', async () => {
    const r = await request(buildApp()).get('/devices').set('Cookie', sa.cookie);
    expect(r.status).to.equal(200);
    const got = udids(r.body);
    expect(got).to.include.members([SHARED_UDID, TEAM_A_UDID, TEAM_B_UDID]);
  });

  it('Alice (team A member) sees shared + team A; not team B', async () => {
    const r = await request(buildApp()).get('/devices').set('Cookie', aliceMember.cookie);
    expect(r.status).to.equal(200);
    const got = udids(r.body);
    expect(got).to.include(SHARED_UDID);
    expect(got).to.include(TEAM_A_UDID);
    expect(got).to.not.include(TEAM_B_UDID);
  });

  it('Bob (no team) sees only the shared device', async () => {
    const r = await request(buildApp()).get('/devices').set('Cookie', bobUnaffiliated.cookie);
    expect(r.status).to.equal(200);
    const got = udids(r.body);
    expect(got).to.include(SHARED_UDID);
    expect(got).to.not.include(TEAM_A_UDID);
    expect(got).to.not.include(TEAM_B_UDID);
  });
});
```

- [ ] Run:

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 test/integration/team-visibility-grid.spec.ts
```
Expected: 3 passing.

If `GridRouter.register` doesn't fit the test's app-builder shape, refactor the test to use whatever export pattern the router uses. Existing integration tests under `test/integration/` are the reference.

- [ ] Commit:

```
cat > /tmp/xenon-p4t8-msg.txt << 'XENON_EOF'
test(integration): /grid/devices team-visibility scenarios

Three users (SA, member-on-team-A, member-with-no-team) and three
devices (shared, team-A, team-B). Asserts that the response is
correctly filtered per caller.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add test/integration/team-visibility-grid.spec.ts
git commit -F /tmp/xenon-p4t8-msg.txt && rm /tmp/xenon-p4t8-msg.txt
```

---

## Task 9: PR-A finalization

- [ ] Run the full identity surface (every PR-A-relevant suite + the new integration test) — should be green.
- [ ] `npx tsc --noEmit` clean.
- [ ] `git push -u origin feat/phase-4a-team-visibility`.
- [ ] Open PR-A: title `feat(auth): Phase 4A — req.auth.teamIds + /grid/devices filter (PR-A of 3)`. Body must explicitly call out the **surprise-hide warning**: assigning a device to a team for the first time will hide it from non-team-members on the next refresh. Reference Phase 3's `deviceTeamAssigned` audit event so operators know the change is logged.

---

# PR-B — Filter the rest of the read surface

**Branch:** `feat/phase-4a-readsets` (off `main` after PR-A merge).
**Ships:** team filter applied to `/grid/queue/*`, `/grid/sessions/active`, dashboard session/build reads, `/recordings/*` reads. Frontend session-detail loader handles 404 → `/sessions` redirect with toast.

---

## Task 10: Apply filter to `/grid/queue/*` and `/grid/sessions/active`

**File:** Modify `src/app/routers/grid.ts` (queue/session handlers).

- [ ] **Step 1: Locate the handlers**

```
grep -n "getQueue\|getActiveSessions\|router.get('/queue'\|router.get('/sessions/active'" src/app/routers/grid.ts
```

- [ ] **Step 2: For each handler, plumb `req.auth.teamIds` through**

Pending sessions and active sessions reference a `device_udid`. The filter:

```ts
// Inside each handler:
const auth = (req as any).auth as { teamIds?: string[] } | undefined;
const teamIds = auth && Object.prototype.hasOwnProperty.call(auth, 'teamIds') ? auth.teamIds : undefined;

// At the data layer (or as a post-filter if the data layer doesn't have a
// per-device team join), filter rows to only those whose device_udid is
// visible to the caller.
const visible = teamIds === undefined
  ? rows
  : await filterRowsByVisibleDevice(rows, teamIds, 'device_udid');
```

Where `filterRowsByVisibleDevice` is a shared helper. Add it to `src/data-service/device-service.ts` (next to `getDevices`):

```ts
// Filter an array of rows down to those whose `udidField` references a
// device visible to the caller. Visibility is: teamIds === undefined (no
// filter) → return as-is; teamIds === [] → only rows whose device.teamId
// is null; teamIds === [a, b] → rows whose device.teamId is null or in
// the set.
export async function filterRowsByVisibleDevice<T>(
  rows: T[],
  teamIds: string[] | undefined,
  udidField: keyof T,
): Promise<T[]> {
  if (teamIds === undefined) return rows;
  const udids = Array.from(new Set(rows.map((r) => String(r[udidField])).filter(Boolean)));
  if (udids.length === 0) return rows;
  // Fetch the team membership for each referenced device once.
  const devices = await prisma.device.findMany({
    where: { udid: { in: udids } },
    select: { udid: true, teamId: true },
  });
  const visibleUdids = new Set(
    devices
      .filter((d) => d.teamId === null || (d.teamId !== null && teamIds.includes(d.teamId)))
      .map((d) => d.udid),
  );
  return rows.filter((r) => visibleUdids.has(String(r[udidField])));
}
```

`prisma` import path matches the rest of `device-service.ts`.

- [ ] **Step 3: Run**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 test/integration/team-visibility-grid.spec.ts
```
(Should still pass; this task adds new endpoints to filter.)

- [ ] **Step 4: Commit**

```
cat > /tmp/xenon-p4t10-msg.txt << 'XENON_EOF'
feat(auth): /grid/queue + /grid/sessions/active honour req.auth.teamIds

Queue listings and active-session listings now filter to rows whose
underlying device is visible to the caller. Admins are unscoped;
members see only rows for shared-pool or their team's devices.

Adds filterRowsByVisibleDevice() helper in data-service/device-service.ts
so /dashboard and /recordings reads in the next task can reuse the
same one-query-per-batch shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/app/routers/grid.ts src/data-service/device-service.ts
git commit -F /tmp/xenon-p4t10-msg.txt && rm /tmp/xenon-p4t10-msg.txt
```

---

## Task 11: Apply filter to dashboard session/build reads + recordings reads

**Files:**
- Modify: `src/app/routers/dashboard.ts`
- Modify: `src/app/routers/recordings.ts`

- [ ] **Step 1: Dashboard session listings**

```
grep -n "getSessions\|getBuilds\|getSessionById\|getBuildById" src/app/routers/dashboard.ts | head -10
```

For each list-style read (sessions list, build list, build's sessions list), apply `filterRowsByVisibleDevice` keyed on the session's `device_udid` field:

```ts
const auth = (req as any).auth as { teamIds?: string[] } | undefined;
const teamIds = auth && Object.prototype.hasOwnProperty.call(auth, 'teamIds') ? auth.teamIds : undefined;
const filtered = await filterRowsByVisibleDevice(rows, teamIds, 'device_udid');
res.json(filtered);
```

For GET-by-id routes (`/session/:sessionId`), do an early visibility check:

```ts
const auth = (req as any).auth as { teamIds?: string[] } | undefined;
const teamIds = auth && Object.prototype.hasOwnProperty.call(auth, 'teamIds') ? auth.teamIds : undefined;
if (teamIds !== undefined) {
  const dev = await prisma.device.findUnique({
    where: { udid: row.device_udid },
    select: { teamId: true },
  });
  const visible = dev && (dev.teamId === null || teamIds.includes(dev.teamId));
  if (!visible) return res.status(404).json({ error: 'session not found' });
}
res.json(row);
```

For `/build/:buildId/sessions`, post-filter the sessions list. The build itself stays visible if any of its sessions are visible (matches the spec's "build aggregation" rule). For `/build` (build list), include a build if it has at least one visible session — that's a join-heavy query; pragmatic implementation: post-filter the sessions list per build, drop builds with empty session lists.

If the dashboard router is large and you can't reach all the endpoints in 30 minutes, scope this task to:
- `/session` (list)
- `/session/:sessionId` (detail with 404 fallback)
- `/build` (list with empty-session-list drop)
- `/build/:buildId/sessions` (post-filter)

Skip more obscure endpoints; document in the report.

- [ ] **Step 2: Recordings**

```
grep -n "router.get('/recordings'\|router.get('/recordings/:groupId" src/app/routers/recordings.ts
```

For the `/recordings` list and `/recordings/:groupId` detail, the recording table likely has a `device_udid` field already. Apply the same patterns:

- List: `filterRowsByVisibleDevice` post-filter.
- Detail: 404 if the underlying device isn't visible.

The existing per-recording manual-lock check (Phase 1's `manual_<userId>_<udid>` format) layers on top — visibility filter runs first; manual-lock check stays.

- [ ] **Step 3: Run integration test from PR-A**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 test/integration/team-visibility-grid.spec.ts
```

- [ ] **Step 4: Commit**

```
cat > /tmp/xenon-p4t11-msg.txt << 'XENON_EOF'
feat(auth): dashboard + recordings reads honour req.auth.teamIds

Session listings, session details (with 404 fallback for invisible
devices), build listings (drop builds with no visible session), build
session listings, and recording listings/details all filter to rows
whose underlying device is visible to the caller. Admins remain
unscoped. The existing per-recording manual-lock check layers on top.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/app/routers/dashboard.ts src/app/routers/recordings.ts
git commit -F /tmp/xenon-p4t11-msg.txt && rm /tmp/xenon-p4t11-msg.txt
```

---

## Task 12: Integration tests for dashboard + recordings + frontend 404 redirect

**Files:**
- Create: `test/integration/team-visibility-dashboard.spec.ts`
- Create: `test/integration/team-visibility-recordings.spec.ts`
- Modify: `web/src/components/session-detail/session-detail-page.tsx`

- [ ] **Step 1: `team-visibility-dashboard.spec.ts`**

Mirror the PR-A grid spec's seedUser/team/device setup (consider extracting a shared helper at `test/helpers/teamVisibilityFixture.ts` to reduce duplication — left as an exercise; if the duplication is small enough, just inline). Cases:

- SA hits `/dashboard/session` → sees all sessions across all 3 devices.
- Alice hits `/dashboard/session` → sees only sessions on shared + team-A devices.
- Alice hits `/dashboard/session/<id>` for a session on team-B's device → 404.
- Alice hits `/dashboard/build` → builds whose only sessions are on team-B aren't listed.

Seed two sessions per device for the test (one per build). Cleanup deletes the test sessions in `after`.

- [ ] **Step 2: `team-visibility-recordings.spec.ts`**

Two cases:
- SA hits `/recordings` → sees all.
- Alice hits `/recordings` for a recording whose device is team-B → 404 on detail; recording absent from list.

If recording creation in tests is heavy (it spawns ffmpeg etc.), skip and rely on stubbed `prisma.recording.findMany` calls. Pragmatic: create recording rows directly via `prisma.recording.create` to populate the test fixture.

- [ ] **Step 3: Frontend session-detail 404 → redirect**

```
grep -n "useSession\|getSession\|404" web/src/components/session-detail/session-detail-page.tsx | head
```

Find where the page fetches the session detail. On a 404 response, redirect to `/sessions` and surface a toast (`useToast()` from Phase 2). Existing 401 handling (RouteGuard) is unchanged. Pseudocode:

```tsx
const { id } = useParams();
const navigate = useNavigate();
const { toast } = useToast();
useEffect(() => {
  fetch(`/xenon/api/dashboard/session/${id}`, { credentials: 'include' })
    .then(async (r) => {
      if (r.status === 404) {
        toast({ kind: 'info', message: 'Session not available — it may belong to a team you are not in.' });
        navigate('/sessions', { replace: true });
        return null;
      }
      if (!r.ok) throw new Error(`Session fetch failed (${r.status})`);
      return r.json();
    })
    .then((data) => data && setSession(data));
}, [id]);
```

Adapt to the existing session-detail page's data-loading pattern (it may use a custom hook like `useSessionDetail`; modify the hook to surface a `notFound: true` flag the page can act on).

- [ ] **Step 4: Run all the new tests**

```
XENON_BCRYPT_COST=4 npx mocha --require ts-node/register --timeout 60000 \
  test/integration/team-visibility-grid.spec.ts \
  test/integration/team-visibility-dashboard.spec.ts \
  test/integration/team-visibility-recordings.spec.ts
cd web && npx vitest run
```

- [ ] **Step 5: Commit**

```
cat > /tmp/xenon-p4t12-msg.txt << 'XENON_EOF'
test(integration): team visibility on dashboard + recordings; session-detail 404 redirect

Two new integration suites cover the dashboard session/build reads
and the recordings reads end-to-end. Frontend session-detail page
now redirects to /sessions with a toast when the underlying session
returns 404 (typically because the session is on a team-scoped
device the caller can no longer see).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add test/integration/team-visibility-dashboard.spec.ts \
        test/integration/team-visibility-recordings.spec.ts \
        web/src/components/session-detail/session-detail-page.tsx
git commit -F /tmp/xenon-p4t12-msg.txt && rm /tmp/xenon-p4t12-msg.txt
```

---

## Task 13: PR-B finalization

- [ ] Run full identity surface (PR-A's list + new PR-B suites). All green.
- [ ] `npx tsc --noEmit` clean (root and `cd web`).
- [ ] `cd web && npx vitest run` green.
- [ ] Push and open PR-B: title `feat(auth): Phase 4A — extend filter to dashboard + recordings (PR-B of 3)`.

---

# PR-C — `/profile` "Your teams" line + finishing touches

**Branch:** `feat/phase-4a-frontend` (off `main` after PR-B merge).

---

## Task 14: `GET /auth/me` returns teamIds; `/profile` page renders them

**Files:**
- Modify: `src/app/routers/auth.ts`
- Modify: `web/src/api-service/auth.ts`
- Modify: `web/src/pages/profile/profile-page.tsx` (or wherever the "Password & Authentication" tab lives)

- [ ] **Step 1: Backend — extend /auth/me**

Find the `/me` handler in `src/app/routers/auth.ts`. Read `req.auth.teamIds` and either:
- For the new field: include `teamIds: req.auth.teamIds ?? null` (null if undefined for admins).
- Add the team names by joining `prisma.team.findMany({ where: { id: { in: teamIds } } })` so the frontend can show a friendly label, not just IDs.

Final `/auth/me` response gains:

```ts
teams: Array<{ id: string; name: string }>;  // empty array for admins/SAs (unscoped)
```

The plan-of-record returns names (better UX) over raw IDs.

- [ ] **Step 2: Frontend — extend MePayload**

In `web/src/api-service/auth.ts`, find the `MePayload` interface. Add:

```ts
teams: Array<{ id: string; name: string }>;
```

- [ ] **Step 3: Frontend — render on the profile page**

In the profile page (or its "Password & Authentication" tab), add a small section above the password form:

```tsx
{me?.teams && me.teams.length > 0 && (
  <div className="mb-6">
    <div className="text-xs text-[var(--text-dim)] uppercase tracking-wide mb-2">
      Your Teams
    </div>
    <div className="flex flex-wrap gap-2">
      {me.teams.map((t) => (
        <span key={t.id} className="inline-block px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs">
          {t.name}
        </span>
      ))}
    </div>
  </div>
)}
{me && me.teams && me.teams.length === 0 && (
  <div className="mb-6 text-xs text-[var(--text-dim)]">
    You're not on any team — ask an admin to add you so you can see team-scoped devices.
  </div>
)}
```

Admins won't trigger either branch since their `teams` array is empty (unscoped) — show nothing for them, OR the second branch's "ask an admin" wording needs gating to MEMBER. Pragmatic: only render either block when `me?.role === 'MEMBER'`.

- [ ] **Step 4: tsc + commit**

```
cd web && npx tsc --noEmit 2>&1 | grep -E "(profile|auth)" || echo "tsc clean"
cd ..

cat > /tmp/xenon-p4t14-msg.txt << 'XENON_EOF'
feat(web): /profile shows "Your Teams" for member callers

GET /auth/me now returns teams: Array<{id, name}> (empty for admins/
super-admins, who are unscoped). The profile page renders a small
chip-list above the password form so members can see which teams
gate their visibility — and an "ask an admin to add you" hint when
they're on no team.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add src/app/routers/auth.ts web/src/api-service/auth.ts \
        web/src/pages/profile/profile-page.tsx
# (Stage exactly the files you actually edited.)
git commit -F /tmp/xenon-p4t14-msg.txt && rm /tmp/xenon-p4t14-msg.txt
```

---

## Task 15: Role-matrix integration test extension + manual verification

**File:** Modify `test/integration/role-matrix.spec.ts`.

- [ ] **Step 1: Add a team-visibility row to the matrix**

The existing matrix runs `/users`, `/apikeys`, `/teams`, `/processes` per role. Add a `/grid/devices` case that asserts the device count differs per role. This is more of a smoke than a strict matrix row (different counts, not different status codes), so it's a separate `it()` block at the bottom of the file rather than a CASES table entry:

```ts
it('GET /grid/devices: SA sees more devices than MEMBER without team membership', async function () {
  // Skip if the test DB doesn't have a team-scoped device.
  const teamScoped = await prisma.device.count({ where: { teamId: { not: null } } });
  if (teamScoped === 0) {
    this.skip();
    return;
  }
  // ... rest of the test ...
});
```

(Keep this lightweight — the dedicated `team-visibility-grid.spec.ts` from PR-A is the strict assertion path.)

- [ ] **Step 2: Manual verification**

Walk the spec's manual checklist (see the spec's "Manual verification (final task)" section). Document outcomes in the PR body.

- [ ] **Step 3: Commit (only the test extension; manual verification is documentation-only)**

```
cat > /tmp/xenon-p4t15-msg.txt << 'XENON_EOF'
test(integration): role-matrix smoke for /grid/devices visibility

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
XENON_EOF
git add test/integration/role-matrix.spec.ts
git commit -F /tmp/xenon-p4t15-msg.txt && rm /tmp/xenon-p4t15-msg.txt
```

---

## Task 16: PR-C finalization

- [ ] Run full identity surface + new tests. All green.
- [ ] `npx tsc --noEmit` and `cd web && npx tsc --noEmit` clean.
- [ ] `cd web && npx vitest run` green.
- [ ] Push and open PR-C: title `feat(web): Phase 4A — /profile teams + manual verification (PR-C of 3)`. Body includes the manual-verification checklist with checked boxes.

---

## Self-Review Checklist (pre-merge)

Before each PR:

- [ ] All tests in the relevant suite pass.
- [ ] `tsc --noEmit` clean for root + `web/`.
- [ ] No `git add -A` was used.
- [ ] Conventional Commits + Co-Authored-By trailer.
- [ ] PR-A body documents the surprise-hide behavior change loudly.
- [ ] PR-B body confirms session-detail page handles 404 gracefully.
- [ ] PR-C body has manual verification walked.

## Out of scope for this plan

- Phase 4B (per-node `(accessKey, token)`) — its own design/plan/PR cycle later.
- Per-team rate limits / session quotas.
- Per-team device-allocation policy.
- "My teams" widget on `/overview`.
- Auto-team-assign on user create.
- 2FA / SSO / OIDC / account lockout.
