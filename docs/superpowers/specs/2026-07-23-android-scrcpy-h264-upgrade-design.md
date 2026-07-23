# Android live streaming: scrcpy capture upgrade (minimal bundled jar)

**Date:** 2026-07-23
**Status:** Design approved — pending implementation
**Area:** `src/device-managers/android/AndroidH264StreamService.ts` (swap the capture
source) + a new `ScrcpyServerSession` helper + a vendored `scrcpy-server` jar.
**Follow-up to:** 1.9.0–1.9.2 (Android H.264 live preview, `screenrecord` source).
**Parent spec:** [2026-07-23-android-h264-streaming-design.md](2026-07-23-android-h264-streaming-design.md)

## Problem (measured, shipped)

The shipped H.264 feature replaced the ~1 fps screencap loop with a continuous
`adb screenrecord --output-format=h264` stream, validated end-to-end on a Pixel 5.
Two `screenrecord`-source limitations remain (documented in the parent spec):

1. **First-client cold start ~6–9s on a static screen.** MediaCodec holds encoder
   output until content changes, and `screenrecord` gives us no way to force an
   initial IDR. The first viewer stares at a blank tile until the first keyframe.
2. **~3-min restart hiccup.** `screenrecord`'s `--time-limit` cap forces a respawn;
   the stream freezes for the reconnect.

Both are inherent to `screenrecord`. scrcpy's server configures the `MediaCodec`
encoder to **emit an initial keyframe immediately** and streams **continuously with
no cap**, removing both limitations.

## Goal

Replace the Android H.264 **capture source** with scrcpy — near-instant first frame,
no periodic restart hiccup — **without regressing** the shipped pipeline, the MJPEG
fallback, iOS, or recording. Integrated **minimally**: no new npm dependency, reusing
the existing NAL parser / multiplexer / WebSocket / WebCodecs player.

### Non-goals

- **@yume-chan / any scrcpy npm library.** Rejected in v1 as too heavy (ESM-only, 3
  packages, jar↔library version alignment). We drive the scrcpy **server** directly.
- **scrcpy control channel.** Tap/swipe/type stay on the existing adb `input` path
  (`AndroidDeviceManager.tap/swipe/typeText`). `control=false`.
- **Audio.** `audio=false`.
- **Recording, iOS, the WS transport, the WebCodecs player, the feature flag's role.**
  Unchanged — this swaps only the packet producer.

## Why this is surgical

The shipped feature made the **capture source swappable by design**. Everything
downstream of `AndroidH264StreamService.openCapture()` is source-agnostic:
`H264NalParser`, `H264Multiplexer`, the authenticated WS endpoint
(`/xenon/api/control/:udid/stream/h264?ticket=`), `WsH264Player`, `pickStreamPlayer`,
`resolveStreamType`, and the MJPEG fallback. This upgrade touches only the producer.

## Decisions (locked)

1. **Integration: minimal bundled jar, no npm library.** Vendor
   `scrcpy-server-<version>.jar`; push it with Xenon's **already-resolved adb** (the
   1.8.2 GUI-PATH-trap fix — never a bare `adb`); start it via `app_process`; read its
   video socket.
2. **Raw stream mode → existing parser, unchanged.** Start scrcpy with
   `send_frame_meta=false`, so the server emits a **raw Annex-B H.264 byte stream**
   whose shape is **identical to `screenrecord`'s stdout**. It feeds straight into the
   existing `H264NalParser` (which already derives config/key/delta from NAL types) with
   **zero parser changes**. scrcpy's per-frame metadata is available (`=true`) as a
   future option but not needed here.
3. **Source selectable for rollback.** The `streaming.androidH264` flag value grows to
   accept an optional source (see Config). `true` means **scrcpy** (new default);
   `{ source: 'screenrecord' }` keeps the shipped path intact as a code-level rollback
   with no revert. Automatic runtime fallback (scrcpy fails → MJPEG) is unchanged.
4. **Transport socket: `adb forward` + `tunnel_forward=true`.** The server listens on a
   device `localabstract` socket; the host connects through an `adb forward` local TCP
   port. (Forward, not reverse — simpler host-side; no host listener to manage.)

## Architecture

```
device (MediaCodec H.264, initial keyframe forced, no cap)
  → scrcpy-server (app_process, video-only)  ──localabstract socket──►
      adb forward tcp:N  →  net.Socket  →  H264NalParser  (UNCHANGED)
        → H264Multiplexer → WebSocket → WsH264Player       (ALL UNCHANGED)
```

### Backend: `ScrcpyServerSession` (new helper)

One responsibility: own a scrcpy-server instance for one udid and expose a readable
byte stream of raw Annex-B H.264. Owns nothing about multiplexing or NAL semantics.

**Lifecycle:**
1. **Resolve adb** via `AndroidDeviceManager.getAdbForDevice(udid)` →
   `{ adbPath, hostArgs }` (reuse the existing resolution the 1.8.2 fix added).
2. **Push jar:** `adb push <vendored jar> /data/local/tmp/scrcpy-server-<ver>.jar`
   (idempotent; skip if already present with the right size).
3. **Start server** (long-lived child):
   `adb [-s udid] shell CLASSPATH=/data/local/tmp/scrcpy-server-<ver>.jar app_process /
   com.genymobile.scrcpy.Server <ver> tunnel_forward=true audio=false control=false
   video=true video_codec=h264 max_size=<M> video_bit_rate=4000000 max_fps=30
   send_device_meta=false send_codec_meta=false send_frame_meta=false
   send_dummy_byte=true cleanup=true`
   (Exact arg **names are version-specific — verified against the vendored scrcpy
   2.7 jar's dex.** All three meta channels off → pure Annex-B; the explicit
   dummy byte is the tunnel_forward readiness byte the reader skips.)

   > **`max_size` is a single integer capping the device's *longer* edge, aspect
   > preserved — not `screenrecord`'s width-capped `WxH` string.** A hard-coded
   > `max_size=720` would over-shrink a portrait phone (on 1080×2340 it caps the 2340
   > side → ~332px wide). To match today's ~720-wide downscale, `<M>` comes from a new
   > `resolveScrcpyMaxSize(udid)` that derives the longer-edge cap so the *shorter* edge
   > lands near 720 (e.g. 1080×2340 → `max_size≈1560`). It sits beside the existing
   > `resolveCaptureSize` (which stays for the `screenrecord` source); neither is
   > reused for the other source.
4. **Forward + connect:** `adb forward tcp:0 localabstract:scrcpy` → parse the assigned
   local port → `net.connect(port)`. On `tunnel_forward=true` the server sends a single
   readiness **dummy byte (0x00)** before the stream; skip it. Then relay all bytes.
5. **Stop:** kill the child, `adb forward --remove tcp:N`, `socket.destroy()`. Server
   `cleanup=true` self-removes device-side state.

> **Handshake caveat (spike-verified).** The exact readiness handshake for the pinned
> version — dummy byte presence, any codec-id preamble when `send_frame_meta=false` — is
> **confirmed by a tiny on-device spike (plan Task 1)** before the reader is finalized,
> exactly as the parent plan reserved a verification step for @yume-chan.

### Backend: `AndroidH264StreamService.openCapture()` (rewired)

`openCapture` picks the source from config and produces `H264Packet`s into the
multiplexer, identically for both sources:

- **`source: 'screenrecord'`** → the current spawn (kept verbatim).
- **`source: 'scrcpy'` (default)** → create a `ScrcpyServerSession`, pipe its byte
  stream through a fresh `H264NalParser`, emit packets via the same `onPacket`
  callback the service already uses.

The restart-on-unexpected-exit + `MAX_RESTART_FAILURES` guard is retained (now
crash-recovery only — scrcpy has no cap, so healthy restarts are rare). Idle-out
watchdog and `manual_<actorId>_<udid>` lock semantics unchanged.

### Config (schema)

`streaming.androidH264` today is a boolean. It grows (backward-compatibly) to a union:

- `false` (or absent) → H.264 off, MJPEG only. **Unchanged default.**
- `true` → H.264 on, **source `scrcpy`** (new meaning of `true`).
- `{ "source": "scrcpy" | "screenrecord" }` → H.264 on with an explicit source.

`schema.json`'s `streaming` property stays **opaque** (`type: object` + description) —
the appium-required workaround from 1.9.0 — with the typed union living in `definitions`
and `$ref`'d only during type generation (`scripts/generate-types-from-schema.js`). A
tiny `resolveAndroidH264(cfg)` helper normalizes the three shapes to
`{ enabled, source }` so call sites (`resolveStreamType`, the service) read one shape.

### Vendoring & version pin

- Vendor `scrcpy-server-<version>.jar` (~60 KB) in-repo under
  `src/device-managers/android/vendor/` and copy it to `lib/` at build (extend the
  existing asset-copy step) so it ships in the npm tarball. Add the path to
  `package.json` `files` if not already covered.
- **Pin the exact scrcpy version.** The `app_process` arg names/format are
  version-specific; a mismatched jar is the primary drift risk. A `vendor/README.md`
  documents the pinned version, its SHA256, the source URL, and the bump procedure
  (replace jar → update `<ver>` constant → re-run the arg-builder test → on-device
  spike). One `SCRCPY_SERVER_VERSION` constant is the single source of truth for the
  jar filename and the `app_process` `<ver>` argument.

## Error handling & fallback (unchanged contract)

- scrcpy push/start/connect fails, or no bytes within a start budget → `start()` throws
  → `control.ts` **already** catches and reports `type: 'mjpeg'`, so the tile silently
  uses MJPEG. Logged once per device.
- Browser lacks WebCodecs / decode throws → player emits error → tile swaps to MJPEG
  `<img>` (existing `stream-retry` path). Unchanged.
- WS drop → client reconnects, multiplexer replays the current GOP on rejoin. Unchanged.

## Testing

- **Unit (host, no device):**
  - `ScrcpyServerSession` **launch-arg builder** — asserts the exact `app_process`
    argv (CLASSPATH, class, pinned `<ver>`, `tunnel_forward/audio/control/video_codec/
    max_size/…`) for a given udid + resolved size. This is the guard against silent arg
    drift on a version bump.
  - Source routing in `openCapture` — `source: 'screenrecord'` still spawns the legacy
    path; `source: 'scrcpy'` constructs a `ScrcpyServerSession` (seam stubbed).
  - `resolveAndroidH264` normalization — `false`/`true`/`{source}` → `{enabled, source}`.
  - Existing service tests (start idempotency, cleanup-on-throw, stop kills capture) run
    unchanged against the stubbed capture seam.
- **On-device spike (plan Task 1):** confirm handshake + that raw bytes decode through
  the existing parser on a Pixel 5.
- **Manual / perf (the payoff), Pixel 5:** measure **first-frame time** (expect
  ~sub-second vs 6–9s), confirm **no ~3-min hiccup** over a >5-min watch, fps/latency vs
  `screenrecord`, and the **MJPEG fallback drill** (force scrcpy start failure). Record
  numbers in the PR.

## Rollout & versioning

- **Minor bump 1.10.0** — adds a vendored binary and changes a flagged feature's default
  source. Flag stays **OFF by default**.
- **Reversible:** flag off → pure MJPEG; `streaming.androidH264: { source: 'screenrecord' }`
  → the exact shipped 1.9.x behavior, no revert needed.

## Risks

- **Jar ↔ scrcpy version drift.** `app_process` args are version-specific. Mitigate: one
  version constant, the arg-builder unit test, the vendor README bump procedure, and the
  runtime→MJPEG fallback if a bad jar fails to produce bytes.
- **`app_process` quirks across Android versions.** scrcpy's own launcher handles some
  device quirks we don't replicate. Mitigate: `max_size`/`video_codec` pinning + the
  MJPEG fallback; validate across the lab's device mix. Keep `screenrecord` selectable
  as a per-device escape hatch.
- **Handshake specifics.** Dummy-byte / preamble behavior is version-specific — pinned
  down by the Task 1 spike before the reader is finalized (not guessed).
- **Two capture sources** live behind the flag during the transition — accepted as the
  rollback-safety cost; `screenrecord` is retired once scrcpy is validated in the field.
