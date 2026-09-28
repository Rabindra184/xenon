# Per-command auth for WebDriver session commands

**Date:** 2026-09-28
**Status:** approved, implemented on `feat/command-auth`
**Setting:** `XENON_REQUIRE_COMMAND_AUTH` (env var, off by default)

## Problem

Xenon checks credentials when an Appium session is created. Every later
command, `<basePath>/session/:sessionId/...`, is authorized by the session id
alone. Anyone who has a session id can drive that session. Session ids are not
secrets: they appear in logs, dashboards and URLs, and `GET
<basePath>/appium/sessions` lists them.

## Decisions

| Question | Decision |
|---|---|
| How is it switched on? | `XENON_REQUIRE_COMMAND_AUTH`, parsed by the same `envSwitchOn` as `XENON_REQUIRE_SESSION_TOKEN` (`1`/`true`/`yes`/`on`, any case). Off by default. Never applies when `config.authDisabled`. Not in `schema.json`, because a schema change risks breaking older configs at boot. Read per request, like the session-token gate. |
| Where does it run? | An Express middleware on `<basePath>/session/:sessionId`, every method, spliced into the router stack ahead of Appium's first route. `POST <basePath>/session` has no id segment and does not match. Nothing outside a session path is touched. |
| Which credentials? | The ones REST accepts: the `x-xenon-access-key` + `x-xenon-token` pair, or `Authorization: Bearer <jwt>` with audience `xenon-rest` or `xenon-mcp`. The pair wins when both are sent, as in `authMiddleware`. The dashboard cookie is not accepted: a browser attaches it to requests a hostile page makes. A `xenon-session` token is not accepted either, since REST does not accept it. |
| How are they verified? | By the same code as `authMiddleware`, extracted to `src/middleware/verifyCredential.ts` (`verifyKeyPairCredential`, `verifyBearerCredential`, `ACCEPTED_BEARER_AUDIENCES`). An inactive user, a revoked or expired key and a bad or expired token all fail. The helpers return null for a wrong credential and throw when the check could not run, so the two can be told apart. `authMiddleware` answers 401 for both, as before. |
| Who is allowed? | The session's owner (`SessionOwnerResolver.ownerOf`, compared to the caller's user id), or an override admin by `canOverrideLease`'s `api-key` rule: `SUPER_ADMIN`, or an `admin`-scoped credential. An `ADMIN` user's ordinary key is not an override. |
| How is a Bearer token judged? | Like a key, by its `scopes` claim plus the live role, which is how `resolveActor` judges it on REST. `/auth/token` copies the minting credential's scopes into the token, so judging it by role alone (the lease session-token branch) would let an `ADMIN`'s ordinary key mint its way to an override. |
| What does a refusal look like? | Appium 3's unknown-session answer: HTTP 404, `application/json; charset=utf-8`, `{"value":{"error":"invalid session id","message":"A session is either terminated or not started","stacktrace":""}}`. `error`, `message`, status and key order come from base-driver's `NoSuchDriverError` rendered by `getResponseForW3CError`; a unit test derives them from Appium's own module. |
| Why is `stacktrace` empty? | Appium fills it with its server-side stack (about 2.8 KB, with install paths). W3C leaves the field's content to the implementation, and clients read `error` and `message`. Every refusal with the setting on uses the same body, so it reveals nothing about whether the session exists. The boot evidence shows the two bodies differ only in this field. |
| What is logged? | A `warn` per refusal with method, path, session id, and the caller's user id or `no credentials` / `invalid credentials`, plus the reason. Never the credential. |
| Unattributable sessions? | A session with no owner on record (created without credentials, or unknown) is refused to everyone except override admins. |
| Lookup failures? | A credential check or owner lookup that throws gets 503 with `{"value":{"error":"unknown error","message":"Xenon could not verify access to this session. Try again.","stacktrace":""}}` and an `error` log. It is never let through. |
| Cost | No credentials: refused with no lookup at all. Setting off: one env read per session command, no lookups. Otherwise one credential verification (cached) and, for non-admins, one `ownerOf` (positive results already memoized by `SessionOwnerResolver`). |
| The credential cache | Verified identities are cached for 30 s in `CommandCallerVerifier`, keyed by SHA-256 of the presented secret (`key-pair\0<accessKey>\0<token>`, or `bearer\0<jwt>`). The access key is part of the key: keying on the token alone would let a wrong access key ride a cached right one. At most 1000 entries; expired entries go first, then the oldest. An entry never outlives the key's `expiresAt` or the token's `exp`. Failures are not cached. |
| Revocation | Not pushed into the cache. Access ends through many paths: a key revoked from `/apikeys` or `/profile`, an access key rotated, a user disabled or demoted, a key expiring, a row edited directly, or any of those done by another process sharing the database. A clear-on-revoke hook would cover only the paths someone wired, and would still look instant. A uniform 30 s bound covers all of them. REST and createSession still verify on every request. |
| What if it can't be placed? | `insertBeforeRoutes` finds the router on `app._router` (Express 4) or `app.router` (Express 5; reading it on Express 4 throws, which is caught). If neither exists it adds nothing and says why. `registerCommandAuth` logs an error, and when the setting is on (and auth is enabled) throws, so Appium refuses to start rather than serve session commands unchecked. |
| Placement relative to the proxy | Registered before `registerProxyMiddlware`, so where that middleware is spliced ahead of the routes (Express 4), a hub checks a command before forwarding it. `registerProxyMiddlware`'s behaviour is unchanged. |
| Hub and nodes | Enable it on the hub. A node verifies against its own database and would refuse forwarded commands. Hub-to-node forwarding does not carry credentials in this change. |
| Discoverability | `GET /xenon/api/capabilities` reports `features.commandAuth`, like `sessionTokenGate`. |

## How the splice works

Appium's `server()` runs `configureServer` (its middleware, then `addRoutes`
for every WebDriver route), then each plugin's `updateServer`, then its
catch-all 404. A plugin's `app.use()` therefore lands after the routes, and a
route that answers never calls `next()`. `insertBeforeRoutes` calls
`app.use(path, handler)` so Express builds the layer with the router's own
settings, then moves that one layer to just before the first layer with a
`.route`. Because the layer is Express's own, path matching follows the same
case-sensitivity setting as the routes: `/WD/HUB/SESSION/<id>/url` reaches the
routes and is guarded too (unit-tested, and seen on the real boot).

`basePath` comes from `cliArgs.basePath`, as `wd-command-proxy` reads it, and
is normalised with Appium's rule (drop one trailing `/`, add a leading `/`).
Appium hands plugins the raw value and normalises only its own copy, so an
un-normalised mount would silently miss the routes. A test checks the
normalisation against base-driver's `normalizeBasePath`.

## Known gaps

- **`/wd-internal`.** Xenon's own loopback calls (`LocalSession` through
  `RemoteSession`: the heartbeat's `timeouts` probe, page source, performance
  recording) use `<basePath>/wd-internal/session/<id>/...`, which
  `registerProxyMiddlware` rewrites to the public path. On Appium 3 that
  middleware is appended after the routes, so the rewrite reaches no route and
  those calls answer `unknown command` today (seen on the real boot). This
  check leaves the alias alone. If the proxy is ever spliced ahead of the
  routes, the rewrite will run after this check, and the alias becomes a way
  around it. That fix must authenticate Xenon's internal calls (for example a
  per-process secret header) in the same change.
- **One public-path call without credentials.** `LocalSession.stopVideoRecording`
  falls back to HTTP on `<basePath>/session/<id>/...` when the in-process driver
  call fails. With the setting on, that fallback is refused.
- **WebSockets.** `<basePath>/bidi/<id>` (WebDriver BiDi) and `<basePath>/ws/...`
  upgrade outside Express and are not checked.
- **Scopes.** An owner's key is allowed whatever its scopes, as the approved
  design says. Requiring `sessions` (as createSession does) would be stricter,
  but `xenon-mcp` tokens carry a down-mapped scope set and need checking first.
- **Session listing.** `GET <basePath>/appium/sessions` is not a session command
  and still lists ids and capabilities. Whether those capabilities include a
  session's credentials is worth checking separately.

## Tests

- `test/unit/insert-before-routes.spec.ts`: the splice on Express 4 and on the
  Express 5 Appium itself resolves; routes record that they ran.
- `test/unit/verify-credential.spec.ts`: the shared helpers, including "could
  not check" versus "wrong".
- `test/unit/command-caller.spec.ts`: credential reading, the override rule for
  both kinds, and the cache (TTL, expiry caps, bounds, SHA-256 keys).
- `test/unit/command-auth.spec.ts`: every decision on both Express shapes,
  through `registerCommandAuth` on an app whose routes were added first.
- `test/unit/command-auth-appium-server.spec.ts`: base-driver's own `server()`
  with Appium's own WebDriver routes and a fake driver, the updater installed as
  a server updater.
- A real boot of Appium 3.1.1 with this build on port 4725, auth enabled, with
  the setting on and then off.
