---
title: Recordings
description: Record the screens of one or several phones from the Live devices page, mark them up, replay them side by side, and download them. Limits, storage and cleanup.
---

You can record any phone's screen without a test session. The **Live devices** page shows several phones at once, records them together, and lets you draw marks on the screens while they record. Afterwards the **Recordings** page keeps every recording, replays the phones in sync, and downloads them as videos or as one bundle. This page also covers the limits on recording, where recordings are stored and when they are deleted.

Recordings made this way are separate from the video of a test session, which belongs to the session: see [Sessions and builds](./sessions.md).

## Record on the Live devices page

Open **Live devices** in the sidebar. The list on the left shows the phones you can see; click one to put it on the grid, and click it again to take it off. You can also drag a phone onto the grid. A phone that you can't add shows why: **In automation**, **Manual control by another user**, **Recording in another group**, or **Busy**. The layout buttons (1, 2×1, 2×2, 3×2 or Auto) choose how the grid is laid out.

Each tile is the phone's live screen, and you can use it as in [device control](./device-control.md): click, drag, press and hold, and type. A tile holds the phone for you, as device control does, and the phones are released again after five minutes without activity. A warning appears 30 seconds before, and a recording in progress is never released.

1. Put the phones you want on the grid.
2. Choose **Record**, which says **Record 3 devices** for three phones. The timer shows how long you have been recording.
3. Choose **Stop** when you are done.

Recording starts for all the phones or for none. If any is busy, or the limit below would be exceeded, nothing starts and a message says which phones are busy and why. A phone you are already previewing is fine. A phone that someone else holds is not: another user's live control, a running test, a recording in another group, or another user's SDK lease. If a phone fails to start but the others do, the rest record and a message names the failure.

A recording goes on if you reload the page: Xenon puts the tiles back, with the timer and the marks. While recording, you can't change which phones are on the grid.

### Interact and annotate

While recording, the **Interact** and **Annotate** switch decides what a click on a tile does. **Interact** sends it to the phone. **Annotate** draws a mark on the recording instead: pick **Rect**, **Circle**, **Arrow** or **Draw** and a colour, and draw on a tile. Marks appear in the preview and are saved with the recording at the moment you drew them. **Clear marks** ends the marks that are showing. They stay in the recording until that moment. **Esc** returns to Interact.

### Side by side

With two or more phones, Xenon also makes one **side-by-side** video with all the phones in a grid, next to each phone's own video. Phones added to a recording later, through the API, are not part of it. With one phone there is only the phone's own video.

### After you stop

The buttons beside **Stop** download the video: **Download video** for one phone, **Download videos** (a zip) for several, and **Side-by-side**. **Open in Recordings** takes you to the recording's page.

A phone's recording ends by itself if the phone stops answering. You keep what was recorded until then. A recording that produced no usable video is marked **Failed**. If the server restarts while a recording is running, that recording is marked failed too, and its phones are released.

When a recording ends, its phone is released as if you had closed the page: after 3 seconds, unless someone is watching it or another recording is reading it.

## Find and replay a recording

**Recordings** in the sidebar lists every recording you can see, newest first: when it was made, the phones, its length, who recorded it, how many bookmarks it has, and whether it is still recording or failed. Search by phone name or bookmark, and filter by **Phone**, **Recorded by** and **When** (any time, the last 24 hours, 7 days or 30 days). The filters stay in the address. A footnote says how long recordings are kept.

Open a recording to replay it. All its phones play together on one timeline, so you see them as they happened. A phone that started a little later waits at its start. **Space** plays and pauses, and the left and right arrow keys move 5 seconds. Bookmarks appear on the timeline and in a list, and a click jumps to one. **Annotations** shows or hides the marks.

**Download** offers:

| Item | What you get |
|---|---|
| **All videos (zip)** | Each phone's video, and the side-by-side one, with the marks drawn in wherever there are any. |
| **Side-by-side video** | The group's combined video, when there is one. |
| **Proof bundle** | A zip of everything, below. |
| **`<phone>`: video** | One phone's video as recorded, without marks. |
| **`<phone>`: video with annotations** | One phone's video with the marks drawn in. |

**Delete** removes a recording for everyone. Only the person who recorded it, or an admin, can delete it, and not while it is still recording. A group that includes a phone you can't see is deleted only for the phones you can see: the other team's phones, and the side-by-side video that shows them, stay until nobody is left.

### The proof bundle

The proof bundle is for evidence you want to hand on or keep. It is a zip with:

- `manifest.json`: the group, and for each phone its recording id, status, length, size and times.
- `README.md`: the same in words, with the bookmarks.
- `composite.mp4`: the side-by-side video, when the recording has one and you can see every phone in it.
- `devices/<udid>/video.mp4`, `bookmarks.json`, `annotations.json` and `device.json` for each phone. `device.json` holds the phone, its server, and the start, end and status of its recording.

### Bookmarks

Bookmarks label a moment, such as "payment screen shown". The dashboard shows them but doesn't make them: add one over the API, with the time in milliseconds after the recording started.

```bash
curl -X POST "http://localhost:4723/xenon/api/recordings/$GROUP_ID/bookmark" \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"recordingId\":\"$RECORDING_ID\",\"timecodeMs\":42000,\"label\":\"Payment screen shown\"}"
```

## Record from a script

The API behind the page records phones without it. These calls need the Member role and a token with the `devices` scope:

| Call | What it does |
|---|---|
| `POST /xenon/api/recordings` with `{"udids":["..."]}` | Starts a group. Answers `202` with `groupId` and the id of each recording. |
| `POST /xenon/api/recordings/<groupId>/add-device` with `{"udid":"..."}` | Adds a phone to a running group. |
| `POST /xenon/api/recordings/<groupId>/stop` | Stops the whole group. |
| `GET /xenon/api/recordings/<groupId>/bundle.zip` | Downloads the proof bundle. |

A refused start answers `409`: `device_busy` with the phones and why (`automation`, `manual_other`, `recording_other_group`, `leased` or `unknown`), or `concurrency_cap` with the limit.

## Limits, storage and cleanup

| Setting | Default | What it does |
|---|---|---|
| `XENON_MAX_CONCURRENT_RECORDINGS` | `4` | How many phones can be recorded at once, across all users. Each phone in a group counts as one. |
| `XENON_RECORDINGS_ASSETS_PATH` | `~/.cache/xenon/assets/sessions/recordings` | Where recordings are stored. |
| `recordingCleanupDays` | `30` | Recordings older than this are deleted. |
| `recordingCleanupMaxCount` | `100` | At most this many recordings are kept, newest first, counting each phone's video separately. |
| `recordingFailedCleanupDays` | `2` | Failed recordings hold no video, so they go sooner. |

The first two are environment variables: set them before Appium starts. The plugin options with the names `maxConcurrentRecordings` and `recordingsAssetsPath` that [Configuration](./configuration.md) lists are not read in this version. The last three are plugin options, with the flags `--plugin-xenon-recording-cleanup-days`, `--plugin-xenon-recording-cleanup-max-count` and `--plugin-xenon-recording-failed-cleanup-days`.

Each phone's video is stored in `<path>/<recording id>/video/`, and a group's side-by-side video in `<path>/_groups/<group id>/`. Videos are encoded with the ffmpeg that comes with Xenon. Cleanup runs on the schedule that deletes old builds, midnight by default, and also removes any recording folder that no recording points to. A recording that is still running is never deleted. See [Data retention](./retention.md), whose `deleteBuildAssets` setting doesn't apply to recordings.

## Phones on a node

A phone on a node is recorded on the hub, from the node's preview stream, so the recording and its marks are stored on the hub like any other. The node counts the hub's reading as a viewer, so it keeps the preview running. A node that refuses the stream ends that phone's recording. A cloud provider's phone can't be recorded. While the hub is recording a node's phone, its preview can't be stopped, because that would cut the recording short: the request is refused with `409` and `device_recording`. See [Hub and nodes](./hub-and-nodes.md).

## Related

- [Live device control](./device-control.md)
- [Data retention](./retention.md)
- [Teams](./teams.md): who can see which recordings.
- [Hub and nodes](./hub-and-nodes.md)
