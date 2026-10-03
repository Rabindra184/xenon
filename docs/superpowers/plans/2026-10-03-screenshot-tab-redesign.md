# Screenshot tab redesign: plan

Spec: `docs/superpowers/specs/2026-10-03-screenshot-tab-redesign-design.md`.
Each task is test first: write the failing test, see it fail, make it pass.
Checks after each task: `cd web && npx vitest run <changed specs>`; at the end
the whole suite, `npx tsc --noEmit -p .`, `npm run build:xenon`, Prettier on
changed files only, and the colour ratchet.

## Cloud tasks

1. **Dependencies.** `fflate` (dependency) and `fake-indexeddb` (dev) in
   `web/package.json` and the lockfile.
2. **`captureMeta.ts`.** `captureLabel`, `detailsLine`, `captureFilename`,
   `zipFilename`, `formatBytes`, `orientationOf`, `deviceSlug`.
3. **`screenshotStore.ts`.** IndexedDB store (`list`, `put`, `delete`,
   `clear`), memory fallback, `openScreenshotStore()`,
   `clearAllScreenshotStores()`. Tests on `fake-indexeddb`.
4. **Toast action.** Optional `{ label, onClick }` fourth argument; the button
   runs it and closes the toast.
5. **Browser helpers.** `copyImage.ts`, `downloadAll.ts` (zip read back with
   `unzipSync`), `imageTools.ts` (`pictureSize`, `makeThumbnail`,
   `flattenMarks`, each with a fallback where canvas is missing).
6. **`useScreenshots.ts`.** Load per phone, take, delete / clear with undo,
   cap at 50, numbering, store failures kept in memory.
7. **Components.** `ScreenshotRail`, `ScreenshotPreview`, `AnnotateBar`,
   `ScreenshotsPanel`, `screenshots.css`.
8. **Wire in.** `device-control.tsx` renders the panel; the old state,
   handlers, JSX and CSS go; `device-control.test.tsx` updated.
9. **Sign-out** clears the stores.
10. **Close guard.** `InPlaceDialog` `useCloseGuard` / `useDialogClose`; device
    control's back button through it; `LogcatView` asks while recording.
11. **Checks**, commit, push, PR (merge only when the user says).

## Local tasks (the Mac, with phones and a running server)

- `npm run test:viewport` and the control sweep (`npm run test:sweep`).
- Light and dark contrast probe on device control's Screenshot tab.
- Galaxy S9+ and an iPhone: capture; reload keeps them; the 51st drops the
  oldest; copy on https and on http; annotate and save a copy; compare; the
  zip opens; undo delete and Clear all; sign-out empties it; Esc while a Logs
  recording runs asks first.
