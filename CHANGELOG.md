# Changelog

All notable changes to `@xenon-device-management/xenon` (the Appium hub plugin).

This project follows [Semantic Versioning](https://semver.org/). Releases are
published to npm automatically when `package.json`'s `version` changes on `main`
(see `.github/workflows/npm-publish.yml`).

## 1.12.0

Minor release: a retention policy for Live Devices recordings — the one asset
class nothing ever removed. Minor rather than patch because this is the first
version that **deletes recordings on a schedule**; every earlier release kept
them forever.

### Added

- **Recording retention and orphan sweep** — `CleanupService` covers Builds and
  Sessions (`session.video_recording` is the Appium session video, a different
  model), and there is no `DELETE` route for recordings, so the tree grew without
  bound. On one developer machine it had reached 313 MB across 78 directories,
  the oldest three months past the 30-day build window, with **265 MB of it
  unreachable** — directories no DB row pointed at, left behind by failed starts.
  A third phase now runs on the existing `buildCleanupSchedule` cron: expire rows
  by age and count, then sweep directories no surviving row can reach. Expiring
  first leaves those directories unreachable, so one pass reclaims both.
  Reachability is decided by `file_path`, never by directory name — only 35 of 39
  rows on that machine were named after their own id.

### Changed

- New plugin args, shaped like their build counterparts:
  `recordingCleanupDays` (30), `recordingCleanupMaxCount` (100), and
  `recordingFailedCleanupDays` (2) — a failed recording holds no playable file,
  so it need not linger as long as real footage.
- **Recordings are now deleted automatically.** Nothing was ever removed before,
  so this changes behaviour on existing installs: raise `recordingCleanupDays`,
  or set it very high, if recordings are retained as evidence. In-flight
  recordings are excluded from both rules, and the sweep refuses to run if the
  `Recording` table read returns no rows while directories exist.

## 1.11.2

Patch release: what a real device disconnected mid-recording turned up. The
1.11.1 fix worked, but it stopped one step short — and it made two dormant
recording-bookkeeping gaps reachable.

### Fixed

- **A device that stopped answering served a frozen frame indefinitely** — the
  reuse health check in 1.11.1 tested whether a frame *existed*, not whether it
  was recent, and `latestFrame` is only ever assigned. The capture loop swallows
  capture errors without changing the session status, so a device that went away
  (unplugged, adb killed, reboot) left the MJPEG server rewriting the last good
  JPEG every 60ms: a frozen preview, and a recording that `ffprobe` calls
  perfectly healthy and which is a still photograph. That is worse than the
  0-byte failure 1.11.1 addressed, because it looks valid. Capture health is now
  measured as how long the device has been silent — time, not a failure count,
  since a fast `ADB Exit` and a 15s `ADB Timeout` are very different amounts of
  frozen video. Past a 10s grace window the session is refused for reuse and
  stream clients are disconnected, so ffmpeg finalises the footage it actually
  captured. Verified on hardware by disconnecting a device mid-recording: the
  frozen tail is bounded to the grace window instead of running until someone
  presses Stop.
- **A stalled device could still go unlogged** — the warning for the above was
  emitted from the capture loop, but disconnecting clients is precisely what
  idles that loop, so the failure that would have crossed the threshold never
  happened. Measured on the device: 10 failures spanning 9.214s against a 10s
  threshold, then silence. Either path now claims the announcement, so a stall is
  logged exactly once no matter which notices it first.
- **A recording stayed `RECORDING` when its ffmpeg exited on its own** — nothing
  reconciled the row, so it kept no `ended_at`, duration or size until a manual
  Stop, or until a server restart marked it `FAILED`. This was near-unreachable
  before — ffmpeg only exited early if it crashed — and the stall fix above makes
  a clean early exit a designed outcome. The row is now finalized from the exit
  (`fail_reason=source_ended`, so a short recording is visible as such rather
  than silently truncated), and the file gets the faststart remux the normal stop
  path performs.
- **Recording duration was wall-clock, not video** — `duration_ms` measured the
  time between start and Stop, which matches the file only while capture keeps
  up. A disconnected device produced 335964ms for a 35.16s mp4, and the same
  number fed the recording-duration metric and the proof-bundle manifest. The
  finished file is now probed (via the bundled ffmpeg — there is deliberately no
  `ffprobe` dependency), falling back to wall-clock when it cannot be read.
  Nothing is lost: wall-clock remains derivable from `started_at` and `ended_at`.

## 1.11.1

Patch release: the Android counterpart to the stale-stream-session fixes that
1.11.0 made on the iOS side.

### Fixed

- **Android preview and recording could be handed a stream port that serves
  nothing** — `startStream` reused any session marked `running` *or* `starting`
  without checking that anything was still serving it. A session whose HTTP server
  had closed, or one that went live without ever capturing a frame (startup warns
  after a 5s first-frame wait and continues anyway), was therefore reused
  indefinitely: ffmpeg exited 1 against the port and left a 0-byte mp4 — the same
  silent symptom as the 1.11.0 promise-map fix, reached by a different route.
  Reuse now requires the session to be `running`, its own server to still be
  listening, and at least one frame to have been captured; anything else is torn
  down and restarted. `GET /:udid/stream` kept a second copy of the same
  short-circuit, so it now routes through `startStream` as well — the Android
  analogue of the iOS route fix in 1.11.0.

## 1.11.0

Minor release: iOS live-streaming reliability, including the root-cause fix for
WebDriverAgent being terminated a few minutes after launch.

### Fixed

- **WebDriverAgent terminated minutes after launch (iOS 17+)** — the vendored
  go-ios was pinned at v1.0.134, which does not keep the XCTest session alive.
  iOS terminates the runner while the host-side `runwda` process stays alive with
  `exitCode === null`, so nothing on the host notices and it presents as a hang.
  Isolated by holding one WebDriverAgent build constant and varying only the
  launcher: v1.0.134 died at 2m51s, `xcodebuild` survived 11m+, v1.2.1 survived
  12m+. Note the version bump alone would not have reached existing installs —
  the installer's cache check was version-blind — so it now records the installed
  version and upgrades in place.
- **iOS preview stuck on "Connection Failed" until a manual stop or restart** — a
  `UniversalMjpegProxy` that exhausted its reconnect budget stayed in the
  per-device cache, and because the upstream URL was unchanged it was reused
  indefinitely, short-circuiting every request to 503 even after the device
  recovered. Stopped proxies are now evicted and recreated.
- **A dead WDA went undetected for up to an hour** — `GET /:udid/stream` reused any
  session marked `running` without checking it, so recovery waited on the hourly
  watchdog. The stream path now health-checks before reuse and restarts on demand.
- **Android recordings silently produced 0-byte files until a server restart** —
  `startStream` registered its in-flight promise *after* invoking the task while
  releasing the key from inside the task's own `finally`. On the early-return path,
  which never awaited, the release ran before the registration and left a settled
  promise stuck in the map, so every later call returned a stale port for the life
  of the process. Both stream services now dedupe through a `SingleFlight` helper
  in which the release cannot precede registration.
- **Perpetual empty-diff churn on the committed Prisma client** — `@prisma/client`
  ships some runtime `.d.ts` files with CRLF while the client is committed as LF,
  so every `prisma generate` rewrote them. Generated output is normalised to LF and
  the freshness check now compares EOL-insensitively.

### Changed

- Vendored go-ios pinned to **v1.2.1** (was v1.0.134); the installer records the
  installed version in `.go-ios-version` so existing caches upgrade rather than
  being skipped.

## 1.10.5

Patch release: Live Devices recording reliability and video-only downloads.

### Fixed

- **Empty / unplayable mosaic recordings** — ensure MJPEG is running before ffmpeg
  (stop Android H.264 preview when needed); persist orchestrator recording IDs in
  the DB so Stop targets the correct ffmpeg; avoid macOS `taskpolicy` Economy wrap
  that broke VideoToolbox; remux to standard faststart mp4 on stop.
- **Composite download gate** — only offer side-by-side when the server actually
  started a composite.

### Added

- **Video-only downloads** — `GET /recordings/:groupId/video.mp4` and
  `GET /recordings/:groupId/videos.zip` (mp4 files only; proof bundle remains for
  API clients).
- **Live Devices recording UX** — elapsed `REC` timer, Starting/Stopping states,
  clearer Record N devices label, success/error banners, Download video /
  Download videos / Side-by-side actions.

## 1.8.1

Patch release: two real-device iOS / session-lifecycle fixes found while
verifying the hosted-MCP lab path end-to-end on real Android and iOS hardware.

### Fixed

- **Real-device iOS sessions** — `injectWDAUrl` wrote the WebDriverAgent
  capabilities (`webDriverAgentUrl`, `usePreinstalledWDA`, `updatedWDABundleId`)
  into **both** the W3C `alwaysMatch` and `firstMatch[0]` objects. The spec
  forbids a capability appearing in both, so appium-xcuitest rejected every
  real-device iOS session with "property 'webDriverAgentUrl' should not exist on
  both primary and secondary object" — even though WebDriverAgent itself
  launched fine. The injected WDA caps are now written to exactly one bucket.
  (#160)
- **Device stuck `busy` after a thrown session create** — when the driver's
  `createSession` (or the remote forward) **threw**, the device allocated for
  the session was left stuck `busy: true` with no session, unavailable until the
  hub restarted: the throw skipped both `finalizeSession` and
  `handleSessionFailure` (the latter only unblocks when `createSession`
  *returns* an error object, not when it throws). The session-creation block now
  releases the device on any thrown error before rethrowing. (#161)

## 1.8.0

First release since 1.7.10, covering 11 merged PRs. The headline is **hosted-MCP
support**: everything Xenon Studio's lab mode needs (granular MCP scopes, session
tokens, audit ingest, MCP plugin endpoints) is now available from a published
version instead of only from `main`.

### Added

- **Hosted MCP support** — the `xenon-mcp` token audience is accepted on the REST
  bearer path so MCP plugin tool calls authenticate, plus the MCP plugin
  endpoints themselves. (#152, #153)
- **Granular MCP scopes** — flat→granular scope mapping with a least-scope
  default; `xenon-mcp` tokens carry granular `scope`/`roles` claims alongside a
  down-mapped flat `scopes` claim, so a token's REST reach never exceeds its MCP
  grant. (#153)
- **Session tokens (R9)** — `/auth/token` mints a short-lived `xenon-session`
  token alongside the `xenon-mcp` one, and `createSession` gained an opt-in
  `xenon:options.sessionToken` gate that closes the direct-to-Appium bypass.
  Off by default. (#153)
- **Capability flags** — `/capabilities` advertises `mcpScopedTokens` and
  `sessionTokenGate` so clients can detect support. (#153)
- **Audit ingest** — `POST /xenon/api/audit/events` feeds `EventLogService`
  (`mcp_audit` events), for gateway authz decisions. (#153)
- **Healing APIs** — `GET /healing/selector-health` (hotspots + etalon age), a
  `sessionId` filter on `GET /healing/events`, and an
  `xenon:options.healingTiers` tier-policy gate in `HealingOrchestrator`. (#152)
- **Socket bearer auth** — the Socket.IO handshake accepts a hub-issued bearer
  JWT as a dashboard principal. (#151)

### Fixed

- **iOS shared-stream device lock** — a manual stream lock (`manual_<actor>_<udid>`)
  no longer overwrites a live Appium session's `session_id`, which previously made
  session teardown fail to release the device (leaving it stuck `busy: true`) and
  caused the health monitor to skip reclamation. Session teardown now also stops an
  idle session-owned stream (when no one is watching) instead of letting it linger.
  (#157 — closes #149, #150)
- **Slow session creation** — the device-availability wait now polls every **1s**
  instead of 10s, so a create waiting on a briefly-busy device proceeds within ~1s
  of it freeing rather than quantizing into 10s chunks. (#155)
- **Lease port allocation** — hub node-pair credentials are wired into
  `LeaseService`'s port allocator. (#154)
- **Token minting** — `/auth/token` validates that `scopes` is an array before
  minting, returning a clean 400 instead of failing opaquely. (#153)
- **Recordings** — bearer principals can start recordings (`req.auth.userId`
  fallback). (#152)
- **mac-app hang diagnostics** — app shutdown is no longer reported as a GPU
  crash, and normal suspension no longer trips the hang detector. (#145, #148, #156)

### Changed

- **mac-app** — Electron 33 → 43. (#146)
- Added a load-guard test for the log batcher. (#147)

## 1.7.10 and earlier

Not tracked in this file — see the git history and PR list.
