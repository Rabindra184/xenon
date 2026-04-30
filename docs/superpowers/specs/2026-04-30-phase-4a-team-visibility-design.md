# Phase 4A — Per-team Device Visibility

**Status:** design
**Date:** 2026-04-30
**Author:** rabindrabiswal1@gmail.com

## Overview

Phase 1's spec deferred two items to Phase 4: per-team device-visibility enforcement and per-node `(accessKey, token)`. This spec covers **only the first**. Per-node auth (replacing `XENON_NODE_SECRET`) gets its own design cycle as Phase 4B once 4A bakes.

Today's gap: `Device.teamId` exists, and `prisma-store.ts` already filters by it (`callerTeamId`), but **the filter only fires for programmatic `(accessKey, token)` callers** via `SessionLifecycleService.authorizeSessionRequest`. Cookie sessions — the dashboard's primary auth path — get `callerTeamId === undefined` and see every device, regardless of `TeamMember` rows. Members today can see fleet-wide devices, queue, sessions, recordings, and builds — directly contradicting the docs' "Users can only access devices assigned to their team".

Phase 4A closes that gap by:

1. Computing `req.auth.teamIds: string[] | undefined` in `authMiddleware`, once per request, from Phase 3's `TeamMember` table. Admins return `undefined` (unscoped).
2. Widening the existing single-team filter (`callerTeamId`) to a multi-team set (`callerTeamIds`) — Phase 3's `TeamMember` is many-to-many, so a member can belong to multiple teams.
3. Applying the filter to every list-style read that's currently exposing fleet-wide data: `/grid/devices`, `/grid/queue/*`, `/grid/sessions/active`, dashboard session/build endpoints, and `/recordings/*`.

### What Phase 4A ships

- A new `req.auth.teamIds: string[]` field, populated by `authMiddleware` for `MEMBER`-role cookie sessions (one indexed `TeamMember` lookup per request). Undefined for `ADMIN` and `SUPER_ADMIN`.
- The filter signature widens from `callerTeamId: string | null | undefined` to `callerTeamIds: string[] | undefined`. SQL: `WHERE teamId IS NULL OR teamId IN (...)` (the `OR teamId IS NULL` keeps shared-pool devices visible to everyone).
- Filter applied across every device-reading endpoint (devices, queue, active sessions, dashboard session/build reads, recordings).
- `ApiKey.teamId` narrowing precedence: when an API token is narrowed to a single team, that one team OVERRIDES the user's full TeamMember set. Matches the "tokens narrow, never widen" rule from Phase 1.
- A small "Your teams" line on `/profile` so members see which teams they're scoped to.
- Integration tests covering: member sees only team + shared pool; admin sees everything; team-narrowed token sees only the narrowed team; member with no team rows sees only shared pool.

### What Phase 4A does NOT ship (deferred)

| Phase | Topic | Reason for deferral |
|---|---|---|
| 4B | Per-node `(accessKey, token)` for hub-node channel | Independent subsystem; `XENON_NODE_SECRET` works fine today |
| 5 | Sidebar redesign | Cosmetic |
| — | Per-team session quotas / per-team rate limits | Quotas are a separate design exercise; demand signal is unclear |
| — | Per-team device-allocation policy (round-robin within team) | Allocation is its own subsystem |
| — | Team-keyed audit dashboards | No UI for audit log yet |
| — | "My teams" widget on `/overview` | `/profile` line is enough |
| — | Auto-team-assign on user create | Operators add team membership manually via the Teams page |
| — | 2FA / SSO / OIDC / account lockout | Per Phase 1 spec, deferred indefinitely |

## Decisions on file (from brainstorm)

| # | Decision | Why |
|---|---|---|
| Q1 | `req.auth.teamIds: string[] \| undefined`. `undefined` = unscoped (admin). | One source of truth, populated once in middleware, no per-handler queries |
| Q2 | Admins skip team filtering | Mirrors device-farm-pro: "Admins can override team assignments" |
| Q3 | Empty-team-membership member sees shared pool only (`teamId IS NULL`) | Safe default; an unassigned member sees the unassigned-device pool |
| Q4 | Direct shared-pool devices remain visible to everyone | Operators need a way to expose devices to all members without explicit team assignment |
| Q5 | `ApiKey.teamId` narrows the user's set when present (single-team override) | Token narrowing must always be a strict subset of the user's grant |
| Q6 | Filter applied at the data-store layer, not in handlers | One place to enforce; handlers stay thin; DRY |
| Q7 | No new endpoints; response shapes unchanged | Pure backend behavior change with one tiny `/profile` UI addition |
| Q8 | Recordings/builds inherit visibility through `udid` → `device.teamId` | Consistent: if a member can't see the device, they can't see its recordings or its builds |

## Architecture

```
Request
  │
  ▼
authMiddleware
  │   ─ req.auth.userId, role, scopes (Phase 1-3)
  │   ─ NEW: req.auth.teamIds = MEMBER ? TeamMember.findMany() : undefined
  │
  ▼
roleGuard / scopeGuard (per route, Phase 2 / Phase 3 unchanged)
  │
  ▼
Handler — passes req.auth.teamIds into the data-layer filter
  │
  ▼
Data layer (prisma-store / device-store)
  │   ─ if callerTeamIds === undefined → no filter (admin)
  │   ─ else → WHERE teamId IS NULL OR teamId IN (callerTeamIds)
  │
  ▼
Response
```

The change concentrates in two places:

1. **`authMiddleware`** — populates `req.auth.teamIds` for member sessions. The lookup is one indexed query (`TeamMember` has `@@index([userId])` from Phase 3).
2. **`device-utils.ts` filter builder** — accepts `callerTeamIds` instead of `callerTeamId`. The downstream `prisma-store.ts` and `device-store.ts` swap their `WHERE teamId = X OR IS NULL` clauses for `WHERE teamId IS NULL OR IN (...)`.

Every consumer of `getDevices` (and the equivalent queue/session listings) gets the new filter at no extra cost — the filter is a passthrough when `callerTeamIds === undefined`.

### Why `req.auth.teamIds`, not a fresh service call?

The lookup must happen *somewhere* per request — better in middleware where the result can be reused across handlers, including downstream services like `SessionLifecycleService`. Keeps the data path symmetric for cookie-session and `(accessKey, token)` callers: both produce a `req.auth.teamIds` array (the latter is `[ApiKey.teamId]` if narrowed, or the user's full set if not).

### Token narrowing precedence

When `req.auth.kind === 'api-key'` and `req.auth.apiKeyId` exists with a non-null `teamId`, `req.auth.teamIds = [ApiKey.teamId]` (single-element array). When `ApiKey.teamId` is null, `req.auth.teamIds` falls back to the user's full TeamMember set. **A team-narrowed token can never widen** — even if the user belongs to teams the token wasn't narrowed to, those teams are invisible for that request.

This is encoded in `authMiddleware`'s population logic, not in handlers. Handlers just read `req.auth.teamIds` and pass it through.

## Data model

No schema changes. `TeamMember` (Phase 3) is the source of truth.

## API surface

### No new endpoints

### Modified — every list-style read picks up the new filter

| Surface | Endpoints | Filter applied via |
|---|---|---|
| `/grid` | `GET /devices`, `GET /device`, `GET /device/:platform`, `GET /queue/length`, `GET /queue`, `GET /queue/status/:capability_id`, `GET /queue/summary`, `GET /sessions/active`, `GET /node`, `GET /node/status` | `getDevices(filter)`, queue/session helpers gain a `callerTeamIds` argument that filters by joining through `Device.teamId` |
| `/dashboard` | `GET /session`, `GET /session/:sessionId`, `GET /build`, `GET /build/:buildId/sessions`, etc. | Filter on `Session.device_udid` → `Device.teamId` membership; sessions whose device is hidden don't appear; builds with no visible session don't appear in the listing |
| `/recordings` | `GET /recordings`, `GET /recordings/:groupId`, the per-device sub-resource reads | Filter on the recording's primary `udid` → `Device.teamId` membership; per-recording manual-lock check (Phase 1's `manual_<userId>_<udid>`) layered on top |

GET-by-id endpoints check the visibility on the underlying device and return 404 (not 403) when hidden — leaks less info than 403.

POST/PUT/DELETE mutations on devices, recordings, sessions are already gated by `roleGuard('MEMBER')` plus per-resource ownership checks (Phase 2 / Phase 3). They keep working — but a member trying to mutate a resource on an invisible device gets a natural 404 from the same filter.

### Auth contract

`src/types/express.d.ts` extends:

```ts
auth?: {
  // ... existing fields ...
  teamIds?: string[];  // present for MEMBER cookie sessions; undefined for ADMIN / SUPER_ADMIN
                       // (token-narrowed callers get [singleTeamId] here)
};
```

### Audit logging

Existing `deviceTeamAssigned` event (Phase 3) gains an explicit `fromTeamId → toTeamId` shape — already mostly there; just verify. No new audit events.

## Operational concerns

### Performance

`prisma.teamMember.findMany({ where: { userId } })` runs once per MEMBER-tier authenticated request. The `@@index([userId])` (Phase 3) keeps the query sub-millisecond. ADMIN / SUPER_ADMIN paths skip the lookup entirely. If profiling ever shows this as hot, cache on the UserSession row at session creation time (deferred until needed).

### Surprise hides

After Phase 4A, assigning a device to a team for the first time will HIDE that device from every member who isn't on the team. This is the intended semantic but a behavior change — operators doing bulk team-assigns may get "where did my devices go?" tickets. Mitigation:
- The audit log already records `deviceTeamAssigned` events.
- PR-A's body documents the behavior change loudly so reviewers and ops are warned.
- The `/devices` page already shows the team chip (Phase 3 PR-C), so the assignment is visible in the UI before the filter takes effect.

### Auth-disabled bypass

`config.authDisabled === true` (the dev-mode escape hatch from Phase 1) populates a synthetic SUPER_ADMIN auth. After Phase 4A, that path also gets `teamIds: undefined` (unscoped) — every device visible. Matches existing dev behavior; no change needed.

### Token-narrowed callers

`SessionLifecycleService.authorizeSessionRequest` already produces `callerTeamId` (singular). Phase 4A extends `authMiddleware` to also populate `req.auth.teamIds` for `kind: 'api-key'` callers — so the same data path serves both. The session-creation handler still consults `authorizeSessionRequest` for its team check; that consult continues to work because the underlying `ApiKey.teamId` is unchanged.

### Security checklist (verify during implementation)

- [ ] `req.auth.teamIds` is `undefined` for SUPER_ADMIN and ADMIN regardless of their TeamMember rows (admins are unscoped).
- [ ] `req.auth.teamIds` is `[apiKey.teamId]` (single element) when the request used a team-narrowed token, even if the underlying user belongs to other teams.
- [ ] Empty-array `req.auth.teamIds` results in `WHERE teamId IS NULL` only (shared-pool only).
- [ ] Every device list / queue / session / recording / build read passes `req.auth.teamIds` to its data-layer call.
- [ ] GET-by-id endpoints return 404 (not 403) for invisible resources — no info leak about whether the resource exists.
- [ ] Mutations on hidden resources return 404 from the natural filter, not 200 with success.
- [ ] `authMiddleware` doesn't double-fetch teamIds (memoize on req per request).

## Testing strategy

### Unit (`test/unit/`)

| Suite | Coverage |
|---|---|
| `authMiddleware.test.ts` (extended) | MEMBER cookie session populates `req.auth.teamIds` from TeamMember; ADMIN / SUPER_ADMIN cookie session leaves teamIds undefined; team-narrowed `(accessKey, token)` populates `[apiKey.teamId]`; empty TeamMember rows yield `[]` |
| `device-utils.test.ts` (extended or new) | `callerTeamIds` filter shape: undefined → no filter, [] → IS NULL only, [a, b] → IS NULL OR IN |
| `prisma-store.test.ts` (or device-store equivalent) | Filter SQL is correctly built for each input shape |

### Integration (`test/integration/`)

| Suite | Scenario |
|---|---|
| `team-visibility-grid.spec.ts` (NEW) | Member with one team sees devices in that team + shared; member with no team sees only shared; admin sees all; team-narrowed token sees only the narrowed team |
| `team-visibility-recordings.spec.ts` (NEW) | Member can't list recordings for a device on a team they're not in; admin can; manual-lock per-user check still applies on top |
| `team-visibility-dashboard.spec.ts` (NEW) | Session listings + build listings filter to caller-visible devices |
| `role-matrix.spec.ts` (extended) | Add a `/grid/devices` row that asserts member sees a smaller list than admin (using seedUser + a shared-pool + team-only fixture) |

### Manual verification (final task)

```
npm run dev

1. Sign in as super-admin → /devices → see all N devices.
2. Note one device's udid; assign it to a new team "team-x".
3. Invite alice@x.local with role=MEMBER. Sign in as alice.
4. /devices → alice sees N-1 devices (the team-x one is hidden).
5. As super-admin, add alice to team-x via /teams.
6. As alice, refresh /devices → see N devices again.
7. /grid/queue, /sessions/active, /recordings all filter the same way.
8. Generate a team-x-narrowed token via alice's /profile. Use it
   programmatically (header pair). The session creation succeeds and
   only sees team-x devices, even if alice is later added to other teams.
```

### Out of scope

No load tests · no fuzz on the filter SQL · no per-team rate-limit tests.

## Risks and open questions

- **Surprise hides** (above) — behavior change documented in PR body.
- **Performance** — per-request lookup, indexed; acceptable. Cache later if needed.
- **Token narrowing semantics** — explicit precedence rule documented in code + PR body.
- **Dashboard "session detail by id"** — when a member navigates to a deep-linked URL like `/sessions/<id>` for a session whose device is hidden, the GET should 404. Frontend should redirect to `/sessions` with a toast ("session no longer accessible") rather than render a broken page. PR-B handles this in the session-detail loader.
- **Already-running session at the time of removal** — a member who was on team-x and ran a session, then was removed from the team: their session detail becomes invisible to them but stays visible to admins. Acceptable. The session itself isn't terminated — that's a separate quota / housekeeping concern.
- **Build aggregation** — a build with sessions on multiple devices, some visible to the caller and some not: the listing shows the build (any visible session is enough) but per-session detail filters. Document this in PR-B body.
- **Search / filter UI** — `/devices` currently has client-side filter pills. Phase 4A doesn't change them; the underlying device list is just smaller for non-admins. No UI change needed.

## Next step

Once this spec is approved, the brainstorming workflow hands off to the `superpowers:writing-plans` skill, which produces a step-by-step implementation plan. Three PRs anticipated:

- **PR-A:** `authMiddleware` populates `req.auth.teamIds`. Widen the filter signature `callerTeamId` → `callerTeamIds` in `device-utils.ts`, `prisma-store.ts`, `device-store.ts`, `SessionLifecycleService.ts`. Apply to `/grid/devices` first. Unit + integration tests for the auth and filter mechanics.
- **PR-B:** Extend the filter to remaining surfaces — `/grid/queue/*`, `/grid/sessions/active`, dashboard session / build reads, recordings reads. Integration test per surface. Frontend session-detail 404 → redirect handler.
- **PR-C:** Frontend `/profile` "Your teams" line; manual verification; role-matrix integration test extension.

Each PR is mergeable on its own; PR-A makes member-tier device reads correct; PR-B closes the rest of the visibility holes; PR-C ships the user-visible bits.
