# Phase 2 — Role Enforcement + Password Reset

**Status:** design
**Date:** 2026-04-29
**Author:** rabindrabiswal1@gmail.com

## Overview

Phase 1 (PRs #59 / #60 / #61, all merged) shipped the User entity, login/logout/profile flows, and the `(accessKey, token)` programmatic auth shape. It explicitly deferred two things to Phase 2:

1. **Role enforcement matrix** on every authenticated route.
2. **Password reset via email**.

Today every authenticated request carries `req.auth.role` (`SUPER_ADMIN | ADMIN | MEMBER`), but the role is **inert** — every existing guard is a *scope* guard (`scopeGuard(['admin'])`, `mutationScopeGuard(['devices'])`). Six routers (`bug-report`, `build-export`, `recordings`, `interceptor`, `profile`, `auth`) have no scope guard at all; the first three are real holes, the last two are intentional. For password recovery, the only flow today is the env-var escape hatch `XENON_BOOTSTRAP_RESET_PASSWORD=true` — there is no user-initiated reset.

Phase 2 closes both gaps. It does **not** ship `/users` or team-membership UI (those are Phase 3) — what it ships is the **enforcement matrix** plus a **self-service password-reset flow**.

### What Phase 2 ships

- A `roleGuard(min)` middleware that checks `req.auth.role` against a minimum (`SUPER_ADMIN > ADMIN > MEMBER`) and returns 403 on insufficient role. Composes with the existing `scopeGuard`.
- The role matrix from `device-farm-pro-docs/docs/user-authentication.md` applied to every router under `/xenon/api`. The six unguarded routers gain at minimum a `roleGuard('MEMBER')` to close the holes.
- A `/auth/forgot-password` + `/auth/reset-password` self-service flow backed by a new `PasswordResetToken` table and `nodemailer`-based email delivery, with graceful **log-fallback** when SMTP isn't configured.
- Frontend `/forgot-password` and `/reset-password/<token>` pages outside the `RouteGuard`. The header dropdown / sidebar hides items the caller's role can't access.
- Test fixture: a shared `seedUser({ role })` helper so every integration suite can author a request as the role it actually intends to test.

### What Phase 2 does NOT ship (deferred)

| Phase | Topic | Reason for deferral |
|---|---|---|
| 3 | `/users` page (CRUD, role assignment, deactivate) | Bootstrap super-admin can edit roles via SQL until then; Phase 2 enforces what the DB says, it doesn't change it |
| 3 | Team-membership UI + device → team UI | Backend supports `Device.teamId`; UI is its own design exercise |
| 4 | Per-node `(accessKey, token)` for hub-node channel | `XENON_NODE_SECRET` still works; orthogonal change |
| 5 | Sidebar redesign | Cosmetic |
| — | 2FA, SSO/OAuth, OIDC, account lockout, recovery questions | Per Phase 1 spec, deferred indefinitely |
| — | Audit log for role changes | No UI to change roles in P2; the audit event lands when Phase 3 UI does |

## Decisions on file (from brainstorm)

| # | Decision | Why |
|---|---|---|
| Q1 | Roles **overlay** scopes; both survive | A Member's CI token can be `read`-only even though the owner has `sessions,read` — token-narrowing stays meaningful. Two simple concepts that compose are cleaner than one complex one |
| Q2 | `nodemailer` with SMTP env config; log fallback when unset | SMTP is the universally supported option for self-hosted ops. Log-fallback keeps `npm run dev` working without external infra, mirroring Phase 1's `bootstrap-key.txt` pattern |
| Q3 | Phase 2 enforces the matrix; Phase 3 ships the management UI | Decoupling lets us land the security win on its own and learn which 403s actually trip in production before we design the management UX |
| Q4 | Single-use, time-bound, hashed `PasswordResetToken` | Matches the docs' "reset password" flow; mirrors Phase 1's UserSession TTL pattern |
| Q5 | Generic 204 from `/auth/forgot-password` regardless of email-exists | Same anti-enumeration argument as `/auth/login` (Phase 1) |
| Q6 | Rate-limit `/auth/forgot-password` per IP | Reuse `LoginRateLimiter` from Phase 1 — separate bucket so reset attempts don't share quota with login |
| Q7 | Six unguarded routers all get `roleGuard('MEMBER')` minimum | Close the holes. `MEMBER` is the floor; specific routes step up to ADMIN/SUPER_ADMIN per matrix |

## Architecture

```
Request
  │
  ▼
authMiddleware (Phase 1)        — populates req.auth { kind, userId, role, scopes, ... }
  │
  ▼
roleGuard(min)            (NEW) — 403 if req.auth.role < min
  │
  ▼
scopeGuard(required)      (P1)  — 403 if token's scopes don't include any of `required` (or 'admin')
  │
  ▼
handler                         — receives req with auth confirmed at both axes
```

`roleGuard` and `scopeGuard` compose. A route can use either alone or both. Typical patterns:

| Route purpose | Guards |
|---|---|
| Read your own resources | `roleGuard('MEMBER')` only |
| Read team-wide / mutate non-system data | `roleGuard('ADMIN')` + existing `scopeGuard(['devices'])` (or similar) |
| Mutate system config | `roleGuard('SUPER_ADMIN')` |
| Self-service (own profile, own tokens) | no role gate; handler checks `req.auth.userId` ownership |

### Role hierarchy

```ts
// src/middleware/roleGuard.ts
const ROLE_RANK = { SUPER_ADMIN: 3, ADMIN: 2, MEMBER: 1 } as const;
export function roleGuard(min: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER'): RequestHandler;
```

If `req.auth.role` resolves to a value outside the known set (defensive — should never happen given Phase 1's `isUserRole` type guard at the persistence boundary), the guard returns 403 fail-closed.

### Role matrix (applied per router)

Source of truth: `/Users/rabindrabiswal/Workspace/device-farm-pro-docs/docs/user-authentication.md`. Applied to Xenon routers:

| Router | Method/Path | roleGuard | scopeGuard |
|---|---|---|---|
| `apikeys.ts` | GET/POST/DELETE all | `ADMIN` | `['admin']` (existing) |
| `teams.ts` | GET/POST/DELETE all | `ADMIN` | `['admin']` (existing) |
| `webhook.ts` | POST/DELETE/test | `ADMIN` | `['admin']` (existing) |
| `processes.ts` | GET | `ADMIN` | `['admin']` (existing) |
| `dashboard.ts` healing/config mutations | POST | `ADMIN` | `['admin']` (existing) |
| `dashboard.ts` reads | GET | `MEMBER` | none |
| `apps.ts` | GET | `MEMBER` | none |
| `apps.ts` | POST/DELETE | `ADMIN` | `['devices']` (existing `mutationScopeGuard`) |
| `reservation.ts` | GET | `MEMBER` | none |
| `reservation.ts` | POST/DELETE (mutations) | `MEMBER` | `['devices']` (existing). Reserving a device for *yourself* is a Member action; flagging a device for maintenance is Admin. Two distinct mount points |
| `control.ts` | GET (live preview) | `MEMBER` | none |
| `control.ts` | POST (start stream / record) | `MEMBER` | `['devices']` |
| `control.ts` | POST flag/unflag | `ADMIN` | `['devices']` |
| `recordings.ts` | GET | `MEMBER` | none |
| `recordings.ts` | POST/DELETE | `MEMBER` | none (per-user manual locks already enforce ownership) |
| `bug-report.ts` | all | `MEMBER` | none |
| `build-export.ts` | all | `MEMBER` | none |
| `interceptor.ts` | all | `ADMIN` | `['admin']` |
| `config.ts` | GET | `ADMIN` | `['admin']` |
| `config.ts` | POST/PUT (system) | `SUPER_ADMIN` | `['admin']` |
| `grid.ts` | GET nodes | `MEMBER` | none |
| `grid.ts` | POST register/remove | `ADMIN` | `['admin']` |
| `profile.ts` | all | (none — handler checks ownership) | none |
| `auth.ts public` | login, logout, forgot, reset | (none — outside auth) | none |
| `auth.ts authed` | me, change-password | (none — handler checks ownership) | none |
| `auth.ts authed` | dashboard-session | `SUPER_ADMIN` (already in P1) | n/a |

The mapping is deliberately conservative: when in doubt about a route's intent, default to `MEMBER` (not unauthenticated) and let production usage tell us when to step up.

### Password reset flow

```
[Browser /forgot-password]
   ─POST /auth/forgot-password { email }─▶
                                          │
                                          ▼
                          rate-limit: LoginRateLimiter (separate bucket "forgot")
                                          │
                                          ▼ (always 204; no enumeration)
                          Background: lookup user by email; if ACTIVE,
                            create PasswordResetToken (1h TTL),
                            email link, OR log link if SMTP unset
                                          │
[User clicks email link]
   ─GET /reset-password/<token>─▶
                                          │
                                          ▼
                          (Frontend page) ─GET /auth/reset-password/check/<token>
                                          ─→ 200 if valid; 404 otherwise
                                          │
                                          ▼ user enters new password
   ─POST /auth/reset-password { token, newPassword }─▶
                                          │
                                          ▼
                          consume token (set usedAt),
                            update User.passwordHash + passwordChangedAt,
                            revokeAll UserSessions for that user
                                          │
                                          ▼ 204 + redirect to /login
```

### New modules

| Module | Path | Purpose |
|---|---|---|
| `roleGuard` | `src/middleware/roleGuard.ts` | role hierarchy check |
| `PasswordResetService` | `src/services/PasswordResetService.ts` | create / verify / consume / expire reset tokens |
| `EmailService` | `src/services/EmailService.ts` | nodemailer wrapper; falls back to log when SMTP unset |
| `seedUser test helper` | `test/helpers/seedUser.ts` | shared user-fixture for integration suites |

### Modified modules

- `src/services/UserSessionService.ts` — no change; `revokeAllForUser(userId)` (NEW) helper that deletes all sessions (not "all except one"), called from password-reset.
- `src/middleware/loginRateLimiter.ts` — already keyed by IP; we instantiate a second `LoginRateLimiter` for the forgot-password endpoint (separate buckets).
- All 16 routers under `src/app/routers/` — add `roleGuard(...)` per the matrix above.

## Data model

One new model:

```prisma
model PasswordResetToken {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique                          // sha256(rawToken); raw is what's emailed
  createdAt  DateTime  @default(now())
  expiresAt  DateTime                                   // now + XENON_RESET_TOKEN_TTL_MS (default 1h)
  usedAt     DateTime?

  @@index([userId])
  @@index([expiresAt])
}
```

Single Prisma migration `phase_2_password_reset` adds the table. No changes to `User`, `ApiKey`, `UserSession`.

### Token shape

- `rawToken` is `crypto.randomBytes(32).toString('base64url')` — 43 chars, URL-safe, ~256 bits of entropy. Same primitive as Phase 1's API tokens.
- `tokenHash` is `sha256(rawToken)`. The raw token is emailed and is the only way to reset; we store only the hash.
- Reset link shape: `https://<host>/xenon/reset-password/<rawToken>`.

## API surface

### New endpoints (under `/xenon/api`)

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| POST | `/auth/forgot-password` | `{ email }` | `204` always | Rate-limited per IP (separate bucket from login) · generic 204 (no enumeration) · timing-safe (always sleeps a constant 50ms regardless of branch) |
| GET | `/auth/reset-password/check/:token` | — | `200 { ok: true }` if valid; `404 { error: 'invalid or expired token' }` otherwise | Used by frontend to render "your link has expired" before showing the form |
| POST | `/auth/reset-password` | `{ token, newPassword }` | `204` | Consumes the token · updates `passwordHash` + `passwordChangedAt` · revokes all UserSessions for that user · 400 on min-8-char fail · 404 on invalid/expired/already-used token |

### Modified

- Every existing route under `/xenon/api/{apikeys,teams,webhook,processes,dashboard,apps,reservation,control,recordings,bug-report,build-export,interceptor,config,grid}` gains a `roleGuard(...)` per the matrix above. Where the route already had `scopeGuard(...)`, it now has both — `roleGuard` evaluated first.

### Audit logging

Add events to existing scoped logger:
- `passwordResetRequested` — IP hash + email; logs whether email was sent or fell back to log
- `passwordResetCompleted` — userId + IP hash
- `passwordResetExpired` — userId (for token-cleanup cron metrics)

`/auth/forgot-password`'s rate-limit denials produce `forgotPasswordRateLimited` events.

### Cookie / cookie-resolution unchanged

Phase 1's `xenon_dashboard_session` semantics carry forward unchanged. After a successful reset, the user is signed out everywhere and must log in again — both sessions and `lastSeenAt` are gone.

## Frontend

### New routes

- **`/forgot-password`** — single email input + Submit button. On 204 always shows: *"If your email is registered, you'll receive a reset link shortly. Check spam if you don't see it within a minute."* (Same-message-on-success-and-failure to match the backend's anti-enumeration policy.) "Back to sign in" link.
- **`/reset-password/:token`** — on mount calls `GET /auth/reset-password/check/:token`. If 404 → renders "this link is invalid or expired, request a new one" with link back to `/forgot-password`. If 200 → renders new-password + confirm form, identical inputs to the existing change-password tab. On 204 → redirect to `/login` with a one-shot toast: *"Password updated. Sign in with your new password."*

Both routes mount **outside** `<RouteGuard>` (same as `/login`).

### Modified

- `web/src/api-service/auth.ts` — adds `forgotPassword(email)`, `checkResetToken(token)`, `resetPassword(token, newPassword)`.
- `web/src/pages/login.tsx` — add a "Forgot password?" link below the password field, pointing at `/forgot-password`.
- `web/src/components/sidebar/sidebar.tsx` — hide menu items that the caller's role can't access. Mapping (from the matrix):
  - MEMBER sees: Overview, Devices (read-only), Sessions (own), Apps (read), Selector Health, Notifications.
  - ADMIN adds: Apps (manage), Reservation, Teams, API Keys, Webhooks.
  - SUPER_ADMIN adds: Settings (system).
- `web/src/components/header/header.tsx` — already shows role from Phase 1; no functional change. Add the same role-aware visibility to the Workspace/System dropdown sections so MEMBER doesn't see admin-only items.
- `web/src/auth/auth-context.tsx` — no change; `me.role` is already exposed.

### 403 UX

When a route returns 403, the frontend's existing `api-client.ts` toast pipeline shows: *"This action requires {min role}. Contact an admin if you need access."* Single source of formatting in the api-client; no per-call handling.

## Operational concerns

### Bootstrap (no change to Phase 1 path)

Phase 1's `bootstrapIdentity()` creates the SUPER_ADMIN. Phase 2 adds nothing to bootstrap. Existing `XENON_BOOTSTRAP_RESET_PASSWORD=true` env-var escape hatch survives unchanged — useful if SMTP isn't configured AND the only super-admin loses email access.

### SMTP configuration

```
XENON_SMTP_URL=smtps://user:pass@smtp.example.com:465      # nodemailer URL form
XENON_SMTP_FROM="Xenon <noreply@example.com>"
XENON_RESET_TOKEN_TTL_MS=3600000                          # 1h default
XENON_PASSWORD_RESET_LOG_FALLBACK=true                    # if SMTP unset, log link instead
XENON_RESET_RATE_LIMIT_ATTEMPTS=3                         # forgot-password bucket
XENON_RESET_RATE_LIMIT_WINDOW_MS=900000                   # 15min default (longer than login)
```

When `XENON_SMTP_URL` is unset:
- If `XENON_PASSWORD_RESET_LOG_FALLBACK=true` (default) — `EmailService.send()` logs the email body at `warn` level. Operators self-relay.
- If `XENON_PASSWORD_RESET_LOG_FALLBACK=false` — `EmailService.send()` throws. `/auth/forgot-password` still returns 204 (anti-enumeration), but the operator log records a `passwordResetSendFailed` event.

### Reset-token cleanup

Reuse Phase 1's hourly cron (`src/services/identity/sessionCleanupCron.ts`). Add a second `cleanupExpiredResetTokens()` call alongside the existing session cleanup. Same hour cadence, same `.unref()` pattern.

### Email template

A single hard-coded text/plain template in `EmailService` — no template engine. Contains: greeting using `User.name`, the reset link, "this link expires in 1 hour", "if you didn't request this, ignore this email" boilerplate. No HTML version (keeps the surface small; if marketing wants branded email they can swap to a real template engine in a later phase).

### Security checklist (verify during implementation)

- [ ] `/auth/forgot-password` always returns 204 — no email-exists enumeration.
- [ ] Bcrypt-compare runs even when user doesn't exist (constant-time branch).
- [ ] Reset token is hashed before storage; raw is in the email only.
- [ ] Token is single-use — `usedAt` set atomically with the password update; second attempt 404s.
- [ ] Token TTL enforced before consume.
- [ ] Successful reset revokes every UserSession for that user.
- [ ] Rate limit on `/auth/forgot-password` — separate IP-keyed bucket from `/auth/login`.
- [ ] Reset link uses HTTPS in production (server respects `X-Forwarded-Proto`).
- [ ] No-cache + no-store headers on `/auth/forgot-password` and `/auth/reset-password` responses (already set globally per Phase 1's apiRouter cache-control).
- [ ] `roleGuard` returns 403 (not 401) on insufficient role — the caller IS authenticated.
- [ ] `roleGuard` fails closed for unknown role values (defense in depth).

## Testing strategy

### Unit (`test/unit/`)

| Suite | Coverage |
|---|---|
| `roleGuard.test.ts` | 9 cases: each (SUPER_ADMIN, ADMIN, MEMBER) request × each (SUPER_ADMIN, ADMIN, MEMBER) min — pass/fail per the hierarchy. Plus: missing `req.auth` → 401; unknown role → 403. |
| `PasswordResetService.test.ts` | createToken (returns raw + hash) · verify happy path · verify expired returns null · verify already-used returns null · consume marks used + idempotent on retry · cleanupExpired |
| `EmailService.test.ts` | SMTP-on path uses nodemailer.createTransport (with mocked transport) · log-fallback path writes the expected line · throws on `XENON_PASSWORD_RESET_LOG_FALLBACK=false` and SMTP unset |

### Integration (`test/integration/`)

| Suite | Scenario |
|---|---|
| `forgot-password.spec.ts` | full flow: forgot → DB has unused token → reset with token → 204 → user can log in with new password; old password rejected; tokens reused → 404; tokens expired → 404 |
| `forgot-password-rate-limit.spec.ts` | 3 attempts from one IP → 4th 429 with Retry-After |
| `role-matrix.spec.ts` | one test per (role × router), boundary cases — e.g. MEMBER on `/apikeys` POST → 403; ADMIN on `/apikeys` POST → 200; MEMBER on `/recordings` GET → 200; SUPER_ADMIN passes everywhere. ~30 test cases auto-generated from a table fixture |
| `reset-revokes-sessions.spec.ts` | user with two active UserSessions → reset → both deleted → both cookies 401 |

### Frontend

- `auth-pages.smoke.test.tsx` — vitest: `/forgot-password` renders + submits; `/reset-password/<token>` shows "expired" state when check returns 404, form when 200; full reset flow with mocked `api-service/auth`.
- Sidebar role-visibility test: MEMBER sidebar excludes admin items; SUPER_ADMIN sees everything.

### Manual verification (final task)

```
npm run dev
1. Visit /xenon/login → click "Forgot password?" → /forgot-password.
2. Enter unknown@xenon.local → submit → see generic success message.
3. Enter admin@xenon.local → submit → check operator logs for the reset link
   (or check inbox if SMTP is configured).
4. Click the link → /reset-password/<token> renders the form.
5. Enter "NewPassw0rd!" twice → submit → redirect to /login.
6. Sign in with old password → 401.
7. Sign in with new password → /overview.
8. As MEMBER (use SQL to demote): hit POST /xenon/api/apikeys via curl → 403.
9. As ADMIN: hit POST /xenon/api/apikeys → 200.
10. Sidebar shows correct items per role; refresh after role change reflects the new menu.
11. 4 forgot-password attempts from one IP → 4th returns 429.
```

### Out of scope

No load tests · no SMTP-failure-mode chaos tests · no end-to-end against a real SMTP provider (uses nodemailer's stream transport in CI).

## Risks and open questions

- **Test fixture explosion.** The role-matrix integration suite has ~30 cases. Authoring a user per case is slow if bcrypt cost stays at production. Solution: `seedUser()` helper uses `XENON_BCRYPT_COST=4` in test env (already the convention from Phase 1). Confirm during implementation that 30 user creates + 30 sessions still fits in the 30s mocha timeout.
- **Sidebar role-visibility staleness.** If an admin demotes a user mid-session, the user's sidebar reflects the old role until they refresh. Acceptable: any 403 they hit shows the toast, prompting them to refresh. We do NOT poll `/auth/me` continuously.
- **Email rendering.** Single hard-coded template. If the user's email client mangles the link (some clients break on long base64url tokens), we'll find out the first time someone reports it. Mitigation: the link works as a triple-clickable single token even if line-broken — most email clients restitch URLs.
- **Forgot-password rate limit bucket key.** Per IP. A multi-user company behind one NAT gateway shares a bucket, which means an attacker can DoS legitimate resets for that IP block. Acceptable: real abuse needs a WAF (same argument Phase 1 used). The 3-per-15-min default is generous enough for honest users.
- **Phase 1's "Legacy Admin" ApiKeys.** Their User row is `INACTIVE` so `authMiddleware` already 401s before any role check. After Phase 2, this is unchanged. No regression.
- **Adding `roleGuard('MEMBER')` to the six unguarded routers.** This is technically a behavior change — previously they accepted any authenticated user, now they require role ≥ MEMBER. In practice every authenticated request HAS a role (the schema constrains it), so this is a no-op for honest traffic, and a tightening for an attacker who managed to forge a roleless `req.auth`. Defense in depth.

## Next step

Once this spec is approved, the brainstorming workflow hands off to the `superpowers:writing-plans` skill, which produces a step-by-step implementation plan. Three PRs likely:

- **PR-A:** roleGuard middleware + apply matrix to every existing router + tests. No UI, no DB change.
- **PR-B:** PasswordResetToken model + EmailService + `/auth/forgot-password` + `/auth/reset-password` endpoints + integration tests.
- **PR-C:** Frontend `/forgot-password` and `/reset-password` pages + sidebar role-visibility + 403 toast + manual verification.

PR-A is mergeable on its own (closes the enforcement gap), PR-B is mergeable on its own (adds the reset flow even without the UI), PR-C ships the user-visible bits last.
