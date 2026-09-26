# Composite Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `composite.mp4` downloads show every annotation mark in its device's
cell, exactly as the per-device videos do.

**Architecture:**
- **Layout record.** The composite's geometry already depends only on the
  input count. It becomes a set of exported pure helpers, and the
  orchestrator records which recording sits in which cell (`composite.json`).
- **Render.** The composite is rendered like a per-device video, in one
  ffmpeg pass over the composite. Each mark is placed in its cell's picture
  box, found by mirroring ffmpeg's `scale` + `pad` maths on the device's frame
  size.

**Tech Stack:** TypeScript, bundled ffmpeg 4.4, Mocha + Chai + Sinon.

**Spec:** `docs/superpowers/specs/2026-09-26-composite-annotations-design.md`

## Global Constraints

- **Cells.** The default cell is 540×960, row-major. 2 inputs make 2×1, 3–4
  make 2×2, and 5–6 make 3×2. This must stay byte-identical to today's
  `xstack` layouts.
- **Scale.** `force_original_aspect_ratio=decrease` gives
  `w = min(cellW, round(cellH·srcW/srcH))` and
  `h = min(cellH, round(cellW·srcH/srcW))`, rounded half away from zero.
- **Pad offsets.** `trunc((cell − size)/2)`, with no rounding to even. This
  was measured on the bundled ffmpeg: a 1024×768 source lands at y=277.
- **Missing inputs.** No layout file, no marks, or any render error: serve
  the raw composite.
- **Mocha.** Hooks go inside `describe`. Specs must pass on their own. No
  broad `eslint --fix`. Stage explicit paths only.

---

### Task 1: Composite geometry helpers

**Files:** Modify `src/services/VideoPipelineService.ts`. Test
`test/unit/composite-geometry.spec.ts` (new).

**Produces:**
- `export const COMPOSITE_CELL_W = 540`, `COMPOSITE_CELL_H = 960`
- `export interface CompositeGeometry { cellW: number; cellH: number; cols: number; rows: number }`
- `export function compositeGrid(n: number): { cols: number; rows: number }`
  gives 2→{2,1}, 3–4→{2,2}, 5–6→{3,2}.
- `export function cellOrigin(i: number, cols: number, cellW: number, cellH: number): { x: number; y: number }`
- `export function buildCompositeFilterGraph(n: number, cellW: number, cellH: number): string`
  is extracted from `startComposite` unchanged.
- `startComposite(...)` now resolves `Promise<CompositeGeometry>`.

- [ ] **Step 1: Write the failing test.** `compositeGrid` for n=2..6.
  `cellOrigin` for every index of each grid, matching the xstack strings
  (`0_0|w0_0|0_h0|w0_h0`, `…|w0+w1_0|…`). `buildCompositeFilterGraph(2,540,960)`
  equals the current literal graph for two inputs, captured before the
  refactor.
- [ ] **Step 2: Run it and check that it fails** (the exports are missing).
- [ ] **Step 3: Implement.**
  - Move the per-input `scale,pad,setsar` loop and `buildStackFilter` call
    into `buildCompositeFilterGraph`.
  - `compositeGrid` derives from `pickLayout`.
  - `startComposite` uses the constants and the graph builder, and returns
    `{ cellW, cellH, ...compositeGrid(inputs.length) }`.
- [ ] **Step 4: Run it and check that it passes.** Also run
  `test/unit/video-pipeline-*.spec.ts`.
- [ ] **Step 5: Commit.**
  `refactor(recording): composite geometry as pure, exported helpers`

### Task 2: Record the composite's layout

**Files:** Modify `src/services/recording/RecordingOrchestrator.ts`. Test
`test/unit/recording-orchestrator.spec.ts`.

**Produces:**
- `export function compositeLayoutPath(groupId: string): string`, which is
  `composite.json` beside `compositeOutputPath`.
- `export interface CompositeLayoutFile { version: 1; cellW; cellH; cols; rows; cells: Array<{ index: number; udid: string; recordingId: string }> }`

- [ ] **Step 1: Write the failing test.** Start a 2-device group with a fake
  pipeline whose `startComposite` resolves
  `{ cellW: 540, cellH: 960, cols: 2, rows: 1 }`. Expect `composite.json` to
  hold both cells in input order with the right `recordingId`s. A pipeline
  resolving `undefined`, as the legacy stubs do, writes no file and does not
  throw.
- [ ] **Step 2: Run it and check that it fails.**
- [ ] **Step 3: Implement.** After `startComposite` succeeds, map each
  composite input's udid to its `StartedRecording.id` and write the JSON
  with `mkdir -p`. On failure, `recLog.warn` and continue.
- [ ] **Step 4: Run the tests, expecting a pass.**
- [ ] **Step 5: Commit.** `feat(recording): record which recording sits in which composite cell`

### Task 3: Frame size and picture box

**Files:** Modify `src/services/recording/probeDuration.ts`. Test
`test/unit/composite-geometry.spec.ts`.

**Produces:**
- `export function parseFfmpegFrameSize(stderr: string): { w: number; h: number } | undefined`
  uses `/Video: .*?, (\d{2,5})x(\d{2,5})(?=[,\s\]])/`. It must not match
  `0x31637661`.
- `export async function probeVideoFrameSize(file: string): Promise<{ w: number; h: number } | undefined>`
- `export function containBoxPx(cellW: number, cellH: number, srcW: number, srcH: number): { x: number; y: number; w: number; h: number }`
  lives in `annotation-render.ts`.

- [ ] **Step 1: Write the failing tests.**
  - Parse the real stream line: `… (avc1 / 0x31637661), yuv420p(tv, …), 720x1480, 61 kb/s …`
    gives 720×1480.
  - `containBoxPx` matches the boxes measured from the bundled ffmpeg for six
    source shapes, e.g. 720×1480 gives `{ x: 36, y: 0, w: 467, h: 960 }` and
    1024×768 gives `{ x: 0, y: 277, w: 540, h: 405 }`.
  - A wide source such as 1480×720 is letterboxed vertically.
  - An equal aspect gives the full cell.
- [ ] **Step 2: Run them and check that they fail.**
- [ ] **Step 3: Implement.** Make `runProbe` generic over its parse result.
  `probeVideoFrameSize` runs `-hide_banner -i file` and parses stderr.
- [ ] **Step 4: Run the tests, expecting a pass.**
- [ ] **Step 5: Commit.** `feat(recording): probe frame size and place a picture in a composite cell like ffmpeg`

### Task 4: Render marks into the composite

**Files:** Modify `src/services/recording/annotation-render.ts`. Test
`test/unit/annotation-render.spec.ts`.

**Produces:**
- `buildFilterParts(annotations, durationSec?, box?: PixelBox)`. With `box`,
  every coordinate is an absolute pixel.
- `buildCompositeGraph(cells: Array<{ box: PixelBox; annotations: AnnotationRow[]; imageFor: (a) => string | undefined }>, durationSec?): RenderGraph | null`
- `resolveCompositePath(groupId: string): Promise<{ filePath: string; annotated: boolean }>`
- Internals: `renderCached(outPath, stampPath, stamp, render: () => Promise<void>)`
  and `renderPlan(source, out, build: (withText: boolean) => RenderGraph | null)`
  shared by the per-device and composite paths.

- [ ] **Step 1: Write the failing tests.**
  - A RECT with box `{x:10,y:20,w:100,h:200}` and geometry
    `{x:.1,y:.1,w:.5,h:.5}` gives `drawbox=x=20:y=40:w=50:h=100`.
  - With no box, output is unchanged (the existing tests).
  - Graph shape: drawbox parts first, then
    `[1:v]scale=W:H[o1];[d0][o1]overlay=X:Y:enable=…[v1]`.
  - `resolveCompositePath` returns raw when the layout file is missing and
    when no cell has marks.
  - **Real-ffmpeg pixel test.**
    1. Two lavfi sources: a 360×720 navy video and a 720×360 dark-green one.
    2. Composite them via `buildCompositeFilterGraph(2, 540, 960)`.
    3. Write `composite.json`, per-device mp4s, a layout, and a store with an
       image mark (a PNG with a solid red block) in cell 0 and a
       box-fallback RECT in magenta in cell 1.
    4. Render, then read one raw RGB frame and check the pixels at the
       computed centres (red, magenta) and at a point outside both
       (background).
- [ ] **Step 2: Run them and check that they fail.**
- [ ] **Step 3: Implement.**
  - A box-aware coordinate helper.
  - Generalise the cache and the text-retry path (per-device behaviour
    unchanged; the existing concurrency test still stubs `renderToFile`).
  - Composite stamp: `c1|compositeMtime|` plus per cell the box and per-mark
    parts.
  - Output `composite.annotated.mp4`.
- [ ] **Step 4: Run the tests, expecting a pass.** Mutation-check the pixel
  test by breaking the pad rounding.
- [ ] **Step 5: Commit.** `feat(recording): burn annotation marks into the composite video`

### Task 5: Serve the marked composite

**Files:** Modify `src/app/routers/recordings.ts` (`/composite.mp4`),
`src/services/recording/proof-bundle.ts` (`populate`, `populateVideosOnly`),
and `src/services/recording/RecordingOrchestrator.ts` (stop pre-render).
Test `test/unit/proof-bundle.spec.ts`.

- [ ] **Step 1: Write the failing test.** With `resolveCompositePath` stubbed
  to an annotated file, both zips use it. When it throws, they fall back to
  the raw composite.
- [ ] **Step 2: Run it and check that it fails.**
- [ ] **Step 3: Implement.** The route and both zips call
  `resolveCompositePath` inside try/catch with a raw fallback. `stop()` fires
  `prewarmCompositeRender(groupId)` after finalising, when the composite
  exists.
- [ ] **Step 4: Run the tests, expecting a pass.** Also run the full
  `npm run test:all` with the Android SDK env, and `tsc`.
- [ ] **Step 5: Commit.** `feat(recording): downloads serve the composite with marks`

### Task 6: Live verification

- [ ] Run `npm run build`, then restart the Postgres-backed server and check
  for `[DBMigrate]` in sync and no `Fatal`.
- [ ] Record the S9+ with a second device: the iPhone, or an Android
  emulator if it won't stream. Draw a distinct mark on each tile, and clear
  one.
- [ ] Check frames from the downloaded composite: each mark sits in its own
  cell on its target, and the cleared mark ends at the clear.
- [ ] **Timing:** trigger a screen change (via adb) and a mark at a logged
  time. Compare where the mark and the change land in the composite and in
  each per-device video. Report any per-device offset separately.
- [ ] Push and open the PR.
