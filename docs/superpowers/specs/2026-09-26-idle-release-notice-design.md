# Idle release notice — design

Date: 2026-09-26
Status: approved in brainstorming, awaiting spec review

## Why

Live Devices releases your devices after 5 minutes without mouse or keyboard
activity (`IDLE_TOTAL_MS` in `DeviceMosaicView.tsx`). A 30-second "Are you
still there?" dialog comes first. Two problems:

1. **The release is silent.** The tiles vanish and nothing explains why when
   you come back. The dialog warned you, but you were away.
2. **It destroys recordings.** The idle timer runs whenever tiles exist,
   including during a recording. Its release sends `POST
   /control/:udid/stream/stop`, and neither stream service checks for an
   active recording. Measured on 2026-09-26 on the lab Galaxy S9+:

   | Step | Result |
   |---|---|
   | Start a recording | 202 |
   | The release's `stream/stop` | 200; the device lock was dropped |
   | Stop the recording | status **FAILED**, **28 bytes**: all 38 s lost |

   A recording nobody clicks through, such as an automated test run, loses
   everything after 5 minutes.

Decisions made in brainstorming:

| Question | Decision |
|---|---|
| The timer during a recording | Paused. The 5-minute clock starts fresh after Stop. |
| What you see after a release | A lasting banner with **Restore devices** and **Dismiss** |

## Behaviour

### The timer

- `useIdleDetector` is enabled only when there are tiles **and** no
  recording is in progress (`state.recordingPhase === 'idle'`).
- When a recording stops, the hook's existing enable path schedules a fresh
  5-minute clock. Nothing new is needed there.
- The warning dialog can't appear during a recording. If it is already open
  when Record is pressed, disabling the hook closes it.

### The banner

- It shows only after an automatic release, when the warning countdown hits
  zero. A release chosen with **Release now** in the dialog shows no banner.
- The text is "Released N device(s) after 5 minutes without activity.",
  with the count and a singular or plural noun.
- Buttons: **Restore devices** and **Dismiss**.
- It stays until you dismiss it or everything is restored. A page reload
  also clears it, because it lives in page state.
- It appears above the grid, in the same place as the recording banners,
  with its own neutral style: `--surface-2` background, `--border` edge and
  `--text`. The recording banners' `info` tone is green (the success
  colour), which would read as good news.

### Restore

- On timeout, the released tiles (`MosaicTile[]`, in grid order) are saved.
- **Restore devices** checks each saved tile against the current device
  list, using a pure function (below). A device comes back when it is
  online, and free or held by your own manual lock. It comes back through
  the normal add path (`ADD_TILE` plus `XenonApiService.startStream`), the
  same as clicking it in the device list. A 409 from `startStream` removes
  the tile again, as it does today.
- A device another user now holds is skipped, and so is one that is offline
  or no longer listed.
- **Result:**
  - If everything came back, the banner closes.
  - Otherwise it keeps its neutral style and changes its text, for example
    "Restored 1 device.
    Pixel 8 Pro is now in use by someone else.", and offers only
    **Dismiss**. A device missing from the list is described as "is no
    longer connected".
- The layout isn't touched: releasing never changed it.

### `planRestore`

`planRestore(saved: MosaicTile[], devices: DeviceRow[], myUserId: string | null)`
returns `{ restore: DeviceRow[]; skipped: { name: string; reason: 'in_use' | 'offline' | 'gone' }[] }`.
It is pure and lives in `web/src/components/mosaic/idleRestore.ts`.

- A device that isn't in the list gives `gone`.
- `offline` gives `offline`.
- `busy` gives `in_use`, unless its lock is your own manual lock.
- Otherwise the device is restored.

The same file holds `releaseMessage(n)` and `restoreMessage(restored, skipped)`,
the banner texts, so the wording is tested directly.

## Code

| File | Change |
|---|---|
| `web/src/components/mosaic/idleRestore.ts` (new) | `planRestore`, `releaseMessage`, `restoreMessage` |
| `web/src/components/mosaic/IdleReleaseBanner.tsx` (new) | The banner: a message plus optional Restore and Dismiss buttons |
| `web/src/components/mosaic/DeviceMosaicView.tsx` | The idle hook's `enabled` gains `&& state.recordingPhase === 'idle'`; `onTimeout` saves the tiles before `releaseAll()`; the banner is rendered; Restore runs through `planRestore` and the add path. **Release now** calls `releaseAll()` without saving. |

No server changes. The server's `stream/stop` still accepts a device that is
being recorded. That is a separate follow-up: the dashboard no longer sends it
during a recording, but another client could.

## Testing

Tests written first:

- **`planRestore`:**
  - a free device is restored;
  - your own manual lock is restored;
  - another user's lock is skipped as `in_use`;
  - an automation session is skipped as `in_use`;
  - an offline device is skipped as `offline`;
  - a device missing from the list is skipped as `gone`;
  - the saved order is kept.
- **`releaseMessage`:** 1 device and 2 devices.
- **`restoreMessage`:**
  - everything restored gives null (close the banner);
  - some skipped;
  - none restored.
- **`IdleReleaseBanner`:** renders the message; Restore and Dismiss call
  their handlers; Restore is hidden when not offered.
- **Recording pause:** the view's hook is disabled while recording. This is
  tested through a small exported helper,
  `idleWatchEnabled(tileCount, recordingPhase)`, in `idleRestore.ts`.

Live on the S9+, about 12 minutes of real waiting:

1. Record for 6 minutes without touching the page. No warning appears. After
   Stop the video is intact: `STOPPED`, and bigger than 1 MB.
2. Leave the page idle for 5.5 minutes. The warning appears and then the
   release happens, and the banner shows "Released 1 device after 5 minutes
   without activity."
3. Click **Restore devices**. The tile returns, the stream is live, the
   device holds your lock again, and the banner closes.

## Out of scope

- A server-side guard on `stream/stop` during a recording (follow-up).
- Changing the 5-minute length or making it configurable.
- Keeping the banner across a reload.
