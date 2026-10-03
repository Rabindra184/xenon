# Device control: the Logs tab, redesigned

Date: 2026-10-03
Status: design agreed in conversation, section by section (scope "polish and
power tools", browser only; approach B, the list renders only the rows on
screen with `@tanstack/react-virtual`; Logs before Screenshot). Waiting for the
user's review of this document.

The Screenshot tab is the second half of the same request and gets its own
spec and PR after this one. Agreed for it so far: browser only, captures kept
in this browser (newest 50 per phone, removed by Clear all and on sign-out).

## Who it is for, and what done means

- **Testers and app engineers** watching a phone's live log while they use it
  from device control (`/devices/<udid>/control/logs`), on Android (logcat)
  and iOS (os_trace).
- **Done means:**
  - the toolbar takes one row, and about 35 lines fit at 1440 px instead of 13;
  - one line per record when the panel is 720 px or wider, with errors and
    warnings visible at a glance;
  - you can act on a line: see all of it, copy it, show or hide its tag or app;
  - scrolling up to read never fights the stream, and the place you are reading
    stays put;
  - a full 5,000-line buffer stays smooth;
  - the look matches the Actions tab (#328): sentence case, quiet buttons, the
    app's tokens, both themes;
  - nothing that works today stops working: the stream, the filter syntax,
    Find, Record and Export keep their behaviour and their file formats.

## What is wrong today

Seen on the Galaxy S9+ at 1440 × 900 with a full stream, or read in the code:

1. The toolbar wraps into four rows, 160 px of the 788 px pane. The level
   dropdown takes a row of its own.
2. Each record takes two lines (43 px): the row grid has five fixed columns and
   the message drops to its own line under the time. About 13 records are on
   screen out of 2,629.
3. Errors look like every other line. The level is one letter at the right of
   the metadata; the 51 errors in 2,629 lines were invisible.
4. Every record in the buffer is in the page: 2,629 rows then, up to 5,000.
5. A line can't be acted on: no copy, no "filter by this tag", no full view of
   a long message.
6. FREEZE stops following but never says how much arrived since. Scrolling up
   while following is pulled back down by the next line.
7. The filter placeholder is cut off ("tag:Wifi package:com.a"), so the
   `tag:` / `package:` / `level:` syntax is hidden.
8. Dated look: ALL-CAPS buttons (FREEZE, RECORD, EXPORT, CLEAR), a filled green
   EXPORT, Info lines in the action green, three hex colours in `logcat.css`.
9. `logcat.css` still says the panel is a fixed 450 px. It isn't: the column is
   `flex: 1` between 450 and 1,200 px (954 px at 1440, about 794 at 1280,
   less with a landscape phone).

## The tab

### Toolbar (one row, about 42 px)

Left to right:

- **Status:** "Live", "Connecting", "Offline" or "Denied" with its dot, as
  today, in `role="status"`.
- **Filter field**, taking the free width. Placeholder
  `tag:Wifi package:com.example text`. A **?** button at its right end opens a
  popover (`ui/Popover`) with the syntax and four examples:
  - `tag:Wifi` lines whose tag contains Wifi
  - `package:com.example` lines from that app
  - `level:W` warnings and above
  - `-tag:chatty` hide a tag (new, see "Filter syntax")
  A × inside the field clears it, as today.
- **Find**, about 110 px, with its "3/12" count inside, then previous and next
  buttons. Behaviour as today: it keeps every line and steps between matches;
  Enter and Shift+Enter step.
- A divider, then:
  - **Pause** / **Resume** (pause and play icons). Pausing stops following;
    lines keep arriving and are counted (see "Following and pausing"). It
    replaces FREEZE / FOLLOW.
  - **Record** / **Stop · 1,204 lines**, red while recording, as today.
  - **Export**, an icon button named "Export shown lines". With no lines shown
    it stays enabled and a toast says "No lines to export".
  - **⋯ menu** (`ui/Menu`): "Match case" and "Wrap long lines" (checked
    items), a divider, "Copy selected lines" (only with a selection) and
    "Clear lines".

Buttons use `ui/button`'s secondary and ghost styles. Nothing on this tab is
filled green.

### Level bar (one thin row under the toolbar)

- **All**, then each level with how many lines of it the buffer holds:
  - Android: Verbose, Debug, Info, Warning, Error, and Fatal when there is one.
  - iOS: Debug, Info, Error, Fault (what os_trace sends, mapped as
    `iosSourceFilter` maps it today).
- Clicking a level shows that level and above. It writes the `level:` term
  into the filter text with `setLevelTerm`, so the bar and the field always
  agree, as the dropdown does today. Clicking the chosen level again goes back
  to All.
- The chosen level has `aria-pressed="true"`; the levels it includes are
  tinted. Each button is named for what it does: "Warning and above, 117
  warning lines".
- **Counts follow the filter, minus its level term**: with `tag:Wifi`, the bar
  counts Wifi's lines per level.
- On iOS, choosing Debug still turns Debug on at the device (a high-volume
  stream), as the dropdown does today.
- At the right: "168 of 2,629 shown" (lines passing the filter / lines in the
  buffer).

### Rows

- **Panel 720 px or wider** (a container query, written as `min-width` per the
  repo's rule): one line per record, about 20 px, five columns:
  1. time `HH:MM:SS` (62 px)
  2. level letter on a small badge (18 px)
  3. tag, in its own colour from `tagColor` (up to 140 px)
  4. package (up to 150 px)
  5. message (the rest)

  Tag and package truncate with an ellipsis; their full values are in the
  `title` and the details panel. PID and TID leave the row for the details
  panel.
- **Narrower panel:** two compact lines, metadata then message, as today but
  tighter.
- **Levels:** Error and Fatal rows get a red tint and a 2 px left stripe;
  Warning gets an amber badge; Info uses `--color-info` instead of the action
  green; Verbose and Debug are muted. The letter stays on every row, so colour
  is never the only signal.
- **Wrap long lines** (on by default): a long message wraps inside the message
  column, never under the time. Off: one line each, cut with an ellipsis; the
  details panel shows the whole message.
- **Find** highlights the matched text inside each row (`<mark>`) as well as
  tinting the row; the current match is also outlined.
- Xenon's own records ("N lines dropped (slow client)") keep their amber
  italic look, span the row, and are never hidden by a filter, as today.
- The rows stay a dark island (`theme-dark`) in the light theme, as today.

### Following and pausing

- The list follows the newest line while it is scrolled to the bottom.
- **Scrolling up pauses it**: a scroll by the user (wheel, touch, keys,
  scrollbar) that leaves the bottom more than 24 px away. Xenon's own scrolls
  never pause it.
- While paused, a pill at the bottom of the list says "342 new lines · Jump
  to latest". It counts lines that pass the filter and arrived since the
  pause. Clicking it, End, Resume, or scrolling back to within 24 px of the
  bottom follows again.
- **The place you are reading stays put** when the buffer drops its oldest
  lines (it holds 5,000): the first line on screen is remembered by its `seq`
  and its offset, and kept there after each update. If that line itself has
  been dropped, a note at the top says "Older lines were dropped while
  paused".

### Selecting and the details panel

- Clicking a line selects it and opens the details panel at the bottom of the
  list (up to 40% of the list's height, scrolling inside). Shift+click selects
  a range, Cmd/Ctrl+click adds or removes one line.
- The panel shows the level's name and the tag, the time with milliseconds,
  the package, PID and TID, and the whole message (selectable text). Buttons:
  - **Copy line** (the Export line format, `formatLine`)
  - **Copy message**
  - **Show only this tag**: sets `tag:<tag>`, replacing a `tag:` term already
    there
  - **Hide this tag**: adds `-tag:<tag>`
  - **Show only this app**: sets `package:<pkg>`; absent when the line has no
    package
  For one of Xenon's own records the panel says it was added by Xenon and
  offers Copy line only.
- Cmd/Ctrl+C with lines selected copies them, in list order, in the Export
  format; so does "Copy selected lines" in the ⋯ menu. A toast says "Copied 12
  lines". Only selected lines the filter shows are copied.
- Selection is kept by `seq`, so it survives the buffer dropping old lines. If
  the line in the panel leaves the buffer, the panel keeps showing it and says
  "This line has left the buffer". Esc closes the panel, and a second Esc
  clears the selection.

### Filter syntax: one addition

- **New:** `-tag:<value>` and `-package:<value>` hide lines whose tag or
  package contains the value. Several may be given; quoting works as for the
  other terms (`-tag:"My Tag"`); Match case applies.
- Unchanged: `tag:`, `package:` and `level:` (one of each, the last wins),
  free text, and Xenon's own records are never hidden.
- A free word starting with `-` and no `:` is still plain text.
- On iOS the exclusions apply in the browser only. `iosSourceFilter` keeps
  sending the device the levels and the `package:` term, nothing else.

### States

- **Connecting, no lines yet:** "Waiting for the phone's first log line…" in
  the middle of the list.
- **Connected, no lines yet:** "Connected. Lines appear here as the phone
  logs them."
- **The filter hides every line:** "No lines match `<filter>`" and a **Clear
  filter** button. The level bar still shows its counts.
- **Denied (1008) or gave up reconnecting:** today's banners, in tokens, with
  **Reconnect** inside the banner instead of the toolbar. Lines already
  received stay on screen.
- **Unsupported platform:** the shared `EmptyState`, today's words.

### Accessibility

- The list is a `listbox` with `aria-multiselectable`, named "Log lines". Each
  rendered row is an `option` with `aria-selected`, `aria-setsize` (the lines
  shown) and `aria-posinset`, so a screen reader knows where it is though only
  the rows on screen exist. Focus stays on the list; the active row is
  `aria-activedescendant`.
- New lines are not announced (20 updates a second would drown everything
  else). The status and the find count are polite live regions, as today.
- Focus rings use `--color-focus-ring`. The live dot's pulse and smooth
  scrolling stop under `prefers-reduced-motion`.

### Keyboard (focus inside the Logs pane)

| Key | Does |
|---|---|
| `/` | focus the filter (not while typing in a field) |
| Cmd/Ctrl+F | focus Find (the browser's find can't see rows not on screen) |
| Enter / Shift+Enter in Find | next / previous match |
| ↑ / ↓ in the list | move the active line |
| Shift+↑ / Shift+↓ | extend the selection |
| Enter in the list | open the details panel |
| Esc | close the details panel, then clear the selection |
| Cmd/Ctrl+C | copy the selected lines |
| End | jump to the latest line and follow |

Outside the pane, Cmd/Ctrl+F is the browser's. Keys pressed in the pane never
reach the phone: device control types into the phone only while the device
screen has focus (`isCanvasFocused`, `device-control.tsx`), and a test holds
that.

## Structure

All in `web/src/components/device-control/logcat/`.

| File | Job |
|---|---|
| `LogcatView.tsx` | Stays the parent. Owns the filter text (the one source of truth), the stream (`useLogcatStream`, unchanged), recording, following and selection; puts the parts together. |
| `LogToolbar.tsx` | Status, filter field and its syntax popover, Find, Pause, Record, Export, ⋯ menu. |
| `LevelBar.tsx` | Level buttons and counts; writes `level:` through `setLevelTerm`. |
| `LogList.tsx` | `useVirtualizer` list: measured rows (wrap makes heights vary), follow and auto-pause, the new-lines pill, keeping the reading place, selection, list keys, `scrollToIndex` for Find. |
| `LogRow.tsx` | One memoized row; single or two-line by the container query; find highlighting. |
| `LogDetails.tsx` | The details panel. |
| `levelCounts.ts` | Lines per level for the bar. Pure. |
| `logSelection.ts` | Range and toggle selection by `seq`, the copied text. Pure. |
| `findHighlight.ts` | Splits a message around its matches. Pure. |
| `logcatFilter.ts` | Adds `excludeTags` / `excludePkgs` to `LogcatQuery`, and `withTerm(query, key, value)` / `withExclusion(query, key, value)` for the panel's buttons (quoting values with spaces, no duplicates). |

Unchanged: `useLogcatStream.ts`, `logcatRecording.ts`, `iosSourceFilter.ts`
(it reads `parsed.pkg`, which a `-package:` term never sets), `tagColor.ts`,
the server.

**Data flow:** stream → `records` (up to 5,000) → `matches(parsed)` →
`visible` → `LogList`. The level bar counts `records` against `parsed` with
its level term removed. Export saves `visible`; Record captures `records` from
start to stop, both as today.

**New dependency:** `@tanstack/react-virtual` ^3.14 in `web/package.json`
(peer React 16.8–19, so 17.0.2 is fine; one dependency, `virtual-core`).

**Styles:** `logcat.css` is rewritten for the new parts, in role tokens. Its
three hex literals go, and its entry leaves
`design/color-literals.baseline.json`. The stale "fixed 450 px" comment goes
with the rule it explains. The four classes borrowed from
`device-control.css` are replaced by `ui/button` and `ui/input`, so the import
of that sheet goes too.

## Testing and checks

**Unit (vitest, `npm test` in `web/`):**

- Pure helpers:
  - `levelCounts`
  - `logSelection` (range, toggle, the copied text matches `formatLine`)
  - `findHighlight` (case on and off, several matches, none)
  - the exclusions: alone, with includes, quoted, with Match case, never
    hiding Xenon's records
  - `withTerm` / `withExclusion`
  - `iosSourceFilter` ignoring exclusions
- `LogList` under a fixed-size viewport. jsdom has no `ResizeObserver` and no
  layout; a helper stubs both inside each `describe` and restores them after.
  - 5,000 lines render fewer than 100 rows, with correct `aria-setsize` and
    `aria-posinset`
  - scrolling up pauses; the pill counts new lines; Jump to latest follows
  - the reading place survives a front trim; the "dropped while paused" note
  - select, Shift and Cmd/Ctrl selection, Cmd/Ctrl+C
  - the list keys
  - Find reaching a match that isn't rendered
- `LogcatView.test.tsx` (about 40 tests): every behaviour it checks is kept;
  selectors change for the new names and the level bar. A test removed rather
  than rewritten is listed in the PR with its reason.
- `device-control.test.tsx`: keys pressed in the Logs pane send no text and no
  key event to the phone.

**Browser (Playwright, against a running server):**

- `web/test/viewport/overflow.spec.ts`: the Logs tab at 1280 and 1440, and at
  the 450 px panel (a landscape phone), with a content check that rows
  rendered so an empty list can't pass.
- A light-theme contrast check on the Logs tab.
- The control sweep (`npm run test:sweep`) once before the PR; every new
  control has to do something, and any legitimate no-op gets its reason.
- `color-literals.test.ts` passes with the lowered baseline.

**On the lab phones, as a user, on a rebuilt server:**

- Galaxy S9+: about 35 lines at 1440; auto-pause and the count; the reading
  place kept after the buffer passes 5,000; details actions; copy; the 720 px
  switch by turning the phone to landscape.
- An iPhone: the iOS level bar; Debug turned on at the device; "Show only this
  app" narrowing at the source.
- Export and Record files in the same format as today's.

**Performance**, measured on today's build first, then the new one, on the S9+
with a full 5,000-line buffer, through the Performance panel or a
`PerformanceObserver` for `longtask`: the longest render per 50 ms update, and
the long tasks over 50 ms in one minute. Target: none. Both sets of numbers go
in the PR.

## Delivery

One feature branch (`feat/logs-tab-redesign`), one PR. Not in this PR: the
Screenshot tab (next spec), the session page's Device logs tab, a log-viewer
shared with the session page (a follow-up once this one has settled), filter
suggestions as you type, grouping stack traces.

## Risks

- **jsdom and the virtualizer.** If the stubbed viewport proves brittle, the
  behaviour tests move to Playwright against a mocked stream and jsdom keeps
  the pure and the shallow component tests. Decided in the plan, not later.
- **Keeping the reading place** depends on measured row heights with wrap on.
  The test covers a trim while paused with wrapped rows of mixed heights.
- **Browser find (Cmd/Ctrl+F) inside the pane** is replaced by Find. Testers
  used to the browser's find get the pane's, which reaches every line; outside
  the pane nothing changes.
