# Recordings library — design

Date: 2026-09-27
Status: approved in brainstorming ("go").

## Why

Live Devices records one or more phones at once: one video per phone, plus a
side-by-side composite for two or more, with bookmarks and drawn annotations.
The server keeps them for 30 days (up to 100; failed ones 2 days) and serves
every download a person might want: each video, all videos as a zip, a proof
bundle, and an annotated video.

But nothing lists them. The only way to a recording is the download bar on
Live Devices right after pressing Stop; once that page is left, a recording
can only be reached by someone who kept its group id. The lab already holds 25
recordings (28 videos, 42 MB) that nobody can find.

Decisions made in brainstorming:

| Question | Decision |
|---|---|
| Scope | **Find and replay**: a Recordings page to find past recordings, and a page that plays them in the browser with bookmarks and annotations, plus the existing downloads and delete |
| Access | **Team sees, owner deletes**: anyone who can see a phone sees its recordings (today's download rule); only the person who started a recording, or an admin, deletes it |
| Playback of several phones | **Side by side, in sync**: every phone's video in a grid, one play control and one timeline |

## Model

A **recording** in the library is a recording *group*: the rows of the
`Recording` table that share a `group_id`, one per phone. No new table.

- **When:** the earliest `started_at` of its rows is its start. The latest
  `ended_at` is its end, or none while any row is still recording.
- **Status:** `recording` if any row is `RECORDING`; `failed` if every row
  failed; otherwise `done`. A partly failed group is `done`, and its failed
  phones are shown as failed on the recording page.
- **Offsets:** a phone's **offset** is its row's `started_at` minus the
  group's start, because a phone can be added to a running recording.
  Bookmark and annotation `timecode_ms` values are read as group times:
  - Live Devices stamps annotations as `now − group start`.
  - No dashboard page creates bookmarks; only API callers do, and nothing
    defines their base, so they are read the same way.
  - For every phone that was in the recording from its start (offset 0),
    group time and video time are the same.
- **Names:** a phone's name comes from the current device list
  (`deviceTitle`), falling back to its UDID for a phone no longer in the lab.
  `device_snapshot` is empty on every row, so it can't be used.
- **Who:** **who started it** is a new nullable column, `Recording.started_by`,
  holding the user id. The orchestrator writes it on `start` and on
  `addDevice`, and it is null on rows written before this change.
- **Kept until:** `started_at` plus `recordingCleanupDays` (30 by default;
  `recordingFailedCleanupDays` for a failed one), as `CleanupService` applies
  it. The count cap (`recordingCleanupMaxCount`, 100) can remove the oldest
  sooner; the page says so in its footnote.

## Server

### `GET /xenon/api/recordings`

- Lists recording groups, newest first.
- **Query:**
  - `limit` (default 50, maximum 200) and `cursor`, which is the start time
    of the last group on the previous page;
  - `udid`: groups that include that phone;
  - `startedBy`: a user id, or `unknown` for groups with no `started_by`;
  - `since`: an ISO time;
  - `q`: a case-insensitive match against phone names, UDIDs and bookmark
    labels.
- **Visibility:** only rows whose device the caller can see
  (`filterRowsByVisibleDevice`, as `GET /recordings/:groupId` does today).
  A group none of whose rows are visible is left out.
- **Response:** `{ recordings: RecordingSummary[], nextCursor: string | null }`.

```ts
interface RecordingSummary {
  groupId: string;
  startedAt: string;        // ISO
  endedAt: string | null;   // null while recording
  durationMs: number | null;
  status: 'recording' | 'done' | 'failed';
  phones: { recordingId: string; udid: string; name: string; platform: string | null;
            status: string; offsetMs: number; durationMs: number | null;
            failReason: string | null }[];
  startedBy: { id: string; name: string } | null;
  bookmarkCount: number;
  annotationCount: number;
  keptUntil: string;        // ISO
  sizeBytes: number;
  hasComposite: boolean;
}
```

- The grouping, status, offsets and `keptUntil` are computed by a pure
  function, `summarizeRecordingGroups(rows, devices, users, retention, now)`,
  tested on its own.

### `GET /xenon/api/recordings/:groupId` (extended)

- Today it returns `{ groupId, recordings }`.
- It adds `summary: RecordingSummary`, plus the group's `bookmarks` and
  `annotations`, each carrying its `recordingId`. The recording page needs
  them, and nothing currently returns them.
- The existing fields are unchanged.

### `DELETE /xenon/api/recordings/:groupId`

- **Allowed** for the user in `started_by`, or an admin (`resolveActor`,
  `isAdmin`). A group whose rows have no `started_by` is admin-only.
- **Refusals:**
  - someone else's group gets **403** `not_owner`;
  - a group that is still recording gets **409** `recording_in_progress`;
  - a group the caller can't see gets **404**.
- **Deletes:**
  - the video files, the composite, annotation images and cached exports
    (the same files `CleanupService` removes);
  - the `Recording` rows; bookmarks and annotations cascade.
- **Answer:** `204`.

### Migration

- A Prisma migration adds `started_by String?` to `Recording`, with no
  backfill.
- `schema.json` does not change.
- The three Schema Drift Check gates apply at release.

## Dashboard

### Sidebar and routes

- **Sidebar:** a new item, **Recordings** (icon `Film`), after Live devices,
  visible to every signed-in user.
- **Routes:**
  - `/recordings` is the library;
  - `/recordings/:groupId` is a recording.
- **Titles:** "Recordings · Xenon", and "Recording · Xenon" for a recording.

### Recordings page (`/recordings`)

- **Header:** the page title and a count ("25 recordings").
- **Filters** (they keep the URL in step, like the Devices page's filters):
  - **Phone**, a menu of the phones that appear in recordings;
  - **Recorded by**, a menu of the people who recorded, plus "Unknown";
  - **When**: Any time, Last 24 hours, Last 7 days, Last 30 days;
  - **Search**, for phone names and bookmark labels.
- **A table,** one row per recording:
  - **When:** the start date and time, with "Recording…" while live;
  - **Phones:** names, with "+2" past two, and the full list in the tooltip;
  - **Length**;
  - **Recorded by:** a name, or "Unknown";
  - **Bookmarks:** a count;
  - **Status:** only when not done, as "Recording…" or "Failed".
  
  The row is a link to its recording page. A recording that is still
  running links to Live devices instead.
- **Empty states:**
  - "No recordings yet. Record phones from Live devices.", linking to it;
  - "No recordings match", with **Clear filters**.
- **Paging:** **Load more** at the bottom while there is a next page.
- **Footnote:** "Recordings are kept for 30 days, up to the newest 100."
  The numbers come from the server's retention settings, returned with the
  list.

### Recording page (`/recordings/:groupId`)

- **Header:**
  - back to Recordings;
  - the start date and time;
  - the phones, "Length 4:12" and "Recorded by …";
  - **Download** (a menu) and **Delete** (only for the owner or an admin).
- **The grid:** one tile per phone, sized like Live Devices tiles, each with
  its name.
  - A tile plays that phone's video with `currentTime = groupTime −
    offset`.
  - Before a phone's offset it shows "Joined at 0:42" over a still of its
    first frame.
  - A failed phone shows "Recording failed: <reason>".
  - A video that can't load shows "Video no longer available".
- **The transport:** one bar under the grid.
  - Play or pause (Space) and the current time out of the length.
  - A timeline you can click or drag; ← and → skip 5 s.
  - Bookmarks sit on the timeline as diamonds that show their label on hover.
  - All tiles follow the one clock. Videos that drift more than 250 ms from
    it are corrected, and a tile that stalls pauses the rest until it can
    play.
- **Bookmarks:** a list beside or under the grid, with each bookmark's
  label, time and phone. Selecting one jumps there.
- **Annotations:**
  - drawn over the phone they belong to, from their `timecode_ms` until
    `end_timecode_ms` (or to the end, as on Live Devices);
  - rendered with the existing `AnnotationOverlay`, with drawing turned off
    and the visible set passed as `committed`;
  - an **Annotations** toggle hides them.
- **Download menu:**
  - **All videos (zip)** (`videos.zip`);
  - **Side-by-side video** (`composite.mp4`, when there is one);
  - **Proof bundle** (`bundle.zip`);
  - per phone, **Video** (`video.mp4?recordingId=`) and **Video with
    annotations** (`exports/annotated.mp4?recordingId=`), the latter only
    when that phone has annotations.
- **Delete:** asks in a `Modal`: "Delete this recording? Its videos,
  bookmarks and annotations are removed for everyone." On success it returns
  to the library with a toast. The 403, 409 and 404 answers each get their
  own message.

### Live devices

After a recording stops, the download bar adds **Open in Recordings**,
linking to `/recordings/<groupId>`.

## Code

| Unit | Kind | Job |
|---|---|---|
| `src/services/recording/recordingSummary.ts` | pure | `summarizeRecordingGroups`, `matchesQuery`, `keptUntil` |
| `RecordingStore` | extended | `listGroupRows(filter, limit, cursor)`, `groupDetail(groupId)`, `deleteGroup(groupId)` (files + rows) |
| `RecordingOrchestrator` | changed | writes `started_by` on start and add-device |
| `routers/recordings.ts` | changed | the list and delete routes; the detail route adds `summary`, bookmarks and annotations |
| `web/src/components/recordings/RecordingsPage.tsx` | new | filters, table, empty states, load more |
| `web/src/components/recordings/RecordingPage.tsx` | new | header, grid, transport, bookmarks, downloads, delete |
| `web/src/components/recordings/playback.ts` | pure | `videoTimeFor(groupTime, offset)`, `visibleAnnotations(list, groupTime)`, `needsResync(videoTime, expected)`, the timeline's bookmark positions |
| `web/src/components/recordings/useSyncedPlayback.ts` | hook | one clock driving N `<video>` elements |
| `web/src/api-service/recordings.ts` | extended | `listRecordings`, `getRecording`, `deleteRecording` |
| Sidebar, `App.tsx`, `lib/document-title.ts`, `RecordingControls.tsx` | changed | the nav item, routes, titles and the Open in Recordings link |

## Errors

- **List fails:** the page shows the reason with **Retry**.
- **Recording not found or not visible:** "This recording isn't available.
  It may have been deleted, or it's on phones you can't see", with a link
  back.
- **Missing video file:** that tile shows "Video no longer available" and
  the others still play.
- **Group still recording:** the recording page says "Still recording" and
  links to Live devices. The Delete button is disabled with the reason.

## Testing

- **Server** (mocha, written first):
  - `summarizeRecordingGroups`: status, offsets, start and end, `keptUntil`
    for done and failed, and the count;
  - list visibility across teams;
  - each filter, and the cursor;
  - delete for the owner, an admin, someone else, an unknown owner, a
    running group, and a group not visible to the caller;
  - `started_by` being written on start and add-device.
- **Dashboard** (Vitest):
  - `playback.ts`: offsets, visible annotations at and around their times,
    resync;
  - the library's filters, empty states and load more;
  - the recording page's downloads by case and delete by role.
- **Viewport:** `/recordings` and `/recordings/:groupId` added to the viewport
  matrix, with route mocks and a content check that proves rows and tiles
  render.
- **Live** on the S9+ and iPhone together:
  - record with a bookmark and an annotation;
  - open the recording from Live devices and from the library;
  - play in sync, jump to the bookmark, and see the annotation on the right
    phone at the right time;
  - download each item;
  - delete as the owner;
  - check both themes for contrast.

## Not in this version

- Naming or renaming recordings.
- Appium test-session videos in the library.
- The annotated-video export's time shift for a phone added to a running
  recording. The export treats `timecode_ms` as the phone's own video time,
  but it is group time, so a late phone's marks appear late. It's worth its
  own fix.
