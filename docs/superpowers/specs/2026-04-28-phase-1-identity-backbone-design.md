# Phase 1 — Identity Backbone

**Status:** design
**Date:** 2026-04-28
**Author:** rabindrabiswal1@gmail.com

## Overview

Bring Xenon's authentication and identity model in line with the device-farm-pro spec at `/Users/rabindrabiswal/Workspace/device-farm-pro-docs`: real users with passwords, a sign-in screen, a profile page with API tokens, and the docs-faithful `(accessKey, token)` programmatic-auth shape.

Today Xenon authenticates exclusively with API keys. There is no User entity, no login screen, no per-user identity beyond an `ApiKey` row. The existing dashboard "gate" at `/xenon/` is a paste-key form. `ApiKey.role` is stored but never enforced. Hub-node uses a shared `XENON_NODE_SECRET`.

Closing the full gap (login, roles, user/team management UI, per-node tokens, sidebar redesign) is at least five distinct workstreams. **This spec covers Phase 1 only.** The other phases get their own spec → plan → PR cycle once Phase 1 ships and bakes.

### What Phase 1 ships

- A `User` entity with email + password + `accessKey`.
- `POST /auth/login`, `POST /auth/logout`, `POST /auth/change-password`.
- A `/login` screen (Xenon-adapted hero, no SSO).
- A `/profile` page with two tabs: *Password & Authentication* and *API Tokens* — Access Key row + Identity Tokens table.
- `(accessKey, token)` pair-based programmatic auth (HTTP headers and WebDriver capabilities).
- Migration that links every existing `ApiKey` to a User (Legacy Admin for everything, bootstrap admin for the auto-generated bootstrap key).
- Existing single-secret API key path still works for one minor version under a back-compat flag.

### What Phase 1 does NOT ship (deferred)

| Phase | Topic | Reason for deferral |
|---|---|---|
| 2 | Role enforcement matrix (SUPER_ADMIN / ADMIN / MEMBER) on every route | Need P1 in production first to learn which guards matter |
| 2 | Password reset via email | Whole SMTP subsystem; bootstrap-reset env var covers the painful case |
| 3 | User CRUD UI (`/users` page) | Bootstrap is the only user in P1; add CRUD when there's a second user |
| 3 | Team-membership join table + manage-members UI | Today only `Device.teamId` exists; no users-in-team yet |
| 3 | Device → team assignment UI | Backend supports it; UI is its own design exercise |
| 4 | Per-node `(accessKey, token)` for hub-node channel | Today's shared `XENON_NODE_SECRET` works; replacing it is a separate breaking change |
| 5 | Sidebar redesign / menu-items parity with docs | Cosmetic; orthogonal to identity model |
| — | 2FA, OAuth/Google SSO, OIDC, account lockout | Each is a real subsystem; none is gating "enterprise readiness" alone |

## Decisions on file (from brainstorm)

| # | Decision | Why |
|---|---|---|
| Q1 | Decompose; ship Phase 1 only | One PR per workstream — smaller blast radius |
| Q2 | `ApiKey.userId NOT NULL`; one model | Matches "personal API tokens" in docs; one verification path |
| Q3 | Adopt `(accessKey, token)` pair now | Profile UI is in P1; lock data model + UI down once |
| Q4 | Reuse `xenon_dashboard_session` cookie + new `UserSession` table | JWT is overkill; second cookie doubles surface |
| Q5 | Migration: synthetic Legacy Admin holds all existing keys | Real attribution lands in Phase 2 UI |
| Q6 | In: change-password, logout, IP rate-limit, min-8 password | Out: reset email, 2FA, account lockout |
| Q7 | Email + password only — no Google SSO in P1 | OAuth doubles P1 work and depends on external setup |
| Q8 | Login mockup: Xenon-adapted hero with feature pills | Same split structure as docs; Xenon brand on the left pane |

## Architecture

```
                                ┌──────────────────────────────┐
[Browser /login]  ─POST /auth/login (email, pw)─▶              │
                                │  Hub                          │
[Browser /*]  ─cookie─▶         │   authMiddleware              │
                                │     ├─ cookie → UserSession   │
                                │     │            → User       │
                                │     └─ cookie → ApiKey        │
                                │                  → User       │
[Test client] ─x-xenon-access-key + x-xenon-token─▶             │
                                │     verify(accessKey,token)   │
                                │                  → User       │
[WebDriver]   ─df:options.{accessKey,token}─▶                   │
                                │     same verification path    │
                                └──────────────────────────────┘
```

Every authenticated request ends with the same `req.auth` shape regardless of which path got it there:

```ts
req.auth = {
  kind: 'user-session' | 'api-key',
  userId,                  // always present
  role,                    // SUPER_ADMIN | ADMIN | MEMBER
  scopes,                  // present if kind === 'api-key'; derived from role otherwise
  teamId,                  // present if api-key carries one
  apiKeyId?,               // present if kind === 'api-key'
  sessionId?,              // present if kind === 'user-session'
}
```

### New modules

| Module | Path | Purpose |
|---|---|---|
| `UserService` | `src/services/UserService.ts` | bcrypt hash/verify, accessKey gen + rotate, password change, bootstrap |
| `UserSessionService` | `src/services/UserSessionService.ts` | opaque session table, sliding TTL, hourly cleanup |
| `LoginRateLimiter` | `src/middleware/loginRateLimiter.ts` | in-memory IP token bucket |

### Renamed

`apiKeyMiddleware` → `authMiddleware`. The old name is kept as a re-export for one release so unrelated routers don't churn.

## Data model

```prisma
model User {
  id                String     @id @default(uuid())
  email             String     @unique
  name              String
  passwordHash      String                              // bcrypt, cost 12
  accessKey         String     @unique                  // public, "xen_<12-char-rand>"
  role              UserRole   @default(MEMBER)         // stored, mostly not enforced in P1
  status            UserStatus @default(ACTIVE)         // ACTIVE | INACTIVE
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
  lastLoginAt       DateTime?
  passwordChangedAt DateTime?

  apiKeys           ApiKey[]
  sessions          UserSession[]

  @@index([accessKey])
}

enum UserRole   { SUPER_ADMIN ADMIN MEMBER }
enum UserStatus { ACTIVE INACTIVE }

model UserSession {
  id          String   @id @default(uuid())             // also the cookie value
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
  expiresAt   DateTime                                   // sliding 24h
  lastSeenAt  DateTime @default(now())
  userAgent   String?
  ipHash      String?                                    // SHA256(ip + serverSecret)

  @@index([userId])
  @@index([expiresAt])
}

model ApiKey {
  // ...all existing fields preserved
  userId      String                                     // NEW — NOT NULL
  user        User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

`Team` and `Device` are unchanged in Phase 1.

### Migration plan

One Prisma migration, idempotent:

1. Create `User`, `UserSession`, enums.
2. Insert bootstrap super-admin (`XENON_BOOTSTRAP_ADMIN_EMAIL` / `XENON_BOOTSTRAP_ADMIN_PASSWORD`, defaults `admin@xenon.local` / `Admin@123`). Log security warning to rotate.
3. If any rows exist in `ApiKey`, insert Legacy Admin user (`legacy-admin@xenon.local`, status `INACTIVE`, unusable bcrypt hash, accessKey `xen_legacy_<6 chars>`).
4. `ALTER TABLE api_keys ADD COLUMN user_id TEXT NOT NULL DEFAULT '<legacy-admin-id>'`.
5. `UPDATE api_keys SET user_id = '<bootstrap-admin-id>' WHERE name = 'bootstrap'`.
6. Drop the column default; add the FK + index.

`down` reverses 1, 3, 4, 6 (keys are not deleted; only the `user_id` annotation is dropped). Existing single-secret keys keep working through the back-compat flag.

## API surface

### New endpoints (under `/xenon/api`)

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `204` + `Set-Cookie: xenon_dashboard_session` | Rate-limited 5/IP/5min · generic 401 (no enumeration) · bumps `lastLoginAt` · timing-safe (always runs bcrypt) |
| POST | `/auth/logout` | — | `204` + clear cookie | Idempotent · deletes `UserSession` row |
| POST | `/auth/change-password` | `{ oldPassword, newPassword }` | `204` | Min 8 chars · bumps `passwordChangedAt` · deletes all *other* `UserSession` rows for this user |
| GET | `/auth/me` *(modified)* | — | `{ userId, email, name, role, accessKey, scopes, teamId, kind }` | Frontend redirect-source on 401 |
| GET | `/profile/tokens` | — | `[{ id, name, scopes, expiresAt, createdAt, lastUsedAt }]` | Caller's own; secret never returned |
| POST | `/profile/tokens` | `{ name, expiresAt?, scopes? }` | `201 { id, token }` | `token` shown once; `scopes` defaults to caller's role-derived set (see below) and can only narrow it, never widen |
| DELETE | `/profile/tokens/:id` | — | `204` | Caller's own only |
| GET | `/profile/access-key` | — | `{ accessKey }` | |
| POST | `/profile/access-key/rotate` | — | `200 { accessKey }` | Old accessKey dies immediately · existing tokens are *rebound* to the new accessKey (token row is unchanged; verification looks up User by accessKey, then matches token) |

### Role → scopes derivation (Phase 1)

When a user creates an API token without specifying `scopes`, the token inherits its caller's role-derived set. Caller may pass `scopes` explicitly only to narrow:

| Role | Default token scopes |
|---|---|
| `SUPER_ADMIN` | `['admin']` |
| `ADMIN` | `['devices', 'sessions', 'read']` |
| `MEMBER` | `['sessions', 'read']` |

These are the *maximum* scopes the user may grant on a token; a request to widen returns `400`. Phase 2 will reuse the same map for direct route enforcement.

### Modified

- `POST /auth/dashboard-session` — still works for ops escape hatch, but now requires `role = SUPER_ADMIN` on the key's owning user.
- `apiKeyMiddleware` → `authMiddleware`. Resolution priority:
  1. `xenon_dashboard_session` cookie → `UserSession` or `ApiKey`.
  2. `x-xenon-access-key` + `x-xenon-token` headers → User by accessKey, then verify token belongs to that user.
  3. `x-xenon-api-key` header (legacy) → only if `XENON_ACCEPT_LEGACY_KEY=true` (default on for one minor version).
- `scopeGuard` / `mutationScopeGuard` — unchanged. Still evaluate `req.auth.scopes`. `req.auth.role` is exposed for Phase 2.

### WebDriver capabilities

- New: `df:options.accessKey` + `df:options.token`.
- Legacy: `xenon:accessKey` (single secret), accepted under back-compat flag.
- Both present → pair wins. Neither → anonymous (existing behavior, will be tightened in a later phase).

### Explicitly NOT in Phase 1

- `POST /users`, `GET /users`, etc. — Phase 3.
- `POST /auth/forgot-password` — Phase 2+.
- `POST /profile/tokens/:id/regenerate` — delete + create suffices; the docs' "regenerate" icon is cosmetic.
- 2FA endpoints — deferred.

### Audit logging

Add events to existing log scope: `loginAttempt` (success/fail with IP hash + email), `tokenCreated`, `tokenDeleted`, `accessKeyRotated`, `passwordChanged`. No new audit table.

## Frontend

### New routes

- **`/login`** — Xenon-adapted hero (Q8 option B): split layout, brand statement + feature pills on the left, email + password + Sign in on the right. On submit → `POST /auth/login` → redirect to `?next=` URL or `/overview`.
- **`/profile`** — two tabs:
  - *Password & Authentication* — new password + confirm + Update.
  - *API Tokens* — Access Key row (copy + rotate), Generate New Token modal (name + optional expiry), token table (name / token-dots / issued / expiry / actions).

### Modified

- `web/src/components/header/header.tsx` — replace hardcoded `"Administrator"` with avatar + name + role from `/auth/me`. Dropdown items: **Profile**, **Logout**. (No Users / Teams / Manage Devices yet — Phase 3.)
- **Route guard** — every authenticated route reads `/auth/me` at mount. On `401` → `/login?next=<current>`. The mosaic page already calls `/auth/me`; we extend that call rather than add a parallel one.

### Demoted (not removed)

- `ApiKeyGate` moves from `/` to `/api-key-gate`. Undocumented from the main UI; kept as ops escape hatch.

### Untouched in Phase 1

- Sidebar (Overview, Devices, Apps, Sessions, Selector Health, Notifications, Settings, Teams, API Keys) — redesign is Phase 5.
- All existing page components — they authenticate via cookie today, no change needed.
- `/teams` page — exists today, stays as-is until Phase 3.

### Compatibility note: mosaic manual locks

Today the mosaic encodes locks as `manual_<userId>_<udid>` where `userId` is an `ApiKey.id`. After Phase 1, `/auth/me` returns a real `User.id`. The migration links every ApiKey to a User, so existing locks resolve correctly through a User-id fallback in `inspectManualLock`. No mosaic regression.

## Operational concerns

### Bootstrap on first run (empty DB)

```
1. Run pending Prisma migrations.
2. UserService.bootstrapIfEmpty():
   if User table empty:
     email    = XENON_BOOTSTRAP_ADMIN_EMAIL    ?? "admin@xenon.local"
     password = XENON_BOOTSTRAP_ADMIN_PASSWORD ?? "Admin@123"
     create User { role: SUPER_ADMIN, accessKey: random, passwordHash: bcrypt(password) }
     log.warn("Bootstrap super-admin created. Sign in and rotate.")
3. ApiKeyService.bootstrapIfEmpty():
   if ApiKey table empty:
     create ApiKey { userId: bootstrap-admin-id, name: "bootstrap", scopes: ["admin"] }
     write secret to bootstrap-key.txt   # existing behavior
```

The bootstrap admin's accessKey is *not* written to disk. Sign in via the UI to read it from `/profile`.

### Bootstrap on populated DB (existing install upgrading to P1)

```
Migration creates Legacy Admin (status INACTIVE, unusable bcrypt).
ALTER api_keys ADD user_id (default legacy-admin-id, then drop default).
UPDATE api_keys SET user_id = bootstrap-admin-id WHERE name = 'bootstrap'.
UserService.bootstrapIfEmpty() — sees Legacy Admin exists, so creates the bootstrap super-admin
  only if no SUPER_ADMIN with status=ACTIVE exists.
```

### Forgot the bootstrap password

```
XENON_BOOTSTRAP_RESET_PASSWORD=true XENON_BOOTSTRAP_ADMIN_PASSWORD=NewPw123 npm run server
```

On boot, if the env var is `true` and a bootstrap super-admin exists, password is rotated and **all** UserSessions for that user are deleted. Logged loudly. Replaces the email-based reset we punted.

### Login rate limiting

- In-memory token bucket per IP: `XENON_LOGIN_RATE_LIMIT_ATTEMPTS` (5) per `XENON_LOGIN_RATE_LIMIT_WINDOW_MS` (300000).
- Cleared on success.
- Not durable across restart. Acceptable; real abuse needs a WAF.
- No account-lockout (deferred).

### Session lifecycle

- `UserSession.expiresAt` = `now + XENON_USER_SESSION_TTL_MS` (default 24h) on create.
- Each authenticated request bumps `expiresAt` and `lastSeenAt` (sliding window).
- Hourly cron: `DELETE FROM user_sessions WHERE expiresAt < now()`. Reuses existing scheduler.

### Password handling

- `bcrypt` cost 12 (≈ 250ms/hash).
- Password fields never logged. Add `passwordHash` to existing log redaction.

### Env var summary

| Var | Default | Purpose |
|---|---|---|
| `XENON_BOOTSTRAP_ADMIN_EMAIL` | `admin@xenon.local` | first-run super-admin email |
| `XENON_BOOTSTRAP_ADMIN_PASSWORD` | `Admin@123` | first-run super-admin password |
| `XENON_BOOTSTRAP_RESET_PASSWORD` | `false` | rotate bootstrap admin password on boot |
| `XENON_ACCEPT_LEGACY_KEY` | `true` | accept single `x-xenon-api-key` header (sunset: next minor) |
| `XENON_LOGIN_RATE_LIMIT_ATTEMPTS` | `5` | failed-attempts threshold |
| `XENON_LOGIN_RATE_LIMIT_WINDOW_MS` | `300000` | rolling window |
| `XENON_USER_SESSION_TTL_MS` | `86400000` | sliding session TTL (24h) |

### Security checklist (verify during implementation)

- [ ] Generic 401 on bad credentials — no email enumeration.
- [ ] HTTP-only, Secure, `SameSite=strict` cookie (matches existing).
- [ ] Password fields never logged, even on validation failure.
- [ ] `change-password` invalidates every other session for the user.
- [ ] `accessKey rotate` returns a new value but does *not* invalidate tokens.
- [ ] Migration is idempotent — re-running on an already-migrated DB is a no-op.
- [ ] Login route runs bcrypt-compare whether or not the email exists (timing-safe).

## Testing strategy

### Unit (`test/unit/`)

| Suite | Coverage |
|---|---|
| `UserService.spec.ts` | bcrypt roundtrip · accessKey gen · password validation · `bootstrapIfEmpty` idempotency · `changePassword` invalidates other sessions |
| `UserSessionService.spec.ts` | create / resolve / sliding-renew / expire / logout / cleanup |
| `LoginRateLimiter.spec.ts` | threshold · window rollover · success clears bucket · IPs isolated |
| `authMiddleware.spec.ts` | cookie→UserSession · cookie→ApiKey · `(accessKey,token)` header pair · legacy `x-xenon-api-key` (flag on/off) · 401 shapes |
| `bootstrap.spec.ts` | empty DB · populated DB · `XENON_BOOTSTRAP_RESET_PASSWORD=true` · re-running migration |

### Integration (`test/integration/`)

| Suite | Scenario |
|---|---|
| `auth-flow.spec.ts` | login → cookie → `/auth/me` → logout → 401 |
| `auth-rate-limit.spec.ts` | 5 bad logins → 6th 429 with `Retry-After`; success resets |
| `profile-tokens.spec.ts` | create token (secret once) → list (no secret) → delete; rotate accessKey keeps tokens valid |
| `legacy-key-compat.spec.ts` | flag on → works · flag off → 401 |
| `migration.spec.ts` | seed old DB → migrate → assert User attached, Legacy Admin exists, rerun → no diff |
| `change-password.spec.ts` | other sessions for same user are gone; current survives |

### Frontend smoke

- Login renders, submits, redirects on `?next=`.
- Profile lists tokens; Generate shows secret in modal once.
- Header avatar/dropdown reflects `/auth/me`; Logout clears cookie + redirects to `/login`.
- Route guard: unauth `/devices` → `/login?next=/devices`.

### Manual verification (CLAUDE.md requires UI verification)

```
npm run dev
# 1. Visit http://localhost:4723/xenon/  →  /login redirect.
# 2. Sign in admin@xenon.local / Admin@123  →  /overview.
# 3. /profile → API Tokens → Generate  →  secret shown once.
# 4. curl with x-xenon-access-key + x-xenon-token  →  200 on /xenon/api/devices.
# 5. Logout  →  /auth/me returns 401.
# 6. 5 bad logins  →  6th returns 429.
# 7. Change password  →  other tabs get 401 on next request.
```

### Out of scope

No load tests · no fuzz on bcrypt · no e2e for SSO/OAuth.

## Risks and open questions

- **bcrypt dependency.** Confirm during implementation whether `bcrypt` is already in the dep tree via Prisma/Argon path, or needs to be added (`bcrypt@^5`).
- **Cookie format change for resolution.** Today `xenon_dashboard_session` is an ApiKey id. After P1, it can be either an ApiKey id or a UserSession id. Resolution tries one, then the other. Requires that ID spaces don't collide — both are UUID v4, collision is astronomically unlikely, but `authMiddleware` should treat ambiguity as auth failure rather than picking one.
- **Frontend rehydration.** The mosaic mount-time rehydration relies on `/auth/me`'s `userId`. We must verify that the User-id-vs-ApiKey-id transition for cookie sessions doesn't strand existing manual locks at upgrade time.
- **`xenon:accessKey` capability semantics.** Today the capability holds the single secret. After P1, when both `df:options.accessKey` and `df:options.token` are present, those win. If only `xenon:accessKey` is present and the back-compat flag is off, session creation fails. We should verify no internal test fixtures rely on `xenon:accessKey`.
- **Legacy Admin status.** It's `INACTIVE` so no one can log in as it, but every existing ApiKey points to it. If ops marks it `ACTIVE` and its tokens get used, every token in the system suddenly has SUPER_ADMIN scope (because role-derived scopes for SUPER_ADMIN are broad). Mitigation: in P1 the implementation must short-circuit Legacy Admin to a tightly-scoped role-derived set even though the DB row says SUPER_ADMIN.

## Next step

Once this spec is approved, the brainstorming workflow hands off to the `superpowers:writing-plans` skill, which produces a step-by-step implementation plan from this design.
