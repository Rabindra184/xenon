# Recording annotations: stability pass

**Date:** 2026-09-25
**Status:** approved, ready for planning
**Includes:** [Clear marks](2026-09-25-annotation-clear-marks-design.md), approved separately
**Follows:** #295

## Why

The user asked for Live Devices annotations to be "very very stable", and
for the Bookmark option to go. A live test on a Galaxy S9+ covered every
toolbar option: four shapes, colour, the Annotate toggle, layouts 1 and 2×2,
a layout switch mid-recording, Clear marks, and a page reload
mid-recording.

These worked: mark positions after #295, marks rescaling on a layout switch,
colour, the Annotate toggle (taps reach the device and nothing is posted),
and timing.

These failed:

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | P0 | Recording state lives only in the page's `useReducer`. A reload, a closed tab, or navigating to another route forgets it. The server keeps recording and nothing in the UI can stop it. | After a reload the UI offered Record while the Stop button was disabled. The server row stayed `RECORDING` and ffmpeg kept running. |
| 2 | P0 | The same device can be recorded twice at once. `BusyPrecheck` lets a device through when its lock is the caller's own manual lock, and never calls `RecordingStore.isRecording(udid)`. | Record after a reload returned `202`, and two capture ffmpegs ran on one device. Repeat it four times and `maxConcurrentRecordings` is used up until a restart. |
| 3 | P1 | Circle and Arrow burn in as filled boxes, and "Draw" is Rect. `drawbox` cannot draw curves or diagonals. `annotationFromDrag` handles `FREEHAND` in the same branch as `RECT`. | A circle became a large red square. An arrow became a tall box plus a small square. The 35% fill hid the content underneath. |
| 4 | P1 | Clear marks does not reach the video. | See the Clear marks spec. |
| 5 | P1 | One `TEXT` mark wipes every mark from the download. The bundled ffmpeg 4.4 has libfreetype without fontconfig, so `drawtext` fails with "No font filename provided". The failed render falls back to the clean video. | Reproduced directly on the bundled binary. |
| 6 | P2 | The toolbar moves under the cursor. "Clear marks" is rendered only while marks exist, and the shape buttons only while Annotate is on, in a right-aligned row. | Two of my own clicks landed on the colour swatch and on Clear marks. |
| 7 | P2 | The annotate hint covers about a third of a small tile in 2×2 or 3×2, for as long as Annotate is on. | Screenshot, 2×2. |
| 8 | Requested | Remove the Bookmark option. | |

## Decisions (user)

- **The video must match the preview exactly.** Marks are rasterised by the
  browser, with the same `paintAnnotation` code the overlay uses, and
  composited by ffmpeg.
- **Draw becomes real freehand.**
- **Bookmarks are removed from the UI only.** The `Bookmark` table, the
  `POST /bookmark` route and `bookmarks.json` in proof bundles stay. Dropping
  the table would destroy existing bookmarks.
- **Clear marks** follows the approved spec: a mark is visible until Clear
  marks or the end of the recording.

## Design

### 1. Rehydrating a running recording (P0 #1)

- Add `GET /recordings/active`. It returns every `RECORDING` group whose
  devices are held by the caller. That means `isSelfManualLock` against the
  device's `session_id`, evaluated with `resolveActor(req)` in the same way
  as `/control`. This applies **to admins too**, as tile rehydration does:
  a mosaic must never adopt another user's recording.
- Per group it returns `{ groupId, startedAt, serverNow, compositeEnabled,
  recordings: [{ id, udid }], annotations: [...] }`. The annotations are the
  group's marks that are still open, meaning `end_timecode_ms IS NULL`.
- `DeviceMosaicView`'s mount-time rehydration calls the endpoint after its
  tiles are known. It adds tiles for any recording udid that is missing, then
  dispatches a new `REHYDRATE_RECORDING` action with the group id,
  recordings, `compositeEnabled`, the open marks as `overlayAnnotations`, and
  `startedAt`.
- `startedAt` is converted to the client's clock as
  `Date.now() - (serverNow - startedAt)`, so client-to-server clock skew
  cannot shift the timecodes of new marks.
- Result: after a reload or navigation you get the REC timer back, Stop and
  Clear marks work, and the overlay shows the same marks the video will.

### 2. One recording per device (P0 #2)

- `BusyPrecheck` reports `recording_other_group` for any udid where
  `RecordingStore.isRecording(udid)` is true. That reason already exists in
  `BusyReason`, and the picker already labels it "Recording in another
  group". The check comes before the manual-lock rules, so an owner cannot
  start a duplicate either.
- It applies to `start` and to `add-device`.
- `recoverOnBoot` already turns orphan `RECORDING` rows into `FAILED`, so a
  stale row cannot block a device after a restart.

### 3. Exact-match burn-in (P1 #3, #5)

- **Client.** When a mark is committed, `rasterizeAnnotation(ann, dims)`
  paints it onto an offscreen canvas.
  - The canvas has the device's aspect ratio, with its long side at 1600px.
  - `ctx.scale` maps the tile's CSS size to that canvas, and then
    `paintAnnotation` runs unchanged. Stroke width and arrow-head size
    therefore keep the same proportion to the frame as in the preview, and
    edges stay sharp.
  - The PNG is sent as a data URL in a new optional `image` field on
    `POST /annotation`.
- **Server.**
  - The route checks the `data:image/png;base64,` prefix and the PNG
    signature, and caps the decoded size at 2 MB. Anything else is a `400`.
  - The store writes the image to
    `<recordingsAssetsPath>/<recordingId>/annotations/<annotationId>.png`.
    Recording cleanup removes the whole `<recordingId>/` directory, so the
    images go with their video.
  - The image does not need a column: whether the file exists is the flag.
- **Render.**
  - A mark with an image becomes an extra input:
    `[k:v][prev]scale2ref=w=iw:h=ih[ok][bk];[bk][ok]overlay=0:0:enable='…'`.
    In `scale2ref`, `iw/ih` are the *reference* dimensions; this was
    verified on the bundled ffmpeg 4.4, where `main_w` did not scale.
  - A mark without an image, meaning a legacy row or an API client, keeps the
    `drawbox` rendering.
  - A `TEXT` mark without an image is still attempted, because a build
    with fontconfig can draw it. If the render fails and text was present,
    it re-renders once without those marks and logs a warning. One mark that
    cannot be drawn must never cost the others.
  - The graph goes through `-filter_complex_script`, a temp file beside the
    output. This removes command-line length limits with many marks, and
    shell-style escaping.
  - The cache stamp includes each mark's image mtime, and the prefix
    becomes `v3`.

### 4. Real freehand (P1 #3)

- While dragging with Draw, the overlay records the pointer path. It keeps a
  point only when the pointer has moved at least 2 CSS px, and caps the path
  at 2000 points.
- The geometry is `{ x, y, w, h, points: [[nx, ny], …] }`. The `x/y/w/h`
  bounding box is kept so the `drawbox` fallback and older readers still
  get a sensible box.
- `paintAnnotation` draws `FREEHAND` as a round-joined polyline with the same
  dark halo and colour stroke as the other shapes. A path of one point is
  discarded.
- There is no schema change: `geometry` is already a JSON string.

### 5. A toolbar that stays put, and a smaller hint (P2 #6, #7)

- While recording, Annotate, the four shapes, colour and Clear marks are
  always rendered. They are **disabled** rather than hidden: the shapes and
  colour when Annotate is off, and Clear marks when there are no marks.
  Nothing appears or disappears, so nothing moves.
- The hint becomes a single-line chip, "Annotating · drag to mark", placed
  at the top of the tile beside the REC badge. It stays `pointer-events:
  none`.

### 6. Remove Bookmark (#8)

- Remove the Bookmark button, `onBookmark`, the `B` hotkey, and the client
  `addBookmark` export.
- The server keeps the route, the table and the bundle export.

## Testing

- **Mocha.**
  - `busy-precheck`: a self-locked device that is already recording is
    refused with `recording`, and an idle self-locked device is allowed.
  - `annotation-render`: an overlay graph for image marks, the
    `scale2ref=w=iw:h=ih` form, a failing `TEXT` mark retried without text, a
    mix of image and `drawbox` marks, and the stamp including the image.
  - The annotation route: image validation (bad prefix, bad signature,
    oversize) and the image written to the right path.
  - The active-recordings route: only the caller's own groups, admins
    included.
  - Plus every spec in the Clear marks design.
- **Vitest.**
  - The freehand path is recorded, thinned and capped.
  - `rasterizeAnnotation` passes the scaled context to `paintAnnotation`.
  - The toolbar renders the same buttons whether Annotate is on or off.
  - `REHYDRATE_RECORDING` restores the timer origin and the marks.
  - Bookmark UI is absent.
  - The write queue holds its ordering.
- **Live on the S9+.** Every item below is checked on frames extracted from
  the downloaded video, not from the preview.
  1. Each shape (Rect, Circle, Arrow, freehand) matches the preview,
     including its colour.
  2. Clear marks removes marks at the clear time, and a mark drawn after it
     appears.
  3. A reload mid-recording brings back the timer and the marks, and Stop
     works.
  4. Record after a reload is refused while a recording is running.
  5. Layouts 1, 2×2 and 3×2.
  6. A stress run of 40+ marks renders and downloads.
  7. A `TEXT` mark from the API does not wipe the others.
  8. Restart the Postgres-backed server and check the log: `[DBMigrate]`
     in sync and no `Fatal`.
  9. Apply the migrations to a scratch SQLite file.

## Out of scope

- **Multi-device composite download.** `composite.mp4` is streamed raw, with
  no marks. Only one device was available to test, and burning marks into a
  stacked layout is its own design.
- The missing group-visibility check on the existing `POST /annotation` and
  `/bookmark` routes.
- Undoing one mark, or clearing one tile.
