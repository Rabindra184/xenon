# Device access guard — enforcing device ownership on control endpoints

**Date:** 2026-08-08
**Status:** approved, ready for planning

## Problem

Xenon has an ownership model for devices and does not enforce it where it
matters. A second user can drive a device that another user — or a running
Appium test — is already using.

### What exists today

`src/services/recording/manualLock.ts` encodes a soft lock as
`manual_<actorId>_<udid>` and `inspectManualLock` correctly classifies a lock as
self, foreign, or legacy. Exactly one endpoint consults it:
`POST /:udid/stream/stop` returns `403 lock_owned_by_another_user` for a foreign
lock, with an admin bypass (`control.ts:659`).

### Gap 1 — no control endpoint checks ownership

Every endpoint that actually drives the device — `tap`, `swipe`, `text`,
`keyevent`, `touchAndHold`, `lock`, `unlock`, `install`,
`install-repository-app`, `upload-install`, `uninstall`, `shell`, `clipboard`
(POST), `test-locator` — passes through `roleGuard('MEMBER')` and
`mutationScopeGuard(['devices'])` and then goes straight to the device. There is
no ownership check and no team filter on the router.

Any authenticated MEMBER holding `devices` scope can tap and type on any device
in the lab, including one mid-Appium-run.

### Gap 2 — `stream/start` lets one user steal another's lock

```ts
const isCurrentlyControlledManually = hasActiveManualStream(udid);
if (device.busy && !isCurrentlyControlledManually) { /* reclaim or 409 */ }
```

`control.ts:530`. When a manual stream **is** live the busy check is skipped
entirely, so execution falls through to
`blockDevice(udid, host, manual_<B>_<udid>)`. `resolveBlockSessionId` only
protects a real Appium `session_id` from manual overwrite; manual-over-manual
keeps the incoming id.

Result: B's start silently rewrites the lock to B, and A's own `stream/stop`
then returns 403 on the device A was using.

The `manual_self` / `manual_other` distinction in `DevicePicker.tsx` is
cosmetic. Nothing on the server enforces it.

### Gap 3 — ownership is keyed inconsistently

Callers derive an actor as `req.apiKey?.id ?? req.auth?.userId`, which is two
different identifier spaces depending on the credential path. `req.apiKey` is
never set for dashboard cookie sessions. This produces two wrong answers:

1. Take a lock in the dashboard (actor = userId), then call `/tap` with an API
   key (actor = apiKey.id) — `inspectManualLock` reports foreign. The user is
   denied their own device.
2. `Session.api_key_id` is an API-key id, so comparing it against a cookie
   caller's userId can never match. Session ownership is undecidable on that
   path.

## Decisions

| Question | Decision |
|---|---|
| Which endpoints are guarded | Every mutation under `/control`. Reads stay open. |
| What counts as "held by someone else" | A manual lock owned by another user, **or** an Appium session owned by another user. Your own session stays interactive. |
| Takeover | Admin scope / `SUPER_ADMIN` bypasses and can force-release. Existing orphan reclaim is kept. No new idle-expiry machinery. |
| Ownership identity | `req.auth.userId` — the human, not the credential. |

## Architecture

Two units, split so the policy is testable without Express, Prisma, or a device.

| File | Role |
|---|---|
| `src/services/device-access/deviceAccessPolicy.ts` | Pure. `evaluateDeviceAccess(input) -> Decision`. No I/O, no Container. |
| `src/middleware/deviceAccessGuard.ts` | Effects. Resolves device, session owner, and actor from `req`; calls the policy; writes the 409. |

This mirrors the existing decision/effect split in the codebase —
`decideAndroidStreamReuse`, `resolveStreamType`, `resolveAndroidH264`,
`resolveBlockSessionId`.

### Policy contract

```ts
export type DeviceAccessDenyCode =
  | 'device_held_by_another_user'
  | 'device_in_use_by_session';

export interface DeviceAccessInput {
  udid: string;
  busy: boolean;
  sessionId: string | null | undefined;   // device.session_id
  sessionOwnerUserId?: string | null;     // resolved from an Appium session id
  actorUserId?: string;                   // req.auth.userId
  actorApiKeyId?: string;                 // req.apiKey?.id — upgrade tolerance only
  isAdmin: boolean;
}

export type DeviceAccessDecision =
  | { allow: true }
  | { allow: false; code: DeviceAccessDenyCode; holderId: string };
```

Rules, evaluated in order:

1. `isAdmin` → allow.
2. `!busy` → allow.
3. `sessionId` is a manual lock (`inspectManualLock` returns non-null):
   - self → allow
   - legacy (`manual_<udid>`, no actor) → allow
   - foreign → deny `device_held_by_another_user`

   "Self" here means the lock's actor matches `actorUserId` **or**
   `actorApiKeyId`. Since `inspectManualLock` compares against a single actor,
   this is two calls — one per candidate identity — and self is the disjunction.
   Implementing it with a single call silently drops the upgrade tolerance
   described below.
4. Otherwise `sessionId` is an Appium session id:
   - `sessionOwnerUserId === actorUserId` → allow
   - owner differs → deny `device_in_use_by_session`
   - owner unknown (`api_key_id` null, or the `ApiKey` row is gone) → deny
     `device_in_use_by_session`
5. No actor at all → `401`, handled in the middleware before the policy runs.

Legacy locks allow through deliberately. They are ownerless orphans and
`stream/stop` already lets any caller clear one; denying would strand the device
for everybody.

Unknown session owners deny — fail closed. An unattributable session is
precisely the one a stranger should not be tapping.

### Identity resolution

Ownership means **same human**.

- Manual locks are written with `req.auth.userId` (always populated, both
  credential paths).
- The self-check accepts a match on either the caller's `userId` **or** their
  current `apiKey.id`. This absorbs locks written by the current version — which
  hold an `apiKey.id` — with no migration and no extra query. Locks are
  ephemeral (device-row state, cleared on stop, reclaim, or restart), so the
  tolerance can be dropped in a later release.
- An Appium session's owner is resolved `session.api_key_id -> ApiKey.userId`,
  memoized in a `Map<sessionId, ownerUserId>`. Session ownership never changes
  for a given session id, so the cache cannot go stale, and it keeps a
  swipe-heavy tile off the database.

## Data flow

Mounted in `control.ts` after the existing guards:

```ts
router.use(roleGuard('MEMBER'));
router.use(mutationScopeGuard(['devices']));
router.use(deviceAccessGuard);          // new
```

The guard applies to **every non-GET request**, minus an explicit allowlist.
Keying on the HTTP method rather than enumerating paths is what makes a
newly-added endpoint guarded by default — the absence of that property is what
produced Gap 1.

```ts
export const UNGUARDED_CONTROL_MUTATIONS = [
  'stream/start',   // own conflict handling, see below
  'stream/stop',    // richer check already: self | legacy | admin, plus orphan release
  'stream/ticket',  // mints a viewing credential; viewing is a read
] as const;
```

Each entry carries its reason. Adding one without a reason is the failure this
guard exists to prevent.

No handler is edited. `DeviceStore` is an in-memory cache, so the guard's device
read is free and handlers keep their own `getDeviceInfo` call — no `req.device`
plumbing.

### Hub–node proxying

`InternalHttpClient.post(target, req.body)` (`control.ts:112`) forwards no
credentials, so hub-to-node control only functions when the node runs with
`authDisabled`, where the node sees `auth-disabled` / `SUPER_ADMIN`. This is
pre-existing behaviour and out of scope, but it fixes the enforcement point:
**the hub, before the proxy branch.** A guard running on the node degrades to
the admin bypass and will not break forwarding.

### `stream/start`

Rewritten rather than guarded, because "busy" means something different at
start time.

| Device state | Live manual stream | Today | After |
|---|---|---|---|
| foreign manual lock | yes | steals the lock | 409 |
| own manual lock | yes | reuse | reuse |
| legacy manual lock | yes | takes it | takes it |
| any manual lock | no | reclaim orphan | reclaim orphan |
| foreign Appium session | no | 409 | 409 |
| own Appium session | no | 409 | **allow** |

The last row is a deliberate behaviour change: it is what makes "watch the test
I started" work, and `resolveBlockSessionId` (#149) already prevents the manual
lock from overwriting the real session id, so the coexistence path is built for
it.

The first row is the steal fix and is **required**, not optional. Without it,
adding the guard makes the situation worse: B's start rewrites the lock, and the
new guard then denies A access to A's own device.

## Error handling

Denials return `409 Conflict`:

```json
{
  "success": false,
  "error": "device_held_by_another_user",
  "message": "Device is being controlled by alice@example.com. Ask them to release it, or use an admin key to force-release.",
  "holder": { "userId": "usr_...", "name": "alice@example.com" }
}
```

409 rather than 403: the caller's permissions are correct, the device's state is
the obstacle, and the same request succeeds later unchanged. It also matches the
status `stream/start` already returns for a busy device.

The holder's display name costs one lookup and is resolved only on the deny
path, where it is rare. Resolution is best-effort: `holderId` may be an
`apiKey.id` written by an older version, so when no user resolves, omit
`holder.name` and fall back to a generic message ("another user"). The denial
itself never depends on the lookup succeeding.

`stream/stop` keeps its existing `403`. The inconsistency is real but nothing
consumes that code (no frontend reference to `lock_owned_by_another_user`), and
aligning it is not this change's job. Recorded as a follow-up.

Every denial logs at `warn` with actor, holder, and endpoint.

Missing actor with auth enabled returns `401`.

## Frontend

Deliberately minimal:

- Surface the 409 `message` as a toast on the mosaic and device-control pages.
  Without it a blocked tap is a silent no-op.
- Disable interaction affordances on tiles whose `busyReason === 'manual_other'`
  so the lock is visible before the tap, not after. The picker badge already
  exists.

## Testing

| Spec | Covers |
|---|---|
| `test/unit/device-access-policy.spec.ts` | Full truth table, pure: admin, not-busy, self / foreign / legacy manual lock, own / foreign / unattributable session, apiKeyId upgrade tolerance. |
| `test/unit/device-access-guard.spec.ts` | supertest mini-app with stubbed lookups: GET passes, POST denies, allowlist respected, admin bypass, 401 on missing actor, response shape. |
| `test/unit/stream-start-conflict.spec.ts` | The steal scenario: A starts, B starts, B gets 409, A's lock is intact, A can still stop. |

Discipline:

- Verify each guard is non-vacuous by neutering it (`if (false && ...)`) and
  confirming the test goes red.
- `import 'reflect-metadata'` at the top of any spec pulling `SessionManager`.
- Targeted `npx mocha <file>` runs only. The full suite is not to be run.
- `tsc --noEmit` before merge — CI has no build or test gate.

Hardware validation with two identities:

- B cannot tap, type, install, or shell on a device A holds.
- **A is never denied their own device** — across both credential paths, with a
  live lock. A guard that over-denies is worse than the hole it closes, and unit
  tests will not catch the cookie-vs-key interaction against real lock state.
- An admin key can still force-release.

`schema.json` is untouched, so there is no config-validation risk at boot.

## Out of scope

- `GET /:udid/clipboard` stays open. Reading another user's clipboard is a data
  leak rather than interference; separate change.
- Idle expiry / lock heartbeat. The stream watchdog and orphan reclaim already
  cover the crashed-browser case.
- Aligning `stream/stop` to 409.
- Team-scoping the control router.
- Credential forwarding on the hub-to-node proxy path.
