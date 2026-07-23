# Android live streaming: scrcpy H.264 (continuous, hardware-encoded)

**Date:** 2026-07-23
**Status:** Design approved — pending implementation
**Area:** new `src/device-managers/android/AndroidH264StreamService.ts`, a WebSocket
video endpoint, and a new frontend player; existing MJPEG path retained as fallback.
**Follow-up to:** 1.8.2 (adb path), 1.8.3 (fast start), 1.8.4 (in-process encoder).

## Problem (measured)

Android live preview tops out at **~1 fps**. The capture loop takes a full
screenshot per frame via `adb exec-out screencap`; on a Pixel 5 over USB that is
**10.1 MB and ~1.3 s per frame** (second device ~1.4 s — not device-specific).
Device-side PNG (`screencap -p`) is ~1.2 MB but ~0.8–1.0 s because the device
spends the transfer savings on PNG encoding. The 1.8.3/1.8.4 fixes optimized
everything *around* frame acquisition; the acquisition itself is the wall.

Fixing this requires abandoning per-frame screenshots for a **continuous,
hardware-encoded H.264 stream** — what scrcpy does via Android `MediaCodec`.

## Goal

Smooth (~30 fps), low-latency Android **live preview** using scrcpy's H.264
stream, decoded in the browser, **without regressing** the MJPEG path or iOS.

### Non-goals

- **Recording.** Stays on the existing screencap→MJPEG→mp4 path (already ~1 fps
  from the same source, so no regression). Migrating recording to remux the H.264
  stream is a **phase 2** (see Coexistence).
- **iOS / tvOS.** Untouched — continues to use WebDriverAgent's MJPEG server.
- **Input injection.** Tap/swipe/type stay on the existing adb `input` path
  (`AndroidDeviceManager.tap/swipe/typeText`). scrcpy's control channel is out of
  scope (a possible later latency win).
- **Audio.** Not streamed.

## Decisions (locked)

1. **Acquisition:** the maintained **`@yume-chan/scrcpy`** ecosystem
   (`@yume-chan/adb`, `@yume-chan/adb-scrcpy`, `@yume-chan/scrcpy`) handles the
   scrcpy protocol in Node. The scrcpy **server binary** (`scrcpy-server`) is still
   bundled and pushed to the device; the library supplies the matching protocol.
2. **Rollout:** **feature-flagged, with MJPEG fallback.** Android uses H.264 when
   available and the browser supports it; otherwise it falls back to MJPEG. iOS
   stays MJPEG. Two Android player paths coexist during the transition.
3. **Scope:** **live-preview first.** Recording migration is phase 2.
4. **Browser decode:** **WebCodecs `VideoDecoder` → `<canvas>`** (low latency, well
   supported in the dashboard's Chrome-class target). MSE/fMP4 is the fallback idea
   if WebCodecs proves insufficient, but is not implemented in phase 1.
5. **Transport host→browser:** an authenticated **WebSocket** carrying H.264
   access units, reusing the existing single-use **stream-ticket** auth (`?ticket=`).

## Architecture

```
device (MediaCodec H.264)
  → scrcpy-server  ──adb socket──►  AndroidH264StreamService (Node, @yume-chan)
      → H264Multiplexer (one upstream → many clients; config + keyframe-gated join)
        → WebSocket  /xenon/api/control/:udid/stream/h264?ticket=…
          → browser: WsH264Player (VideoDecoder → canvas)
```

### Backend: `AndroidH264StreamService`

Parallel to `AndroidStreamService` (do **not** overload it — H.264 has a different
lifecycle and output contract). Responsibilities:

- **Start:** resolve the device's adb (reuse
  `AndroidDeviceManager.getAdbForDevice(udid)` for the executable/host — same
  resolution the rest of Xenon uses), connect via `@yume-chan/adb`, push
  `scrcpy-server` and start it via `@yume-chan/adb-scrcpy` with options:
  `videoCodec=h264`, `maxSize=720` (matches today's downscale), `maxFps=30`,
  `videoBitRate≈3–4 Mbps`, audio disabled, control disabled.
- **Consume:** read the scrcpy video stream — a **config packet** (SPS/PPS) followed
  by **frame packets** (keyframe flag + PTS). Keep the latest config and the last
  keyframe-anchored position.
- **Fan out:** `H264Multiplexer` (mirrors `UniversalMjpegProxy`'s one-upstream/
  many-clients + backpressure design): on new client, send the current SPS/PPS
  config, then start delivery **at the next keyframe** (request an IDR if the lib
  supports it; otherwise wait for the periodic one). Drop clients whose socket
  backlog exceeds a bound (same OOM guard as the MJPEG proxy).
- **Lifecycle:** idle-out watchdog after N minutes with zero viewers (unless the
  device is busy), symmetric with `AndroidStreamService`. Manual-lock semantics
  (`manual_<actorId>_<udid>`) unchanged — the H.264 start path takes the same lock
  as MJPEG.

### Transport: WebSocket video endpoint

- `GET /xenon/api/control/:udid/stream/h264` upgraded to WebSocket. Auth: the
  existing single-use **stream ticket** (`?ticket=`), same mechanism the webview
  MJPEG path uses; validate the ticket and the caller's lock/scope before relaying.
- **Wire format:** binary frames = small header (type: `config` | `key` | `delta`,
  PTS, length) + H.264 bytes. Config carries SPS/PPS so a late joiner can configure
  its decoder.

### Frontend: `WsH264Player`

- New component used by `DeviceTile` when the stream type is H.264. Opens the WS,
  reads config → `VideoDecoder.configure({ codec: 'avc1.…', description })`, decodes
  `EncodedVideoChunk`s (key/delta), and renders each `VideoFrame` to a `<canvas>`
  via `drawImage` (then `frame.close()`). Canvas resizes to the frame's dimensions,
  so **rotation is handled by re-sizing** — no special case.
- Coordinate mapping for taps/overlays maps canvas-rendered size ↔ device
  `screenWidth/screenHeight`, exactly as the `<img>` does today; `AnnotationOverlay`
  sits on top unchanged.

### Player selection & feature flag

- Backend advertises a per-device **stream type** on `GET
  /…/stream/status` (`type: 'h264' | 'mjpeg'`), decided by: platform (iOS→mjpeg),
  the feature flag, and whether scrcpy started successfully.
- `DeviceTile` chooses the player: **iOS → MJPEG `<img>`**; **Android → H.264 canvas
  when** the flag is on **and** `window.VideoDecoder` exists **and** the backend
  reports `h264`; **otherwise MJPEG `<img>`** (existing `stream-retry` path).
- Flag: a `pluginArgs.streaming.androidH264` (schema-driven) — **default OFF** for
  the first release (opt-in), flip to default-on after field validation.

## Coexistence with recording (phase-1 rule)

Recording still uses the screencap→MJPEG capture (`RecordingOrchestrator` reads
`dev.mjpegServerPort`). To avoid running two capture pipelines against one device:

> **A device that is recording uses the MJPEG path for preview too.** H.264 preview
> applies only when the device is not recording. When recording stops, preview may
> return to H.264.

This keeps phase 1 simple and never regresses recording (which is ~1 fps today
regardless). **Phase 2** migrates recording to remux the H.264 access units to mp4
(cheaper than MJPEG→mp4 and real fps), at which point this rule is removed.

## Dependencies

- Add `@yume-chan/adb`, `@yume-chan/adb-scrcpy`, `@yume-chan/scrcpy` (host).
- Bundle the matching `scrcpy-server` binary (vendored like go-ios;
  pinned to the library's supported protocol version). Document the pin and the
  update procedure.
- Frontend: no new dep — WebCodecs is a browser API.

## Error handling & fallback

- scrcpy fails to start / device unsupported / stream errors → service reports
  `type: 'mjpeg'` for that device so the tile uses MJPEG. Log once per device.
- Browser lacks WebCodecs, or `VideoDecoder.configure`/decode throws → the player
  emits an error the tile catches and swaps to the MJPEG `<img>` (same
  `stream-retry` fallback), so a user never sees a dead tile.
- WebSocket drop → client reconnects, re-requests a keyframe on rejoin.

## Testing

- **Backend unit:** `H264Multiplexer` — a new client receives the current SPS/PPS
  config and then frames starting at a keyframe (not mid-GOP); a client exceeding
  the backlog bound is dropped. scrcpy **option builder** produces the expected
  flags. Stream-type selection (`iOS→mjpeg`, flag off→mjpeg, flag on + started→h264).
- **Frontend unit:** player-selection logic (platform × WebCodecs presence ×
  backend type). The `VideoDecoder` render loop gets a smoke test fed a small
  captured H.264 sample (SPS/PPS + one IDR) asserting a `VideoFrame` is produced.
- **Manual / perf (the payoff):** on a real Pixel 5, measure **fps and glass-to-glass
  latency** H.264 vs MJPEG, single and several concurrent devices; confirm host CPU
  is dominated by byte relay (not encoding). Record numbers in the PR.
- **Fallback drills:** force scrcpy failure and WebCodecs-absent; confirm the tile
  silently uses MJPEG.

## Rollout & versioning

- Ships as a **minor (1.9.0)** — notable feature, new deps, bundled binary,
  frontend change — **feature-flagged OFF by default**. Enable per deployment,
  validate, then consider default-on in a later release.
- Reversible: flag off → pure MJPEG behavior; the new service/endpoint/player are
  inert.

## Risks

- **WebCodecs coverage.** Chrome/Edge/recent Safari support `VideoDecoder`; the
  dashboard targets laptop Chrome-class browsers. MJPEG fallback covers the rest.
- **scrcpy-server ↔ library version pin.** The bundled binary must match the
  `@yume-chan/scrcpy` protocol version; document and test the pin on upgrades.
- **Device/encoder quirks.** Some devices' `MediaCodec` output is finicky
  (rotation, odd resolutions); fallback + `maxSize` mitigate. Validate across the
  lab's device mix.
- **New-joiner latency.** A late client waits for the next IDR; tune scrcpy's
  keyframe cadence / request an IDR on join to bound it.
- **Two Android player paths** during the flagged transition — accepted cost of a
  safe rollout; removed if/when H.264 becomes the Android default and MJPEG is
  retired.
- **Security.** The WS must enforce the stream ticket + device-lock ownership just
  like the REST/MJPEG paths; a raw video socket must not become an unauthenticated
  side door.
