# Device control: the Screenshot tab, redesigned

Date: 2026-10-03
Status: layout agreed in conversation; the user said "go" to the recommended
options (zip with `fflate`, ask before closing during a Logs recording). The
rest follows the scope agreed earlier: "polish and power tools", browser only,
approach B (the tab moves out of `device-control.tsx` into its own folder).

The second half of the request that redesigned the Logs tab (#431). Reuses its
patterns: native key listeners so an Esc the tab uses never closes device
control, `fakeLayout` in tests, the Actions tab's look (#328).

## Who it is for, and what done means

- **Testers and app engineers** capturing a phone's screen from device control
  (`/devices/<udid>/control/screenshot`), on Android and iOS, to attach to a
  bug, compare two states or point at something.
- **Done means:**
  - captures survive a reload and leaving the phone: kept in this browser, per
    phone, newest 50; Clear all and signing out remove them;
  - a capture that fails says so;
  - about 10 thumbnails are visible at 1440 × 900 instead of 2;
  - a capture is named "Screenshot 12" with its time, orientation, resolution
    and size, not a random id;
  - copy, annotate, compare two, download one, download all;
  - Delete and Clear all can be undone;
  - the look matches the Actions tab: sentence case, quiet buttons, role
    tokens, both themes;
  - no server, schema or Prisma change.

## What is wrong today

Seen live on the Galaxy S9+ at 1440 × 900, or read in `device-control.tsx`:

1. Captures live in React state only: a reload, another tab of device control
   that remounts, or leaving the phone loses them.
2. A failed capture only reaches `console.error`; the spinner stops and nothing
   else happens.
3. The rail shows two thumbnails; the rest scroll out of sight.
4. A capture is labelled "ID: f197b74d" (a uuid fragment) and its time.
5. Only Download PNG and Delete. No copy, no annotate, no compare, no download
   all.
6. Delete and Clear all can't be undone.
7. ALL-CAPS labels (NEW CAPTURE, CLEAR ALL, DOWNLOAD PNG, DELETE), a big green
   NEW CAPTURE, one hex literal.
8. Every thumbnail is the full PNG: 50 S9+ captures decode to about 850 MB.

## The tab

```
┌ Screenshots ─────────────────────── 12 of 50 kept ─ [Compare] [Download all] [Clear all] ┐
├──────────────────┬───────────────────────────────────────────────────────────────────────┤
│ [Take screenshot]│                    ┌─────────────┐                                    │
│ ┌────┐ ┌────┐    │                    │  selected   │                                    │
│ │ 12 │ │ 11 │    │                    │  capture    │                                    │
│ └────┘ └────┘    │                    └─────────────┘                                    │
│ ┌────┐ ┌────┐    │───────────────────────────────────────────────────────────────────────│
│ │ 10 │ │  9 │    │ Screenshot 12 · Today 14:32:05 · Portrait · 1440 × 2960 · 1.2 MB      │
│   … scrolls      │ [Copy] [Annotate] [Download]                              [Delete]    │
└──────────────────┴───────────────────────────────────────────────────────────────────────┘
```

### Header

- Title "Screenshots", as the Actions tab titles its sections.
- "12 of 50 kept". At 50 it reads "50 of 50 kept · the oldest goes when you
  take another".
- When this browser can't keep captures (private window, storage refused) it
  reads "Kept until you leave this page" with a title saying why. Everything
  else works from memory.
- **Compare**, **Download all**, **Clear all**: secondary buttons, small.
  Compare needs two captures, the other two one; otherwise disabled.

### Rail

- **Take screenshot**, the ordinary primary button, full rail width. While a
  capture runs it reads "Taking screenshot…" with a spinner, and a placeholder
  tile sits at the top of the grid.
- A two-column grid of thumbnails, newest first, scrolling. Each shows the
  capture's number and time; a marked copy shows a pen badge. Thumbnails are
  small images made at capture time (long side 320 px), not the full PNG.
- The grid is a `listbox`; each thumbnail an `option` with `aria-selected`.
  Arrow keys move the selection, Home / End go to the newest / oldest, Delete
  or Backspace deletes the selected capture.
- Hover shows a small delete button, as today, now with a name ("Delete
  Screenshot 12").

### Preview

- The selected capture, fitted to the area. **Actual size** (a toggle in the
  footer, or a click on the picture) shows it 1:1 in a scrolling area.
- Footer, one line: "Screenshot 12 · Today 14:32:05 · Portrait · 1440 × 2960 ·
  1.2 MB". A marked copy reads "Screenshot 13 · marked copy of 12 · …".
  Orientation and resolution come from the picture. The app on screen is left
  out: the browser can't know it without a server change.
- Actions: **Copy**, **Annotate**, **Download** (secondary), **Delete** (quiet,
  danger on hover) at the right.

### Empty state

"No screenshots yet" and one line, "Take one to keep it here. This browser
keeps the newest 50 for this phone." The rail's grid and the preview aren't
drawn.

### Narrow panel

Below a 720 px panel (a landscape phone at 1280), a container query, as Logs
uses: the rail becomes a horizontal strip of thumbnails above the preview, the
Take screenshot button at its start.

## Power tools

### Copy

`navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`. Toast
"Copied Screenshot 12". The image clipboard exists only on secure origins; a
lab dashboard on `http://<lan-ip>` has none, so there the toast says "Your
browser can't copy pictures on this address. Use Download instead."

### Annotate

Annotate turns the footer into a tool row: **Rect**, **Circle**, **Arrow**,
**Draw** (the mosaic's shapes, `aria-pressed`), a colour, **Undo mark**,
**Clear marks**, then **Cancel** and **Save copy**. The picture gets
`AnnotationOverlay` (`mosaic/AnnotationOverlay.tsx`) with the picture's aspect.

- **Save copy** paints the picture at its full resolution and every mark over
  it with `paintAnnotation`, the code the overlay draws with, and adds the
  result as a new capture, a marked copy of the original. The original is
  never changed.
- **Cancel** or Esc leaves without saving; with marks, Esc asks nothing: the
  marks are one Undo away from being redone, and Cancel says what it does.
- The rail, header and Take screenshot stay usable; selecting another capture
  leaves annotate.

### Compare

**Compare** splits the preview in two, the selected capture on the left. The
right starts on the next older capture. While comparing, a click in the rail
picks the right side; the thumbnails show "A" and "B". Each side has its own
label line. **Done** or Esc goes back to one picture. With the panel under
720 px the two sit one above the other.

### Download and Download all

- One: `<device>-screenshot-12-2026-10-03-14-32-05.png`, a marked copy
  `…-screenshot-13-marked-….png`. The device part is the Devices card name,
  reduced to letters, digits and dashes.
- All: one zip, `<device>-screenshots-2026-10-03.zip`, every kept capture under
  the same names. Made with `fflate` `zipSync` at level 0: PNGs are already
  compressed. `fflate` (about 8 KB gzipped, MIT) becomes a direct dependency;
  it is already in the tree as a transitive one.

### Delete, Clear all, Undo

- Delete and Clear all act at once and show a toast with **Undo** for 6 s:
  "Deleted Screenshot 12" / "Cleared 12 screenshots". Undo puts them back, in
  the browser's store too, and selects the restored capture.
- The toast gains an optional action (`toast(message, type, duration,
  { label, onClick })`). Clicking it runs the action and closes the toast.
- After a delete the selection moves to the next older capture, else the newer
  one.

### Failures

Every failure is a toast in plain words:

- capture: "Couldn't take a screenshot: <reason>" (`failed()` from
  `actionMessages.ts`), or "Couldn't take a screenshot. The phone sent no
  picture." when the answer has none;
- saving to this browser fails (quota): "Couldn't keep Screenshot 12 in this
  browser. It's here until you leave the page." The capture stays in memory;
- download all: "Couldn't make the zip: <reason>".

## Keeping captures in this browser

- IndexedDB database `xenon-screenshots`, store `captures`, key `id`, index
  `udid`. A record: `{ id, udid, n, takenAt, width, height, bytes, png: Blob,
  thumb: Blob, markedFrom?: number }`. Blobs, not base64: a third smaller and
  no string copies.
- `n` is the phone's next number: one more than the highest kept, so it starts
  at 1 again after Clear all.
- After each add, captures past the newest 50 for that phone are deleted.
- Loading a phone reads its records by the `udid` index, newest first. Object
  URLs are made per record and revoked when it leaves or the tab unmounts.
- **Sign-out** deletes the whole database (`clearAllScreenshotStores`, called
  from `auth-context`'s `signOut` before it redirects, best effort, never
  holding sign-out more than a second).
- `screenshotStore.ts` hides IndexedDB behind `{ list(udid), put(rec),
  delete(ids), clear(udid) }`, with a memory store used when IndexedDB is
  missing or refuses to open. Tests run the IndexedDB one against
  `fake-indexeddb` (a new dev dependency).

## Escape during a Logs recording

Agreed: ask first. While Logs records, closing device control (Esc, or "Back
to devices") opens a dialog: "Stop recording? 1,204 lines recorded so far."
**Keep recording** (default) and **Save and close**, which stops the recording
(downloading its file, as Stop does) and then closes.

- `InPlaceDialog` gains a close guard through context: `useCloseGuard(fn)`
  registers a function that may claim a close (returns true), and
  `useDialogClose()` gives children a close that runs the guard first. Esc and
  device control's back button both go through it.
- Leaving through the sidebar or the browser's back button isn't guarded.

## Structure

`web/src/components/device-control/screenshots/`:

| File | What it holds |
|---|---|
| `ScreenshotsPanel.tsx` | The tab: header, rail, preview; modes (view, compare, annotate); keys |
| `useScreenshots.ts` | Captures for one phone: load, take, add, delete, restore, clear, cap at 50 |
| `screenshotStore.ts` | IndexedDB store, memory fallback, `clearAllScreenshotStores` |
| `captureMeta.ts` | Pure: label, details line, file names, size text, orientation |
| `imageTools.ts` | Thumbnail, picture size, flattening marks (canvas) |
| `ScreenshotRail.tsx` | Take button and the thumbnail listbox |
| `ScreenshotPreview.tsx` | One picture or two, actual size, footer |
| `AnnotateBar.tsx` | The annotate tool row |
| `downloadAll.ts` | The zip |
| `copyImage.ts` | Copy a picture, false where the browser can't |
| `screenshots.css` | The tab's styles, tokens only |

`device-control.tsx` loses the screenshot state, the four handlers and the JSX,
and renders `<ScreenshotsPanel udid platform deviceName />`. The old
`.screenshot-*`, `.preview-*`, `.thumb-*` and `.empty-gallery-*` rules go from
`device-control.css` (the `screenshot-mode` scroll rules stay: Logs uses them).

## Testing

Unit (vitest, jsdom), test first:

- `captureMeta`: labels, details line, file names (unsafe device names), sizes.
- `screenshotStore`: put/list order by udid, delete, clear, the memory
  fallback when `indexedDB` is missing, `clearAllScreenshotStores`.
- `useScreenshots`: take adds and selects; a failure toasts and adds nothing;
  the 51st prunes the oldest; delete then undo restores; numbers.
- `ScreenshotsPanel`: empty state; header count; keys (arrows, Delete, Esc
  leaving compare and annotate without closing the dialog); compare picks B
  from the rail; annotate save adds a marked copy; copy where the clipboard is
  missing; download all calls the zip.
- `downloadAll`: the zip's entries and names (read back with `fflate.unzipSync`).
- `toast`: the action button runs and closes.
- `InPlaceDialog`: a guard claims Esc; `useDialogClose` runs it.
- `LogcatView`: closing while recording asks; Save and close downloads, closes.

Build, `tsc --noEmit`, Prettier on changed files, the colour ratchet (it may
only go down: `device-control.css`'s one literal goes if it is a screenshot
rule).

On the Mac later (no phones or server in the cloud): the viewport spec, the
control sweep, the light/dark contrast probe, and real-phone checks on the
Galaxy S9+ and an iPhone (capture, reload keeps them, 50 cap, copy on https and
http, annotate save, compare, zip opens, undo, sign-out clears, Esc while
recording).
