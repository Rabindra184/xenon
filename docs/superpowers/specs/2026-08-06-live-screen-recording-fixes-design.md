# Live Screen — Recording & Streaming Reliability Fixes

**Date:** 2026-08-06
**Status:** Approved design, pending implementation
**Scope:** Bug fixes to the Live Devices (mosaic) recording/streaming/annotation subsystem, on top of the current uncommitted WIP.

## Background

A live end-to-end check of the Live Devices page (fresh build of the WIP,
Samsung Galaxy S9+ `star2ltexx`, config `androidH264: true`, Postgres, auth
disabled) confirmed several WIP improvements already work and surfaced four
reproducible defects.

### Verified working (no change needed)
- Orphaned `manual_*` lock reclaim on boot (`RecordingOrchestrator.recoverOnBoot`) — devices no longer stuck `busy`.
- MJPEG port-collision fix in `AndroidStreamService.startStream` (bind-retry loop; Samsung bound `9101` while iOS held `9100`).
- Android H.264 live preview and tap/swipe in normal (non-recording) use.
- Recording produces a valid mp4 (was 100% broken before the port fix).
- Annotation drawing, overlay render, persistence across the Annotate toggle, save-to-backend, and the ffmpeg burn-in filter geometry.

### Defects (this spec)
| ID | Symptom | Root cause | Origin |
|----|---------|-----------|--------|
| A | Live preview flaps "Starting Stream…" for seconds at recording start/stop | `stream/start` unconditionally stops the *active* MJPEG proxy | WIP regression |
| B | Tap/swipe dead on a tile added before device dimensions load | Tile caches `screenWidth/height: undefined`; never re-reads | Pre-existing |
| C | Stop hangs ~16s then SIGKILLs ffmpeg | ffmpeg ignores SIGINT until the kill timeout — leading hypothesis: `-reconnect_at_eof 1` retries on EOF instead of finalizing (validate during impl) | Pre-existing |
| D | Recording plays at ~2× speed; late annotations vanish | `-use_wallclock_as_timestamps`/`-vsync vfr` not yielding real-time duration; wall-clock annotation timecodes overshoot the shorter video | Pre-existing |

(“E” below — slow synchronous download — is a UX fix bundled with the pipeline group, not a correctness defect.)

## Evidence

- **A:** server log shows `Stream started for <udid> - Port: 9101` immediately followed by `[MjpegProxy] Stopping source (proxy stopped)` → `Terminating 3 client connections` → `Source stream error: aborted`. Flap count = 1 per `stream/start`; preview recovers only after the start-storm settles.
- **B:** live DOM inspection — interaction surface not mounted; `DeviceTile` props show `screenWidth`/`screenHeight` absent. Device record has `screenWidth:"1080"` (populated lazily ~first stream); iPhone shows `screenWidth:null`.
- **C:** log `[VideoPipeline] <id> still running after SIGINT — sending SIGKILL`; stop HTTP call took 16080ms.
- **D:** recorded mp4 `duration=294.72s` for ~9:25 wall-clock; annotation `timecodeMs=339343` (> duration). Extracted frame at t=280s shows no annotation. Burn-in ffmpeg filter is otherwise correct.

## PR structure

Two PRs from one spec (per merge-pacing preference):

- **PR-1 — streaming/UI quick wins:** Fix A + Fix B (B1 frontend approach).
- **PR-2 — recording pipeline:** Fix C + Fix D + Fix E.

---

## PR-1

### Fix A — remove the harmful proxy stop

**File:** `src/app/routers/control.ts`, `POST /:udid/stream/start` handler.

Delete the block appended after the `Stream started for … - Port:` log line:

```ts
const staleProxy = MJPEG_PROXY_CACHE.get(udid);
if (staleProxy) {
  staleProxy.stop();
  MJPEG_PROXY_CACHE.delete(udid);
}
```

**Why safe:** the `GET /:udid/stream` handler already replaces the proxy only
when the upstream port changed (`if (existingProxy.url !== videoUrl) { existingProxy.stop(); … }`),
which is the exact "Android briefly aliased to iOS's 9100" case the deleted
block cited. Stopping the proxy on *every* start — including the warm-fetch the
tile issues when recording begins — is what tears down the live preview.

**Verification:** record the Samsung; the tile stays `live`; server log shows no
`proxy stopped` immediately after `Stream started`.

### Fix B — refresh tile dimensions when they arrive (B1)

**Files:** `web/src/components/mosaic/recording-group-store.ts`, `web/src/components/mosaic/DeviceMosaicView.tsx`.

Root: Android `screenWidth/height` populate lazily (~first stream, via
`adb shell wm size`). A tile added before then caches `undefined`, so
`interactive = !annotateMode && !!screenWidth && !!screenHeight` stays false and
the interaction surface never mounts.

1. Add a reducer action `PATCH_TILE_DIMS { udid, screenWidth, screenHeight }`
   that updates the matching tile's dims (only when currently missing → avoid
   needless re-renders).
2. In `DeviceMosaicView`, add an effect keyed on `devices` that, for each tile
   with missing dims, looks up the live device and dispatches `PATCH_TILE_DIMS`
   once valid (`Number.isFinite(sw) && sw > 0`) dims are available.

Interaction turns on within one device-poll cycle (~5s) of dims becoming known.
No backend change. (B2 — eager `wm size` at device discovery — is a possible
follow-up to remove the root lazy-population, out of scope here.)

**Verification:** add the Samsung immediately after a restart; within a few
seconds tap/swipe issues `POST /control/<udid>/tap|swipe` and the device
responds. Also confirm interaction works while recording (annotate off).

---

## PR-2

### Fix C — graceful ffmpeg stop

**File:** `src/services/VideoPipelineService.ts`, the `stopFfmpeg`-style helper
("Graceful ffmpeg stop: SIGINT, then SIGKILL").

Primary (**C1**): send ffmpeg a graceful quit by writing `q` to its **stdin**
before the SIGINT→SIGKILL escalation. This requires the recording ffmpeg to be
spawned with a writable stdin pipe (`stdio: ['pipe', …]`). Keep SIGINT then
SIGKILL as escalating fallbacks with the existing timeout.

Empirical validation required: confirm ffmpeg exits within ~1–2s of `q`, the mp4
finalizes (moov present / faststart remux succeeds), and the stop HTTP call no
longer takes ~16s.

Fallback (**C2**, only if `q` proves unreliable): drop `-reconnect_at_eof 1`
from the recording input so EOF at Stop finalizes the capture — accepting that a
transient mid-recording MJPEG blip could end capture early.

### Fix D — real-time recording duration + timecode clamp

**Files:** `src/services/VideoPipelineService.ts` (`buildRecordArgs`),
`src/services/recording/annotation-render.ts`.

Root fix (**D1**): the recording input already carries
`-use_wallclock_as_timestamps 1` with output `-vsync vfr`, intended to make mp4
duration track real time, but the capture still records at ~2× speed. Make the
recorded duration match wall-clock, validated empirically. Candidates to test
(pick what actually works on this HTTP-MJPEG source + Homebrew ffmpeg):
- `-fflags +genpts` on input;
- verifying `-use_wallclock_as_timestamps` actually applies to the `-f mjpeg`
  HTTP demuxer (timestamps may reset across `-reconnect`);
- encoder/`-vsync` interaction (`h264_videotoolbox` vs `libx264`).

Success = a recording's `ffprobe duration` ≈ wall-clock (±~5%). Once true, the
existing wall-clock annotation timecodes align automatically.

Safety net (**D2**, include regardless): in `annotation-render`, clamp each
annotation's `tStart` to `[0, videoDuration]` (probe duration once per render)
so a late mark renders at the end instead of never (`enable='gte(t,tStart)'`
past EOF). This keeps annotations visible even if D1 is imperfect.

### Fix E — pre-render annotated mp4 asynchronously

**Files:** `src/services/recording/RecordingOrchestrator.ts` (stop path) or the
recordings stop route; reuses `AnnotationRenderService.resolvePlayablePath`
(already caches via `cacheStamp`).

Primary (**E1**): after a recording stops, if it has ≥1 annotation, kick off
`resolvePlayablePath(recordingId)` fire-and-forget so the `.annotated.mp4` cache
is warm before the user clicks Download. Recordings with no annotations skip the
encode and serve the clean source (unchanged). A download that races the render
falls back to the current on-demand behavior.

Optional add-on (**E3**, if cold render still slow): use `h264_videotoolbox` for
the burn-in encode (as the recording path does) instead of `libx264`.

**Verification:** stop an annotated recording; within a few seconds the
`.annotated.mp4` exists; `GET /recordings/<groupId>/video.mp4` returns promptly.

---

## Testing

- **Unit:** extend `test/unit/annotation-render.spec.ts` for the D2 clamp
  (annotation `tStart > duration` → clamped, still emitted). Add a
  `buildRecordArgs` assertion if D1 changes the argv. Existing
  `PortAllocator.test.ts` and `recording-group-store.test.ts` must stay green;
  add a `PATCH_TILE_DIMS` reducer test for B.
- **Manual (live, Samsung):** A — preview stable through record start/stop;
  B — tap/swipe works after early add and during recording; C — stop returns
  quickly, mp4 valid; D — `ffprobe duration` ≈ wall-clock and a late annotation
  appears in the burned-in mp4; E — download of an annotated recording is
  prompt.

## Risks / open questions

- **D1** is empirical — the real-time-duration fix may need iteration against
  the actual ffmpeg build; D2 guarantees annotations remain visible meanwhile.
- **C1** requires ffmpeg spawned with a stdin pipe; verify no other code path
  assumes ffmpeg stdin is ignored.
- Composite (multi-device `xstack`) recording shares the stop path — apply
  C's graceful-stop change to `stopComposite` too, and re-check its duration.
- iOS could not be tested (device unplugged); B applies to iOS tiles equally
  (`screenWidth:null`) — the same B1 refresh covers them.

## Out of scope
- B2 (eager `wm size` at discovery).
- iPhone-specific streaming validation (needs a connected device).
- The benign `/dashboard/api/ping → 404` self-ping log noise.
