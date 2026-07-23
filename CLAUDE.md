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

Run a single test file (`.mocharc.json` already wires up `ts-node/register`):
```bash
npx mocha test/unit/your-test.spec.ts
```

Run a single test by name (mocha grep):
```bash
npx mocha test/unit/recording-orchestrator.spec.ts -g "happy path"
```

Tests that import `CommandInterceptor` or anything that pulls in `SessionManager` need `import 'reflect-metadata'` at the top — TypeDI Container.get is invoked at module-load time and will throw `_a.getMetadata is not a function` without it.

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

A Xenon hub instance can orchestrate remote Xenon node instances. `NodeDevices.ts` handles node registration; `RemoteSession.ts` forwards commands to the appropriate node.

### Device Streaming (`src/device-managers/{ios,android}/*StreamService.ts`)

Independent of Appium sessions, each platform has a stream service that brings up an MJPEG feed for live preview / recording:

- **iOS**: `IOSStreamService` shells `go-ios` to start a tunnel (iOS 17+), launches WebDriverAgent via `runwda`, and forwards local ports `wdaPort:8100` and `mjpegPort:9100` with `iproxy`. WDA's MJPEG server is enabled via `/appium/settings`. Stream sessions are tracked in `this.sessions` with a watchdog that idles out streams after 10 min of zero viewers (unless the device is busy with an Appium session).
- **Android**: `AndroidStreamService` uses ADB + a built-in capture pipeline (MJPEG). A faster, flagged **H.264 live-preview** path also exists — see "Android H.264 live preview (scrcpy)" below.

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

`VideoPipelineService` is hardware-accelerated (`h264_videotoolbox` on Mac, `libx264` elsewhere) and writes fragmented mp4 (`frag_keyframe+empty_moov+default_base_moof`) for instant playback / crash resiliency.

### Network Interception (`src/services/interceptor/`, `InterceptorService.ts`)

Android-only in v1. Sessions opt in via any of the capability shapes accepted by `pluginArgs.interceptor.enabled` — see the schema description for the full alias list. Once enabled, an MITM proxy captures requests/responses (capped by `bufferSize`), and `xenon: addMock` / `removeMock` / `clearMocks` / `getRequests` / `getMocks` / `exportHar` execute scripts manipulate per-session state. HAR export is the canonical way to ship captured traffic to clients.

### Identity & Manual Locks

Authentication: every `/xenon/api` request is gated by `authMiddleware` (`src/middleware/authMiddleware.ts`), which accepts either the (`x-xenon-access-key`, `x-xenon-token`) header pair or the `xenon_dashboard_session` cookie — a `UserSession` id, with a legacy raw-API-key fallback. It also accepts a hub-issued RS256 JWT as `Authorization: Bearer` (audience `xenon-rest`, minted by `POST /auth/token`, validated against the hub's JWKS) — the same middleware, a third credential path with a live user lookup so REST revocation is instant. It always sets `req.auth = { kind, userId, role, scopes, teamIds, rateLimit, … }`; `req.apiKey = { id, scopes, teamId, rateLimit }` is additionally set on the API-key paths only, never for cookie user-sessions. A raw API key can be exchanged for the cookie via `POST /auth/dashboard-session`, but only for SUPER_ADMIN owners. `scopeGuard(['devices'])` and `mutationScopeGuard(['devices'])` (mutations only — GETs always pass) enforce scope-based access on routers like `/control`.

When the dashboard takes a soft lock on a device for live preview or recording, the `device.session_id` is written as `manual_<actorId>_<udid>` (encoded by `formatManualLock` in `src/services/recording/manualLock.ts`). All readers — `BusyPrecheck`, the `/stream/stop` route, the picker UI — call `inspectManualLock(blockId, actorId, udid)` to distinguish *self* from *another user* from *legacy `manual_<udid>`*. Locks owned by a different user can only be force-released by an admin-scope key.

Device leases: programmatic clients (SDK, MCP tools) claim devices via
`POST /xenon/api/sdk/leases` (`src/services/lease/LeaseService.ts`) — token-bound
claims with TTL + heartbeat, swept by `LeaseOrphanSweeper`, resolved at
allocation via the `xenon:options.leaseId` capability. Prefer leases over
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

### Frontend (`web/`)

React 17 + Vite + Tailwind CSS dashboard. Talks to the backend over REST and Socket.io. Built artifacts are copied into `src/public/` and served as static files by the plugin server.

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

Coverage boundary — all 15 routes in the matrix are now **hermetic**. The 11
data-heavy routes (overview, devices, builds, builds/:buildId, apps,
selector-health, selector-health/detail, teams, users, api-keys, notifications)
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
| `src/helpers/UniversalMjpegProxy.ts` | One-upstream-to-many-clients MJPEG fan-out with backpressure |
| `src/device-managers/android/ScrcpyServerSession.ts` | scrcpy-server lifecycle (push jar + `app_process` + `adb forward` + first-byte-gated connect) for the Android H.264 source |
| `src/app/routers/androidH264Config.ts` | Normalizes the `streaming.androidH264` flag union (`bool \| { source }`) to `{ enabled, source }` |
| `src/services/recording/RecordingOrchestrator.ts` | Per-device + composite recording lifecycle |
| `src/services/recording/manualLock.ts` | `manual_<actorId>_<udid>` lock format helpers |
| `src/middleware/authMiddleware.ts` | Populates `req.auth` (and `req.apiKey` on API-key paths) from the header pair or session cookie |
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
