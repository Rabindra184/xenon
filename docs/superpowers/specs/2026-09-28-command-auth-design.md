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
- **Scopes.** An owner's key is allowed whatever its scopes, as the approved
  design says. Requiring `sessions` (as createSession does) would be stricter,
  but `xenon-mcp` tokens carry a down-mapped scope set and need checking first.
- **The umbrella BiDi socket.** `<basePath>/bidi` (no session id) attaches to
  Appium's own driver, not to a session, and is not guarded.
- **Upgrades on the lab's Node.** On Node < 22.21, Xenon's own `upgrade`
  listeners (h264, logcat, socket.io) mean Node never hands an upgrade to
  Appium's Express handler. So BiDi and driver sockets get no answer at all,
  with the setting on or off. The guard only adds a prompt `404` for callers
  who may not use the session. Not fixed here.
- **Xenon's own sockets on newer Node.** On Node >= 22.21 / 24.9, Appium's
  `upgrade` listener runs first and destroys every upgrade it has no mapping
  for. That includes `/xenon/api/control/:udid/stream/h264`, `/logcat` and
  socket.io's websocket transport ("Did not match the websocket upgrade
  request ... to any known route", seen on a real boot with Node 22.23). This
  is independent of this setting. Not fixed here.

## Addendum: the session listing and session WebSockets

**Date:** 2026-09-29. Both surfaces follow the setting and are untouched with
it off.

### Session listing

| Question | Decision |
|---|---|
| Which routes? | `GET <basePath>/appium/sessions` (base-driver `getAppiumSessions`), the only listing route in Appium 3.1.1 and 3.2.0; there is no `GET /sessions`. Appium serves it only with the `session_discovery` insecure feature. HEAD is filtered too, since its Content-Length would give away the list's size. |
| Who sees what? | Credentials are read and verified exactly as for a command. An override admin sees Appium's answer untouched. A verified caller sees the entries whose owner is them. No credentials, or credentials that don't verify, get `{"value":[]}`, the same answer as an idle server. |
| How? | `sessionListingFilter.ts`, spliced ahead of the routes on `<basePath>/appium/sessions` like the command check. It wraps `res.json` before `next()` and removes entries from Appium's own answer; it never builds a listing. An answer that is not a listing (an error) passes through. An entry without an id is dropped. |
| Owner lookup | `SessionOwnerResolver.ownersOf(ids)`: one `session.findMany` for the listed ids, plus one `apiKey.findMany` only for rows that predate `user_id`. ownerOf's rule, and ownerOf's positive-only cache. |
| Why at answer time, not before `next()`? | The listed ids are known only then. Precomputing "the caller's live sessions" has no reliable live signal: `xenon: setSessionStatus` sets `status` on a running session. Without a status filter it is every session the user ever ran. |
| Failures | A credential check that cannot run: 503 before the route runs. An owner lookup that fails: 503 instead of the listing. |
| Logging | `warn` when a list is emptied (caller `no credentials` / `invalid credentials`, count withheld). `info` when one is filtered (caller, `N of M sessions shown`). |

### Session WebSockets

| Question | Decision |
|---|---|
| Which paths? | `<basePath>/bidi/<id>` (Appium's main registers `<basePath>/bidi` and `<basePath>/bidi/:sessionId`), and `/ws/session/<id>/...`, base-driver's `DEFAULT_WS_PATHNAME_PREFIX` convention (UiAutomator2 logcat, XCUITest syslog), with or without the base path. |
| How does Appium take upgrades? | base-driver `server()`: if `http.Server#shouldUpgradeCallback` exists (Node >= 22.21 / 24.9), `configureHttp` adds an `upgrade` listener before plugin updaters run. It destroys any upgrade it can't map. Otherwise `configureServer` adds `handleUpgrade` as an Express middleware ahead of the routes. Node reaches that middleware only while the server has no `upgrade` listener. |
| How does the guard get in front? | Two hooks, both from `registerSessionUpgradeGuard`. First, it wraps `httpServer.emit` for `upgrade`. A session upgrade is held back from every listener until the check allows it, then emitted unchanged. Second, it puts a middleware at index 0 of the Express stack (`insertAtStart`), which holds the request and calls `next()` only when allowed. Just prepending a listener isn't enough: the check is async, and Appium's listener would run synchronously right after it. Wrapping `emit` covers listeners added before and after `updateServer`, so Appium never gets a socket that was refused. |
| Which session ids? | As Appium reads them: the WHATWG-normalised pathname (dot segments, `%2e%2e`, absolute form), matched case-insensitively with an optional trailing slash, and BiDi's second read of the raw URL (`/bidi/([^/]+)$`, query included). Each is also decoded. The caller must own every id. An id with no session has no owner and is refused. |
| Refusal | `HTTP/1.1 404 Not Found`, `Connection: close`, `Content-Length: 0`, written on the raw socket, which is then closed. It's the same for an unknown session. A check that can't run gets the same answer with `503`. |
| Robustness | Node detaches its socket error handler before emitting `upgrade`. The guard therefore holds its own until it hands the socket on, or a client reset during the check would crash the process (mutation-tested). A socket the client drops mid-check is never handed on. |
| Untouched | The umbrella `<basePath>/bidi`, `/xenon/...` (ticketed h264/logcat), socket.io, non-WebSocket upgrades, ordinary HTTP to the same paths, and everything when the setting is off or auth is disabled. |
| Can't install? | No http.Server, or no router to splice into: logged, and with the setting on Appium refuses to start. |

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
- `test/unit/session-listing-auth.spec.ts`: every listing decision on both
  Express shapes, one owner query per listing, error passthrough, 503s.
- `test/unit/session-owner-resolver.spec.ts`: `ownersOf` (one query, the
  legacy key hop, the shared positive-only cache).
- `test/unit/session-upgrade-guard.spec.ts`: the id classifier, and a real
  http.Server with a real WebSocket client and base-driver's own
  `tryHandleWebSocketUpgrade` / `handleUpgrade`, in both dispatch modes and
  next to Xenon-style listeners (refusal bytes, owner/admin/other, driver
  sockets, umbrella, setting off, 503s, a client reset mid-check).
- `test/unit/command-auth-appium-server.spec.ts` also runs the listing and a
  BiDi upgrade through base-driver's `server()`, natively and with its
  upgrade-listener mode forced.
- A real boot of Appium 3.2.0 on port 4725 (Node 22.19 and Node 22.23),
  setting on and off: the unauthenticated listing is `{"value":[]}` with the
  `warn` line, and session upgrades get the raw 404.
