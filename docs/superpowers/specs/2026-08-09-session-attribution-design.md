# Session attribution — making Appium sessions identify their owner

**Date:** 2026-08-09
**Status:** approved, ready for planning
**Follows:** the device ownership guard (#216–#221, released as 1.13.0)

## Problem

The ownership guard released in 1.13.0 allows a caller to interact with a
device that is running **their own** Appium session — the "watch the test I
started" path. It resolves the session's owner as
`Session.api_key_id → ApiKey.userId` (`SessionOwnerResolver`), and denies when
the owner cannot be determined (fail closed).

`Session.api_key_id` is frequently null, so that path frequently cannot fire.
Measured on a real lab database: **7 of 7 sessions have `api_key_id = null`.**

`authorizeSessionRequest` (`src/services/SessionLifecycleService.ts:227`)
produces the value. There are four cases:

| Case | Today | Verdict |
|---|---|---|
| `authDisabled` | `apiKeyId: null` (line 235-237) | Correct. Every caller is a synthetic SUPER_ADMIN, so the guard bypasses and attribution is moot. This is why the measured lab shows all-null. |
| Valid `df:options.{accessKey,token}` pair | `apiKeyId: row.id` (line 292) | Works. |
| Valid `xenon:options.sessionToken` | `apiKeyId: null` (line 264) | **Bug.** |
| No credentials at all | warn, allowed, `apiKeyId: null` (line 260-265) | Out of scope — see below. |

### The bug

`assertSessionTokenGate` verifies the `xenon:options.sessionToken` JWT and then
**discards the payload**. That token is minted at `src/app/routers/auth.ts:73`
as:

```ts
await svc.sign({ sub: auth.userId, teamId: auth.teamId ?? null },
               { audience: 'xenon-session', ttlSeconds: expiresIn });
```

So the caller's identity is known, cryptographically verified, and thrown away —
after which the guard denies that same caller access to their own device for
being unidentifiable.

A second, smaller loss: the token is only verified when
`XENON_REQUIRE_SESSION_TOKEN` is enabled. A client that presents a valid token
on a server with the gate off is never identified at all.

### Explicitly out of scope

A createSession carrying **no** credentials on an auth-enabled server stays
allowed and stays unattributable, so the guard keeps failing closed on it.
Rejecting those would make every session attributable by construction, and
would also close the fact that anyone reaching the Appium port can currently
create sessions on an auth-enabled server — but it breaks every existing client
that does not pass credentials. Deployments that want that already have
`XENON_REQUIRE_SESSION_TOKEN`. Decided deliberately; revisit separately.

## Decisions

| Question | Decision |
|---|---|
| Where the user identity is stored | A new `Session.user_id` column, not overloaded into `api_key_id`. |
| When a session token is read for identity | Whenever one is present, independent of the gate. |
| What governs accept/reject | `assertSessionTokenGate`, unchanged. |
| Credential-less sessions | Unchanged: allowed, unattributed, denied by the guard. |
| `authDisabled` | Unchanged: `{ apiKeyId: null, userId: null }`. |

## Architecture

### `Session.user_id` — a new column, deliberately not a reused one

`api_key_id` keeps its meaning: *the ApiKey row that created this session*.
`user_id` means *the human who owns it*.

A session-token caller has a userId and no ApiKey row, so there is nothing
correct to put in `api_key_id`. Writing a userId there would make
`SessionOwnerResolver`'s `api_key_id → ApiKey.userId` lookup resolve to nothing,
and — more importantly — it recreates exactly the id-space conflation that
caused the Critical in #216, where `stream/start` wrote a userId while
`stream/stop` read an ApiKey id and locked users out of their own devices. Two
id spaces, two columns.

Prisma: `user_id String?`, nullable, **no backfill**. Old rows resolve through
the existing fallback. No index — lookups are always by session id.

The blast radius is small, and was checked rather than assumed:
`Session.api_key_id` has exactly **one writer** (`event-manager.ts:122`) and
**one reader** (`SessionOwnerResolver`). Nothing queries or filters sessions by
it, so no other consumer needs teaching about the new column.

### `resolveSessionIdentity` — pure

New pure function, testable without Prisma, TypeDI or a driver:

```ts
export interface SessionIdentity {
  apiKeyId: string | null;
  userId: string | null;
}

export async function resolveSessionIdentity(input: {
  row: { id: string; userId: string } | null;   // verified df:options pair
  sessionToken: string | null;                   // xenon:options.sessionToken
  verify: (token: string) => Promise<{ sub?: unknown }>;
}): Promise<SessionIdentity>;
```

Rules, in order:

1. `row` present → `{ apiKeyId: row.id, userId: row.userId }`. Both are
   populated, so new rows need no ApiKey hop at read time.
2. Otherwise a `sessionToken` that verifies and carries a non-empty string
   `sub` → `{ apiKeyId: null, userId: sub }`.
3. Otherwise → `{ apiKeyId: null, userId: null }`.

A token that fails verification is ignored, not rejected: **attribution is
decoupled from enforcement.** `assertSessionTokenGate` remains the sole decider
of whether a session is admitted, and its behaviour does not change. This is
what lets a valid token identify its caller even when the gate is off.

When the gate *is* enabled, the token is verified twice — once by the gate to
admit the session, once here to identify it. That is deliberate: one extra
RS256 signature check on a path that already does several database round-trips,
in exchange for the gate and the attribution having no shared state and no
ordering dependency. Threading the gate's payload out to avoid the second
verify would couple enforcement to attribution for no measurable gain.

### Resolver preference

`SessionOwnerResolver.ownerOf(sessionId)`:

1. `session.user_id` if set — one query, no ApiKey hop.
2. Otherwise the existing `session.api_key_id → ApiKey.userId` path, so rows
   written before this change keep resolving.
3. Otherwise null → the guard's fail-closed rule applies unchanged.

The existing positive-results-only cache is unchanged: a resolved owner is
still safe to cache forever (session ownership never changes for a session id),
and a null still must not be cached, because it can mean the Session row has
not been written yet.

## Data flow

```
createSession caps
  └─ authorizeSessionRequest()
       ├─ authDisabled            → { apiKeyId: null, userId: null }
       ├─ verifyPair(df:options)  → row
       ├─ assertSessionTokenGate() ....... unchanged; admits or throws
       └─ resolveSessionIdentity({ row, sessionToken, verify })
            → { apiKeyId, userId }
  └─ finalizeSession(..., apiKeyId, userId)
  └─ event-manager.ts:122  →  prisma.session.create({ api_key_id, user_id })
```

`authorizeSessionRequest`'s return type gains `userId: string | null` alongside
the existing `apiKeyId`, `callerTeamIds` and `scoped`. `finalizeSession` takes
it as a parameter next to `apiKeyId`; the session object carries it to
`event-manager`.

The team-scoping behaviour (`callerTeamIds`, `scoped`) is untouched. A
session-token caller remains unscoped exactly as today — the token's `teamId`
claim is **not** used for device filtering in this change, because that would
alter allocation, which is a separate concern from attribution.

## Error handling

- Token verification failure → ignored, session unattributed. Never throws from
  the attribution path; enforcement is the gate's job.
- A token that verifies but has no usable `sub` (missing, empty, non-string) →
  treated as unattributed rather than storing a garbage owner.
- `SessionOwnerResolver` behaviour on a null owner is unchanged: the guard
  denies, fail closed.
- Writing `user_id` must not be able to fail a session that would otherwise
  succeed; it is one more nullable field on an existing insert.

## Testing

| Spec | Covers |
|---|---|
| `test/unit/session-identity.spec.ts` | `resolveSessionIdentity` truth table: df:options pair populates both; valid token populates userId only; invalid token ignored; missing/empty/non-string `sub` ignored; neither → both null; a valid pair wins over a token. |
| `test/unit/session-owner-resolver.spec.ts` (extend) | Prefers `user_id`; falls back to `api_key_id → ApiKey.userId` for legacy rows; null when neither resolves; positive-only caching still holds for the new path. |
| `test/unit/session-attribution-wiring.spec.ts` | `authorizeSessionRequest` returns the identity for each of the four cases, and `authDisabled` short-circuits to `{ null, null }`. |

Discipline, carried from the guard work:

- Verify each test is non-vacuous by mutating the behaviour it claims to pin
  and confirming red. Do not trust a suggested mutation that does not compile
  or does not exercise the path.
- Targeted `npx mocha <file>` only. The full suite crashes this repo.
- `npx tsc --noEmit` before merge; CI has no build or test gate.

**Migration verification is mandatory and cannot be unit-tested.** After
`npm run db:generate`, restart a real server and confirm the migration applies
and the listener comes up — grep the log for `Fatal` rather than trusting the
app's status. A migration that fails at boot takes the server down the same way
the 1.12.0 `schema.json` change did.

**End-to-end check with auth enabled**, on an isolated server (the local lab
runs `authDisabled: true`, under which none of this is observable):

1. Create a session with a valid `df:options` pair → row has both `api_key_id`
   and `user_id`.
2. Create a session with only a `xenon:options.sessionToken`, gate **off** →
   row has `user_id`, `api_key_id` null.
3. That session's owner can interact with the device through `/control`
   (the previously-broken own-session path) → 200.
4. A different user is still denied on the same device → 409.
5. A credential-less session still produces an unattributed row and still
   denies everyone non-admin → unchanged, fail closed.

## Out of scope

- Rejecting credential-less sessions (see above).
- Using the session token's `teamId` claim for device scoping.
- Backfilling `user_id` on existing rows.
- `schema.json` / plugin args — unchanged, so no config-validation risk.
