# Phase 3 — Users + Teams Management UI

**Status:** design
**Date:** 2026-04-30
**Author:** rabindrabiswal1@gmail.com

## Overview

Phases 1 and 2 (PRs #59 / #60 / #61 / #62 / #63 / #64, all merged) shipped the User entity, login, programmatic auth, role enforcement matrix, and self-service password reset. They explicitly deferred to Phase 3:

1. **`/users` page** — CRUD + role assignment + activate/deactivate.
2. **Team-membership UI** — keyed by User, not ApiKey.
3. **Device → team assignment UI** — backend already exists at `PUT /grid/device/:udid/team`.

Today the only way to manage users is SQL. The bootstrap super-admin can't even invite a second human through the product. The `Team` model exists from before Phase 1, but its membership is keyed by `ApiKey` (`Team.apiKeys[]`). `GET /teams/:id/members` returns ApiKeys, not the people behind them. The existing `web/src/components/settings/teams.tsx` (582 lines) is built around that ApiKey-keyed model. Device-team assignment has a backend route but no UI.

Phase 3 closes all three gaps. It does **not** ship per-team device-visibility enforcement (the spec calls users "can only access devices assigned to their team", but actually filtering every device-listing endpoint by team membership is a separate design exercise — Phase 4 candidate).

### What Phase 3 ships

- A `TeamMember` join model (`teamId, userId`) replacing the ApiKey-keyed membership concept. Existing `ApiKey.teamId` stays — that's "this token is narrowed to team X", a different concept from "this person is on team X".
- A `/users` REST router with CRUD, role assignment, activate/deactivate. Bound by role-vs-target rules (an ADMIN can only manage MEMBERs).
- Migration backfilling `ApiKey.teamId` ↦ `TeamMember(apiKey.userId, apiKey.teamId)` rows so existing teams keep their effective membership.
- Frontend `/users` page (list + invite + edit drawer + delete confirm + admin-driven password-reset trigger).
- Sidebar gains a "Users" item gated `minRole: 'ADMIN'`.
- The existing `teams.tsx` Members tab rewritten from ApiKey-keyed to User-keyed.
- A team selector cell on the Devices page, pointing at the existing `PUT /grid/device/:udid/team`.

### What Phase 3 does NOT ship (deferred)

| Phase | Topic | Reason for deferral |
|---|---|---|
| 4 | Per-team device-visibility enforcement | Spec calls it out, but adding visibility filters across every device-reading endpoint is a separate design exercise. The frontend assignment UI in Phase 3 is the prerequisite. |
| 4 | Per-node `(accessKey, token)` for hub-node channel | Independent of users/teams |
| 5 | Sidebar redesign | Cosmetic |
| — | Bulk user import (CSV), avatar customization, per-user rate-limit overrides | No demand signal |
| — | Email-invite flow with magic-link onboarding | Temp password + admin-shared login is simpler; can revisit if SMTP usage settles in |
| — | 2FA, OAuth/SSO, OIDC, account lockout | Per Phase 1 spec, deferred indefinitely |

## Decisions on file (from brainstorm)

| # | Decision | Why |
|---|---|---|
| Q1 | New `TeamMember` join table; keep `ApiKey.teamId` | Two distinct concepts: "user belongs to team" vs "token narrowed to team". Conflating them broke the existing membership UX. |
| Q2 | Hard-delete user (cascade nukes sessions / api keys / team memberships / reset tokens) | Soft-delete is a separate feature; PATCH `status: 'INACTIVE'` is the gentler path users will pick by default |
| Q3 | ADMIN can only manage MEMBER users; SUPER_ADMIN can manage everyone | Mirrors device-farm-pro's role matrix. ADMIN seeing super-admins on the list would leak privileged-user names |
| Q4 | Last-active-super-admin lockout protection | Pre-write count check; prevents the org from accidentally locking out all super-admins |
| Q5 | Self can't delete or change own role | UX safety net; users who need to change their own role go to a different super-admin |
| Q6 | Email is unique + immutable post-create | Email rotation creates audit / login-flow complications; explicit "delete + re-create" is fine |
| Q7 | Admin "Reset password" reuses existing `/auth/forgot-password` (Phase 2) | No new admin-override endpoint; reuse audit and rate-limit machinery |
| Q8 | Team-member POST/DELETE shape changes from `apiKeyId` to `userId` (breaking) | Acceptable because PR-C ships the only consumer rewrite in lockstep; `/teams/:id/members` is a UI-only surface |

## Architecture

```
Request
  │
  ▼
authMiddleware             — populates req.auth { kind, userId, role, scopes }
  │
  ▼
roleGuard('ADMIN')         — gate every /users + /teams route
  │
  ▼
Handler                    — additional checks:
                              · target role ≤ caller role (ADMIN can't touch SUPER_ADMIN)
                              · self-modify rules (can't delete self, can't change own role)
                              · last-super-admin guard (pre-write count check)
                              · email immutability (PATCH refuses email)
  │
  ▼
UserService / prisma       — DB write
  │
  ▼
Side effects (when relevant):
  · revokeAllForUser on deactivate / delete
  · loginRateLimiter unaffected (per-IP, not per-user)
  · audit log line ('userCreated', 'roleChanged', etc.)
```

`roleGuard('ADMIN')` is the floor; handler-level checks layer on top. Both must pass; either can 403.

### New modules

| Module | Path | Purpose |
|---|---|---|
| `UserService` (extended) | `src/services/UserService.ts` | adds `listUsers(callerRole)`, `updateUser`, `deactivateUser`, `deleteUser`, `setRole` |
| `users` router | `src/app/routers/users.ts` | CRUD endpoints |
| `TeamService` (modified) | `src/services/TeamService.ts` | swap ApiKey-based member queries for TeamMember-based |
| `teams` router (modified) | `src/app/routers/teams.ts` | `/teams/:id/members` shape changes |

### Modified modules

- `src/services/UserSessionService.ts` — already has `revokeAllForUser` (Phase 2 shipped it). Reused on deactivate / delete / role-change.
- `src/middleware/scopeGuard.ts` — unchanged.
- Frontend sidebar — adds the "Users" item with `minRole: 'ADMIN'`.

## Data model

One new model + relation arrays on existing models:

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

`User` gets `teamMemberships TeamMember[]`. `Team` gets `members TeamMember[]`. `ApiKey.teamId` is unchanged.

### Migration plan

Single Prisma migration `phase_3_team_members`:

1. `CREATE TABLE TeamMember (teamId, userId, createdAt)` with composite PK + index on userId + cascades.
2. Backfill from existing apiKey-based memberships:
   ```sql
   INSERT INTO TeamMember (teamId, userId, createdAt)
   SELECT DISTINCT ApiKey.teamId, ApiKey.userId, datetime('now')
   FROM ApiKey
   INNER JOIN User ON User.id = ApiKey.userId
   WHERE ApiKey.teamId IS NOT NULL
     AND ApiKey.userId IS NOT NULL
     AND User.email != 'legacy-admin@xenon.local';
   ```
   The Legacy Admin filter avoids polluting team rosters with the synthetic INACTIVE user that adopted Phase 1's pre-existing keys.
3. The composite PK handles the dedupe naturally (`SELECT DISTINCT` is a belt-and-suspenders; if the same `(teamId, userId)` shows up twice from two ApiKeys, we still get one row).

`down` reverses 1; the data backfill is one-way (we don't reconstruct apiKey-team links from `TeamMember`).

## API surface

### New endpoints — `/xenon/api/users` (router, gated `roleGuard('ADMIN')`)

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| GET | `/users` | — | `[{ id, email, name, role, status, createdAt, lastLoginAt }]` | ADMIN sees only `role: 'MEMBER'` rows; SUPER_ADMIN sees all |
| POST | `/users` | `{ email, name, role, password? }` | `201 { id, email, name, role, status, accessKey, temporaryPassword? }` | If `password` omitted, server generates 12 random URL-safe chars and returns once. ADMIN limited to `role: 'MEMBER'` (else 403) |
| PATCH | `/users/:id` | `{ name?, role?, status? }` | `200 { id, email, name, role, status }` | `email` ignored if present (immutable); `role` change subject to role-vs-target + last-super-admin checks; `status` change to `INACTIVE` revokes all sessions |
| DELETE | `/users/:id` | — | `204` | Self-delete refused (400); last-super-admin refused (400); cascade nukes UserSessions / ApiKeys / TeamMembers / PasswordResetTokens. `revokeAllForUser` runs explicitly first (defense in depth) |

### Modified endpoints — `/xenon/api/teams/:id/members`

`apiKey`-keyed routes → `user`-keyed:

| Method | Path | Body | Returns | Breaking? |
|---|---|---|---|---|
| GET | `/teams/:id/members` | — | `[{ userId, email, name, role, addedAt }]` | Yes (shape change from ApiKey-list to User-list) |
| POST | `/teams/:id/members` | `{ userId }` | `201 { userId, addedAt }` | Yes (was `{ apiKeyId }`) |
| DELETE | `/teams/:id/members/:userId` | — | `204` | Yes (path param renamed; old `:apiKeyId` route is gone) |

`Team.memberCount` (currently derived from `Team.apiKeys.length`) becomes a `Team.members` count via TeamMember.

### Unchanged

- `PUT /grid/device/:udid/team` (Phase 1; gated `roleGuard('ADMIN')` + `scopeGuard(['admin'])`).
- `/auth/forgot-password` (Phase 2; admin "Reset password" trigger calls this with the target user's email).
- All other auth/profile/recordings/dashboard endpoints.

### Audit logging

Add events to existing scoped logger:
- `userCreated` — actorId, targetId, role
- `userUpdated` — actorId, targetId, changed fields (name, role, status)
- `userDeleted` — actorId, targetId
- `roleChanged` — actorId, targetId, fromRole → toRole
- `userActivated` / `userDeactivated` — actorId, targetId
- `teamMemberAdded` / `teamMemberRemoved` — actorId, teamId, userId
- `deviceTeamAssigned` — actorId, udid, fromTeamId → toTeamId

No new audit table. Existing log scope is enough until Phase 5+ surfaces it in a UI.

## Frontend

### New routes / components

- **`/users`** — table view: Name | Email | Role | Status | Last Login | Actions. "+ Invite User" CTA opens a modal (email + name + role selector). On submit → `POST /users` → modal flips to "User created. Temporary password: <copyable>" if no password was specified. Edit drawer for name/role/status. Delete confirm dialog. "Reset password" action calls `forgotPassword(user.email)` (existing Phase 2 helper).
  - Hides `SUPER_ADMIN` and `ADMIN` rows when caller is `ADMIN` (matches the GET filter).
  - Disabled state for self-row's "Delete" / "Change role" actions (with tooltip: "Use a different super-admin to manage your own role/account").

### Modified components

- `web/src/api-service/users.ts` — NEW: `listUsers()`, `createUser({ email, name, role, password? })`, `updateUser(id, patch)`, `deleteUser(id)`.
- `web/src/components/sidebar/sidebar.tsx` — adds `{ id: 'users', label: 'Users', icon: <Users>, path: '/users', minRole: 'ADMIN' }`.
- `web/src/components/settings/teams.tsx` — Members tab swaps the ApiKey-keyed listing for a User-keyed listing. The "+ Add Member" picker queries `/users` and shows users not yet in the team.
- `web/src/components/device-card/*` (or wherever the Devices page table lives) — adds a "Team" column with an inline `<select>` listing teams + "(unassigned)". On change → `PUT /grid/device/:udid/team`. Optimistic update + toast.
- `web/src/routes/index.tsx` — register `/users` route inside `RouteGuard`.

### 403 / "no permission" UX

Existing Phase 2 toast pipeline (`web/src/api-service/api-client.ts`) catches 403 and shows the server's error message. New endpoints rely on it; no per-call handling.

## Operational concerns

### Bootstrap (no change)

`bootstrapIdentity()` (Phase 1) creates the SUPER_ADMIN. Phase 3 doesn't change boot. The `XENON_BOOTSTRAP_RESET_PASSWORD=true` escape hatch is unchanged.

### Migration safety

- The `phase_3_team_members` migration creates a new table — no destructive changes to existing data.
- The backfill is best-effort: ApiKeys missing `userId` (shouldn't happen post-Phase-1) are skipped; Legacy Admin's keys are skipped to avoid polluting team rosters.
- `down` only drops the table.
- After the migration applies and the new code is live, the existing UI continues to function for everything except team-member listings, which return the new User-keyed shape — and PR-C ships the matching UI rewrite.

### Last-super-admin race

A concurrent DELETE + PATCH that both check "another super-admin exists" can both succeed and demote / delete the org's last super-admin. SQLite serializes writes within a process, so this is only a multi-process concern. For Phase 3, accept the nano-window risk and document it. If it ever surfaces, wrap the operation in a `prisma.$transaction([countCheck, mutate])` with `SERIALIZABLE` semantics.

### Temporary password handling

When `POST /users` returns `temporaryPassword`, the value is shown once in the UI and never logged. The standard logger redaction list (which already includes `passwordHash`) gets `temporaryPassword` added.

### Security checklist (verify during implementation)

- [ ] Email uniqueness is enforced at the DB level (already true via `User.email @unique`).
- [ ] Email change is refused at PATCH level; the field is silently dropped from the request body.
- [ ] Last-active-SUPER_ADMIN check runs before any role demote / deactivate / delete.
- [ ] `targetUser.role` ranking ≤ caller's role; otherwise 403.
- [ ] DELETE = self refused with 400.
- [ ] PATCH `role` self refused with 400 (regardless of role-vs-target).
- [ ] Deactivate revokes all UserSessions for the target.
- [ ] Delete cascade includes UserSessions, ApiKeys, TeamMembers, PasswordResetTokens (already true via `onDelete: Cascade` on each FK).
- [ ] Generated temporary password is at least 12 URL-safe chars (`crypto.randomBytes(9).toString('base64url')` gives 12 chars).
- [ ] Logged temp password? **No.** Returned in the API response only; frontend shows it once.
- [ ] No leak of admin/super-admin user records to ADMIN-role callers (response filtered).

## Testing strategy

### Unit (`test/unit/`)

| Suite | Coverage |
|---|---|
| `UserService.test.ts` (extended) | listUsers role-filter, updateUser email-immutability, setRole last-super-admin guard, deactivateUser revokes sessions, deleteUser cascade |
| `users-router.test.ts` (NEW) | POST creates with temp password · POST refuses ADMIN→ADMIN role · PATCH refuses self role-change · PATCH refuses email change · DELETE refuses self · DELETE refuses last super-admin · GET filters per caller role |
| `TeamService.test.ts` (extended) | members switched from ApiKey to User; addMember(teamId, userId), removeMember |

### Integration (`test/integration/`)

| Suite | Scenario |
|---|---|
| `users-flow.spec.ts` | super-admin creates admin → admin creates member → admin lists (sees only members) → super-admin lists (sees all) → admin deletes member → confirm session revoked |
| `team-membership-migration.spec.ts` | seed an ApiKey with teamId on Member user → run migration → assert TeamMember row exists; Legacy Admin's keys yield no row |
| `users-lockout.spec.ts` | only super-admin tries to delete self → 400; tries to demote self → 400; second super-admin exists → first can delete |
| `role-matrix.spec.ts` (extended) | 4 new cases: GET /users (SA 200, A 200, M 403); POST /users (SA 201, A 201, M 403); PATCH /users/:id (SA 200, A 403 vs admin target, M 403); DELETE /users/:id (SA 204, A 204 vs member, A 403 vs admin) |

### Frontend

- `web/src/pages/users.smoke.test.tsx` (NEW) — vitest: page mounts; lists 0 users (mocked); invite modal opens; submit calls `createUser`.
- Sidebar role-visibility test extension — MEMBER doesn't see `Users`.

### Manual verification (final task)

```
npm run dev

1. Sign in as super-admin → /users → see one row (yourself).
2. Click "+ Invite User" → email=alice@x.local, name=Alice, role=ADMIN → submit.
   See modal with "Temporary password: <12 chars>". Copy.
3. Sign out → sign in as alice with that temp password → /users.
4. As alice (ADMIN), invite bob@x.local with role=MEMBER → succeeds.
5. As alice, try to invite carol@x.local with role=ADMIN → 403 + toast.
6. As alice, list /users → see only bob and yourself; super-admin not visible.
7. As super-admin, demote alice to MEMBER → her sidebar shrinks on next request.
8. As super-admin, try to delete yourself → 400.
9. As super-admin, try to demote yourself when you're the last SA → 400.
10. /teams: open existing team → see User-keyed members. Add bob via picker.
11. /devices (or wherever the device list lives): pick a device → assign to a team → toast confirms.
12. As alice (now MEMBER), 200 on /devices read; 403 on /apikeys.
```

### Out of scope

No load tests · no CSV import · no per-user rate limiting.

## Risks and open questions

- **Backfill correctness for Legacy Admin's keys.** The migration explicitly skips Legacy Admin to avoid polluting rosters. If a real admin's keys were re-pointed to Legacy Admin during Phase 1's adoption (shouldn't have happened, but worth a sanity check during implementation), those team links would be silently dropped. Mitigation: a one-line query at migration time logs how many ApiKeys were skipped — operators can investigate if the count is surprising.
- **Self-demote / self-delete UX.** The frontend disables those actions for the current user; the backend enforces them. If someone POSTs directly to the API the UI hides, the 400 protects them — but the operator log fires `roleChanged` / `userDeleted` events that won't actually have happened. Mitigation: log `roleChangeRefused` / `userDeleteRefused` separately; the audit log distinguishes "tried" from "did".
- **`teams.tsx` rewrite churn.** 582 lines, mostly working, ApiKey-keyed throughout. Best done by gutting the Members tab and re-writing it User-keyed; keep the rest of the page (team list, create, delete) intact. PR-C scope.
- **Existing `/teams/:id/members` callers.** The shape change is breaking. The only consumer is `web/src/components/settings/teams.tsx`, rewritten in lockstep in PR-C. No external clients.
- **Device-team assignment authorization.** `PUT /grid/device/:udid/team` is `roleGuard('ADMIN') + scopeGuard(['admin'])` (Phase 2). ADMINs and SUPER_ADMINs can both assign. ADMIN can move a device into a team they're not a member of — that's the documented behavior in device-farm-pro ("Admins can override team assignments"). No change.
- **Temp password security.** Returned once, shown in the modal, never logged. The user is asked to change it on first sign-in. We don't enforce that — there's no "must-change-password" flag. If demand surfaces, add `User.mustChangePassword: Boolean` and gate `/auth/me` to redirect to `/profile` until cleared. Phase 4+ candidate.

## Next step

Once this spec is approved, the brainstorming workflow hands off to the `superpowers:writing-plans` skill, which produces a step-by-step implementation plan. Three PRs anticipated:

- **PR-A:** Backend (TeamMember model + UserService extensions + `/users` router + `/teams/:id/members` rewrite + migration + integration tests).
- **PR-B:** Frontend `/users` page + sidebar entry + vitest smoke.
- **PR-C:** Team-membership UI rewrite (existing `teams.tsx`) + device-team assignment column on the Devices page + manual verification.

Each PR mergeable on its own; PR-A ships the API + migration even without UI; PR-B adds user management with no team-UI churn; PR-C closes the loop.
