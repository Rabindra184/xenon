# Multi-Device Mosaic, Free-Form Recording & Manual-Test Proof Pack (Design Spec)

**Date:** 2026-04-27
**Scope:** New, additive feature surface for manual QA engineers — view multiple device live streams in one window, record one or many devices simultaneously (independent of an Appium session), annotate frames, drop bookmarks, and export the result as a self-contained proof bundle.
**Hard constraint:** Must not change or break any existing functionality. All new entities, routes, services, components, schema fields, and socket channels are **additive**.
**Out of scope (deferred to later phases):** Synchronized log/network overlay during playback (Phase 2), tap-event visualization (Phase 2), side-by-side comparison playback (Phase 2), voice narration (Phase 2), shareable signed URLs with TTL (Phase 3), Jira/GitHub/Linear adapters (Phase 3), AI-assisted summary draft (Phase 3), tap heatmap (Phase 3), SSIM visual-diff mode (Phase 4).

## Goal

Manual QA engineers today must screen-record their laptop, narrate over Slack, and re-explain device state when filing a bug. Xenon already produces every input they need (per-device MJPEG, hardware-encoded fMP4, logs, HAR, healing events) but only when an Appium session is running. This feature exposes those primitives directly to the manual tester:

1. **See** multiple devices side-by-side in one browser tab.
2. **Record** one or many of them on demand, with no session required.
3. **Mark** the moment a bug occurred with a bookmark and an annotation drawn on the frame.
4. **Export** a single zip — video(s), bookmarks, annotations, logs, device metadata — that another engineer can open and understand without further context.

This is the "manual" complement to the existing automated session bug-report flow.

## Non-Regression Posture (load-bearing)

Every change is **additive**. None of the following may be modified in incompatible ways:

| Existing behavior | Status under this design |
|---|---|
| Per-session live MJPEG at `GET /session/:sessionId/live_video` | Untouched. New routes mount under `/xenon/api/recordings/*` and `/xenon/devices/live`. |
| `Session.video_recording`, `video_recording_enabled`, `has_live_video` columns | Untouched. New `Recording` model is a separate table. |
| `VideoPipelineService.startRecording()` / `stopRecording()` for sessions | Untouched. New `RecordingOrchestrator` *consumes* `VideoPipelineService` for non-session captures; session-bound captures continue to call it directly. |
| `AndroidStreamService` / `IOSStreamService` viewer-counting and idle teardown | Untouched. The mosaic adds viewers exactly the same way the existing session view does — `<img src="…/live_video">`. The recorder is *also* a normal MJPEG viewer; backpressure in `UniversalMjpegProxy` already accommodates this. |
| Existing socket events (`SESSION_STARTED`, `SESSION_STOPPED`, `SESSION_COMMAND`, `HEALING_EVENT`) | Untouched. New events use new namespaces (`RECORDING_STARTED`, `RECORDING_STOPPED`, `RECORDING_BOOKMARK_ADDED`). |
| Existing bug-report bundle (`src/services/bug-report/*`) | Reused by composition. The proof pack imports `archive`, `manifest`, `readme`, `window`, `video-slice` and adapts them; it does not modify them. |
| Prisma migrations | Only **add** tables and columns; no rename, drop, or type change. Existing migrations remain valid. |
| `schema.json` plugin args | Only **add** new optional args; no rename, default change, or removal. |

A regression-guard test pass is part of the implementation plan: existing session recording, session bug-report download, and existing dashboard streaming flows must remain green.

## What ships in Phase 1

The feature surface in this spec. Phase 2/3/4 are listed under "Out of scope" above and will get their own specs.

1. New route `/xenon/devices/live` — multi-device mosaic.
2. Server-side multi-device recording independent of `Session`.
3. Live frame annotation (arrow / rect / freehand / text) persisted as overlay metadata, not pixels.
4. Bookmarks (hotkey `B`, optional note).
5. Frame-precise annotated screenshot.
6. Proof-bundle zip download (single recording or multi-device group).
7. Burn-in metadata watermark on optional "Download annotated MP4" export.

## Architecture

```
┌──────────────────────── FRONTEND (web/) ────────────────────────┐
│ Route: /xenon/devices/live                                      │
│   <DeviceMosaicPage>                                            │
│     ├─ <DevicePicker>      pick from online devices             │
│     ├─ <LayoutSelector>    1 / 2x1 / 2x2 / 3x2                  │
│     ├─ <RecordingControls> ● ⏸ ⏹ 🔖 ✎ ⤓                        │
│     └─ <DeviceMosaic>                                           │
│         └─ <DeviceTile udid mjpegUrl focused>                   │
│             ├─ <img src=".../live_video">       (existing)     │
│             └─ <AnnotationOverlay canvas>        (NEW)         │
│   State: useRecordingGroupStore() (zustand)                     │
│   Socket: subscribes to recording:{groupId}:state               │
└─────────────────────────────────────────────────────────────────┘
                              │  REST + WS
                              ▼
┌──────────────────────── BACKEND (src/) ─────────────────────────┐
│ Routes (NEW, mounted in src/app/index.ts):                      │
│   POST   /xenon/api/recordings                                  │
│   POST   /xenon/api/recordings/:groupId/stop                    │
│   POST   /xenon/api/recordings/:groupId/bookmark                │
│   POST   /xenon/api/recordings/:groupId/annotation              │
│   GET    /xenon/api/recordings/:groupId                         │
│   GET    /xenon/api/recordings/:groupId/bundle.zip              │
│   GET    /xenon/api/recordings/:groupId/exports/annotated.mp4   │
│                                                                 │
│ RecordingOrchestrator (NEW)                                     │
│   ├─ start(udids[], opts) → { groupId, recordings[] }          │
│   ├─ stop(groupId)                                              │
│   ├─ addBookmark(groupId, deviceUdid?, timecodeMs, label, note) │
│   ├─ addAnnotation(groupId, deviceUdid, timecodeMs, shape...)   │
│   └─ exportBundle(groupId)  → zip stream                        │
│       composes existing bug-report primitives:                  │
│         archive.ts, manifest.ts, readme.ts                      │
│                                                                 │
│ Per-device capture (one ffmpeg per UDID, capped):               │
│   wraps VideoPipelineService.startRecording(udid, outPath)      │
│   guarded by MAX_CONCURRENT_RECORDINGS (default 4)              │
│                                                                 │
│ Persistence:                                                    │
│   Prisma: Recording, Bookmark, Annotation (new tables)          │
│   Files:  {sessionAssetsPath}/recordings/{groupId}/{udid}/...   │
│                                                                 │
│ Events (NEW):                                                   │
│   RECORDING_STARTED, RECORDING_STOPPED,                         │
│   RECORDING_BOOKMARK_ADDED, RECORDING_ANNOTATION_ADDED,         │
│   RECORDING_FAILED                                              │
└─────────────────────────────────────────────────────────────────┘
```

## Files Touched

### Backend (NEW)
| File | Purpose |
|---|---|
| `src/services/recording/RecordingOrchestrator.ts` | Lifecycle controller, ~280 LOC |
| `src/services/recording/recording-store.ts` | Prisma read/write helpers, ~120 LOC |
| `src/services/recording/concurrency-gate.ts` | Hard cap + reason-when-rejected, ~40 LOC |
| `src/services/recording/proof-bundle.ts` | Composes bug-report primitives + adds annotation/bookmark JSON, ~180 LOC |
| `src/services/recording/annotation-render.ts` | ffmpeg-overlay pass for "Download annotated MP4", ~100 LOC |
| `src/app/routers/recordings.ts` | Express route module, ~140 LOC |

### Backend (MODIFIED — additive only)
| File | Change |
|---|---|
| `src/app/index.ts` | Register `recordings.ts` router (~+2 lines) |
| `src/app/swagger-docs.ts` | Document new endpoints |
| `src/dashboard/event-manager.ts` | Add `emitRecording*` helpers (~+50 LOC, no existing emitters changed) |
| `src/dashboard/socket-events.ts` | Add new `RECORDING_*` event constants |
| `prisma/schema.prisma` | Append `Recording`, `Bookmark`, `Annotation` models. No edits to existing models. |
| `prisma/migrations/<new>/migration.sql` | Generated, additive only |
| `schema.json` | Add optional `maxConcurrentRecordings` (default 4) and `recordingsAssetsPath` (default `<sessionAssetsPath>/recordings`) |

### Frontend (NEW)
Following the existing convention: feature folder under `web/src/components/`, route entry under `web/src/routes/`, API client under `web/src/api-service/`.

| File | Purpose |
|---|---|
| `web/src/routes/devices-live.tsx` | Route entry; renders `<DeviceMosaicView>`, ~30 LOC |
| `web/src/components/mosaic/DeviceMosaicView.tsx` | Page shell, ~140 LOC |
| `web/src/components/mosaic/DeviceMosaic.tsx` | Grid renderer, ~80 LOC |
| `web/src/components/mosaic/DeviceTile.tsx` | One tile (img + overlay + status), ~120 LOC |
| `web/src/components/mosaic/AnnotationOverlay.tsx` | Canvas drawing layer, ~200 LOC |
| `web/src/components/mosaic/RecordingControls.tsx` | Top bar, ~120 LOC |
| `web/src/components/mosaic/DevicePicker.tsx` | Online-device selector, ~80 LOC |
| `web/src/components/mosaic/LayoutSelector.tsx` | 1 / 2x1 / 2x2 / 3x2, ~50 LOC |
| `web/src/components/mosaic/recording-group-store.ts` | Local zustand store (matches sibling-component co-location pattern), ~80 LOC |
| `web/src/api-service/recordings.ts` | Typed fetch wrappers, ~80 LOC |

### Frontend (MODIFIED — additive only)
| File | Change |
|---|---|
| `web/src/App.tsx` | Register the new `/devices/live` route alongside existing routes. No existing routes touched. |
| `web/src/components/header/*` or `web/src/components/sidebar/*` | Add nav link "Live Devices" wherever the existing primary nav lives (verified in implementation plan). |

### Tests (NEW)
| File | Coverage |
|---|---|
| `test/unit/services/recording/recording-orchestrator.spec.ts` | start/stop/bookmark/annotation, concurrency cap, failure paths |
| `test/unit/services/recording/proof-bundle.spec.ts` | Bundle layout, manifest correctness, redaction reuse |
| `test/integration/recordings-router.spec.ts` | End-to-end REST contract |
| `test/regression/no-regression.spec.ts` | Asserts existing session recording + bug-report routes still work |

No new npm dependencies. `archiver`, `ffmpeg`, `prisma`, `socket.io`, and zustand (already in `web/`) cover everything.

## Data Model

```prisma
model Recording {
  id                 String   @id @default(uuid())
  group_id           String                  // groups N devices recorded together
  device_udid        String
  session_id         String?                 // optional FK; null for free-form captures
  started_at         DateTime
  ended_at           DateTime?
  status             String                  // RECORDING | STOPPED | FAILED | DISCARDED
  file_path          String                  // absolute path to fMP4
  duration_ms        Int?
  size_bytes         Int?
  device_snapshot    String?                 // JSON: model, os, app under test, build, locale, orientation
  fail_reason        String?
  bookmarks          Bookmark[]
  annotations        Annotation[]
  Session            Session? @relation(fields: [session_id], references: [id])

  @@index([group_id])
  @@index([device_udid])
  @@index([started_at])
}

model Bookmark {
  id            String   @id @default(uuid())
  recording_id  String
  timecode_ms   Int
  label         String
  note          String?
  created_at    DateTime @default(now())
  Recording     Recording @relation(fields: [recording_id], references: [id], onDelete: Cascade)

  @@index([recording_id, timecode_ms])
}

model Annotation {
  id            String   @id @default(uuid())
  recording_id  String
  timecode_ms   Int                          // 0 = applies to a still-frame screenshot
  shape         String                       // ARROW | RECT | CIRCLE | TEXT | FREEHAND
  geometry      String                       // JSON; coords normalized to 0..1 of frame
  color         String
  text          String?
  author        String?
  created_at    DateTime @default(now())
  Recording     Recording @relation(fields: [recording_id], references: [id], onDelete: Cascade)

  @@index([recording_id, timecode_ms])
}
```

`Session` gains an inverse relation (`Recording[]`) but no new required fields. The relation is optional, preserving every existing row.

## REST Contract

```
POST /xenon/api/recordings
  body: { udids: string[], note?: string, sessionId?: string }
  202: { groupId, recordings: [{ id, udid, status }] }
  409: { error: "concurrency_cap", limit, active }

POST /xenon/api/recordings/:groupId/stop
  200: { groupId, recordings: [{ id, udid, status, durationMs, sizeBytes }] }

POST /xenon/api/recordings/:groupId/bookmark
  body: { deviceUdid?: string, timecodeMs: number, label: string, note?: string }
  201: { id, ... }

POST /xenon/api/recordings/:groupId/annotation
  body: { deviceUdid, timecodeMs, shape, geometry, color, text? }
  201: { id, ... }

GET  /xenon/api/recordings/:groupId
  200: { groupId, recordings, bookmarks, annotations }

GET  /xenon/api/recordings/:groupId/bundle.zip
  200: stream of zip; layout in §"Proof Bundle"

GET  /xenon/api/recordings/:groupId/exports/annotated.mp4?udid=…
  200: stream of mp4 with annotations rendered into pixels (lazy, per-request)
```

All endpoints are versioned-additively. Nothing under `/xenon/api/sessions/*` or `/session/*` is altered.

## Proof Bundle Layout

```
proof-{groupId}-{ISO-timestamp}.zip
├── manifest.json            # groupId, devices, durations, app under test, env, Xenon version
├── README.md                # auto-generated, human-readable summary with bookmark timeline
├── devices/
│   ├── {udid-1}/
│   │   ├── video.mp4               # raw fMP4
│   │   ├── annotations.json        # all annotations for this device
│   │   ├── bookmarks.json          # all bookmarks for this device (or shared)
│   │   ├── frames/                 # optional: PNG exports of bookmarked frames
│   │   ├── device.json             # model, os, app version, build, locale, orientation
│   │   └── logs.txt                # ONLY if sessionId present (Phase 1 stays minimal here)
│   └── {udid-2}/…
└── exports/
    └── annotated.mp4         # optional, only if user clicked "Download annotated"
```

`manifest.json`, `README.md`, and `archive` step are produced by the existing `src/services/bug-report/{manifest,readme,archive}.ts`, with one new adapter input shape (`RecordingGroup`) added there or wrapped in `proof-bundle.ts`. The decision between "edit bug-report primitives" vs "wrap them" is deferred to the implementation plan; both are additive.

## Concurrency, Disk, and Resource Guards

- **Concurrency cap**: `MAX_CONCURRENT_RECORDINGS` (default 4). When exceeded, `POST /recordings` returns `409 concurrency_cap` with the current limit and active count.
- **Per-device idempotency**: starting a second recording for an already-recording UDID returns the existing one rather than spawning a duplicate ffmpeg.
- **Crash-safe finalization**: on Xenon shutdown, in-progress recordings receive `SIGINT` and are marked `STOPPED` if they finalize cleanly, `FAILED` otherwise. fMP4's `frag_keyframe` flag (already used by `VideoPipelineService`) means partial files remain playable.
- **Disk-budget surfacing**: the mosaic header shows live "Recordings: 2 / 4 · ~1.2 GB on disk." No automatic deletion in Phase 1.
- **Backpressure**: if the recorder ffmpeg can't keep up with the MJPEG source, `UniversalMjpegProxy`'s existing 4 MB drop threshold applies. We log `RECORDING_FRAME_DROPS` once per minute per recording rather than spamming.

## Annotations: Metadata, Not Pixels

- Stored normalized (`0..1`) in `Annotation.geometry` so they survive resolution changes.
- Rendered live by `<AnnotationOverlay>` (HTML5 canvas above the `<img>` MJPEG).
- The proof bundle includes a clean `video.mp4` plus `annotations.json`. **Pixels are only baked at explicit user request** via `GET /recordings/:groupId/exports/annotated.mp4`, which runs a single ffmpeg pass with `drawbox`/`drawtext`/overlay PNGs generated from the annotation list. Slow path; gated behind a button so it's never on the hot path.

## Frame-Precise Screenshot

A pause-and-annotate path that doesn't require recording:
1. User clicks ⏸ on a tile → frontend grabs the current `<img>` frame to a canvas.
2. User draws annotations.
3. User clicks "Save as proof" → `POST /recordings` with `udids:[udid], stillFrameOnly:true`. Server creates a `Recording` row with `duration_ms=0`, persists the PNG (annotated and clean) to `frames/`, persists annotations.
4. The same proof-bundle zip endpoint works for still-frame Recordings.

## Socket Events (NEW)

| Event | Payload |
|---|---|
| `RECORDING_STARTED` | `{ groupId, recordings: [{id, udid}], startedAt }` |
| `RECORDING_STOPPED` | `{ groupId, recordings: [{id, udid, status, durationMs, sizeBytes}] }` |
| `RECORDING_BOOKMARK_ADDED` | `{ groupId, bookmark }` |
| `RECORDING_ANNOTATION_ADDED` | `{ groupId, annotation }` |
| `RECORDING_FAILED` | `{ groupId, recordingId, udid, reason }` |
| `RECORDING_FRAME_DROPS` | `{ recordingId, droppedInLastMinute }` (throttled) |

Existing events are untouched.

## Configuration (`schema.json`, additive only)

```jsonc
{
  "maxConcurrentRecordings": {
    "type": "integer",
    "minimum": 1,
    "maximum": 16,
    "default": 4,
    "description": "Hard cap on simultaneous free-form (non-session) screen recordings."
  },
  "recordingsAssetsPath": {
    "type": "string",
    "description": "Override directory for free-form recording artifacts. Defaults to `<sessionAssetsPath>/recordings`."
  }
}
```

Both are optional; existing deployments require no config change.

## Edge Cases & Failure Modes

| Case | Handling |
|---|---|
| Device unplugged mid-recording | ffmpeg exits → `Recording.status=FAILED`, `fail_reason="device_disconnected"`, partial fMP4 retained (still playable thanks to `frag_keyframe`). |
| Two engineers click Record on the same UDID | Idempotent: same `Recording` returned to both; both clients receive `RECORDING_STARTED`. |
| Browser tab closed during recording | Server-side recording is unaffected; `GET /recordings/:groupId` reflects state on next page load. |
| `recordingsAssetsPath` not writable | Start fails fast with a clear 500; existing session recording (different path) remains usable. |
| Annotation submitted for a stopped recording | Allowed (engineer marks up after the fact). Stored against `timecode_ms` which is now relative to a finalized duration. |
| Concurrency cap reached while a free-form session and a session-driven recording both run | Session-driven recordings (existing path) **do not** count against the cap and are not rate-limited. The cap only applies to free-form. This protects the existing automated test path. |

## Test Plan (regression-anchored)

1. **Regression**: with the new feature compiled in, run existing session E2E (`npm run test:e2e`) and ensure session video + session bug-report bundle behave identically to `main`. This is encoded as a checked-in test that fails if those output shapes change.
2. **Unit**: `RecordingOrchestrator` start/stop/bookmark/annotation, concurrency cap, idempotency, crash-safe finalization (using stubbed ffmpeg).
3. **Integration**: full REST contract against an in-process Express server, including bundle-zip round-trip and `409 concurrency_cap` shape.
4. **Frontend**: component tests for `DeviceTile` (overlay coordinate math), `AnnotationOverlay` (shape persistence), and the recording controls reducer.
5. **Manual smoke**: one Android + one iOS device, 2-up mosaic, 30s recording, two bookmarks, three annotations on each, download bundle, verify on a second machine.

## Open Questions (kept open intentionally; defaults assumed unless flipped)

1. **Recording naming**: default to `proof-{groupId}` in UI, but allow user-supplied label at start (`POST /recordings { note }` already accommodates this). Default labels are auto-generated from device model + timestamp.
2. **Logs in Phase 1 bundle**: if `sessionId` is supplied at recording start, we include `logs.txt` (reusing the bug-report log collector). For free-form recordings we omit it in Phase 1 — Phase 2 introduces a dedicated time-windowed log capture for free-form recordings.
3. **Auth**: Phase 1 reuses existing dashboard auth posture exactly. Shareable signed URLs are Phase 3.

## Phasing Recap

| Phase | Contents | Status after this spec |
|---|---|---|
| 1 | Mosaic, multi-device free-form recording, bookmarks, annotation overlay, frame-precise screenshot, proof bundle, watermark export | **This spec** |
| 2 | Synced log/network overlay, tap visualization, side-by-side playback, voice narration, healing-event timeline | Future spec |
| 3 | Shareable signed URLs, ticket-tracker integrations, AI-assisted summary, tap heatmap | Future spec |
| 4 | SSIM-diff visual regression | Future spec |

## Why this is safe to merge

- All schema changes are additive (`Recording`, `Bookmark`, `Annotation` are new tables; `Session` gets an inverse-only relation).
- All routes mount under new paths.
- All socket events use new constants.
- Existing services (`VideoPipelineService`, `AndroidStreamService`, `IOSStreamService`, bug-report primitives, `EventManager`) are *consumed*, not modified.
- The regression test pins existing session recording + bug-report behavior; CI fails if either drifts.
- The concurrency cap protects the host from "8 ffmpegs running because someone clicked Record on every tile."
