# Clear marks — remove annotations from the recording, not just the preview

**Date:** 2026-09-25
**Status:** approved, ready for planning
**Follows:** #295 (annotations land where they were drawn)

## Problem

While a Live Devices recording runs, the user draws marks on a tile. Each mark
is POSTed as an `Annotation` row with a start `timecode_ms` and later burned
into `<id>.annotated.mp4` by `AnnotationRenderService`.

"Clear marks" does not reach the server. It dispatches
`CLEAR_OVERLAY_ANNOTATIONS`, which empties the browser overlay and nothing else
(`RecordingControls.tsx`, `recording-group-store.ts`). The renderer gives every
mark `enable='gte(t,start)'`, so it stays on screen **until the end of the
video**. The result:

- A cleared mark disappears from the preview but stays in the download.
- Marks drawn on one screen are still burned in after the device has moved on
  to a different screen, so they sit over unrelated content. Observed on a real
  recording (Galaxy S9+, 2026-09-25): boxes drawn around the home-screen clock
  and search bar covered the Settings title and Display row after navigation.

## Decision: the video shows what the preview showed

A mark is visible from when it is drawn until "Clear marks" is pressed, or
until the recording ends. This matches the live overlay today, so what you saw
is what gets recorded. Marks do not expire on their own. That option was
offered and declined, because it would change the live overlay's behaviour
too.

## Approach: an end time on each mark

Add a nullable `Annotation.end_timecode_ms`. A mark is visible over
`[timecode_ms, end_timecode_ms)`. `null` means "until the end of the video",
which is today's behaviour.

Rejected alternatives:

- **A `CLEAR` pseudo-annotation row** (no migration). `buildFilterParts`
  renders an unknown shape as a rectangle, and ffmpeg `drawbox` reads
  `w=0`/`h=0` as the full input size. Any renderer that doesn't know about
  `CLEAR`, such as a rolled-back build, would paint a full-frame wash over the
  video. It would also put a fake mark in the proof bundle's
  `annotations.json`.
- **A separate `AnnotationClear` event table.** It models the events cleanly,
  but it adds a table and a join in every reader, for no user-visible gain
  over a column.

Compatibility works in both directions. Old rows have `null`, so they render
as today. Older code reading new rows ignores the column and falls back to
today's behaviour, never to something worse.

## Design

### Data

- `prisma/schema.prisma`: `end_timecode_ms Int?` on `Annotation`.
- A migration in `prisma/migrations/20260925120000_annotation_end_timecode/`:
  `ALTER TABLE "Annotation" ADD COLUMN "end_timecode_ms" INTEGER;`
  This has the same shape as `20260809035245_session_user_id`, and it applies
  on SQLite (`db push`) and on Postgres (`migrate deploy`) at boot through
  `runMigrations`. It is nullable, so existing rows need no backfill.

### Server

- `RecordingStore.clearAnnotations(recordingIds, timecodeMs)`: `updateMany`
  where `recording_id IN recordingIds`, `end_timecode_ms IS NULL` and
  `timecode_ms <= timecodeMs`. It sets `end_timecode_ms = timecodeMs` and
  returns the count.
  - The `IS NULL` guard makes a repeated clear a no-op for marks that are
    already closed.
  - The `<=` guard leaves a mark that started after the clear time alone.
- `RecordingOrchestrator.clearAnnotations(groupId, timecodeMs)` resolves the
  group's recording ids with `store.listGroup` and delegates. It clears the
  whole group, because the button clears every tile.
- The route `POST /recordings/:groupId/annotations/clear` takes the body
  `{ timecodeMs: number }` and returns:
  - `400` when `timecodeMs` is not a finite number ≥ 0.
  - `404 not_found` when `isGroupVisibleToAuth` fails, the same check the GET
    routes use.
  - `200 { cleared }` on success, and `500 internal` on a store failure.
- No socket event. Nothing in the dashboard listens for
  `RECORDING_ANNOTATION_ADDED` today.

### Render (`annotation-render.ts`)

- A mark with an end time gets `enable='gte(t\,S)*lt(t\,E)'`. `lt` rather than
  `between`, because `between` includes both ends and would show the mark on
  the frame at the moment it was cleared.
- A mark whose end is at or before its start is skipped: it was never visible.
- The end is not clamped. An end past EOF keeps the mark until the video ends.
  The start is clamped exactly as today.
- `cacheStamp` includes the end time, so clearing marks re-renders
  `annotated.mp4`. The stamp prefix goes to `v3`, forcing one re-render of
  cached files whose stamps predate the field.

### Client

- `api-service/recordings.ts`: `clearAnnotations(groupId, timecodeMs)`.
- `DeviceMosaicView` owns a single write queue (a promise chain in a ref).
  `onAnnotation` and a new `onClearMarks` both enqueue, so writes reach the
  server in the order the user made them.
  - This matters because a mark whose POST is still in flight when Clear is
    pressed could otherwise be created *after* the clear. It would stay open
    and remain in the video until the end.
  - One failed write must not block the rest of the queue.
- `onClearMarks` captures `Date.now() - startedAt` **at the click**, not when
  the request leaves. It dispatches `CLEAR_OVERLAY_ANNOTATIONS` immediately,
  so the preview clears at once as today. It then enqueues the POST.
  - On failure it shows the error banner: "Couldn't clear marks from the
    recording. They will still appear in the video."
- `RecordingControls` gets an `onClearMarks` prop instead of dispatching the
  clear itself.
- Copy updates:
  - Annotate hint: "Shapes stay on screen and appear in Download video until
    you press Clear marks."
  - Clear button title: "Clear marks from the preview and the recording."

### Proof bundle

`annotations.json` serializes the rows, so it gains `end_timecode_ms` with no
code change.

## Testing

- **Mocha, `annotation-render.spec.ts`:**
  - A mark with an end time emits `gte(t\,S)*lt(t\,E)`.
  - A mark with no end time emits `gte(t\,S)` exactly as before.
  - A mark with end ≤ start emits nothing.
  - The stamp changes when an end time is set.
- **Mocha, `recording-store.spec.ts`:** the `clearAnnotations` `where` filter,
  covering `IS NULL`, `<=`, and a recording id outside the group.
- **Mocha, route:** 400 for a missing or negative `timecodeMs`, 404 for an
  invisible group, and 200 with the count.
- **Vitest:**
  - Clear sends the click-time timecode.
  - Clear waits for a pending annotation write.
  - A failed write does not stall the queue.
- **Live, required:**
  - Restart the real Postgres-backed server and confirm `[DBMigrate] Database
    schema in sync`, the listener started, and no `Fatal` in the log (see the
    schema-change rule).
  - Record on the S9+: draw mark A, press Clear, draw mark B.
  - Frames extracted from the downloaded video must show A only before the
    clear time and B only after it.
  - Cover the other provider as well: apply the migrations to a scratch
    SQLite file with `prisma migrate deploy` and confirm the column exists.
    The unit suite does not apply migrations, so it cannot stand in for this.

## Out of scope

- Undoing a single mark, or clearing only one tile.
- The existing `POST /annotation` and `/bookmark` routes skip
  `isGroupVisibleToAuth`. The new route checks it, but fixing the old ones is
  a separate change.
