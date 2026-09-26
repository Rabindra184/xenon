# Interact / Annotate switch — design

Date: 2026-09-26
Status: approved in brainstorming, awaiting spec review

## Why

On Live Devices, pressing **Record** turns Annotate on
(`START_RECORDING` sets `annotateMode: true` in `recording-group-store.ts`).
In Annotate mode the tile's tap layer unmounts, so taps and swipes stop
reaching the phone until you find and turn off the Annotate button. People
record mostly to capture themselves using the phone, so the default fights the
main use.

The rest of the app is already inconsistent about this:

- A page reload during a recording lands on Interact
  (`REHYDRATE_RECORDING` sets `annotateMode: false`).
- Stop also lands on Interact.

The toolbar's single **Annotate** toggle also never says what the other mode
is.

Decisions made in brainstorming:

| Question | Decision |
|---|---|
| The control | A two-part **Interact \| Annotate** switch replacing the Annotate button |
| Keyboard | **Esc** returns to Interact, only while annotating; entering Annotate is a click |

## Behaviour

### The switch

- It replaces the Annotate button in `RecordingControls`, in the same place,
  and is always rendered. Nothing appears or disappears when recording
  starts: controls that slid under the cursor caused mis-clicks before (see
  the comment above the shape group).
- It's the shared `ui/SegmentedControl`, `size="sm"`, so the selected side
  uses the accent tonal style (#313).
- **Interact:**
  - selected whenever `annotateMode` is false;
  - tooltip: "Tap, swipe and type on the devices";
  - declares `aria-keyshortcuts="Escape"`.
- **Annotate:**
  - selected when `annotateMode` is true;
  - tooltip: "Draw marks on the recording";
  - **disabled** unless a recording is running (`canAnnotate`), with the
    tooltip "Start recording to annotate". Marks belong to a recording, and
    there is nowhere to save them otherwise.
- Choosing a side dispatches `SET_ANNOTATE_MODE` with the new value; choosing
  the side already selected does nothing.

### Defaults

- A recording **starts on Interact**. `START_RECORDING` sets
  `annotateMode: false`. The reducer test that asserted `true` flips and
  gains a comment saying why.
- Unchanged: a reload lands on Interact, and Stop returns to Interact.

### Esc

While `annotateMode` is true, a `keydown` of `Escape` anywhere on the page
dispatches `SET_ANNOTATE_MODE` false. The listener:

- is registered only while annotating (effect keyed on `annotateMode`), so
  when a tile has focus in Interact mode Esc still reaches the phone
  (Android maps it to Back in `DeviceTile.onKeyDown`);
- ignores events from `input`, `textarea`, `select` and contenteditable
  elements;
- ignores key repeats.

In Annotate mode the tile's key-handling layer is unmounted, so Esc can't
reach the phone.

### Feedback on the tiles

- The annotate chip on each recording tile changes from
  "Annotating · drag to mark" to **"Annotating · Esc to stop"**.
- The crosshair cursor already comes from `AnnotationOverlay` when it's
  enabled; no change.
- In Interact mode there is no chip and taps reach the phone, as today.

### The drawing tools

Unchanged. Rect, Circle, Arrow, Draw, the colour picker and Clear marks are
shown for the whole recording and are enabled only on the Annotate side
(`canDraw`).

## Code

| File | Change |
|---|---|
| `web/src/components/ui/SegmentedControl.tsx` | `Segment` gains `disabled?: boolean`, `title?: string` and `keyShortcuts?: string` (rendered as `disabled`, `title`, `aria-keyshortcuts`). A disabled segment ignores clicks. |
| `web/src/components/ui/segmented-control.css` | A disabled segment: `opacity: 0.45; cursor: not-allowed`, with no hover change. |
| `web/src/components/mosaic/recording-group-store.ts` | `START_RECORDING` sets `annotateMode: false`. |
| `web/src/components/mosaic/RecordingControls.tsx` | The switch replaces the Annotate button; the Esc listener; `toggleAnnotate` becomes `setMode`. |
| `web/src/components/mosaic/DeviceTile.tsx` | The chip text. |

No server changes.

## Testing

Tests written first:

- **Reducer:** `START_RECORDING` leaves `annotateMode` false.
- **`RecordingControls`:**
  - idle: an Interact tab (selected) and an Annotate tab (disabled);
  - recording: Interact is selected at start, and the shape tools are
    disabled;
  - clicking Annotate dispatches `SET_ANNOTATE_MODE` true;
  - Esc while annotating dispatches `SET_ANNOTATE_MODE` false;
  - Esc from inside an `input` doesn't;
  - Esc while not annotating dispatches nothing;
  - `aria-keyshortcuts="Escape"` is on the Interact tab.
- **`SegmentedControl`:** a disabled segment is disabled, shows its title and
  ignores clicks.
- **`DeviceTile`:** the chip reads "Annotating · Esc to stop" while
  annotating.
- Existing `RecordingControls` tests that list the toolbar's buttons are
  updated: the switch's sides are tabs, not buttons.

Verification:

- Web suite, `tsc`, the colour-literal ratchet and no new lint problems.
- **Live, on the S9+:**
  1. Start a recording and tap immediately: `POST /control/:udid/tap` reaches
     the phone.
  2. Switch to Annotate and draw a rectangle: `POST /recordings/:groupId/annotation` returns
     201.
  3. Press Esc: the switch shows Interact, and a tap reaches the phone again.
- Screenshots of the toolbar in both themes: idle, recording on Interact,
  and recording on Annotate.

## Out of scope

- Annotating outside a recording.
- Any other keyboard shortcut. Plain keys go to a focused phone, and Alt
  combinations type characters on some layouts.
- Changes to how marks are drawn, stored or rendered into the video.
