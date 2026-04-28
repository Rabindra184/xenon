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

Run a single test file:
```bash
npx mocha --require ts-node/register test/unit/your-test.spec.ts
```

Run a single test by name (mocha grep):
```bash
npx mocha --require ts-node/register --timeout 30000 test/unit/recording-orchestrator.spec.ts -g "happy path"
```

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

### 5-Tier Self-Healing (`src/services/healing/`)

When `findElement` fails, `HealingOrchestrator` tries five escalating strategies:
1. **Native** — retry with original selector
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
- **Android**: `AndroidStreamService` uses ADB + a built-in capture pipeline.

`UniversalMjpegProxy` (`src/helpers/UniversalMjpegProxy.ts`) multiplexes a single upstream MJPEG to many browser clients. It speaks both standard HTTP MJPEG and a raw-socket fallback for WDA's headerless variant, drops lagging clients (>4 MB kernel backlog) to prevent OOM, and uses bounded retries with exponential backoff (max 10 attempts, 500ms→10s).

The browser-facing URL is always `/xenon/api/control/:udid/stream` (proxy URL). Hitting it auto-starts the underlying stream service if the device is iOS — the GET handler dedupes concurrent starts via `IOSStreamService.startPromises`.

### Recording Subsystem (`src/services/recording/`)

Live recordings are independent of Appium "session video" — the mosaic page can record any device that has an active stream service.

- `RecordingOrchestrator.start({ udids, actorId })` spawns one ffmpeg per device (writing per-device mp4) and, for ≥2 devices, a single composite ffmpeg that scales+pads each MJPEG input into a uniform cell and stacks them with `hstack`/`xstack`. Composite output is at `compositeOutputPath(groupId)` = `${recordingsAssetsPath}/_groups/<id>/composite.mp4`.
- `BusyPrecheck` does an atomic multi-UDID check before any side effect, so a partial group is never created.
- `ConcurrencyGate` enforces a server-wide `maxConcurrentRecordings` cap.
- `ProofBundleService` streams a zip with manifest, README, per-device `video.mp4`/`bookmarks.json`/`annotations.json`/`device.json`, and the composite mp4 if present.
- `recoverOnBoot()` marks any orphan `RECORDING` rows from a previous process as `FAILED` with `fail_reason=server_restart` and releases their manual blocks.

`VideoPipelineService` is hardware-accelerated (`h264_videotoolbox` on Mac, `libx264` elsewhere) and writes fragmented mp4 (`frag_keyframe+empty_moov+default_base_moof`) for instant playback / crash resiliency.

### Identity & Manual Locks

API-key authentication: every dashboard request is gated by `apiKeyMiddleware` which sets `req.apiKey = { id, scopes, teamId, rateLimit }`. The same key can be exchanged for a `xenon_dashboard_session` cookie via `POST /auth/dashboard-session`. `scopeGuard(['devices'])` and `mutationScopeGuard(['devices'])` (mutations only — GETs always pass) enforce role-based access on routers like `/control`.

When the dashboard takes a soft lock on a device for live preview or recording, the `device.session_id` is written as `manual_<actorId>_<udid>` (encoded by `formatManualLock` in `src/services/recording/manualLock.ts`). All readers — `BusyPrecheck`, the `/stream/stop` route, the picker UI — call `inspectManualLock(blockId, actorId, udid)` to distinguish *self* from *another user* from *legacy `manual_<udid>`*. Locks owned by a different user can only be force-released by an admin-scope key.

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
| `schema.json` | All plugin CLI arguments (JSON Schema Draft 7) |
| `prisma/schema.prisma` | Database schema; edit here then run `db:generate` |
| `src/services/healing/HealingOrchestrator.ts` | 5-tier healing entry point |
| `src/dashboard/event-manager.ts` | WebSocket broadcast hub |
| `src/device-managers/AndroidDeviceManager.ts` | ADB device discovery & control |
| `src/device-managers/IOSDeviceManager.ts` | simctl + ios-device control |
| `src/device-managers/ios/IOSStreamService.ts` | go-ios + WDA + iproxy lifecycle for live MJPEG |
| `src/helpers/UniversalMjpegProxy.ts` | One-upstream-to-many-clients MJPEG fan-out with backpressure |
| `src/services/recording/RecordingOrchestrator.ts` | Per-device + composite recording lifecycle |
| `src/services/recording/manualLock.ts` | `manual_<actorId>_<udid>` lock format helpers |
| `src/middleware/apiKeyMiddleware.ts` | Populates `req.apiKey` from header or session cookie |
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
