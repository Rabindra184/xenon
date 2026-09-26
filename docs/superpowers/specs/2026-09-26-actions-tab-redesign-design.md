# Device control Actions tab redesign — design

Date: 2026-09-26
Status: approved in brainstorming, awaiting spec review

## Why

The Actions tab (`/devices/:udid/control/actions`) stacks four equal-weight
cards: Smart Input, App Management, Clipboard and Directional Gestures.
#326 fixed its safety, feedback and accessibility problems. What's left is
its shape:

- **The loud buttons aren't the main actions.** Two solid-green buttons
  (INSTALL, FETCH VALUE) and a red one compete for attention. The labels are
  in ALL CAPS in device control's own button styles, at 31 to 48px tall.
- **Apps are hard to manage.**
  - The installed apps are raw package IDs in a native dropdown you can't
    search: 21 on the lab S9+, often hundreds on real lab phones.
  - A second "Or enter manually" field shares that dropdown's value.
  - Install accepts only a file from your computer, although the Apps
    library can already install a stored build
    (`POST /control/:udid/install-repository-app`, used by the Apps page).
- **The clipboard is read-only.** The server can set it
  (`POST /control/:udid/clipboard`, `XenonApiService.setClipboard`), but
  nothing in the dashboard uses that.
- **The D-pad takes about 230px** for four swipes, below the fold.

Decisions made in brainstorming:

| Question | Decision |
|---|---|
| Layout | Stacked sections, Apps first: Apps, then Text and clipboard, then Swipe |
| The D-pad | A compact row of four named swipe buttons, kept so keyboard and screen-reader users can still swipe (dragging on the live screen needs a mouse) |
| Code | The tab moves out of `device-control.tsx` (about 1,320 lines) into `device-control/actions/` |

## Behaviour

All buttons use the shared `ui/button` with sentence-case labels. Section
headings are sentence case. Each section is a card with a 14px heading,
following the existing `.action-card` rhythm, and there is at most one tinted
(`tonal`) button per section.

### Apps

**Header:** "Apps", with two buttons on the right.

- **Install from library** (`tonal`, `size="sm"`) opens a menu below it,
  using the same `Popover` + `Menu` as the Devices filter menus.
  - **What it lists:** library apps for this device's platform. An Android
    device lists `platform === 'android'`. iOS and tvOS devices list
    `platform === 'ios'`.
  - **Each item** shows the app's `name`, with a note line of
    `version · packageName`, leaving out either one when it's missing.
  - **Choosing an item installs it at once.** The toast reads
    "Installing <name> on <device>…", then "Installed <name> on <device>" or
    "Couldn’t install <name>: <reason>".
  - **The library is fetched** (`XenonApiService.getApps()`) each time the
    menu opens, so a build uploaded a moment ago shows up. While it loads, a
    single disabled item reads "Loading…". If it fails, one item reads
    "Couldn’t load the library" and choosing it retries.
  - **With no matching apps,** the menu reads "No Android apps in the
    library yet" ("iOS" on iOS and tvOS) and offers **Open the Apps
    library**, which navigates to `/apps`.
- **Upload file** (`secondary`, `size="sm"`) opens the file chooser.
  - It accepts `.apk` on Android and `.ipa,.app` on iOS and tvOS.
  - Choosing a file installs it at once through
    `uploadAndInstallApp`, with the same three messages using the file name.
    Today's separate INSTALL step goes.
  - The input stays `sr-only`, so the keyboard reaches it (#326).
- While an install runs, both buttons are disabled and Install from library
  shows a spinner.

**Installed apps list:**

- **Above the list:**
  - A search field named "Search installed apps", with the placeholder
    "Search N installed apps". It filters case-insensitively by substring,
    as you type.
  - An icon-only **Refresh** button, "Refresh installed apps", which reloads
    the list.
- **The list:**
  - Package IDs sorted alphabetically, in monospace, one per row.
  - At most 6 rows tall; the list itself scrolls beyond that.
  - It is a `role="list"` of `role="listitem"`s. The buttons below carry the
    names.
- **Each row's buttons** are quiet, `ghost` and `size="sm"`:
  - **Copy package ID**: an icon button named "Copy <id>". On success its
    icon becomes a check and its name "Copied" for 1.5 s (see Copying).
  - **Uninstall**: a ghost button with red text (`--status-error-fg`),
    named "Uninstall <id>". It opens the confirmation #326 added: "Uninstall
    <id> from <device>? The app and its data are removed from the device."
- **A typed package ID.** If the search matches nothing and the text looks
  like a package ID (`looksLikePackageId`), the list shows one row: the
  typed ID, "Not in the list", and Uninstall. That reaches packages the
  list omits, such as system apps, and replaces "Or enter manually".
- **States:**
  - **Loading:** "Loading apps…".
  - **Empty:** "No apps installed".
  - **No match:** "No apps match “x”", unless the typed-ID row shows.
  - **Load error:** "Couldn’t load the apps: <reason>" and a **Retry**
    button.
- **After an install or uninstall** the list reloads, after 5 s and 3 s as
  today, since the device takes a moment to report the change.

### Text and clipboard

Two rows, each with a fixed-width label on the left.

- **Send text:**
  - The field is named "Text to send to the device", with the placeholder
    "Type text for the focused field…".
  - A **Send** button (`secondary`) sends it, and so does Enter.
  - The "Sent" status and the failure behaviour are as in #326: the text is
    kept, with "Couldn’t send the text: <reason>".
- **Clipboard:** one editable field named "Device clipboard", then three
  buttons.
  - **Read** (`secondary`) fetches the phone's clipboard into the field. An
    empty clipboard leaves the field empty with a status "The device
    clipboard is empty". Failures use `clipboardError(platform, err)` from
    #326, as a toast.
  - **Write to device** (`secondary`) sends the field's text through
    `setClipboard`. It is disabled while the field is empty. It shows a
    status "Written to the device", or the toast "Couldn’t write the
    clipboard: <reason>".
  - **Copy**: an icon button named "Copy clipboard text", which copies the
    field to your own clipboard (see Copying).
- The rows share one `role="status"` line under them for "Sent", "Written
  to the device" and "The device clipboard is empty". Each message clears
  after 2 s.

### Swipe

One line: the label "Swipe" and four icon buttons (arrow up, down, left
and right), each `secondary` and `size="icon"`, named and titled "Swipe up",
"Swipe down" and so on. The swipe itself, the one `quickSwipe` performs today
from the screen size, and its failure toast (#326) are unchanged.

### Copying

`navigator.clipboard` exists only on secure origins (https or localhost). A
lab dashboard served over `http://<lan-ip>:4723` has no clipboard API, and
every existing copy button in the app then fails, most of them silently.
Here, `copyText(text)`:

1. Calls `navigator.clipboard.writeText` when it exists. On success the
   button that asked shows a check icon, and is named "Copied", for 1.5 s.
2. Otherwise, or if that rejects, it selects the text: the clipboard field's
   own contents, or, for a package ID, the row's text. It then shows the
   toast "Your browser blocked copying here. The text is selected, so press
   ⌘C or Ctrl+C."

Fixing the other copy buttons in the app is out of scope.

## Code

| File | Change |
|---|---|
| `web/src/components/device-control/actions/appsList.ts` (new) | Pure. `filterApps(apps: string[], query: string): string[]` (sorted, case-insensitive substring); `looksLikePackageId(text: string): boolean` (two or more dot-separated, non-empty segments of letters, digits, `_` and `-`, no spaces, the first character a letter; iOS bundle IDs can hold hyphens, e.g. `com.example.my-app`); `libraryAppsFor(library: LibraryApp[], platform: string): LibraryApp[]` (android → android, ios and tvos → ios); `libraryNote(app): string` (`version · packageName`) |
| `web/src/components/device-control/actions/copyText.ts` (new) | `copyText(text: string): Promise<boolean>`: true when the clipboard API wrote it, false when the caller must fall back |
| `web/src/components/device-control/actions/AppsSection.tsx` (new) | The header menu and Upload, the list, the search, the rows, the typed-ID row, the states, and the uninstall confirmation dialog (moved from `device-control.tsx`) |
| `web/src/components/device-control/actions/TextClipboardSection.tsx` (new) | Send text and Clipboard, and their shared status line |
| `web/src/components/device-control/actions/SwipeRow.tsx` (new) | The four swipe buttons; takes `onSwipe(direction)` |
| `web/src/components/device-control/actions/ActionsPanel.tsx` (new) | Lays out the three sections. Props: `{ udid, platform, deviceName, screenWidth, screenHeight }`. Owns the swipe call. |
| `web/src/components/device-control/actions/actions.css` (new) | Section, row, list and status styles. Tokens only: no raw colour literals, no rule on the shared Button's classes (the #322 guard). |
| `web/src/components/device-control/device-control.tsx` | The Actions tab renders `<ActionsPanel …/>`. The Actions-only state, handlers and markup leave: text input, clipboard, install, uninstall and confirmation, installed apps, and the D-pad. What other tabs use stays. |
| `web/src/components/device-control/device-control.css` | Rules used only by the old Actions markup are removed once nothing references them (`.app-mgmt-content`, `.install-section`, `.uninstall-section`, `.file-upload-launcher`, `.gestures-*`, `.dpad-*`, `.clipboard-row`, `.smart-input-row`, `.send-status`, `.uninstall-confirm-*`, and similar). Each removal is checked with a repo-wide grep. |

`LibraryApp` is `{ id: string; name: string; platform?: string | null;
version?: string | null; packageName?: string | null }`, the fields
`GET /apps` returns that this tab reads.

No server changes.

## Testing

Tests written first:

- **`appsList`:**
  - `filterApps`: sorted output, case-insensitive substring, and an empty
    query returns everything.
  - `looksLikePackageId`: yes for `com.foo.bar`, `io.appium.settings` and
    `com.example.my-app`; no for `foo`, `com foo`, `.foo`, `com..foo` and
    `1com.foo`.
  - `libraryAppsFor`: android, ios and tvos.
  - `libraryNote`: all four combinations of a missing version or package.
- **`copyText`:** true when `writeText` resolves; false when it rejects or
  `navigator.clipboard` is missing.
- **`AppsSection`** (api mocked):
  - the list renders sorted and search filters it;
  - the empty, no-match and load-error states, and Retry reloads;
  - the typed-ID row appears only for a package-like, unmatched query, and
    its Uninstall opens the confirmation;
  - a row's Uninstall opens the confirmation. Cancel calls nothing, and
    confirming calls `uninstallApp` and shows the success message;
  - Copy on a row shows "Copied", and when copying is blocked the fallback
    toast appears;
  - the library menu lists only this platform's apps, with their notes, and
    choosing one calls `installRepositoryApp(udid, id)` and shows the
    messages;
  - the empty library shows the message and the link;
  - Upload's `accept` depends on the platform, and choosing a file calls
    `uploadAndInstallApp`.
- **`TextClipboardSection`:**
  - Send and Enter call `typeText`;
  - Read fills the field, or shows the empty status;
  - Write is disabled while the field is empty, and calls `setClipboard`;
  - Copy works;
  - the errors are shown.
- **`SwipeRow`:** four named buttons, each calling `onSwipe` with its
  direction.
- **`device-control.test.tsx`:** the #326 Actions tests move to the new
  components' tests where they now belong. The header tests stay.

Also:

- **Unchanged tabs:** the Screenshot and Logs tabs stay pixel-identical, in
  both themes. This uses the #322 threshold-0 harness, with a new baseline
  from main first.
- **Viewport suite:** the device-control route must still have no overflow
  at 1280–1440.
- **Live on the lab S9+,** as the real user, in both themes:
  - search the list, and copy a package ID;
  - open Uninstall's confirmation and **cancel**; no real uninstall is ever
    confirmed;
  - type an unlisted ID and see its row;
  - install from the library: pull the calculator's APK from the phone
    (`adb shell pm path` then `adb pull`), upload it to the Apps library,
    install it from the menu (a reinstall of an app already there, so
    harmless), then delete it from the library again;
  - Read, Write and Copy the clipboard;
  - Send text into a focused field;
  - swipe;
  - measure contrast for every new element.

## Out of scope

- Launch app, Open link and Clear app data: they need new server routes.
- Friendly app names in the list: `listApps` returns package IDs only.
- Fixing the other copy buttons in the app for insecure origins.
