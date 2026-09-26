# Composite video includes annotation marks

**Date:** 2026-09-26
**Status:** approved (approach A), ready for planning
**Follows:** 1.22.0 (#296, #297): per-device burn-in with images, time windows, text

## Problem

A multi-device Live Devices recording produces one video per device plus a
side-by-side `composite.mp4`. Since 1.22.0 the per-device videos carry every
mark exactly as drawn. The composite has none: it is streamed raw by
`GET /recordings/:groupId/composite.mp4`, and added raw to `videos.zip` and
`bundle.zip`.

## How the composite is built today

`VideoPipelineService.startComposite` gives each input a uniform cell (default
540×960). It applies
`scale=W:H:force_original_aspect_ratio=decrease, pad=W:H:(ow-iw)/2:(oh-ih)/2`
and stacks the cells row-major: 2 inputs make 2×1 (`hstack`), 3–4 make a
2×2 `xstack`, and 5–6 make a 3×2 `xstack`, with black cells filling any gaps.

The layout depends only on the input count. Inputs are in the orchestrator's
`recordings` order, filtered to the devices with an MJPEG port. A device
added mid-recording is not in the composite.

**Timing.** `start()` returns right after the composite ffmpeg spawns, which
follows a 750 ms settle, and the browser stamps t=0 when that response
arrives. So mark timecodes already sit on the composite's timeline, to within
about ±200 ms. This is to be measured live, not assumed.

## Decision: approach A, burn marks into the finished composite cell by cell

These alternatives were rejected:

- **Re-stacking the marked per-device videos.** That throws away the in-sync
  live composite, and the per-device videos start up to about 1 s apart.
- **Live injection into the running ffmpeg.** Fragile, and the wrong shape
  for marks that arrive over HTTP.

## Design

### Geometry: one source of truth

`VideoPipelineService` exports pure helpers, and `startComposite` uses them:

- `compositeGrid(n)`, returning `{ cols, rows }`.
- `cellOrigin(i, grid, cellW, cellH)`, which is row-major, matching the
  existing `hstack`/`xstack` layout strings.
- `buildCompositeFilterGraph(n, cellW, cellH)`, the graph `startComposite`
  runs today, extracted unchanged.
- `startComposite` returns the geometry it used,
  `{ cellW, cellH, cols, rows }`.

### Layout record

When the composite starts, the orchestrator writes `composite.json` beside
`composite.mp4`, as `compositeLayoutPath(groupId)`:

```json
{ "version": 1, "cellW": 540, "cellH": 960, "cols": 2, "rows": 1,
  "cells": [{ "index": 0, "udid": "…", "recordingId": "…" }] }
```

A write failure is logged and the composite simply has no marks. A
composite with no layout file, including every one recorded before this
change, is served raw exactly as today.

### Picture box per cell

- `probeVideoFrameSize(file)` parses the `ffmpeg -i` stream line (`, WxH,`).
  The per-device mp4 and the composite read the same MJPEG source, so they
  share the frame size.
- `containBoxPx(cellW, cellH, srcW, srcH)` mirrors ffmpeg:
  - scaled size `min(cell, round(other × aspect))`
  - pad offset truncated, with no rounding to even. Measured on the bundled
    ffmpeg: a 1024×768 source lands at y=277.
- The result is offset by the cell origin.
- If the size can't be probed, the box falls back to the whole cell.

### Render

- `AnnotationRenderService.resolveCompositePath(groupId)` returns
  `{ filePath, annotated }`.
- It reads the layout and `store.listGroup` (annotations included), and
  builds one graph over the composite:
  - The drawbox and drawtext fallback parts from `buildFilterParts(…, box)`.
    With a box, coordinates become absolute pixels
    (`x = box.x + frac × box.w`); without one they stay `iw*frac` as today.
  - Then one overlay per image mark,
    `[k:v]scale=box.w:box.h[ok];[prev][ok]overlay=box.x:box.y:enable=…`.
    It uses exact pixels, because the box is known.
  - Each mark's image is found from its own recording's video path.
  - Time windows and the late-mark clamp work exactly as per device, clamped
    to the composite's duration.
- It reuses the single-writer `renderCached`, the stamp (which includes image
  mtimes and each cell's box), `runGraph` through `-filter_complex_script`,
  and the retry without text. Those are generalised to take a graph builder
  rather than being per-device only.
- The output is `composite.annotated.mp4` beside `composite.mp4`, so it is
  cleaned up with the group directory.

### Serving

These now serve `resolveCompositePath`, falling back to the raw composite on
any render failure:

- `GET /composite.mp4`
- `videos.zip` (`populateVideosOnly`)
- `bundle.zip` (`populate`)

`stop()` pre-renders the composite in the background, as it already does for
each device.

## Testing

- **Unit:**
  - `compositeGrid` and `cellOrigin` for n=2..6, matching the xstack
    layouts.
  - `containBoxPx`, checked against boxes measured from ffmpeg.
  - Frame-size parsing, including `0x31637661`-style codec tags that must
    not match.
  - `buildFilterParts` with a box produces absolute pixels.
  - `buildCompositeGraph` shape.
  - The orchestrator writes the layout file.
  - `resolveCompositePath` serves raw with no layout file, or with no marks.
- **Real ffmpeg:** build a composite with `buildCompositeFilterGraph` from two
  synthetic sources of different aspect ratios. Burn an image mark into
  cell 0 and a box-fallback mark into cell 1, and check the pixel colour at
  the expected composite coordinates, and outside them.
- **Live:** record the S9+ with a second device (the connected iPhone, or an
  Android emulator), draw marks on each tile, and check frames from the
  downloaded composite. Also measure the mark timing in the composite and in
  each per-device video. A per-device offset is reported separately; it is
  not in scope.

## Out of scope

- A device added mid-recording is not in the composite, so its marks are not
  either.
- Frame-shape changes mid-recording (rotation). One shape per device is
  assumed, taken from its video.

## Verified live (2026-09-26)

The test recorded a Galaxy S9+ and a Pixel 6 emulator together (2×1) on the
restarted Postgres-backed server.

**Layout and placement**

- `composite.json` held both cells in order with the right recording ids.
- The Stop pre-render produced `composite.annotated.mp4`, and the download
  was served instantly.
- Placement in each cell's picture box:
  - S9+ (720×1480): box 467×960 at x=36.
  - Emulator (720×1560): box 443×960 at x=588.
- Frames matched the preview: a red box on "21°" (cell 0), a blue circle
  around Chrome (cell 1, identical in a crop of the emulator's own video),
  and a green box at the top of Settings.
- Clear marks at 67.7 s left both cells clean at 70 s, and a mark drawn
  after the clear appeared at 76 s.

**Timing.** Settings was opened at client-relative ≈41.8 s.

- In the composite's S9+ cell it appears at 42.64 s, which is the device's
  own transition and capture latency. Marks line up with the composite.
- In the S9+'s own video it appears at 43.84 s. That file started earlier
  than the composite (85.8 s vs 84.3 s), so **per-device videos in
  multi-device groups show marks about 1.2 s early** (about 0.8 s on the
  device that started later).
- Single-device groups are unaffected: the start request returns right after
  that device's ffmpeg spawns.
- This is a follow-up, not in scope here. The server knows both the spawn
  time of each ffmpeg and the time `start()` returns, which is the browser's
  t=0, so it can shift each per-device burn-in by the difference.
