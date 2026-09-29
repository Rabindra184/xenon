# Hub/node on Appium 3: a session gateway

Date: 2026-09-29
Status: approved direction. The research is in
`.superpowers/sdd/hub-node-appium3-research.md` (local); the user decided the
questions below on 2026-09-29.

## Why

Verified live on 2026-09-28, with Appium 3.1.1 and a hub on :4724 and a node
on :4725:

1. **createSession through the hub returns 500.** Xenon's plugin handles a
   remote-bound `createSession` without calling `next()`, so Appium never
   records the session. Appium (2.15.0 and later) then promotes plugins to
   that session id, and `generateDriverLogPrefix(undefined)` throws. The node
   keeps its session holding the phone. Appium fixed this in base-driver
   10.2.1 (Appium 3.2.1). Upstream device-farm works around it with
   `this.updateLogPrefix = null`.
2. **Commands never reach the node.** `registerProxyMiddlware` splices ahead
   of Appium's routes only on Express 4. On Appium 3 (Express 5) it lands
   after them. Placing it naively would let `/wd-internal/...` get around
   per-command auth, because the rewrite would run after the check.
3. **The hub/node race.** A node's device report (`registerNode`, a `mirror`
   write) overwrites every column on the hub:
   - `busy`, so a hub allocation can be undone;
   - the hub-owned team, tag, reservation and block, so a team phone turns
     back into a shared one.

   A same-machine hub also prunes a node's phones as stale (being fixed in its
   own PR, by host and port).

## Decisions

| Question | Decision |
|---|---|
| Databases | **Each instance has its own**, as upstream appium-device-farm does. Nodes register phones with the hub over HTTP. |
| Where auth is enforced | **At the hub.** The hub's calls to a node carry a short-lived, hub-signed JWT scoped to the session. The node verifies it against the hub's JWKS (`/xenon/api/auth/jwks.json`, `JwtKeyService`). |
| Sessions created directly on a node | **Not supported.** Sessions go through the hub, which owns team rules, reservations and blocks for node phones. Documented. |
| BiDi or session WebSockets through the hub | **Not now.** Documented as unsupported. The returned WebSocket URL points at the node, so nodes must not be on untrusted networks. |
| Appium versions | **Appium 3 only**, every 3.x. The gateway doesn't depend on Appium's crash fix. |
| Hub restart | Remote sessions keep running on their nodes. The hub routes them again from its database. |
| Xenon's loopback calls | Keep `/wd-internal`, recognised only with a per-process secret header, and checked before command auth. |
| Supported setups | A hub and node on the same machine; different base paths on the hub and the node. |
| Race state | New explicit columns (migration), not `lockedAt` / `owningSessionId`. |

## Design: a Xenon session gateway in front of Appium's routes

One layer, placed with `insertBeforeRoutes` (both Express shapes), replaces
`registerProxyMiddlware`:

1. **Internal calls.** A request carrying the per-process secret header is
   Xenon's own. The `/wd-internal` prefix is stripped, and the call bypasses
   command auth. Without the header, `/wd-internal` answers as an unknown
   route.
2. **Command auth** (`XENON_REQUIRE_COMMAND_AUTH`) runs here, once, for local
   and remote sessions alike.
3. **Remote sessions.** Where a session lives comes from `SESSION_MANAGER`, or
   the Session row after a restart, not an in-memory map. The command is
   forwarded to the node with the hub-signed session JWT, and the node's
   answer is relayed. Appium's umbrella never sees a remote session.
4. **Remote DELETE** runs `SessionLifecycleService.deleteSession`, with the
   forward as its `next`. Video archiving, dashboard close and unblock then
   run for remote sessions too; today they don't.
5. **`POST <basePath>/session`** allocates in the gateway:
   - A **remote phone** is forwarded to its node and answered here.
   - A **local phone's** allocation passes to the plugin through
     `AsyncLocalStorage`, and is released if Appium rejects the request
     first.

   The upstream `updateLogPrefix = null` bridge goes in with step 1 as a
   stopgap, and is removed once creation lives in the gateway.

## Design: the race

- **Separate state.** The hub's claim (the session id and when it was
  claimed) and the node's report (`nodeBusy`) live in separate columns. The
  hub computes busy as claim OR report.
- **Release is conditional.** "Set busy false only where there's no hub
  claim", as one conditional update, never a read-then-write. Keyed to the
  session id, so a stale unblock can't free a newer session's phone. Today an
  unblock falls back to matching the udid alone.
- **Pending claims.** A claim whose session is still being created has its
  own timeout, so the idle sweeper can't free it.
- **Hub-owned settings.** Team, tags, reservation and block belong to the
  hub. A node's report writes only discovery columns and `nodeBusy`, the
  device-sync rule from #348 extended to the mirror path.
- **Stale cleanup** of node phones keys on `nodeId`.

## Delivery

Sequential, never parallel branches that edit the same files:

1. **PR 1:** the gateway, internal-call secret, command auth in the gateway,
   DB-backed routing, remote DELETE, and the bridge.
2. **PR 2:** `POST /session` in the gateway (remote create); remove the
   bridge.
3. **PR 3:** the race, with its migration.

Each PR ships with unit tests, integration tests on real SQLite, and a live
check on a local hub (:4724) and node (:4725) with the S9+, with the lab on
:4723 stopped for the duration.
