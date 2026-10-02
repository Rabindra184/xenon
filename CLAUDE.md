# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Xenon

Xenon is an enterprise-grade Appium 3.x plugin for mobile device lab orchestration. It intercepts Appium commands, provides AI-powered self-healing for broken test selectors, manages device lifecycle, streams live device video, and exposes a real-time React dashboard.

## Commands

### Development
```bash
npm run dev          # Migrate DB + build + install plugin + start server (full dev loop)
npm run server       # Start Appium server with Xenon plugin (skip rebuild)
npm run build        # Compile TypeScript + copy public assets to lib/
npm run build:all    # Build plugin AND frontend dashboard
npm run build:xenon  # Build only the React frontend (web/)
```

### Testing
```bash
npm test                  # Run Mocha unit tests
npm run test:all          # Run all unit tests for both platforms
npm run test:e2e          # End-to-end plugin tests (300s timeout)
npm run test:android      # Android integration tests (real device)
npm run test:ios          # iOS integration tests (real device)
npm run test:coverage     # Generate NYC coverage report
```

Run a single test file (`.mocharc.js` already wires up `ts-node/register`, and turns off Node's own TypeScript type stripping on Node >= 22.18 so ts-node stays in charge):
```bash
npx mocha test/unit/your-test.spec.ts
```

Run a single test by name (mocha grep):
```bash
npx mocha test/unit/recording-orchestrator.spec.ts -g "happy path"
```

Tests that import `CommandInterceptor` or anything that pulls in `SessionManager` need `import 'reflect-metadata'` at the top — TypeDI Container.get is invoked at module-load time and will throw `_a.getMetadata is not a function` without it.

`npm run test:all` runs the whole unit suite in one process and should be green on Node 20 and 22. It points `DATABASE_URL` at a freshly migrated scratch file (`test/setup/scratch-default-database.js`), so specs that write in passing never reach `~/.cache/xenon/xenon.db`; a plain `npx mocha <file>` doesn't load it. Every spec must also pass on its own (`npx mocha <file>`). Most breakage here came from a spec that only worked because another one ran first:

- Import what you use (`reflect-metadata`, `chai.should()`). Don't rely on another spec having loaded it.
- Never declare `before`/`beforeEach`/`after`/`afterEach` at the top of a file. Mocha attaches those to the root suite, so they run around every test in the process. Put them inside your `describe`. Register `ARTIFACT_STORE` with `useArtifactStore()` from `test/helpers/artifact-store.ts`, which restores what was there before.
- Stub `process.kill` in any test that can reach it. `ProcessRegistry` signals process groups, and an unstubbed fake pid 1 meant `kill(-1)`, which killed every process the user owned.

### Code Quality
```bash
npm run lint      # ESLint with auto-fix
npm run format    # Prettier formatting (src/, web/, test/)
```

### Database
```bash
npm run db:migrate    # Initialize/apply SQLite migrations
npm run db:generate   # Create a new Prisma migration after schema change
```

### Schema
```bash
npm run build:schema  # Regenerate TypeScript types from schema.json
```

## Architecture

### Plugin Layer (`src/`)

`XenonPlugin` (extends Appium's `BasePlugin`) is the entry point. It:
- Intercepts every Appium command via `CommandInterceptor`
- Manages device discovery through `AndroidDeviceManager` and `IOSDeviceManager`
- Starts an Express + Socket.io server at `/xenon/`

### Command Interception Flow (`src/interceptors/CommandInterceptor.ts`)

Every Appium command from `XenonPlugin.handle()` lands in `CommandInterceptor.handleInContext()`. The order matters — same-named features compete and have to run in the right sequence:

1. **Session bookkeeping** — `updateCmdExecutedTime`, `sessionContext.run()` for AsyncLocalStorage log attribution.
2. **`execute` script router** — strips `xenon:` / `xe:` (and legacy `plugin:`) prefixes and dispatches to `AICommandService`, `InterceptorService`, or `AutowaitService`. This is how dashboard / SDK clients call Xenon-specific features without new endpoints.
3. **OmniVision proactive search** — when `findElement` is called with strategy `-custom:ai-icon` or `-custom:ai-text`, route to `OmniVisionService` instead of the underlying driver. Returns virtual element IDs (`omni_*`).
4. **Virtual element shortcut** — element commands (`click`, `getText`, etc.) targeting an ID prefixed with `omni_`, `healed_ocr`, or `healed_visual` get served from `OmniVisionService.getVirtualElement()` (coordinate-based actions via W3C Actions API). They never reach the real driver.
5. **Autowait pre-checks** (`src/services/autowait/`) — when `pluginArgs.autowait.enabled`:
   - `findElement` / `findElements` get wrapped in a poll loop (timeout / interval) so transient `NoSuchElement` errors retry before healing fires.
   - `click` / `setValue` / `clear` get a pre-action `elementEnabled` poll. Skippable per-command via `excludeEnabledCheck`.
   - Per-session overrides via `xenon: setAutowaitProperties` (or legacy `plugin: setWaitPluginProperties`) execute scripts. Cleared on `deleteSession`.
6. **`next()`** — actually run the underlying Appium driver command.
7. **Post-command hooks** — dashboard event broadcast + selector learning (`triggerLearning` writes etalons for novel selectors so future failures heal cheaply).
8. **Catch-and-heal** — if `next()` throws `NoSuchElement` for `findElement`/`findElements` and `enableSelfHealing !== false`, hand off to `HealingOrchestrator.attemptHealing()`. Visual-tier results return coordinates; the interceptor tries to resolve them to a real element (iOS class chain) and falls back to a coordinate tap via W3C Actions if resolution fails.

The "autowait first, healing second" ordering is deliberate: most "broken" findElements are slow renders, not bad selectors, so a cheap retry beats a 6-tier healing escalation that may end at an LLM call.

### 6-Tier Self-Healing (`src/services/healing/`)

When `findElement` fails, `HealingOrchestrator` tries six escalating strategies:
0. **Resilio** — `ResilioTreeHealingProvider` recovers via stored etalon signatures (cheapest, runs first)
1. **Native** — `FuzzyXmlHealingProvider` retry with original selector
2. **Fuzzy XML** — Dice-coefficient matching against stored Etalon XML signatures
3. **OCR** — Tesseract.js text-based location
4. **Visual AI** — `OmniVisionService` screenshot analysis
5. **LLM** — Gemini/OpenAI/Claude API call with page source context

Etalon signatures (element fingerprints) are stored in SQLite and reused across sessions for fast recovery without repeating AI calls.

### Session Lifecycle (`src/services/SessionLifecycleService.ts`)

State machine: `requested → allocated → running → finished`. Each transition is persisted and broadcast to the dashboard. Local, remote (hub-node), and cloud sessions share a common interface.

### Hub-Node Topology

A Xenon hub instance can orchestrate remote Xenon node instances. Each has its
own database; a node reports its phones to the hub over HTTP (`NodeDevices.ts`,
`POST /xenon/api/register`). Sessions on a node's phone go **through the hub
only**, because the hub owns team rules, reservations and blocks for node
phones, and enforces auth. A node with auth enabled refuses any create without
the hub's verified create token (`assertCreateCameFromHub` in `prepareSession`,
so it holds on the plugin's no-gateway path too): `session not created`,
"Create sessions through the hub", naming the hub. A node with auth disabled
checks no credential, the hub's token included, so a direct create there looks
like the hub's and still works, as it did (local development against one
node). Appium 3 only, every 3.x.

**The session gateway** (`src/gateway/`, placed by `registerSessionGateway` in
`src/app/registerCommandAuth.ts`, wired by `gatewayOptionsFor` in
`defaultGateway.ts`) stands in front of Appium's routes, spliced with
`insertBeforeRoutes` on both Express shapes. It replaced
`registerProxyMiddlware`, which on Express 5 landed after the routes, so no
command ever reached a node. Three adjacent layers:

1. `xenonInternalCalls` (path-less): Xenon's own `<basePath>/wd-internal/...`
   calls. See Per-command auth below.
2. `xenonSessionCreate` at `<basePath>/session` (`sessionCreate.ts`): `POST`
   of exactly that path. See "Creating a session" below.
3. `xenonSessionGateway` at `<basePath>/session/:sessionId` (mounted, so its
   path matching is the router's own, letter case included): per-command auth
   once for local and remote sessions alike, then on a hub:
   - **Where a session runs** is `SessionLocator` (`sessionLocator.ts`):
     `SESSION_MANAGER` first, then the open Session row and its phone's row. It
     is never a routing table of its own. Every session a hub routes to a node
     or cloud is registered in `SESSION_MANAGER`, whatever the dashboard and
     video settings. A remote session whose phone is this server's own (a
     local one from before a restart) is never sent back to this server, and a
     request carrying a hub token is never forwarded again.
   - **Forwarding** (`forwardToNode.ts`) sends the command under the node's
     own base path, drops the client's credentials and cookies, adds the hub
     token, and streams the node's status, headers and body back. No retry: a
     WebDriver command isn't safe to repeat. Appium's umbrella never sees a
     remote session's command, so a pure hub needs no driver for the node's
     routes. The dashboard's before/after command hooks run for registered
     remote sessions when the hub's dashboard is on.
   - **DELETE `<basePath>/session/<id>`** runs
     `SessionLifecycleService.deleteSession` with the forward as its driver
     step, so the node's video is archived while the session exists, then the
     phone is unblocked, the dashboard closed and `SESSION_MANAGER` cleaned.
     DELETE of a sub-resource (`/cookie`) is an ordinary command.
   - Network-conditioning latency is added for local sessions only; the node
     adds it for its own.

**Base paths may differ.** A phone's `host` is only the node's origin, so each
server answers `GET /xenon/api/webdriver` (`{ basePath }`, no login) and the
hub's `NodeBasePathResolver` asks before creating or routing a session (60 s
cache; a node that doesn't answer is assumed to share the hub's base path).

**Creating a session** happens in the gateway, before Appium's route. Every
Xenon server does it this way, a standalone one included. The create layer
takes the credentials out, checks them, validates the capabilities, writes
the pending-session row and allocates the phone
(`SessionLifecycleService.prepareSession`). Then it depends on the phone:

- **Another server's phone** (a node's, or a cloud provider's): the session
  is created there (`completeRemoteSession`) and the hub answers the client
  itself, as Appium answers a new session. Appium's umbrella driver never
  sees it. When it used to (the plugin answering the create without calling
  `next()`), Appium >= 2.15 promoted the plugin to a session it didn't have
  and threw in `generateDriverLogPrefix(undefined)`, answering 500 while the
  node kept the session. Base-driver 10.2.1 fixed the throw, but the umbrella
  still kept the promoted plugin for ever. That is why nothing depends on
  Appium's fix, and why the `updateLogPrefix = null` stopgap is gone.
- **This server's own phone**: the allocation goes to
  `XenonPlugin.createSession` through the request's `AsyncLocalStorage`
  context (`createHandoff.ts`), so it isn't allocated twice. The plugin takes
  it (`completeLocalSession`) and calls `next()`. From then on the plugin
  releases the phone if the create fails, including when Appium finds no
  driver or refuses the capabilities, since in Appium 3 both happen inside
  `next()`. If the request ends without the plugin taking it (another plugin
  refused the create first, or the client left), the gateway gives the phone
  back on the response's `close`. A client that leaves while its phone is
  still being found gets it released when it turns up, and Appium never runs.
- Refusals are answered as Appium answers the same error thrown from the
  plugin (`getResponseForW3CError`). A body without a `capabilities` object
  goes straight to Appium, as before.
- If the create layer isn't installed, the plugin allocates for itself
  (`createSession(..., { localOnly: true })`, with a warning). It refuses and
  releases another server's phone rather than answer for Appium.

**What a node is sent** (`capsForNode`, `nodeCreateCaps.ts`) stands on its
own, whatever the node's auth settings. It carries no credentials and no
lease id: the hub resolved the lease in its own database. The phone the hub
allocated is pinned as `alwaysMatch['appium:udid']`, with no other
`appium:udid` and no `appium:udids`. A lease-bound allocation never wrote the
udid into the caps, and a `udids` list would let the node pick another
phone. Before this the hub put the client's credentials back
(`capsWithCredentials`) for the node to re-check. It couldn't: the node's
database doesn't have the hub's keys, leases or teams.

**The hub's tokens** (`hubSessionToken.ts`), sent as `x-xenon-hub-token`.
Auth is enforced at the hub. All three are RS256 JWTs from the hub's
`JwtKeyService`, verified by the node against the hub's
`/xenon/api/auth/jwks.json`. `/auth/token` mints none of their audiences. A
cloud provider never gets one.

- **A session's** (audience `xenon-node`, claim `sid`, 5 minutes, reused
  until a minute before expiry) goes with every hub call about a session:
  forwarded commands, and `RemoteSession`'s own screenshot, source,
  recording and heartbeat calls. A node with per-command auth on accepts it
  in place of credentials. A forged, expired or other session's token gets
  the unknown-session answer, and a JWKS that can't be fetched is `503`.
- **A create's** (audience `xenon-node-create`, 2 minutes, fresh per create)
  names the owner the hub verified (`sub`, absent for an unattributed
  create), the phone (`udid`) and its node (`host`, the phone row's host).
  It has its own audience, not a claim on the session token. That way jose
  refuses the other kind before any claim is read, so neither kind can open
  what the other does. On a node with auth enabled it is the session's
  credential:
  - it attributes the session (the node's `XenonSession.userId`);
  - it passes `XENON_REQUIRE_SESSION_TOKEN`;
  - the client's own credentials are neither checked nor needed;
  - the session is unscoped, since the hub applied the team rule.

  The node may allocate only that phone, on itself. Caps that name another
  phone are refused before allocation. An allocated phone that is another
  node's (an emulator's udid repeats across machines) is refused and released.
  A forged, expired, already used or session token is refused (`400 invalid
  argument`, "session rejected"), and a JWKS that can't be fetched is `503`.
  With auth disabled on the node the token isn't checked, as no credential
  is. The token is single-use: each has its own `jti`, which the node's
  verifier keeps in a `SingleUseLedger` until it expires. A token with no
  `jti` (from an older hub) is accepted without that check.

- **A device-control call's** (audience `xenon-node-control`, 1 minute,
  fresh per call). It goes with each `/control` action the hub forwards on
  a node's phone (see "Device control on another server's phone" below).
  Forwarded actions used to go with no credential, so an auth-enabled node
  refused every one (its CSRF check, then its login). The token names the
  hub user (`sub`),
  whether they are an admin (`adm`), the phone (`udid`) and its node
  (`host`), and is sent as `x-xenon-hub-token`. The hub's own guards
  (role, team, ownership) have run by then.
  - On a node, `authMiddleware` accepts it only for `/control/<udid>/...` on
    the phone it names, whose `host` is one of the node's own
    (`localDeviceHosts`). It sets `req.auth` to kind `hub-control`: that
    user, `ADMIN` or `MEMBER` with `scopesForRole`, and `teamIds`
    undefined, since the hub applied the team rule.
  - The node's ownership guard then judges that user against the session's
    owner (`LiveSessionOwners`).
  - Anywhere else the header is no credential. A bad token is `401`, and a
    JWKS that can't be fetched is `503`.
  - `csrfMiddleware` passes the header like the key pair: a browser can't set
    it cross-origin. A server that isn't a node ignores the token, and a
    cloud provider never gets one.

**A create is sent once.** `forwardSessionRequest` posts it with
`retry: false` (`InternalRequestConfig`) and `REMOTE_CREATE_TIMEOUT_MS` (8 min,
two under `PENDING_CLAIM_TIMEOUT_MS`, so the idle sweeper can't free a phone
whose create the hub is still waiting for). `InternalHttpClient` otherwise
retries a request on a 5xx or its 30 s timeout, and a slow first UiAutomator2
install then started a second session on the node, holding the phone with
nobody to end it. A create that outlasts the 8 minutes, or whose answer is
lost, can still leave its session on the node until the node's own
new-command timeout.

**A hub restart** leaves node sessions running. At boot a hub clears only its
own phones (`devicesClearedAtBoot`); its nodes' rows stay, so
`recoverActiveSessions` rebuilds their `RemoteSession`s (under each node's own
base path) and the gateway routes them again. Before the gateway every row was
wiped at boot, so every remote session was marked failed on restart.
That needs the session's own row, which names its phone and owner. The
dashboard's row (`onSessionStarted`) is written only with the dashboard on,
and never for a cloud session, so a session the hub routes to a node or a
cloud otherwise gets a minimal one (`recordRoutedSession`: phone, node,
capabilities, `api_key_id`, `user_id`; no profiling, logs or event). The
dashboard setting still decides alone whether a local session has a row.
Until then a dashboard-off hub lost every node session on restart: its
commands went to the hub's own Appium. Recovery also restores the session's
owner (`apiKeyId`, `userId`) from the row, and stamps the row's heartbeat
with this process (`adoptHeartbeat`). The row still carried the old
process's heartbeat, so after an outage longer than 3 heartbeat intervals
(~90 s) the orphan sweep, at boot and on every interval, took every
recovered session for an orphan: it failed the session and freed its phone
while the node kept it. From then on the heartbeat keeps the row fresh and
ends the session if its node no longer has it. A
graceful shutdown (SIGTERM) drains only the hub's own local sessions
(`ShutdownCoordinator`); until 2.1 it also finalized node and cloud sessions,
releasing the phone and closing the row on the hub while the node kept the
session running, unreachable, until its idle timeout.

**Device control on another server's phone**
(`src/app/routers/nodePhoneControl.ts`). `control.ts`'s handlers act with
this server's own adb and go-ios. A gate mounted after the team and ownership
guards decides every `/control` request for a phone whose row is another
server's (`isOtherServersPhone`: its `nodeId`, else its exact host), before
any handler runs:

- `NODE_FORWARDED_CONTROL` (tap, swipe, text, keyevent, touchAndHold,
  screenshot, clipboard read and write, lock, unlock, display, uninstall,
  apps, logs, shell, inspector/snapshot, `upload-install`, and the live
  preview's stream/start, stream/status, stream/leave, stream/stop and
  `GET stream`) goes to the phone's node once, with the control token and
  none of the caller's headers, and without a `ticket` query parameter. An
  upload (a multipart body) is streamed on as it came: the route's own
  parser runs after the gate, so nothing on this server reads it. The
  node's status, headers and body are relayed unchanged. An unreachable node
  is `502 node_unreachable`, and one that hasn't started answering in 60 s
  (15 min for an install, `NODE_INSTALL_TIMEOUT_MS`: the node answers when
  the install is done) is `504 node_timeout`. Once it has, the answer runs
  as long as it runs: the MJPEG `GET stream` lasts as long as its viewer.
- `ANSWERED_HERE` runs here. `appium-session`: the session is routed
  through this server. `stream/ticket`: the viewer's ticket is this
  server's, minted after its team check.
- `ANSWERED_HERE_FOR_NODES` runs here for a node's phone, and does the rest
  through the node. `install-repository-app`: the app is in this server's
  library and checked against the caller's teams here (`canSeeApp`), then
  sent to the node's `upload-install` as a multipart upload streamed from
  disk (`installFileOnNode`). `omni-scan` and `test-locator`: Omni-Vision
  runs here, with this server's AI settings, on the node's screenshot
  (`screenshotFromNode`). A node's own `upload-install` received no file
  until #387, so an install on a 2.2 or older node fails there.
- Everything else is `501 not_available_through_hub`, naming the node, and
  the dashboard toasts that message: `install` (a path on one machine). A
  new `/control` action is refused for another server's phone until it is
  added to a list.
- A cloud provider's phone gets `501 not_available_for_cloud_phone` for
  all but `appium-session` and `stream/ticket`, and nothing is sent to the
  provider. Before this, the five forwarded actions went to the provider's
  host, typed text included.

The node runs the live preview by its own rules, with the hub's user from
the control token. It takes the preview hold on its own row, refuses a
second user, counts viewers (one hub connection per viewer, so its counts
stay true) and releases the phone when nobody watches. The hub keeps none of
that, and its ownership guard leaves a phone busy only by the node's report
to the node (`heldHere`, see "Device access guard"). Two things are the
hub's own:

- **Busy at once.** After the node answers a forwarded stream/start with a
  2xx, the hub sets `nodeBusy` and `busy` on its row, and `nodeHold` to the
  caller's hold (`markNodeBusy`, both stores). The node's report says the
  same only up to `sendNodeDevicesToHubIntervalMs` later, and until then
  the hub could allocate the phone to a session the node would refuse. The
  next report replaces `nodeBusy` and `nodeHold` as usual.
- **Who holds it** (`nodeHold`, a `report` column). The node's report is
  its own row, `session_id` included; the hub keeps a preview hold from it
  (`manual_<user>_<udid>`, `nodeHoldOf` in `deviceClaims.ts`) apart from its
  own `session_id`, and a session the node runs is not a hold. Nodes of any
  2.x version send it. The dashboard reads `session_id`, else `nodeHold`
  (`web/src/lib/deviceHold.ts` `holdOf`), so the picker, the device cards
  and a reload's tile restore treat a node phone's preview like a local
  one. It is shown, never judged: access stays the node's, so a value up to
  one report stale changes a label and nothing else.
- **Named refusals.** A node's 409 (`device_held_by_another_user`,
  `device_in_use_by_session`) names the holder by id only, since its
  database has no rows for the hub's users. The gate fills in the name
  (`SessionOwnerResolver.displayName`, denyBody's wording) before relaying
  it, and passes anything else on unchanged.
- **The sockets** (`src/app/ws/nodeSocketRelay.ts`). The H.264 and logcat
  WebSockets redeem the hub's ticket, and logcat runs the hub's ownership
  check. For another server's phone `openNodeSocket` then asks the node for
  a ticket of its own (`POST stream/ticket` with the control token) and
  opens the same socket there, logcat's `levels` and `process` included.
  `relaySocket` passes messages both ways unchanged and the node's close
  code and reason to the viewer; a dropped node connection is `1011`. The
  node keeps its multiplexer, replay, drop markers and idle release.
  - The node's socket is handed over paused and resumed once the relay
    listens: the node sends H.264's config packet and logcat's replay the
    moment it opens, and a message with no listener is lost. That made the
    preview never decode.
  - While 4 MB sent to the viewer are unwritten, reading from the node
    pauses. The node then sees a slow viewer and applies its own rule
    (dropped H.264 frames, logcat's visible "lines dropped" record). The
    hub never drops or buffers without bound.
  - A cloud phone or a node that refuses the ticket closes the viewer with
    `1008`, which stops the logs pane with the reason. A node that can't be
    reached is `1011`, and the players retry.

**Recording a node's phone** runs on the hub, from the node's stream. See
"Recording Subsystem" below. While the hub records it, the gate refuses that
phone's `stream/stop` with `409 device_recording`, as `/control` refuses one
for its own phones being recorded. The node doesn't know about the hub's
recording, and stopping its stream would cut the recording short.

Through 2.1 only the five input actions were forwarded. The rest ran on the
hub against a phone it doesn't have: they failed, or with hub and node on
one machine, worked on the hub's own adb by accident. Spec fixtures that
stand for this server's phones carry its node id (`useOwnNodeId`,
`test/helpers/own-node-id.ts`).

**Busy on a hub** (`src/data-service/deviceClaims.ts`). A node's phone is
busy on the hub for one of two reasons, each in its own columns so neither
erases the other: the hub's **claim** (`claimedAt` when allocation took it,
`claimSessionId` once the session exists; a claim with no session id yet is
*pending*) and the node's **report** (`nodeBusy`). `busy` is claim OR report.
Every write that can clear `busy` is one conditional update, never a
read-then-write:

- A node's report (`POST /xenon/api/register?type=add`, the
  `nodeReport` path) writes only what the node observes
  (`pickNodeReportFields`) plus `nodeBusy`. Team, tags, reservation, block,
  `session_id` and the claim are the hub's and are never taken from it. A
  report of "free" clears `busy` only where nothing of the hub's holds the
  phone (`UNHELD`: no claim, and no hold such as a preview or recording in
  `session_id`), so a report sent before the hub's claim can't undo it.
- A release names the claim it ends (`ClaimRef`: a session id, or a pending
  claim's `claimedAt`), so a stale release for an ended session can't free a
  phone another session has claimed since. It clears `busy` only where the
  phone is then `UNHELD`, so a node still reporting it busy keeps it busy.
- A pending claim isn't idle at the new-command timeout; the idle sweeper
  frees it only after `PENDING_CLAIM_TIMEOUT_MS` (10 min).
- Stale cleanup keys a node's phones on its `nodeId`: they stay while any
  host of that node answers (an iPhone filed under an unprobeable
  `remoteMachineProxyIP` included) and go with the node. A hub's own sync
  never prunes a row carrying another node's id (`isOwnDevice`: by `nodeId`,
  else by exact host).
- A node's request to forget phones (`POST /register`, `type=remove` for
  one phone by udid, `type=unregister&host=` when it shuts down) goes through
  `removeNodeDevices`: only that node's rows, by the `nodeId` it sends (a
  node now sends it on both), else by exact host, and never one of the hub's
  own (`isOwnDevice`). A `remove` with no udid, or no host and no id, takes
  nothing. The store used to match a host that isn't a URL as a substring and
  a host-less remove by udid alone, so an older node's bare IP deleted every
  row on that machine, the hub's own included. `removeDevices(filter,
  { exactHost: true })` turns the substring match off.
- The health monitor (`HealthMonitorService`) checks only this server's own
  phones, by the same `isOwnDevice`. It used to run the hub's adb against
  every row: each node phone came back unhealthy, was written over the node's
  report and "recovered", and a busy one whose session the hub didn't hold in
  memory was reclaimed. A node checks its own.
- Discovery reuses a row only when it is its own: same udid and the exact
  host its discovery files the phone under (`androidDeviceHost`,
  `iosRealDeviceHost`, `iosSimulatorHost`). That holds for Android, iOS
  phones (the sync, an attach's `getDeviceInfo`) and simulators. A node on
  the same Mac sees the same iPhone and simulators; until 2.1 iOS matched by
  udid alone and took the node's row, host, ports and busy state included.
- The stream services (`IOSStreamService`, `AndroidStreamService`,
  `AndroidH264StreamService`, `previewHold.ts`) find a phone's row the same
  way: `findOwnDevice(udid)` (`src/device-managers/ownDeviceRow.ts`) looks up
  the udid under each of this server's own hosts (`localDeviceHosts`), never
  by udid alone. They used to take the node's row for a shared udid, so they
  could release the node's preview hold or read the node's session as the
  phone's.

A server with no nodes never sets `nodeBusy`, so its `busy` is its claim, as
before. A lease still locks with `busy` alone (allocation also skips a phone
under an active lease), and a manual hold still writes `session_id`. Ending a
lease clears `busy` by the same rule, one conditional update where `UNHELD`
(`releaseLeaseLock`, both stores), so it never frees a phone a session or a
hold still has.

**Not supported:** BiDi and session WebSockets through the hub; the
`webSocketUrl` a session returns points at the node, so nodes must not sit on
untrusted networks.

### Device Streaming (`src/device-managers/{ios,android}/*StreamService.ts`)

Independent of Appium sessions, each platform has a stream service that brings up an MJPEG feed for live preview / recording:

- **iOS**: `IOSStreamService` starts the phone's own go-ios tunnel (iOS 17+, `IOSTunnels`, see below), launches WebDriverAgent via `runwda`, and forwards local ports `wdaPort:8100` and `mjpegPort:9100` with `iproxy`. WDA's MJPEG server is enabled via `/appium/settings`. Stream sessions are tracked in `this.sessions` with a watchdog that idles out streams after 10 min of zero viewers (unless the device is busy with an Appium session).
- **Android**: `AndroidStreamService` uses ADB + a built-in capture pipeline (MJPEG). A faster, flagged **H.264 live-preview** path also exists — see "Android H.264 live preview (scrcpy)" below.

**A go-ios tunnel per iPhone** (`src/device-managers/ios/IOSTunnels.ts`). On
iOS 17+ the go-ios commands Xenon runs against a phone (`runwda`, `ostrace`,
`syslog`, `screenshot`) reach it through a go-ios tunnel. Each phone gets
its own: `tunnel start --udid <phone> --userspace --tunnel-info-port <P>`, a
per-device agent on a pair of ports leased from the `tunnel` range
(12100–12199, `PortAllocator.acquirePair`). P is its tunnel-info API, and
go-ios derives P + 1 for the phone's traffic.

- **Finding it.** A command finds its phone's tunnel through
  `GO_IOS_AGENT_PORT` (`IOSTunnels.envFor`). A phone with no tunnel gets the
  plain environment.
- **Starting it.** A start waits up to 20 s for `GET :P/tunnel/<udid>` to
  answer 200, then goes on with a warning. A tunnel that exits before then
  fails the start.
- **Its ports.** The pair belongs to the tunnel, which gives it back when it
  stops. A session ending on the phone leaves it (`releaseForUdid` skips the
  `tunnel` purpose), since the phone's stream and tunnel can outlive it.
- **Losing it.** go-ios does not end an agent when its phone is unplugged.
  The agent drops the phone's tunnel, and on the replug starts a new one on
  its next traffic port, P + 2, then P + 3: the next phone's leased pair.
  So `IOSTunnels.checkTunnels` (every 5 s) stops a tunnel whose agent
  answers 404 for its phone after it was ready, or names a traffic port
  other than P + 1, and gives its ports back. A start refuses a tunnel that
  comes up on another port the same way. The phone's next start gets a new
  pair. A tunnel whose process exits (a crash) gives its ports back too.
- **Who drives it.** The stream's start and stop. At boot, Xenon reaps go-ios
  and then drops every `tunnel` lease.
- **Why.** Through 2.7 every tunnel took go-ios's default ports, 60105 and
  60106. A second iPhone's stream kill -9'd whatever listened there, which was
  the first iPhone's live tunnel, so only one iOS 17+ iPhone per Mac could
  stream. Nothing is killed by port any more.

**go-ios tunnels and Appium sessions.** The xcuitest driver never uses
go-ios. But an Appium session allocated while a stream runs drives the
stream's WDA (`iOSCapabilities` sets `webDriverAgentUrl`), and on iOS 17+
that WDA reaches the phone through the phone's tunnel. So that session
depends on the stream's WDA, forwarder and tunnel. Three rules follow:

- `cleanupOrphanTunnels` (the phone's own tunnel through `IOSTunnels.stop`,
  then a reap of that phone's untracked go-ios processes) never runs while an
  Appium session holds the phone
  (`heldByAppiumSession`: busy, non-manual `session_id`), or when its row
  can't be read. The sweep waits for the next stop or start after the
  session; a restart reaps every go-ios process at boot.
- A viewer's stop (`stream/stop`, `stream/leave`, via
  `stopStream(udid, { forViewer: true })`) stops nothing while an Appium
  session holds the phone and the stream launched its own WDA. The session's
  teardown (`stopIdleStreamForDevice`) or the idle watchdog stops it later.
  Shutdown still stops it.
- A start never restarts a running stream whose WDA doesn't answer while an
  Appium session holds the phone, as the watchdog's heal already skips a busy
  device. `startStream` throws `StreamRestartRefused`, naming the session,
  and leaves the stream as it was (not marked `error`, no cooldown). A restart
  would kill the WDA and tunnel the session may be driving, or launch a
  second WDA over the session's own. A WDA that is only slow to answer
  `/status`, during a long command, used to be killed this way when someone
  opened the preview. With no session on the phone, a restart still recovers
  a dead WDA.

**WDA names no phone.** `/status` has `os`, `ios.ip`, `build` and `device`
(the form factor); `/wda/device/info`'s `uuid` is `identifierForVendor`, not
the UDID. So `isWDARunning(port, retries)` says whether *a* WDA answers,
never whose, and takes no udid. A caller relies on knowing the port is the
phone's: its own stream's lease, or the Device row's `wdaLocalPort` while an
Appium session holds that phone (the attach branch).

`UniversalMjpegProxy` (`src/helpers/UniversalMjpegProxy.ts`) multiplexes a single upstream MJPEG to many browser clients. It speaks both standard HTTP MJPEG and a raw-socket fallback for WDA's headerless variant, drops lagging clients (>4 MB kernel backlog) to prevent OOM, and uses bounded retries with exponential backoff (max 10 attempts, 500ms→10s).

The browser-facing URL is always `/xenon/api/control/:udid/stream` (proxy URL). Hitting it auto-starts the underlying stream service if the device is iOS — the GET handler dedupes concurrent starts via `IOSStreamService.startPromises`.

#### Android H.264 live preview (scrcpy) — flagged, MJPEG fallback

The MJPEG path above tops out at ~1 fps on Android (per-frame `screencap`). When
`pluginArgs.streaming.androidH264` is on (**default OFF**), Android live *preview*
(not recording — see the phase-1 coexistence rule) uses a continuous, hardware-encoded
H.264 stream instead. The flag is a union: `true` → scrcpy (default source);
`{ source: 'scrcpy' | 'screenrecord' }` → pick the source explicitly (`resolveAndroidH264`
in `src/app/routers/androidH264Config.ts` normalizes all three shapes to
`{ enabled, source }`). iOS is untouched.

Pipeline (source-agnostic downstream): capture producer → `H264NalParser` (Annex-B →
config/key/delta packets) → `H264Multiplexer` (one upstream → many clients, config +
keyframe-gated join, GOP replay for late joiners) → authenticated WebSocket
`/xenon/api/control/:udid/stream/h264?ticket=` → `WsH264Player` (WebCodecs
`VideoDecoder` → `<canvas>`).

- **scrcpy source** (`ScrcpyServerSession`, `src/device-managers/android/ScrcpyServerSession.ts`):
  pushes the vendored `scrcpy-server-<ver>.jar` (`vendor/`, pinned by `SCRCPY_SERVER_VERSION`
  in `scrcpyVersion.ts`) with the resolved adb (never a bare `adb`), starts it via
  `app_process` in raw-stream mode (all three `send_*_meta=false` → pure Annex-B), and
  connects over `adb forward` + `localabstract:scrcpy`. **`adb forward` accepts the local
  TCP immediately — before the device socket is bound — so `connectWithRetry` treats a
  connection as real only when the first byte (scrcpy's `send_dummy_byte` readiness byte)
  arrives; a close/error before any byte retries.** No time cap, forced initial keyframe →
  near-instant first frame.
- **screenrecord source** (`openScreenrecordCapture` in `AndroidH264StreamService`): the
  prior 1.9.x path, kept as a code-level rollback. `adb screenrecord --output-format=h264`
  with a ~3-min cap (auto-restart) and a several-second cold start on a static screen.

Selection: `resolveStreamType(platform, flagOn, recording)` (`streamType.ts`) — Android +
flag on + not recording → `h264`, else `mjpeg`. `control.ts` `stream/start` starts the H.264
service; a scrcpy start failure throws and the handler returns HTTP 500 (it does *not*
downgrade the response to `mjpeg`). The effective MJPEG fallback is **player-level**:
`WsH264Player`'s `onFatal` swaps a failed/dying H.264 stream to the MJPEG `<img>` (the same
`stream-retry` path iOS uses), so a scrcpy-incapable device still ends up on MJPEG.

### Recording Subsystem (`src/services/recording/`)

Live recordings are independent of Appium "session video" — the mosaic page can record any device that has an active stream service.

- `RecordingOrchestrator.start({ udids, actorId })` spawns one ffmpeg per device (writing per-device mp4) and, for ≥2 devices, a single composite ffmpeg that scales+pads each MJPEG input into a uniform cell and stacks them with `hstack`/`xstack`. Composite output is at `compositeOutputPath(groupId)` = `${recordingsAssetsPath}/_groups/<id>/composite.mp4`.
- `BusyPrecheck` does an atomic multi-UDID check before any side effect, so a partial group is never created.
- `ConcurrencyGate` enforces a server-wide `maxConcurrentRecordings` cap.
- `ProofBundleService` streams a zip with manifest, README, per-device `video.mp4`/`bookmarks.json`/`annotations.json`/`device.json`, and the composite mp4 if present.
- `recoverOnBoot()` marks any orphan `RECORDING` rows from a previous process as `FAILED` with `fail_reason=server_restart` and releases their manual blocks.
- **When a recording ends, its phone leaves like a preview** (`leaveDeviceFn`, the router's `previewLeaves`). After a 3 s grace, which also lets the recording's own ffmpeg connection drop, the preview is stopped and the hold released, unless someone watches the phone or another recording reads it.
  - Never decide by whether the phone's stream runs: a recording starts the stream itself when none runs (`ensureMjpegForRecording`).
  - Through 2.6 it did decide that way, and kept a phone nobody watched held until the stream's idle watchdog, ten minutes later.
  - A node's phone has no stream here; its hold goes at once.
- **Another server's phone** (a node's, on a hub) is read from a loopback relay instead of a local stream service (`nodeRecordingSource.ts`, the orchestrator's `nodeSourceFn`).
  - Every connection to the relay gets the node's `GET /control/<udid>/stream`, signed afresh with the control token for the recording's user. ffmpeg reconnects on any hiccup, and the token lasts a minute.
  - ffmpeg's arguments, the composite, the proof bundle and the marks are unchanged: the relay is just another loopback MJPEG port, like this server's own phones'.
  - The node counts the relay's connections as viewers, so its idle release leaves the stream running.
  - The relay closes when its recording is finalized, after the group's composite has stopped.
  - A cloud provider's phone is refused, and a node that refuses the stream ends that phone's recording.
  - The busy precheck reads a node phone's preview hold from `nodeHold`, so the holder may record the phone they're previewing.

`VideoPipelineService` is hardware-accelerated (`h264_videotoolbox` on Mac, `libx264` elsewhere) and writes fragmented mp4 (`frag_keyframe+empty_moov+default_base_moof`) for instant playback / crash resiliency.

### Logcat Streaming (`src/services/logcat/`, `src/device-managers/android/Logcat*`)

Android only. The Debug Logs tab streams a continuous `adb logcat` over a
WebSocket. It replaced a 3-second `logcat -d -t 500` poll that appended without
dedup, so the 1000-line buffer held roughly the same 500 lines twice.

Pipeline: one `adb logcat -v threadtime -T 2000` child per device →
`parseThreadtimeLine` (pure) → `PackageResolver` fills `pkg` at emit time →
`LogcatMultiplexer` fans out → authenticated WS `/xenon/api/control/:udid/logcat?ticket=`
→ `useLogcatStream` → `LogcatView`. Modelled on the H.264 stack so it reuses
those lifecycle lessons; `attachLogcatWs` mounts beside `attachH264Ws`.

Things that are load-bearing and were each a real bug first:

- **`-T` on the spawn.** Without it logcat replays the device's whole ring
  buffer before reaching live output — measured 94-minute-stale records at
  ~84/sec, overrunning both buffers with history under a green LIVE pill.
  Bound to `REPLAY_BUFFER_SIZE` so a first viewer sees the same window a late
  joiner gets from the multiplexer.
- **Dropped records are visible.** When a client can't keep up the mux emits a
  synthetic `W/xenon  "N lines dropped (slow client)"` in its place, coalescing
  a run of drops into one record. The drop counter is **per client** — sharing
  it inverts who gets warned. Synthetic records also bypass the client filter,
  so a `level:E` view can't hide the marker.
- **The client buffer resets on reconnect, except after 1012.** The server
  replays to any joining client and the mux outlives a disconnect by 30s, so a
  reconnect inside that window re-appends the replay — the original duplicate
  bug. But 1012 means the upstream died and `LogcatStreamService` drops the
  session *before* closing the mux, so that reconnect gets an empty replay and
  clearing would blank the pane. Close code decides.
- **Ownership, not just a ticket.** Logcat carries auth tokens, deep-link URLs
  and PII, so it is an ownership-checked read: the WS evaluates
  `evaluateDeviceAccess` at **connect** time, and `logs` is in
  `OWNERSHIP_CHECKED_READS` so the REST dump of the same bytes can't be used to
  walk around it. The ticket carries the minting caller's `isAdmin` and
  `apiKeyId` as signed claims so the WS reaches the same verdict `/control`
  does — a `User.role` lookup would miss admin-scoped API keys.
- **`PackageResolver` never blocks or drops a line.** Negative cache (a PID
  absent from `ps` is marked unknown, not re-queried per line), two clocks
  (`attemptedAt` throttles retries, `loadedAt` alone drives freshness so a
  failing `ps` can't extend it), and no timeout of its own — the timeout
  belongs with the process spawn, in `LogcatStreamService`. Use exactly
  `ps -A -o PID,NAME`; plain `ps -A` returns nine columns, parses to zero rows,
  and every label silently vanishes.

Sizing lives in one place per constant: `IDLE_TIMEOUT_MS` 30s, `IDLE_POLL_MS`
2s, `REPLAY_BUFFER_SIZE` 2000, client buffer 5000, `DEFAULT_TTL_MS` 10s,
`PS_TIMEOUT_MS` 5s.

### WebSocket upgrades (`src/app/ws/upgradeRouter.ts`)

Xenon's WebSockets share Appium's http.Server with Appium's own. Xenon has
H.264 (`/xenon/api/control/:udid/stream/h264`), logcat (`.../logcat`) and
socket.io (`/socket.io/`). Appium has BiDi (`<basePath>/bidi[/<id>]`) and
whatever drivers add (`/ws/session/<id>/...`). The upgrade router gives each
upgrade exactly one handler. Before it, which side worked depended on the
Node version:

- **Node >= 22.21 / 24.9:** Appium's `upgrade` listener (base-driver
  `configureHttp`, added before any plugin) ran first and `socket.destroy()`ed
  every path it had no handler for, Xenon's included. H.264 fell back to MJPEG
  and socket.io to polling.
- **Node < 22.21 (the lab's 22.19, all of Node 20):** Appium takes upgrades in
  an Express middleware, which Node reaches only while the server has no
  `upgrade` listener. Xenon's listeners were always there, so BiDi and driver
  sockets got no answer. On a hub, engine.io's listener ended them after 1 s.

How it works:

- **It wraps `emit('upgrade')`**, as the session guard does. An upgrade to a
  Xenon route goes to that route alone, and no listener sees it. Everything
  else is emitted unchanged, through the guard, to the listeners.
  `registerRoutes` installs it right after the guard.
- **On Node < 22.21 it adds the listener Appium would have added**
  (`appiumUpgradeListener`). The test is base-driver's own: the server has no
  `shouldUpgradeCallback`. That listener is also what makes an old Node emit
  `upgrade` at all. It ports base-driver's `tryHandleWebSocketUpgrade` over
  the public `webSocketsMapping`, and destroys what matches nothing. The port
  handles literal and `:param` patterns, the only kinds Appium and drivers
  register, and `upgrade-router.spec.ts` checks it against Appium's own
  function case by case. A pattern in other path-to-regexp syntax is skipped,
  with one warning.
- **socket.io is adopted.** engine.io attaches by adding its own `upgrade`
  listener, which would also see every other upgrade and end it after 1 s.
  `adopt` takes the listener it added off the server and calls it only for
  `/socket.io/`, using engine.io's own test (a prefix of the raw URL).
- **A new WebSocket goes through `upgradeRouterFor(server).add(...)`**, never
  `server.on('upgrade')`. A listener sees every upgrade. On Node < 22.21 its
  presence alone hides every upgrade from Appium's Express middleware.
- **A throw is contained.** An exception out of an `upgrade` listener ends
  the process. Xenon's path parsers throw on a malformed `%` escape in a udid.
  So does Appium's own dispatch for one in a BiDi session id, because
  path-to-regexp decodes parameters. The router catches either, destroys the
  socket and logs.
- **Limit on Node < 22.21:** any `upgrade` listener makes Node treat every
  `Connection: Upgrade` request as an upgrade. A non-WebSocket one
  (`Upgrade: h2c`) is destroyed rather than served as plain HTTP. It hung
  before this change. Node >= 22.21 serves it as HTTP, because Appium's callback
  only claims `websocket`.

### Process shutdown (`src/index.ts`)

`cleanup()` runs on SIGINT/SIGTERM and is **not reliable on SIGTERM**: Appium's
own handler closes the HTTP server and exits the process before Phase 2
(per-service cleanups) or Phase 3 (`ProcessRegistry.terminateAll`) run — the
log reaches "Shutdown signal received" and Appium's "Received SIGTERM", then
the process is gone without ever logging "sanitized".

So long-lived sidecars are also killed synchronously from a `process.on('exit')`
hook, the last hook that always runs. It forbids async work, which is why each
service exposes a separate `killAllSync()` rather than an await inside
`cleanup()` — `kill()` is a syscall and is safe there. Covered:
`LogcatStreamService`, `AndroidH264StreamService`, and `ProcessRegistry`
(go-ios, WDA, iproxy, ffmpeg). `ProcessRegistry.killAllSync` goes straight to
SIGKILL and targets the process **group**, since 'exit' gives no later tick in
which to observe a graceful wait.

**Do not fix this by registering a stream service with `ProcessRegistry`.** That
registry is also keyed by udid and session, so its children would then be killed
by `terminateForUdid` / `terminateForSession` — ending a session would tear down
a live preview meant to outlive it.

`AndroidStreamService` is deliberately uncovered: its MJPEG capture spawns a
short-lived `adb exec-out screencap` per frame rather than holding a long-lived
child.

### Network Interception (`src/services/interceptor/`, `InterceptorService.ts`)

Android-only in v1. Sessions opt in via any of the capability shapes accepted by `pluginArgs.interceptor.enabled` — see the schema description for the full alias list. Once enabled, an MITM proxy captures requests/responses (capped by `bufferSize`), and `xenon: addMock` / `removeMock` / `clearMocks` / `getRequests` / `getMocks` / `exportHar` execute scripts manipulate per-session state. HAR export is the canonical way to ship captured traffic to clients.

### Identity & Manual Locks

Authentication: every `/xenon/api` request is gated by `authMiddleware` (`src/middleware/authMiddleware.ts`), which accepts either the (`x-xenon-access-key`, `x-xenon-token`) header pair or the `xenon_dashboard_session` cookie — a `UserSession` id, with a legacy raw-API-key fallback. It also accepts a hub-issued RS256 JWT as `Authorization: Bearer` (audience `xenon-rest`, minted by `POST /auth/token`, validated against the hub's JWKS) — the same middleware, a third credential path with a live user lookup so REST revocation is instant. It always sets `req.auth = { kind, userId, role, scopes, teamIds, rateLimit, … }`; `req.apiKey = { id, scopes, teamId, rateLimit }` is additionally set on the API-key paths only, never for cookie user-sessions. A raw API key can be exchanged for the cookie via `POST /auth/dashboard-session`, but only for SUPER_ADMIN owners. `scopeGuard(['devices'])` and `mutationScopeGuard(['devices'])` (mutations only — GETs always pass) enforce scope-based access on routers like `/control`.

`scopesForRole` maps a **cookie** session's role to its scopes: ADMIN/SUPER_ADMIN
get `admin,devices,sessions,read`, MEMBER gets `devices,sessions,read`. MEMBER
carries `devices` deliberately — `/control` declares per-device interaction a
Member action via `roleGuard('MEMBER')`, and without the scope
`mutationScopeGuard` 403'd every member on the line below, making device control
admin-only. Since admins bypass the ownership guard, that combination meant no
dashboard user could ever be told a device was held by someone else. API keys
carry their own explicit scopes and are unaffected by this map.

When the dashboard takes a soft lock on a device for live preview or recording, the `device.session_id` is written as `manual_<userId>_<udid>` (encoded by `formatManualLock` in `src/services/recording/manualLock.ts`). All readers — `BusyPrecheck`, the `/stream/stop` route, the picker UI — call `inspectManualLock(blockId, actorId, udid)` to distinguish *self* from *another user* from *legacy `manual_<udid>`*. Locks owned by a different user can only be force-released by an admin-scope key.

**Ownership is keyed on the user (`req.auth.userId`), never the credential.**
`req.apiKey` is never populated for cookie sessions, so a credential-keyed lock
denies users their own devices and can never match a session's owner. Every
writer and reader of the lock uses `resolveActor(req)` +
`isSelfManualLock(...)`; the only tolerance is that a lock matching the caller's
*current* `apiKey.id` also counts as self, absorbing locks written before 1.13.0.
Getting this half-right is what made a user's own `stream/stop` return 403 on
their own device — migrate every reader and writer together or none.

### Device access guard (`src/middleware/deviceAccessGuard.ts`)

Mounted once on the `/control` router, after `roleGuard` and
`mutationScopeGuard`. Refuses a request against a device held by another user,
or running another user's Appium session. Your own Appium session stays
interactive, so "watch the test I started" works.

- **Scope is chosen by HTTP method, not a path list** — every non-GET is guarded
  minus `UNGUARDED_CONTROL_MUTATIONS` (`stream/start`, `stream/stop`,
  `stream/ticket`, each with a stated reason). That is what makes an endpoint
  added later protected by default; the hole this closed existed because
  ownership had to be remembered in ~20 handlers and was remembered in none.
- **Reads stay open** so the mosaic picker and monitoring can look at a busy
  device — except `OWNERSHIP_CHECKED_READS` (currently just `clipboard`, which
  returns whatever the holder last copied). Keep that list short.
- `evaluateDeviceAccess` (`src/services/device-access/deviceAccessPolicy.ts`) is
  pure: admin → allow; not busy → allow; manual lock self or legacy → allow;
  foreign → deny; otherwise compare the Appium session's owner
  (`Session.api_key_id → ApiKey.userId`, memoized positive-only by
  `SessionOwnerResolver`). An unattributable session **denies** — fail closed.
  "Busy" there is `heldHere` (`deviceClaims.ts`), not the `busy` column, in
  this guard and the logcat socket's authorizer alike. A hub's row for a
  node's phone that is busy only by the node's report (`nodeBusy`, no claim,
  nothing in `session_id`) has no holder on record here, and failing closed
  on it refused every non-admin, the node preview's own holder included.
  That phone is the node's to judge: its guard knows the holder and runs on
  every call the hub forwards.
- Denials are `409` with `device_held_by_another_user` /
  `device_in_use_by_session`, a message naming the holder, and a `warn` log. If
  ownership cannot be determined at all (store or resolver throws) it is `503
  device_ownership_unavailable` — never a silent allow, because the handler runs
  its own device lookup and would otherwise skip the check entirely.
- `stream/start` has its own decision (`src/app/routers/streamStartConflict.ts`)
  because "busy" differs at start time: an orphaned manual lock with no live
  stream is reclaimed rather than refused.

**Team guard** (`src/middleware/deviceTeamGuard.ts`) runs just before it. Teams
are a device boundary: a member may use a shared-pool phone (`teamId` null) or
one of their teams' phones, nothing else. The rule is `isDeviceVisible`
(`src/services/device-access/deviceVisibility.ts`), and its only input is
`req.auth.teamIds`: `undefined` means admin or auth disabled, never
`resolveActor().isAdmin`, so the guard and the device list always agree.
Every method and action is checked, with no exception list.

- **A hidden phone looks unknown on every request.** The guard answers nothing
  itself: it swaps the udid in `req.url` for `HIDDEN_DEVICE_UDID`, which no
  lookup ever resolves, and calls `next()`. Every later layer then gives its
  unknown-udid answer with the same number of lookups: the ownership guard,
  each handler's own 404 body, and Express's 404 and automatic OPTIONS reply
  for requests no route handles. `req.originalUrl` is untouched, so an answer
  that echoes the path echoes the real one, never the placeholder. Express 4
  doesn't restore `req.url` when a router falls through, so `register()`
  mounts `restoreHiddenDeviceUrl` after the router, at the parent, to put it
  back; never as a trailing `router.use`, where a later route would get the
  real hidden udid. Layers after `/control` should still read
  `req.originalUrl` when they need the requested path.
  `test/integration/team-visibility-control.spec.ts` reads the routes from the
  router's own stack and holds all of them, plus unrouted actions, the wrong
  method and OPTIONS, to identical answers. That is also why `stream/ticket`
  and `inspector/snapshot` 404 an unknown udid.
- **It runs first** because the ownership guard's 409 names the holder, which
  would confirm the phone exists and say who has it.
- **One lookup for both guards.** Both parse the udid and look the device up
  through `src/middleware/controlDevice.ts`, memoized on `res.locals`, so a
  member's request costs one query across the two.
- **Tickets are team-checked only when minted.** `GET /control/:udid/stream?ticket=`
  authenticates by ticket with `teamIds: undefined`, so the team guard passes
  it. The H.264 and logcat WebSockets redeem tickets outside Express and never
  reach the guard at all. What covers all three is that minting a ticket
  (`POST stream/ticket`) is team-checked. A second route that accepts tickets,
  or a second way to mint one, needs its own team check.
- Reservations apply the same rule, and so do SDK leases: `LeaseService.create`
  matches with the caller's `callerTeamIds`, never a team list from the
  client's `filters`.
- So do Appium sessions. A credentialed session (key pair or session token)
  is allocated phones, and resolves uploaded apps, by REST's `computeTeamIds`
  for its owner: a member's teams, narrowed by the key's or token's own team,
  unscoped for an ADMIN or SUPER_ADMIN owner or an admin-scoped key. The owner
  is looked up once per session (`leaseAccessFor`, memoized) and shared with
  the lease check. Until 1.30 a key saw only its own team binding, so a
  member's ordinary key never reached their team's phones, and a session
  token saw every team's. A session with no credentials stays unscoped.

**Session data follows the session's phone**
(`src/services/device-access/sessionVisibility.ts`). `canSeeSession` decides one
session: admin, or a visible phone, or, when the phone has no Device row
(unplugged), the session's owner. `visibleSessionWhere` is the same rule as a
Prisma `where`, so a list's `take` and a count are the caller's. Combine it
under `AND`, never by spreading, or one `OR` overwrites the other.

- `isValidSession` guards every `/session/:sessionId/*` route with it, and a
  hidden session gets the unknown-id body byte for byte. Bug reports, the
  session list, its summary (`/session-summary`), builds and the healing
  reads use it too.
- Session files (`<sessionId>/<kind>/<file>` under `sessionAssetsPath`) are
  served only by `GET /session/:sessionId/asset/:kind/:file`, for
  `screenshots`, `video` and `performance`. Never serve that folder with
  `express.static` or any mount outside `apiRouter`: it also holds interceptor
  captures and, by default, every recording. Until 1.29.1,
  `/xenon/session-recordings` served it with no login at all.

**Uploaded apps have a team** (`App.teamId`, null = shared), and follow the
device rule on it: `canSeeApp` / `visibleAppWhere`
(`src/services/device-access/appVisibility.ts`). The list, download, delete
and `/control/:udid/install-repository-app` give a hidden app the unknown-id
answer. Upload (optional `teamId`) and `PUT /apps/:id/team` are admin-only.
Re-uploading stored bytes (md5 is unique) returns the existing app in its own
team. `TeamService.delete` refuses a team that still owns apps, since
`onDelete: SetNull` would share them with everyone.

- A session naming an app by id resolves it with the same `sessionTeamIds`
  its phone is allocated with. A hidden app is left in the caps untouched,
  exactly as an unknown id is.
- The driver downloads the app with no credentials, so it gets
  `?ticket=` from `AppDownloadTicketService`: audience `xenon-app-download`
  (never a stream ticket, nor the reverse), bound to one app id, single-use,
  10 minutes. `authMiddleware` accepts it only on `GET /apps/:id/download`
  and answers every ticket failure `401 invalid ticket`. It is minted just
  before `next()` / the node forward and Xenon never writes it to the pending
  row, the Session row or its own logs: the stored caps keep the plain URL.
  Appium's `[HTTP]` request log and the driver's "Using downloadable app"
  line do print it, as they print stream tickets; by then it is spent, or
  dies within 10 minutes. With auth disabled there is no ticket.
- Both ticket kinds share `SingleUseLedger` for replay: a `jti` is kept until
  the token's `exp` plus `verify()`'s 60 s tolerance.

### Session attribution

A session's owner is resolved by `SessionOwnerResolver.ownerOf`, which prefers
`Session.user_id` and falls back to `Session.api_key_id → ApiKey.userId` for
rows written before 1.13.1. Two columns because two id spaces: `api_key_id` is
the `ApiKey` row that created the session, `user_id` is the human.

A live session this server drives is looked up in memory first
(`LiveSessionOwners`, `src/services/device-access/LiveSessionOwners.ts`):
`finalizeSession` records its owner and its end forgets it (`deleteSession`,
`onUnexpectedShutdown`, shutdown). A node writes no Session row for a session
the hub created, so until then its `/control` guard, logcat WebSocket and
session listing found no owner and, failing closed, refused the phone to
everyone but admins, the owner the hub's create token named included. The
same went for any server with the dashboard off.

`resolveSessionIdentity` (`src/services/session/sessionIdentity.ts`, pure)
derives both from whichever credential `createSession` presented:

| Credential | `api_key_id` | `user_id` |
|---|---|---|
| `xe:options.{accessKey,token}` pair | ApiKey row id | `ApiKey.userId` |
| `xe:options.sessionToken` (JWT `sub`) | null | the token's subject |
| on a node, the hub's create token (`x-xenon-hub-token`, `sub`) | null | the owner the hub verified |
| neither | null | null |
| `authDisabled` | null | null — every caller is a synthetic SUPER_ADMIN |

**`xe:options` is Xenon's capability namespace.** Credentials, the lease and
Xenon's other options (`healingTiers`, `interceptor`, `team`, ...) all live
there. `xenon:options` is still read as an alias; when a session sends both,
`xe:options` wins field by field. That rule lives in one place,
`xenonOptionsOf` / `xenonOptionsIn` (`src/services/session/xenonOptions.ts`),
and every reader goes through it — don't read either namespace directly.
`df:options` (from appium-device-farm) is **not read at all**: a session that
sends only `df:options` is treated exactly like one with no credentials.

The team a key-pair session asks for is `xe:options.team` (or `teamId`),
read by `extractTeamCap`. The flat caps older clients send (`xenon:team`,
`xe:teamId`, ...) still work, and the options field wins over them.

**Credentials never reach the driver or storage.** `prepareSession` (the
first step of every create, run by the session gateway) calls
`takeSessionCredentials` (`src/services/session/sessionCredentials.ts`)
first: it reads `accessKey`, `token`, `sessionToken` and `leaseToken`, then
deletes those four fields from both namespaces in alwaysMatch and every
firstMatch entry, in place, before the pending-session row, allocation, the
driver, the Session row or any log sees the caps. Everything else, `leaseId`
included, stays. They never leave the server they were sent to. A hub
forwarding a create to its node sends `capsForNode` and its own create token
instead (see Hub-Node Topology). A cloud provider gets neither.

**Attribution is decoupled from enforcement.** A session token is read for
identity whenever one is present, whether or not
`XENON_REQUIRE_SESSION_TOKEN` is on, and a token that fails verification is
*ignored*, never rejected. `assertSessionTokenGate` (`src/services/sessionTokenGate.ts`)
remains the sole decider of whether a session is admitted. When the gate is on
the token is verified twice — once to admit, once to attribute; `jose.jwtVerify`
is stateless so the second verify is harmless.

**Operational note:** a session created with **no** credentials is still
admitted (`SessionLifecycleService` warns, it does not reject) and stays
unattributable, so the fail-closed rule denies everyone non-admin on that
device — including the engineer who started the run. If your clients cannot
pass `xe:options.accessKey` + `xe:options.token`, have them present an
`xe:options.sessionToken` instead (minted by `POST /xenon/api/auth/token` with
`audience: 'xenon-mcp'`), or enforce credentials with
`XENON_REQUIRE_SESSION_TOKEN`.

**Per-command auth** (`XENON_REQUIRE_COMMAND_AUTH`, off by default, never with
auth disabled; `src/middleware/commandAuth.ts`). Without it only createSession
checks credentials, and any later `<basePath>/session/:id/...` request is
authorized by the session id alone. With it on, every request under
`<basePath>/session/:sessionId` (all methods; `POST <basePath>/session` is not
under it) must carry the credentials REST accepts, the `x-xenon-*` pair or a
Bearer JWT (`xenon-rest`/`xenon-mcp`), verified by the helpers authMiddleware
uses (`verifyCredential.ts`). The caller must be the session's owner
(`SessionOwnerResolver.ownerOf`) or an override admin by `canOverrideLease`'s
rule; a Bearer token is judged by its `scopes` claim like a key, so an ADMIN's
ordinary key can't mint an override. A refusal is WebDriver's unknown-session
answer (404 `invalid session id`, empty `stacktrace`), so nobody can tell a
session they may not use from a missing one. An ownerless session is refused
to all but override admins. A failed lookup is `503 unknown error`, never an
allow. Verified identities are cached 30 s by SHA-256 of the secret; revocation
is not pushed, it takes up to 30 s (`commandCaller.ts` says why).

- **It must run before Appium's routes.** Appium adds them before any plugin's
  `updateServer`, so a plain `app.use` never sees a command.
  `insertBeforeRoutes` splices the layer ahead of the first route, on
  `app._router` (Express 4) or `app.router` (Express 5, what Appium 3 runs).
  If it can't, the server refuses to start while the setting is on. It runs
  inside the session gateway (see Hub-Node Topology), so it is checked once,
  before a hub forwards anything to a node.
- **`/wd-internal` needs the per-process secret** (`src/gateway/internalCall.ts`).
  Xenon's own loopback calls (`LocalSession`'s HTTP fallbacks for page source,
  screen recording and perf recording) go to
  `<basePath>/wd-internal/session/<id>/...` with `x-xenon-internal`, a secret
  made once per process, never through an HTTP proxy. The path-less
  internal-call layer, ahead of the session layer, accepts a call only with
  both: it strips `/wd-internal`, removes the header, and marks the request so
  the session layer skips per-command auth. Without the secret, or with any
  other spelling of the marker, the request is left as it came and gets
  Appium's unknown-route answer, byte for byte (there is one `next()` call site,
  because Appium's 404 carries a stack trace). The path alone used to be the
  marker, which would have been a way around this check.
- **A local session's heartbeat doesn't use HTTP.** `LocalSession.checkHealth`
  asks the in-process umbrella (`sessionExists`). Any command sent to the
  session, `timeouts` included, restarts the driver's new-command timeout and
  Xenon's idle clock, so a 30 s probe would keep an abandoned session and its
  phone alive for ever.
- **Neither does a hub's heartbeat on a node's session.** `RemoteSession`
  asks the node's `GET /xenon/api/node/sessions/<id>`
  (`src/gateway/nodeSessionStatus.ts`), which reads the node's umbrella
  (`AppiumUmbrella`, noted by `XenonPlugin.createSession`, the one place a
  plugin is handed it) and runs no command: `200 { value: { sessionId,
  exists } }`. Only a node mounts it, ahead of the login. It asks what a
  command to the session asks: with per-command auth on it needs the hub's
  session token for that session and answers anyone else with the
  unknown-session body (`503` when the JWKS can't be fetched); with it off,
  nothing, so a hub that can't sign doesn't see its node sessions as gone. Every
  answer carries `x-xenon-node-sessions`, so an older node (a 404 or a 401
  from its login, without the header) is recognised: the hub falls back to
  the old `GET .../timeouts` probe for it, logs that once per node
  (`NodeSessionProbeSupport`) and asks again after 10 minutes. A cloud
  session keeps the WebDriver probe.
- **The session listing is filtered** (`sessionListingFilter.ts`).
  `GET <basePath>/appium/sessions` is Appium 3's only listing route (no
  `GET /sessions`; Appium also gates it behind the `session_discovery`
  insecure feature). The same credentials are read: an override admin gets
  Appium's list untouched, a verified caller only the sessions they own,
  anyone else `{"value":[]}`, which is what an idle server answers. It wraps
  `res.json` and removes entries; Appium still builds the list. Owners are
  looked up when the list is answered, with one `SessionOwnerResolver.ownersOf`
  query for all listed ids (ownerOf's rule, shared cache). They can't be
  precomputed before `next()`: `xenon: setSessionStatus` changes a live
  session's status, so there is no reliable "live" filter. Error answers pass
  through. A failed credential check or owner lookup is 503.
- **Session WebSockets are guarded** (`sessionUpgradeGuard.ts`).
  `<basePath>/bidi/<id>` and drivers' `/ws/session/<id>/...` (with or without
  the base path) need the owner's or an override admin's credentials, in the
  same headers. A refusal is a bare `404` written on the raw socket, which is
  then closed, identical whether the session exists or not. A failed check is
  a `503`. The umbrella `<basePath>/bidi`, Xenon's ticketed `/xenon/...`
  sockets and socket.io are never touched. Appium takes upgrades one of two
  ways. On Node >= 22.21 / 24.9 it uses an `upgrade` listener, added before
  `updateServer`. On older Node it uses an Express middleware, which Node
  reaches only while the server has no `upgrade` listener. The check is
  async, so the guard wraps `httpServer.emit` for `upgrade`. It holds a
  session upgrade back from every listener until it's allowed, then
  re-emits it unchanged. It also puts a middleware at index 0 of the Express
  stack (`insertAtStart`). Session ids are read the way Appium reads them:
  WHATWG-normalised pathname, case-insensitive, plus BiDi's second read of
  the raw URL, each decoded too. The caller must own every one.
- **Which handler an upgrade reaches is the upgrade router's job** (see
  "WebSocket upgrades" below). It sits in front of the guard's `emit`
  wrapper and passes it everything that isn't Xenon's, so the guard stands
  in front of Appium's listener on every Node. Because the router always
  keeps an `upgrade` listener, Node < 22.21 no longer hands any upgrade to
  Express, and the guard's Express middleware is a backstop that isn't
  reached.
- Enable it on the hub, where the owners are on record. A node with it on
  accepts the hub's session token in place of credentials (see Hub-Node
  Topology), and refuses everything else, since its own database knows no
  owners for hub-created sessions.

Device leases: programmatic clients (SDK, MCP tools) claim devices via
`POST /xenon/api/sdk/leases` (`src/services/lease/LeaseService.ts`) — token-bound
claims with TTL + heartbeat, swept by `LeaseOrphanSweeper` (every 30 s: a lease
ends after three missed heartbeats or at `expiresAt`, whichever comes first;
either way it is marked `expired` and its port leases deleted. Heartbeat,
extend and `authorizeSessionUse` already refuse a lease past `expiresAt`).
Ending a lease, by a reap or its holder's release, takes off only the lease's
lock (`releaseLeaseLock`): `busy` is cleared only where the phone is `UNHELD`
(see "Busy on a hub"). A session created on the lease claims the phone, so a
session that outlives its lease keeps it, and its own release frees it. Until
2.1 the reap wrote `busy: false` outright and handed such a phone to a second
session mid-run. Leases are resolved at
allocation via the `xe:options.leaseId` capability. A lease id is not a
secret, so the session must also prove it holds the lease
(`LeaseService.authorizeSessionUse`): the lease token as
`xe:options.leaseToken`, the creating credential, or an override
(`canOverrideLease`, which follows `resolveActor`). The phone must also be
visible to the caller's REST teams. Every refusal is one message from one
throw site in `allocateDeviceForSession`. `createSession` strips the token,
with the session's other credentials, before anything else reads the
capabilities; the lease-create response's `appiumCapabilities` carry
`xe:options.{leaseId,leaseToken}`, and the persisted `capabilityBag` never
holds the token. Prefer leases over
manual locks for anything non-interactive. Hub-issued JWTs: `POST /auth/token`
mints RS256 tokens (`JwtKeyService`), `authMiddleware` accepts them as
`Authorization: Bearer`, JWKS at `/auth/jwks.json`; single-use stream tickets
(`?ticket=`) authenticate the webview MJPEG path.

The frontend identity probe is `GET /xenon/api/auth/me` which returns `{ userId, scopes, teamId }`. The mosaic view fetches it on mount and uses it for the `manual_self`/`manual_other` distinction in the device picker.

### Mosaic / Live Devices UI (`web/src/components/mosaic/`)

Multi-device live preview + group recording surface. Uses a custom `useReducer` store (`recording-group-store.ts`) for tile/layout/recording state. Click-to-toggle from the picker; drag-and-drop into specific cells; per-tile interaction (tap/swipe/long-press translated via WDA `screenWidth/screenHeight`) and keyboard input (typed chars → `/control/:udid/text`, Backspace/Enter → `/keyevent`). Tile state survives a refresh via mount-time rehydration that finds devices with `session_id=manual_<myUserId>_*` and an active stream service.

### Data Layer (`src/data-service/`)

- **PrismaStore** — SQLite via Prisma ORM (models: Build, Session, SessionLog, Log, Profiling, App, Device)
- **DeviceStore** — in-memory device cache synchronized with the database
- **QueueService** — queues session requests when all devices are busy

### API & Real-time (`src/app/routers/`, `src/dashboard/`)

REST endpoints under `/xenon/api` (documented at `/xenon/api-docs`). All state changes are broadcast to dashboard clients via Socket.io by `EventManager`.

**Live events are team-scoped at emit time.** A socket keeps who it is on
`socket.data.identity` (`{ principal, userId, role, teamIds }`), with
`teamIds` from the same `computeTeamIds` REST uses. It is fixed at connect,
so a membership change applies when the dashboard reconnects (on reload).
The handshake accepts what REST accepts: a bearer JWT, an `(accessKey,
token)` pair (nodes), or the `xenon_dashboard_session` cookie, tried as a
`UserSession` id (`/login`) first and a raw API key second. Until 1.29.0 the
socket tried only the raw key, so every dashboard signed in through `/login`
was refused and got no live events.
Any event about a phone goes through
`SocketServer.emitToDashboardForDevices(event, data, scope)`, which sends it
only to the dashboard sockets whose caller passes `isDeviceVisible`:
`{ udid }` resolves the team through `DeviceTeamResolver`, `{ udid, teamId }`
uses a row in hand, and `{ udids, strip }` cuts a multi-phone payload
(recording started/stopped) per socket. An unknown udid reaches admins
only. The event log still records each event once, unscoped.

- Session commands and intercepted requests emit once each, so the resolver
  caches a udid's team for 5 s (`DEVICE_TEAM_TTL_MS`): one lookup per phone,
  never one per command. Device events and `PUT /device/:udid/team` refresh
  it through `note()`. A lookup that outlasts 2 s
  (`DEVICE_TEAM_LOOKUP_TIMEOUT_MS`) fails closed for that event.
- Each phone's events go through one delivery chain, so they arrive in the
  order they were emitted whatever their scope shape; a group event waits
  for every phone it names. Different phones' events may interleave.
- A new emitter about a phone must name the phone. The plain
  `emitToDashboard` is unscoped and reserved for events that aren't one
  phone's data: selector events and `NODE_*`.
- With no team-scoped socket connected (an auth-disabled server, or admins
  only) and nothing pending for the phone, it is the old synchronous room
  broadcast, with no lookup. The two call sites that look a phone up only
  to scope its event, `removeDevice`'s team read and the recording marks'
  `findVideo`, check `SocketServer.hasScopedDashboard()` first, so an
  auth-disabled server makes no lookup at all.

### Frontend (`web/`)

React 17 + Vite + Tailwind CSS dashboard. Talks to the backend over REST and Socket.io. Built artifacts are copied into `src/public/` and served as static files by the plugin server.

Dialogs: use `ui/Modal` (Radix) for ordinary dialogs. A full-screen view that is
also a route, like device control, uses `ui/InPlaceDialog` instead. Radix's modal
mode hides and blocks everything outside the dialog, which would silence the toast
live region and make toasts unclickable. `InPlaceDialog` marks the background
`inert` (except live regions), moves focus in, closes on Escape except while
typing in a field, and returns focus on close.

#### Design tokens (`web/src/tokens.css`)

Colours live in three layers: **primitives** named by hue (`--green`, `--red-400`,
`--neon-green`), **channels** for alpha tints (`--rgb-green: 34 197 94`, used as
`rgb(var(--rgb-green) / 0.1)`), and **roles** that say what a colour means
(`--color-accent`, `--color-on-accent`, `--color-success`, `--color-warning`,
`--color-danger`, `--color-info`, `--color-highlight`, `--color-focus-ring`).
New UI should use roles.

**Themes.** `<html data-theme>` is `dark` (default) or `light`, chosen in the
account menu (Dark / Light / System) and stored in `localStorage['xenon.theme']`.
An inline script in `web/index.html` applies it before first paint;
`web/src/lib/theme.ts` owns the preference and follows the OS while it is
`system`. The light values live in one `:root[data-theme='light']` block in
`tokens.css`. To keep dark byte-for-byte stable, theme-dependent colours are
written so they compute to the old dark value:

- Neutral washes use `rgb(var(--rgb-fg) / A)` (white in dark, near-black in
  light), never `--rgb-white`.
- Dark wells use `rgb(var(--rgb-well) / calc(A * var(--well-k)))`, and heavy
  drop shadows use `rgb(var(--rgb-black) / calc(A * var(--shadow-k)))`. Both
  `k` values are 1 in dark and scaled down in light.
- A component literal that only works on dark gets a scoped
  `:root[data-theme='light'] .x { … }` override beside it. Don't edit the
  dark rule. In TSX, use the `light:` Tailwind variant defined in
  `web/tailwind.config.js` (e.g. `light:disabled:bg-transparent`).
- Text on a filled accent or success colour uses `--color-on-accent` /
  `--color-on-success` (black in dark, white in light). Never use `--black` or
  `text-black`.
- **Dark islands:** `class="theme-dark"` re-declares the whole dark palette
  on a subtree, because it shares the two `:root` blocks. The terminal, the
  logcat rows (their tag palette only works on dark) and Omni's generated
  code use it. An island with a translucent or absent background needs an
  opaque one in light.

Verify a theme change on both sides. Dark should be pixel-identical at
Playwright `threshold: 0`: the default 0.2 hides small colour shifts. Light
should pass a contrast probe on every route, plus device control, which needs
a route-mocked device.

Don't add raw hex or `rgba()` literals. `web/src/design/color-literals.test.ts`
is a ratchet against `color-literals.baseline.json`: a file may lose literals
(lower its number there) but never gain one. Canvas code, persisted annotation
colours and the logcat tag palette are exempt, with reasons in
`color-literals.ts`. The `--accent` variable never existed; its old fallbacks
(blue for Selector Health and the mosaic, border for device cards) are now
`--color-highlight`, `--color-info` and `--border-strong`.

**Changing a value in `web/src/tokens.css` also changes the Mac launcher.**
`mac-app/src/renderer/src/tokens.css` is generated from the *first* `:root {`
block (surfaces, borders and text, with `-rgb` triples; `--accent-subtle` /
`--accent-border` are copied verbatim, so keep them literal there) by
`mac-app/scripts/sync-tokens.mjs`, and the
Schema Drift Check workflow fails on any difference. After editing a token
value run `node mac-app/scripts/sync-tokens.mjs` and commit the generated
file in the same PR. #268 missed this and turned main's drift check red.

#### Breakpoints

Supported range is **1280–1440** (laptop + tablet landscape). No phone or
tablet-portrait support: no hamburger, no drawer. The sidebar is a fixed 56px
rail at every width.

**Use Tailwind mobile-first `min-width` only** for new work. A few legacy
`max-width` queries remain in component CSS (all firing below 1024px, i.e.
outside the supported range) — don't add more, and prefer `min-width` when you
touch one. Mixing directions is how bugs hide: the codebase has had
`max-width: 1024px` (`device-explorer.css`, `selector-health.css`) alongside
`min-width: 1024px` (`settings.css`), the same number meaning opposite things.

Before choosing a breakpoint, **compute the layout's intrinsic minimum** (sum of
fixed columns + gaps + padding + the 56px rail) and make sure the breakpoint sits
*above* it. Selector Health shipped a `max-width: 1024px` override 121px below
its own 1146px floor, leaving a dead zone at 1025–1145px that was invisible from
either end.

`web/test/viewport/overflow.spec.ts` (Playwright) guards this. It tests both
sides of every breakpoint boundary. It renders a **route-mocked** Android device
(`page.route('**/xenon/api/device*', …)`) rather than seeding the DB — the device
manager reaps `Device` rows for unattached hardware (`removeStaleDevices`), so a
seeded row is deleted before the page loads. Run it with `npm run test:viewport`
against a running server (dashboard enabled, auth disabled).

Coverage boundary — all 19 routes in the matrix are now **hermetic**. The 15
data-heavy routes (overview, devices, devices?view=table, recordings,
recordings/:groupId, builds, builds/:buildId, a failed and healed session's
page, apps, selector-health, selector-health/detail, teams, users, api-keys,
notifications)
route-mock their data endpoints via `ROUTE_DATA_MOCKS` with deliberately
wide/hostile payloads — multiple rows plus a >100-char session subtitle, an
>80-char selector XPath, a long bundle id, and long team/user names/emails — and
a paired `ROUTE_CONTENT_CHECKS` assertion proves the route's real rows/grid
actually mounted (e.g. `.sh-table__row` or `table tbody tr` `not.toHaveCount(0)`)
rather than an `<EmptyState>` placeholder, before the overflow scan runs — a
table with zero rows has nothing to overflow, so without this a broken mock
would pass vacuously. The device-control route keeps its own dedicated device
mock + 11-button toolbar test. The 3 static-form routes (settings, maintenance,
ai-settings) render a fixed layout with no list data to gate on, so the
app-**shell** check (`aside:has(nav)` with buttons) that every route runs is
already non-vacuous for them, and they have no entry in either map.

One dependency still passes through to the live server unmocked: `AuthProvider`
(mounted app-wide, so every route pays this on mount) calls `GET
/xenon/api/auth/me`. It isn't hermetic in the literal sense, but it's stable —
with auth disabled the server always returns the same synthetic
`SUPER_ADMIN`/`auth-disabled` identity regardless of DB state — and no route
gates its row rendering on `me`, so it doesn't threaten the vacuous-pass
guarantee above.

Note `index.css` sets `body { overflow: hidden }`, so `document.scrollWidth`
always equals `innerWidth`. It cannot detect overflow. Measure element rects.
A centered flex row (`justify-content: center`) overflows both edges, so the
guard checks `rect.left < 0` as well as `rect.right > innerWidth`.

`web/test/sweep/controls.spec.ts` (`npm run test:sweep`, about 20 minutes) is
the control sweep. On every page it clicks each visible control with a real
mouse click on a fresh load, plus every control inside the menus and dialogs
they open, and fails if one does nothing or can't be clicked. It caught the
dead "Upload app" button (#274) and the account menu hidden behind the Devices
and Apps toolbars (#279). It runs against the live server but changes nothing:
writes and every `/control` request are answered in the browser, streams are
aborted, and device control uses a mocked device.

- A control counts as working if it causes a request, navigation, a DOM change
  to something the page wasn't already changing, a checked-state change, form
  validation, a dialog, file chooser, download, clipboard write or popup, or
  moves focus elsewhere.
- It explains the legitimate no-ops itself: an already selected tab or filter
  (it must expose `aria-selected`/`aria-pressed`/`aria-current`), a control
  under a full-screen overlay, a switch whose slider covers its input, and a
  label whose field already has focus. It skips `inert` content (the
  background of a modal dialog). Anything else needs an entry, with a reason,
  in `EXPECTED_NO_EFFECT`.
- Sign-in pages are swept as a signed-out visitor (`/auth/me` answers 401),
  since on an auth-disabled server `/login` redirects to the dashboard. Every
  route must still be at the requested path after loading, so a redirect can't
  quietly sweep a different page under another's name.
- A self-test injects a dead and a live button and checks that the dead one
  fails. Run the sweep before a release, not on every change.

CSS source lives in `web/src`, but the running server serves the built bundle
from `lib/public`. A CSS change is not live until `npm run build:xenon &&
npm run build:copy` (from the repo root) regenerates and copies it.

### Key Design Patterns

- **Dependency Injection** — TypeDI `@Service()` decorators; use `Container.get(...)` to retrieve singletons
- **Command Interception** — all Appium commands flow through `CommandInterceptor` before reaching the driver
- **Schema-driven config** — `schema.json` is the canonical source for all plugin CLI arguments; `npm run build:schema` regenerates the TypeScript `IPluginArgs` interface from it
- **Structured logging** — scoped loggers (`log.scope('Module')`) with automatic secret redaction

## Key Files

| File | Purpose |
|------|---------|
| `src/plugin.ts` | `XenonPlugin` class — Appium plugin lifecycle hooks |
| `src/index.ts` | Process signal handling and cleanup orchestrator |
| `src/interceptors/CommandInterceptor.ts` | Single chokepoint for all Appium commands; see "Command Interception Flow" above |
| `schema.json` | All plugin CLI arguments (JSON Schema Draft 7) |
| `prisma/schema.prisma` | Database schema; edit here then run `db:generate` |
| `src/services/healing/HealingOrchestrator.ts` | 6-tier healing entry point |
| `src/services/autowait/AutowaitService.ts` | Per-session implicit-wait config; runs before healing |
| `src/dashboard/event-manager.ts` | WebSocket broadcast hub |
| `src/device-managers/AndroidDeviceManager.ts` | ADB device discovery & control |
| `src/device-managers/IOSDeviceManager.ts` | simctl + ios-device control |
| `src/device-managers/ios/IOSStreamService.ts` | go-ios + WDA + iproxy lifecycle for live MJPEG |
| `src/device-managers/ios/IOSTunnels.ts` | One go-ios tunnel per iOS 17+ phone, on a port pair leased from the `tunnel` range; `envFor` gives a go-ios command its phone's `GO_IOS_AGENT_PORT` |
| `src/helpers/UniversalMjpegProxy.ts` | One-upstream-to-many-clients MJPEG fan-out with backpressure |
| `src/device-managers/android/ScrcpyServerSession.ts` | scrcpy-server lifecycle (push jar + `app_process` + `adb forward` + first-byte-gated connect) for the Android H.264 source |
| `src/app/routers/androidH264Config.ts` | Normalizes the `streaming.androidH264` flag union (`bool \| { source }`) to `{ enabled, source }` |
| `src/services/logcat/logcatParse.ts` | Pure `parseThreadtimeLine`; returns null for continuation lines, banners and malformed input. Infers the year logcat omits, in host-local time |
| `src/services/logcat/PackageResolver.ts` | PID → process name via `ps -A -o PID,NAME`. Negative cache, split `attemptedAt`/`loadedAt` clocks, never throws or blocks a log line |
| `src/device-managers/android/LogcatMultiplexer.ts` | One upstream → many clients, 2000-record replay, **per-client** drop accounting with a visible synthetic marker |
| `src/device-managers/android/LogcatStreamService.ts` | One `adb logcat -v threadtime -T 2000` child per device; idle watchdog, `killAllSync()` for the exit hook |
| `src/app/ws/logcatWs.ts` | Ticket + `evaluateDeviceAccess` at connect time; 1008 denies, 1012 on upstream death |
| `src/app/ws/upgradeRouter.ts` | One handler per WebSocket upgrade: Xenon's routes (H.264, logcat, adopted socket.io) first, everything else to Appium's listener, or Xenon's copy of it on Node < 22.21 |
| `src/services/device-access/ticketActorAccess.ts` | `makeTicketActorAuthorizer` — the WS's ownership decision, extracted so it is tested directly rather than through a copy in a spec |
| `web/src/components/device-control/logcat/logcatFilter.ts` | Pure filter grammar (`level:` minimum, `tag:`, `package:`, text, ANDed) plus `setLevelTerm` so the dropdown and the text box share one query |
| `web/src/components/device-control/logcat/useLogcatStream.ts` | Mints a ticket per connect, batches frames (React 17 does not auto-batch outside events), resets the buffer on reconnect **except** after 1012 |
| `src/gateway/sessionGateway.ts` | The session layer in front of Appium's routes: internal calls skip auth, per-command auth (or the hub token on a node), then a hub forwards remote sessions; remote DELETE runs the lifecycle |
| `src/gateway/internalCall.ts` | `/wd-internal` + the per-process secret header; one `next()` call site so a refused call answers exactly like an unknown route |
| `src/gateway/hubSessionToken.ts` | Hub-signed `x-xenon-hub-token` JWTs, verified by the node against the hub's JWKS: `xenon-node` per session for commands, `xenon-node-create` per create (owner, phone, node), `xenon-node-control` per forwarded `/control` call (user, admin, phone, node) |
| `src/app/ws/nodeSocketRelay.ts` | The H.264 and logcat sockets for another server's phone: a node ticket, the node's socket opened paused, relayed both ways with its close codes and end-to-end backpressure |
| `src/app/routers/nodePhoneControl.ts` | The gate in front of `/control`'s handlers for another server's phone: forward (`NODE_FORWARDED_CONTROL`), answer here (`ANSWERED_HERE`) or refuse with 501; a new action is refused until listed |
| `src/gateway/sessionLocator.ts` | Where a session runs: `SESSION_MANAGER`, then the open Session row and its phone's row; never its own routing table |
| `src/gateway/nodeSessionStatus.ts` | A node's `GET /xenon/api/node/sessions/:id` (hub token, no command, answered from the umbrella) and the hub's memory of which nodes lack it |
| `src/sessions/appiumUmbrella.ts` | Appium's umbrella as `createSession` last saw it; `hasSession` reads `sessionExists` without running a command |
| `src/gateway/nodeWebDriverUrl.ts` | A node's own base path from its public `GET /xenon/api/webdriver`, cached; the hub's is the fallback |
| `src/services/recording/RecordingOrchestrator.ts` | Per-device + composite recording lifecycle |
| `src/services/recording/manualLock.ts` | `manual_<actorId>_<udid>` lock format helpers |
| `src/middleware/authMiddleware.ts` | Populates `req.auth` (and `req.apiKey` on API-key paths) from the header pair or session cookie; `scopesForRole` maps a cookie role to its scopes |
| `src/middleware/deviceAccessGuard.ts` | Ownership guard on `/control` — method-scoped, with the mutation allowlist and `OWNERSHIP_CHECKED_READS` |
| `src/middleware/deviceTeamGuard.ts` | Team guard on `/control` — every request; a hidden phone is handed on as `HIDDEN_DEVICE_UDID` so it answers exactly like an unknown udid |
| `src/middleware/controlDevice.ts` | The one udid parser and per-request memoized device lookup both `/control` guards share; defines `HIDDEN_DEVICE_UDID` |
| `src/services/device-access/DeviceTeamResolver.ts` | udid → team for the live events, 5 s TTL cache, 2 s lookup timeout; `canSeeDeviceTeam` fails closed on an unknown phone |
| `src/services/device-access/deviceVisibility.ts` | Pure `isDeviceVisible(deviceTeamId, teamIds)` — the team rule; `teamIds === undefined` is the only admin |
| `src/services/device-access/appVisibility.ts` | `canSeeApp` / `visibleAppWhere` — uploaded apps follow the device team rule on `App.teamId` |
| `src/services/token/AppDownloadTicketService.ts` | Single-use, app-bound, 10-minute `?ticket=` for the driver's credential-less app download; audience `xenon-app-download` |
| `src/services/device-access/deviceAccessPolicy.ts` | Pure access decision + deny bodies + the shared `isSelfManualLock` / `isOwnSession` primitives |
| `src/services/device-access/SessionOwnerResolver.ts` | Session owner: prefers `Session.user_id`, falls back to `api_key_id → ApiKey.userId`. Caches **positive results only** — a null may mean the row isn't written yet, and caching it would deny the owner for the life of the process |
| `src/services/device-access/LiveSessionOwners.ts` | Owners of the sessions this server drives, while they run; read by `SessionOwnerResolver` before the database, so a node knows who owns the hub's sessions |
| `src/services/session/sessionIdentity.ts` | Pure `resolveSessionIdentity` — derives `{ apiKeyId, userId }` from the presented credential; ignores an unverifiable token rather than rejecting it |
| `src/services/session/xenonOptions.ts` | The one precedence rule for Xenon's options: `xe:options` over the `xenon:options` alias, field by field. Every reader of either namespace goes through `xenonOptionsOf` / `xenonOptionsIn` |
| `src/services/session/sessionCredentials.ts` | `takeSessionCredentials` reads the four secrets and strips them from every bucket in place, first thing in `prepareSession`; nothing puts them back |
| `src/services/session/nodeCreateCaps.ts` | `capsForNode`: the copy of a create a hub sends a node. No credentials, no lease id, the allocated phone pinned in `alwaysMatch` |
| `src/gateway/sessionCreate.ts` | `POST <basePath>/session` in the gateway: allocates, creates another server's phone's session and answers it, hands a local phone to the plugin; on a node, checks the hub's create token |
| `src/gateway/createHandoff.ts` | The allocation on its way from the gateway to `XenonPlugin.createSession`, through `AsyncLocalStorage`; taken once, or given back when the request ends |
| `src/services/device-access/actor.ts` | `resolveActor(req)` — the one place an identity is derived from a request |
| `src/app/routers/streamStartConflict.ts` | `stream/start`'s own conflict decision (proceed / reclaim orphan / deny) |
| `web/src/App.tsx` | Frontend root component and routing |
| `web/src/components/mosaic/DeviceMosaicView.tsx` | Live Devices / mosaic page entry point |

## Tech Stack

- **Runtime**: Node.js ≥ 14.17, TypeScript 5.5 (ES2016 target, decorators enabled)
- **Plugin base**: Appium 3.1.1 `BasePlugin`
- **Database**: SQLite + Prisma 5.4 ORM
- **DI**: TypeDI 0.10
- **Testing**: Mocha + Chai + Sinon (60s default timeout), NYC for coverage
- **Frontend**: React 17, Vite 5, Tailwind CSS, Socket.io-client
- **AI integrations**: `@anthropic-ai/sdk`, `@google/generative-ai`, `openai`
- **OCR**: Tesseract.js 7
- **Tracing**: OpenTelemetry 1.9
