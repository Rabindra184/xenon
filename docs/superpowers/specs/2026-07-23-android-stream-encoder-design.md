# Android live-stream encoder: in-process JPEG (sharp)

**Date:** 2026-07-23
**Status:** Design approved — pending implementation
**Area:** `src/device-managers/android/AndroidStreamService.ts`
**Follow-up to:** 1.8.2 (adb-path fix) and 1.8.3 (fast-start fix)

## Problem

The Android live-stream capture loop encodes every frame by **spawning a fresh
ffmpeg process per frame**. `convertRawToJpeg` does `spawn(ffmpeg …)`, writes one
raw frame to stdin, reads one JPEG from stdout, and lets the process exit — at a
~14 fps target that is ~14 process spawns per second per device. Process
spawn/teardown dominates the host-side cost, driving up CPU and frame jitter and
capping sustained fps, especially with several devices streaming at once.

## Goal

Replace the per-frame ffmpeg subprocess with **in-process JPEG encoding** while
preserving the exact input/output contract, so nothing downstream changes.

### Non-goals

- **The adb transfer floor.** `adb exec-out screencap` still ships the full
  (~8–10 MB) raw RGBA framebuffer per frame. That per-frame cost is unchanged;
  reducing it is the scrcpy / `screenrecord` (H.264) direction and is explicitly
  out of scope here.
- **iOS.** iOS streaming uses WebDriverAgent's MJPEG server directly; there is no
  host-side encode on that path. This change is Android-only.
- **The MJPEG delivery / recording pipeline.** Unchanged (see Contract below).

## Current implementation

- `captureLoop` (AndroidStreamService) grabs a raw frame via
  `adb exec-out screencap`, parses the screencap header
  (`width`, `height`, `format`; 16- or 12-byte header), derives
  `pixFmt = fmt === 1 ? 'rgba' : 'rgb565'`, computes a downscale target
  (max width 720, even dimensions), then calls `convertRawToJpeg(...)` and stores
  the result in `session.latestFrame`.
- `convertRawToJpeg` spawns ffmpeg:
  `-f rawvideo -pixel_format <fmt> -video_size WxH -i pipe:0 -vf scale=dstW:-1 -f mjpeg -q:v 8 -frames:v 1 pipe:1`.

## Contract (what must not change)

`session.latestFrame` is a **JPEG buffer**. It is consumed by:
- the per-session HTTP MJPEG server (serves `latestFrame` to the proxy), and
- `UniversalMjpegProxy` → browsers, and
- the recording pipeline, which reads the device's **`mjpegServerPort`**
  (`RecordingOrchestrator`), i.e. the MJPEG stream — never `latestFrame` directly.

As long as the replacement takes the same raw pixels and returns a JPEG buffer of
the same downscaled dimensions, **all of the above are unaffected**.

## Design

Encode in-process with **`sharp`** (already a dependency, `^0.34.5` — zero new
deps, zero subprocesses).

### Primary path (RGBA, `fmt === 1` — effectively all modern devices)

```ts
// pixels is the post-header framebuffer; take exactly w*h*4 bytes (screencap
// rows are tightly packed, matching today's ffmpeg -video_size assumption).
session.latestFrame = await sharp(pixels.subarray(0, w * h * 4), {
  raw: { width: w, height: h, channels: 4 },
})
  .resize({ width: targetW })     // height auto-derived; preserves aspect
  .jpeg({ quality: JPEG_QUALITY }) // tunable; see below
  .toBuffer();
```

- `sharp` handles per-frame dimensions natively, so device **rotation needs no
  special handling** (no persistent-encoder restart logic).
- `.toBuffer()` runs on libvips' threadpool, off the Node event loop, so
  concurrent devices encode in parallel without blocking.
- Alpha is dropped by JPEG (screenshots are opaque); RGBA byte order matches
  sharp's `channels: 4`.

### Fallback path (rgb565, `fmt !== 1` — legacy/rare)

Keep the **existing ffmpeg conversion** for rgb565 frames only. `sharp` does not
accept 16-bit-packed rgb565 as raw input, and this format is essentially never
emitted by current Android. Reusing the proven ffmpeg path for the rare case
avoids new bit-unpacking code. Rename the current method to
`convertRawToJpegFfmpeg` (unchanged body) and call it only when `pixFmt !== 'rgba'`.

### Quality / dimension mapping

- The current ffmpeg setting is `-q:v 8` (mjpeg quantizer scale 2–31, lower is
  better) ≈ JPEG quality ~75–80. Start `JPEG_QUALITY = 78` as a module constant
  and tune if needed. Document it inline as the low-lag/quality knob.
- Downscale target stays **max width 720** with even dimensions (unchanged).
  With sharp, width alone is sufficient (`resize({ width })` preserves aspect);
  the even-dimension adjustment can be dropped for the sharp path (it existed for
  ffmpeg filters), but keeping targetW even is harmless and preserves parity.

### Structure

Introduce a small private encoder seam so the choice is testable and isolated:

```ts
private async encodeFrame(
  pixels: Buffer, w: number, h: number, targetW: number, targetH: number, pixFmt: string,
): Promise<Buffer> {
  if (pixFmt === 'rgba') return this.encodeRgbaWithSharp(pixels, w, h, targetW);
  // rgb565 (legacy/rare) keeps the proven ffmpeg conversion, unchanged.
  return this.convertRawToJpegFfmpeg(pixels, w, h, targetW, targetH, pixFmt);
}
```

`captureLoop` already computes `targetW`/`targetH`; it passes both to
`encodeFrame`. The sharp path uses only `targetW` (aspect-preserving); the ffmpeg
fallback uses both, exactly as today.

`captureLoop` calls `encodeFrame(...)` instead of `convertRawToJpeg(...)`.

## Error handling

- If `sharp` throws (corrupt/short buffer, unexpected dimensions), the existing
  `captureLoop` try/catch already logs `Capture failure: …` and backs off 1s.
  Add a one-time-per-session warn on the first sharp failure so a systemic
  problem is visible without log spam.
- `sharp` failing does **not** fall through to ffmpeg for RGBA — a sharp failure
  on valid RGBA indicates a real problem; we log and skip the frame rather than
  masking it with a per-frame ffmpeg spawn (which would reintroduce the cost this
  change removes). (Open to revisiting if field data shows benign sharp flakiness.)

## Testing

- **Unit (encoder seam):** feed a synthetic RGBA buffer (small, known WxH) to the
  sharp path; assert the output is a valid JPEG (SOI `FFD8` / EOI `FFD9`) and that
  its decoded dimensions match the downscale target. Assert `encodeFrame` routes
  `rgba → sharp` and `rgb565 → ffmpeg` (spy/stub the two encoders).
- **No-regression:** existing `android-stream-*` unit tests still pass.
- **Manual/perf (optional):** before/after on a real device — sustained fps and
  host CPU for one and several concurrent streams. Record numbers in the PR.

## Rollout

- Single-file change (`AndroidStreamService.ts`) + one unit test. No schema, no DB,
  no API, no frontend.
- Ship as a patch release (**1.8.4**) via the standard version-bump-on-main → CI
  publish flow.
- Reversible: the ffmpeg path remains in the tree (used for rgb565), so a revert
  is a one-line routing change.

## Risks

- **sharp prebuilt coverage.** sharp ships prebuilt binaries for the device-farm
  targets (darwin-arm64/x64, linux-x64/arm64). Already a dependency, so this risk
  is already borne by the project today.
- **Quality delta.** JPEG quality mapping from `-q:v 8` is approximate; validate
  visually and tune `JPEG_QUALITY`.
- **Stride padding.** Both the current ffmpeg path and the sharp path assume
  tightly packed rows (`w*4`/row). If a device reports row stride > `w*4`, both
  would misrender — unchanged behavior, noted for future hardening.
