# Builds + Session Detail Redesign — Design

**Date:** 2026-04-24 (revised same-day against new reference images)
**Status:** Draft (awaiting user review)
**Author:** claude-opus-4-7 (on behalf of @Rabindra184)
**Parent spec:** `2026-04-24-xenon-dashboard-redesign-design.md` (this is Phase 4)
**Source of truth for layout:** two reference screenshots the user supplied after the first draft — one Builds list, one Session detail. This spec matches those images pixel-closely wherever they're explicit.

## 1. Summary

Rebuild the Builds page (`/builds`) and Session Detail screen to match
the reference images the user supplied. The Builds list gets an
action header (Retry failed / Export), a functional filter-pill bar
with per-pill counts, bulk-selectable table rows, a failure-reason
subtitle on each row, and absolute-time columns. The Session Detail
becomes a proper route with three grouped metadata panels
(Identity / Run / Result), a prominent Failure Summary card when
status is failed (with Copy + Open runbook actions), per-tab log
counts, a compact single-line log row layout with inline JSON, and a
flat Desired / Session capabilities panel.

Frontend is redesigned in full. Backend endpoints for `Retry failed`
and `Export` do not exist today; they are added in a narrow extension
to the scope (see §7.2). `Open runbook` is a URL link to a
markdown-based runbook page (new route `/runbooks/:category`) that
ships as a placeholder in this phase with stub content for each
failure category.

## 2. Goals and Non-Goals

### Goals

- **Architectural:** split the 1040-line `session-dashboard.tsx`
  monolith into route-owned components (BuildsPage + SessionDetail
  page) so each is editable without reading the other's internals.
- **Routing:** promote session detail from a conditional render to a
  proper route (`/builds/:buildId/sessions/:sessionId`) so users can
  deep-link, refresh, and open in new tabs.
- **Left rail (Builds list):** keep the three status-summary cards
  (PASSED / FAILED / RUNNING) above the build cards as a dashboard
  glance, not as filters. Build cards show count badges inline.
- **Filter bar (Builds list):** a single row of pills — ALL / PASSED /
  FAILED / RUNNING — with per-pill counts, acting as the only filter
  control. Replaces the two overlapping filter systems in the
  current design.
- **Bulk actions (Builds list):** header action buttons "Retry
  failed" + "Export" and per-row checkboxes, wired to new backend
  endpoints (see §7.2).
- **Failure info (Session detail):** make the failure reason loud and
  findable. Label it. Surface the underlying `failure_reason` string
  (currently stored in DB but hidden). Promote `failure_category`
  into a clickable link that opens a runbook.
- **Failure Summary card:** new, prominent block rendered when
  `status === 'failed'` (regardless of whether a video exists).
  Three subsections: REASON, FIRST ERROR, STACK TRACE. Top-right
  actions: Copy report, Open runbook.
- **Log readability:** compact single-line rows with inline JSON
  payload, `>` chevron to expand, colored event-kind dot, per-tab
  count bubbles, copy-on-hover.
- **Metadata hierarchy:** three adjacent panels (Identity / Run /
  Result) with uppercase labels, right-aligned values, vertical
  dividers between panels.
- **Empty states:** capability tables, no-sessions cases, and no-
  recording cases all get explicit copy ("Session failed before
  recording started", "No sessions match …", etc).
- **Runbook shell:** new route `/runbooks/:category` renders a
  markdown-based page with stub content per failure category
  (`hub_restart`, `infrastructure`, `timeout`, `unknown`). Stubs are
  placeholders the team can fill in later.

### Non-Goals

- **New telemetry** — no new metrics, no new websocket events. We
  surface what's already in `ISession` and the log feeds.
- **Video player replacement** — keep the native HTML `<video>` /
  MJPEG `<img>` approach. Custom player is a separate ask.
- **AI analysis rewrite** — the existing accordion stays visually
  refreshed but structurally intact. The markdown renderer keeps
  working as-is.
- **Runbook content authoring** — stubs only. Writing the actual
  remediation guidance for each failure category is a separate
  writing task, not a frontend spec concern.
- **Session replay / trace deep-linking** — Performance Trace tab
  and Evidence tab keep their current implementations, just with
  their tab label getting a count bubble.

## 3. Architectural Changes

### 3.1 File split

Current: `web/src/components/session-dashboard/session-dashboard.tsx`
(1040 lines) does both Builds list and Session detail.

New layout:

```
web/src/components/builds/
├── builds-page.tsx            # outer layout + left rail + table shell
├── build-list-rail.tsx        # left rail: search, time filter, build cards, shown count
├── build-filter-bar.tsx       # top filter pills (Passed/Failed/Running + All)
├── session-table.tsx          # the table itself (rows, columns, sorting, empty state)
├── session-row.tsx            # a single row; exported for future bulk-select wiring
└── use-builds-data.ts         # data/polling hook (extracts current useEffect logic)

web/src/components/session-detail/
├── session-detail-page.tsx    # outer layout, breadcrumb, route wiring
├── metadata-bar.tsx           # Identity / Run / Result groups
├── failure-summary.tsx        # shown when status === 'failed' && !video
├── log-viewer.tsx             # tabs, tab counts, log-row layout
├── log-row.tsx                # one log row with copy + collapse actions
├── json-viewer.tsx            # lightweight syntax-highlighted JSON block
├── capabilities-panel.tsx     # two-tab read-only capabilities view
└── use-session-detail.ts      # parallel fetch of session + 4 log feeds
```

Old `session-dashboard/` directory is removed entirely after the new
files are in place (Phase 4 final task).

### 3.2 Routing

Before:

```
/builds                                  # list + conditional detail
```

After:

```
/builds                                  # list only
/builds/:buildId                         # list with build selected (sessions visible)
/builds/:buildId/sessions/:sessionId     # full-page session detail
```

Implementation: `AppRoutes` gets the three nested routes. The list
and the detail are siblings (not a modal). Clicking a session row
does `navigate(\`/builds/${buildId}/sessions/${sessionId}\`)`. The
detail page has a back button that does `navigate(-1)` (falls back
to `/builds/${buildId}`).

## 4. Builds List Page

### 4.1 Layout (matches reference image)

```
┌─────────────────────────────────────────────────────────────────────┐
│ LEFT RAIL (280px)       │ MAIN PANE                                 │
│ ┌───────────────────┐   │ ┌───────────────────────────────────────┐ │
│ │ Find builds…      │   │ │ BUILD #A70AC97A        [↻ Retry f.]   │ │
│ ├───────────────────┤   │ │ Default Build           [⬇ Export]    │ │
│ │ All time        ⌄ │   │ ├───────────────────────────────────────┤ │
│ ├───────────────────┤   │ │ [ALL 2] [●PASSED 0] [●FAILED 2] [●R 0]│ │
│ │ ┌─────┬─────┬───┐ │   │ │ ┌───────────────────┐ 2 of 2 sessions │ │
│ │ │ ✓ 0 │ ✗ 2 │…0 │ │   │ │ │Search sessions…   │                 │ │
│ │ │PASS │FAIL │RUN│ │   │ ├─┴───────────────────┴─────────────────┤ │
│ │ └─────┴─────┴───┘ │   │ │ ☐ SESSION │DEVICE·NODE│PLATFORM│STATUS│ │
│ ├───────────────────┤   │ │ ─────────────────────────────────────│ │
│ │ Default Build     │   │ │ ☐ #orphan-f… Unknown Dev   Android   │ │
│ │ 23/04/2026 09:11  │   │ │   Session heartbeat t.  node-a   v13 │ │
│ │ [2 FAILED]        │   │ │                              FAILED  │ │
│ │ a70ac97a…         │   │ │                              dur …   │ │
│ │  (selected: grn▌) │   │ │ ☐ #orphan-s… Unknown Dev   Android   │ │
│ └───────────────────┘   │ │   Session heartbeat t.  node-b   v13 │ │
│                         │ │                              FAILED  │ │
└─────────────────────────┴─┴──────────────────────────────────────────┘
```

### 4.2 Left rail (keeps the status summary!)

Three sections, top to bottom:

1. **Search + time filter** — search input `Find builds…`, dropdown
   `All time / Last 24h / Last 7d / Last 30d`.
2. **Status summary cards** — three small KPI-style cards in a row,
   each with icon + label + big count:
   - `✓ PASSED {n}` (green icon + label)
   - `✗ FAILED {n}` (red)
   - `⌁ RUNNING {n}` (amber)
   These are NOT filter toggles; they are a live dashboard glance
   across all visible builds. Clicking a card is a no-op (not
   interactive). A future version may make them linkable to a
   pre-filtered view.
3. **Build cards** — a scrolling list of builds. Each card:
   - Build name (title, bold).
   - Absolute date `dd/MM/yyyy HH:mm:ss`.
   - Inline status pill(s) — `2 FAILED` in red; counts for passed /
     running if > 0, each in their tone color.
   - Monospace `{shortId}…` footer.
   - Selected state: left-edge green 3px bar + `bg-[var(--surface-2)]`.

No "N shown" footer row (dropped from earlier spec — the reference
doesn't have it).

### 4.3 Main pane header

```
BUILD #A70AC97A                              [↻ Retry failed] [⬇ Export]
Default Build
```

- Eyebrow: the hex build ID in green mono (`text-[var(--green)]`,
  small caps), label `BUILD` in dim uppercase preceding it.
- Title: build name (sentence case, larger weight), no all-caps.
- Right side: two action buttons.
  - `Retry failed` — icon `RefreshCcw`, label "Retry failed". Hitting
    it POSTs to the new bulk-retry endpoint (§7.2) with all failed
    session IDs in the current build. Opens a confirmation modal
    first.
  - `Export` — icon `Download`, label "Export". Opens a dropdown:
    `Export as JSON`, `Export as CSV`. Each calls the new export
    endpoint (§7.2).

When there are zero failed sessions, `Retry failed` is disabled with
a tooltip "No failed sessions to retry".

### 4.4 Filter bar

Single horizontal pill group, sits directly under the main-pane
header:

- `ALL {total}` — default, unfiltered; active by default.
- `● PASSED {n}` — green colored bullet + label + count.
- `● FAILED {n}` — red bullet.
- `● RUNNING {n}` — amber bullet.

Rules:
- Clicking `ALL` clears any specific filter.
- Clicking a colored pill selects only that status (swaps, does not
  accumulate — single-select for v1).
- Active pill styling: `bg-[var(--surface-2)]` with a subtle
  border tone matching its color at 30% alpha.

### 4.5 Search + count row

Below the filter bar:

- Left: search input `Search sessions by ID, name, or device…`
  (wider than the top-bar global search is compressed). Matches the
  reference's placeholder copy.
- Right: `{n} of {total} sessions` counter (grey mono, matches
  reference). Updates as filters + search narrow the visible set.

### 4.6 Session table

Columns (exactly matching the reference):

| Header | Content | Width |
|---|---|---|
| ☐ | row-select checkbox (+ header checkbox for select-all-visible) | 32px |
| `SESSION` | row 1: `#shortId` mono; row 2: failure_reason subtitle when failed, else session.name | 1.6fr |
| `DEVICE · NODE` | row 1: device icon + device name (or "Unknown Device"); row 2: mono `node-{nodeId}` in dim grey | 1fr |
| `PLATFORM` | row 1: platform name ("Android"); row 2: `v{os_version}` in mono dim | 120px |
| `STATUS` | outlined pill (border + colored text, no fill) — `READY`/`RUNNING`/`FAILED`/`PASSED` | 100px |
| `START TIME` | absolute `dd/MM/yyyy, HH:mm:ss` in mono | 150px |
| `DURATION` | `Nh Nm N.Ns` format right-aligned | 110px |
| → | chevron on hover | 32px |

**Failure reason subtitle.** When `session.status === 'failed'`, the
second line under the session ID shows `session.failure_reason`
(truncated to ~45 chars with ellipsis + full-text tooltip). For
passed/running sessions, the second line shows `session.name` (or
nothing if absent).

**Unknown Device.** When `session.device.name` is missing, show the
literal text `Unknown Device` in row 1 (matching the reference) with
the `node-{id}` still in row 2 — that way the node is always the
fallback identifier.

**Status pill.** Outlined, not filled. Matches the reference's
`[ FAILED ]` look — border in status color at 40% alpha, text in
full color, no background fill. Reuse the existing `Pill` UI
primitive with a new `variant="outline"` prop.

**Bulk-select.** The header checkbox selects all visible (post-
filter) rows. The selection state is used by the header's "Retry
failed" and "Export" buttons: when 1+ rows are selected, both
buttons switch to operate on the selection rather than all failures.

**Empty state.** Table renders:
- No build selected → "Select a build from the left to see sessions."
- Build selected + zero sessions (before any filter) → "No sessions
  in this build yet. Trigger one from your test runner."
- Zero results after filter → "No sessions match '{query}' /
  filter(s). Clear filters." with a Clear button.

**Density.** Row height ~60px (two text lines per cell pushes it
higher than the earlier 44px plan — matches the reference's
height).

## 5. Session Detail Page (matches reference image)

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ← Builds  ›  DEFAULT BUILD  ›  SESSIONS  ›  #orphan-fresh-sess-001 📋    │
├──────────────────────────────┬────────────────────────┬─────────────────┤
│ IDENTITY                     │ RUN                    │ RESULT          │
│   DEVICE        Unknown Dev. │   SESSION ID orphan…   │ STATUS  [FAILED]│
│   NODE ID       node-a       │   START     23/04/26   │ CATEGORY  Hub↗  │
│   PLATFORM      android      │   DURATION  6h 7m 38s  │ FAIL    heart…  │
│   OS VERSION    13           │                        │         timeout │
├─────────────────────────────────────────────────────────────────────────┤
│ ⚠ Failure summary   HUB RESTART           [📋 Copy] [↗ Open runbook]    │
│                                                                         │
│ REASON        Session heartbeat timeout                                 │
│                                                                         │
│ FIRST ERROR   Heartbeat from agent not received for 180s — hub restart  │
│                                                                         │
│ STACK TRACE   ┌─────────────────────────────────────────────────────┐   │
│               │ at SessionManager.checkHeartbeat  (…:142)           │   │
│               │ at Interval.<anonymous>            (…:88)           │   │
│               │ at listOnTimeout                   (node:…:569:17)  │   │
│               │ at process.processTimers           (node:…:512:7)   │   │
│               └─────────────────────────────────────────────────────┘   │
├───────────────────────────────────────────────┬─────────────────────────┤
│ Text Logs 3 · Perf 0 · Evidence 0 · Dev 142 · │ RECORDING               │
│ Debug 58 · Profiling 24           [□ Errors]  │  📹  No video available │
├───────────────────────────────────────────────┤  Session failed before  │
│ > 08:31:42 ●  session_stopped   {id: …}       │  recording started      │
│ > 07:16:00 ●  heartbeat_missed  {…}           ├─────────────────────────┤
│ > 06:53:25 ●  session_started   {…}           │ DESIRED | SESSION       │
│                                               │  platformName  Android  │
│                                               │  platformVersion 13     │
│                                               │  deviceName  Pixel 6    │
│                                               │  automationName UiAuto… │
└───────────────────────────────────────────────┴─────────────────────────┘
```

### 5.2 Breadcrumb header

One row, no giant H1:

```
← Builds  ›  DEFAULT BUILD  ›  SESSIONS  ›  #orphan-fresh-sess-001  [📋]
```

- Back arrow is a link that navigates to `/builds/:buildId` (preserves
  the selected build).
- `DEFAULT BUILD` is the build name in small uppercase green mono,
  clickable → `/builds/:buildId`.
- `SESSIONS` is a label, not a link.
- `#orphan-fresh-sess-001` is the full session ID in normal text.
  Next to it, a small `📋` copy-to-clipboard icon (lucide `Copy`).
  On click, toast "Session ID copied". Full ID is always visible —
  no truncation in the breadcrumb.
- There is NO giant H1 duplicating the ID.

### 5.3 Metadata bar — three-panel grid

Three cards side-by-side in a grid with `border border-[var(--border)]`
wrapper and vertical dividers between panels. Each card's layout:

```
┌ LABEL (uppercase, dim) ─────────────┐
│ KEY       value (right-aligned)     │
│ KEY       value                     │
└─────────────────────────────────────┘
```

**Identity:** `DEVICE`, `NODE ID`, `PLATFORM`, `OS VERSION`.
**Run:** `SESSION ID` (with copy icon next to the value), `START TIME`,
`DURATION`.
**Result:**
- `STATUS` — outlined pill (`[FAILED]` / `[PASSED]` / `[RUNNING]`).
- `CATEGORY` — when `failure_category` is set, renders as a clickable
  red link that navigates to `/runbooks/:category` (new route, §7.3).
  For non-failed sessions, this row is hidden.
- `FAILURE REASON` — the full `failure_reason` string in red, clamped
  to 2 lines with "Show more" link if longer. Row hidden when not
  failed.

### 5.4 Failure Summary card (only when status === 'failed')

Full-width card below the metadata bar, with red-tinted border
(`border-[var(--red)]/30`) and a subtle red glow (`shadow-red-500/5`
equivalent using arbitrary-value box-shadow). Present regardless of
whether a video exists — the reference shows it above the log
viewer, not in the right panel.

Header row:

```
⚠  Failure summary     HUB RESTART           [📋 Copy]  [↗ Open runbook]
```

- Warning triangle in red, "Failure summary" in red regular weight.
- `HUB RESTART` eyebrow tag = the humanized `failure_category`
  (uppercase, snake_case → SPACES), in small mono with a dim tint.
- Right-side actions:
  - `Copy` — icon + label. Copies a markdown report block to clipboard:
    ```markdown
    **Session:** orphan-fresh-sess-001
    **Build:** Default Build (#A70AC97A)
    **Device:** Unknown Device (node-a) · Android 13
    **Duration:** 6h 7m 38.4s
    **Failure category:** Hub restart
    **Failure reason:** Session heartbeat timeout
    **First error:** Heartbeat from agent not received for 180s …
    ```
  - `Open runbook` — icon `ArrowUpRight`. Opens `/runbooks/:category`
    in a new tab.

Body — three subsections stacked vertically:

1. **REASON** (label in dim uppercase, body full-width):
   `session.failure_reason` verbatim.
2. **FIRST ERROR** (same label style):
   The first log entry where `!is_success` OR the `session_stopped`
   event's message field. Flattened to one line.
3. **STACK TRACE** (label):
   A boxed `<pre>` code block with mono green text, showing up to
   8 stack frames parsed from `failure_reason` with the helper
   `parseStackFromReason()`. When no stack frames are detectable,
   the subsection is hidden entirely.

### 5.5 Log Viewer

**Tabs row** — horizontal strip matching the reference:

```
Text Logs 3 · Performance Trace 0 · Evidence 0 · Device Logs 142 ·
Debug Logs 58 · System Profiling 24               [□ Errors only]
```

- Each tab label has an inline count number (no bubble — just
  `{label} {count}` with the count in dim mono).
- Active tab: green bottom-border underline.
- Hidden tabs (count = 0): kept visible but dimmed to
  `text-[var(--text-dim)]`.
- Right-aligned: `Errors only` checkbox. When on, filters all log
  lists to entries where `is_success === false`.

**Log rows** — compact single-line format:

```
>  08:31:42  ●  session_stopped   {"id":"orphan-fresh-sess-001","status":"failed",…}
```

Row parts, left to right:
- `>` chevron (click to expand the row into the full JSON viewer
  beneath it).
- Mono timestamp `HH:mm:ss` (64px fixed).
- Colored kind-dot (green = success, red = error, amber = warning).
- Event name in mono, bold (`session_stopped`, `heartbeat_missed`,
  `session_started`, etc.).
- Inline JSON payload in one line, dim color, truncated to fit with
  ellipsis. On hover, a copy icon appears at the right edge.

Expanded row reveals a `JsonBlock` full-payload viewer beneath the
one-line summary, plus the screenshot (when the tab is Text Logs
and a screenshot is attached).

**Jump to timestamp.** Available as an action menu item (accessed by
right-clicking the row, or from a `⋯` icon on hover at the far
right). Disabled when there's no video.

**JSON viewer (`JsonBlock`).** Tokenizes strings/numbers/booleans/
keys and wraps them in spans with token colors from the palette.
Implemented as a ~60-line helper that uses JSON.stringify + regex
tokenization. No external dependency. If regex-based tokenizing
breaks on edge cases, renders raw `<pre>` text as a fallback.

### 5.6 Right panel — Recording + Capabilities

Two stacked cards, each ~300px wide (reference shows them in a
narrow right column).

**Recording card:**

```
RECORDING
 📹
 No video available
 Session failed before recording started
```

- When video URL is present → `<video controls src={url}>` inside
  the card; eyebrow says `RECORDING` in small uppercase; no subtitle
  needed.
- When live-streaming (session is running) → `<img src={liveUrl}>`
  with a `LIVE` pulsing red dot in the top-right corner of the card.
- When no video → camera-slash icon + "No video available" bold +
  subtitle matching the reason (when `status === 'failed'` →
  "Session failed before recording started"; when `status ===
  'ended'` → "No recording was captured for this session").

**Capabilities card:** (no outer "Capabilities" wrapper title — the
reference just puts the two tabs at the top, no card heading)

```
DESIRED | SESSION     (tabs, no fancy segmented control, just two
                       text tabs with a bottom underline on active)
platformName     Android
platformVersion  13
deviceName       Pixel 6
automationName   UiAutomator2
```

Each row is a `<dt>/<dd>` pair (semantic) rendered as a flex row:
key on the left (dim muted), value on the right (text color,
mono for primitive values). Long string values clamp with "Show
more".

Empty state: "No {desired|session} capabilities reported" in dim
text.

## 6. New Components and Shared Primitives

Components to create (grouped by owning feature directory):

**`components/ui/`** (reusable primitives):
- `FilterPill` — takes `{ active, label, count, onClick, tone }`.
  Used by the Builds filter bar; reusable by future filter bars.
- `StatusPillOutline` — outlined variant of the existing Pill with
  tone-colored border + text, no background fill. Used in session
  rows and the Result metadata panel.
- `StatusSummaryCard` — three-up KPI-style card used in the Builds
  left rail (PASSED / FAILED / RUNNING).

**`components/builds/`** (Sub-plan 4A):
- `builds-page.tsx`, `build-list-rail.tsx`, `build-filter-bar.tsx`,
  `session-table.tsx`, `session-row.tsx`, `builds-header.tsx`
  (Retry / Export actions), `use-builds-data.ts`.

**`components/session-detail/`** (Sub-plan 4C):
- `session-detail-page.tsx`, `breadcrumb-header.tsx`,
  `metadata-grid.tsx` (wraps three `metadata-card.tsx` instances),
  `failure-summary.tsx`, `recording-card.tsx`,
  `capabilities-card.tsx`, `log-viewer.tsx` (structure only — rows
  live in 4D), `use-session-detail.ts`.

**`components/session-detail/` (Sub-plan 4D):**
- `log-tab-bar.tsx`, `log-row.tsx`, `json-block.tsx`,
  `errors-only-toggle.tsx`.

**`components/runbooks/`** (Sub-plan 4C):
- `runbook-page.tsx` — fetches and renders markdown for the
  `/runbooks/:category` route.

## 7. Data Strategy

### 7.1 Existing APIs

All existing reads stay the same: `GET /build`, `GET /session`,
`GET /session/:id`, `GET /session/:id/session_log`,
`GET /session/:id/logs/device`, `GET /session/:id/logs/debug`,
`GET /session/:id/profiling`.

The 3s polling loop stays, keyed off the `/builds/:buildId` route.
Polling pauses while the detail page is active and resumes on
navigate-back.

### 7.2 NEW endpoints for bulk actions

Three endpoints are added on the backend in `src/app/routers/`:

| Method + Path | Purpose | Body | Response |
|---|---|---|---|
| `POST /session/retry` | Re-queue one or more sessions by ID | `{ session_ids: string[] }` | `{ queued: string[], failed: Array<{ id, reason }> }` |
| `POST /build/:buildId/export` | Export a build's sessions | `{ format: 'json' \| 'csv', session_ids?: string[] }` | file stream (content-disposition attachment) |
| `GET  /runbooks/:category` | Return static markdown for a failure category | — | `{ markdown: string, title: string }` |

Retry semantics: take the original session's capabilities, enqueue a
fresh session request via the existing QueueService. Non-existent IDs
fail silently into the `failed` array. The first implementation
accepts only sessions with status `failed`; `ended` and `running`
sessions are rejected.

Export semantics: JSON returns `ISession[]`; CSV flattens the same
data with commonly-queried columns (id, build_id, status,
failure_category, failure_reason, platform, os_version, node_id,
duration_ms, createdAt, endedAt). Dispositions:
`build-{id}-sessions.json` / `.csv`.

These endpoints are added as part of the implementation plan for
Phase 4A. They are small (~30 lines each); they do not warrant a
separate spec.

### 7.3 Runbook route

New frontend route `/runbooks/:category` rendered by
`components/runbooks/runbook-page.tsx`. Fetches from
`GET /runbooks/:category` (returns stub markdown from
`src/data/runbooks/*.md` in the backend) and renders via the
existing `react-markdown` renderer. Stub files shipped:

- `src/data/runbooks/hub_restart.md`
- `src/data/runbooks/infrastructure.md`
- `src/data/runbooks/timeout.md`
- `src/data/runbooks/unknown.md`

Each stub contains a one-paragraph description and a "TODO: document
remediation" callout. Real content is authored later, outside this
spec's scope.

### 7.4 Client-side derivations

- `buildStatusCounts(sessions)` → `{ passed, failed, running, all }`.
- `firstErrorLog(logs)` → earliest `!is_success` entry.
- `parseStackFromReason(reason)` → extract `at …` frames.
- `humanizeFailureCategory(cat)` → `hub_restart` → `Hub Restart`.
- `humanizeCapability(value)` → type-aware prettified string.

## 8. Phased Implementation Order

Phase 4 is larger now that bulk-actions + runbook route are in
scope. Four sub-plans, each its own PR.

**Sub-plan 4A — Builds list + routing.**
- Route split, file-structure split.
- Left rail: keep status summary + search/time + build cards.
- Main-pane header with Retry failed + Export actions.
- Filter-pill bar with per-pill counts (ALL / PASSED / FAILED / RUNNING).
- Session table with bulk checkboxes, stacked cells, failure-reason
  subtitle, outlined status pill, absolute time, full-ID tooltip.
- Session search + "N of N sessions" count.
- Delete `session-dashboard/` Builds portion.
  *(~12 tasks, ~9 commits)*

**Sub-plan 4B — Bulk-action backend + wiring.**
- `POST /session/retry` endpoint + tests.
- `POST /build/:buildId/export` endpoint (JSON + CSV) + tests.
- Wire the Retry failed / Export buttons in the Builds header to
  the new endpoints (confirmation modal, toast on success, partial-
  failure handling).
- Disabled state wiring (no failed sessions → Retry failed disabled
  with tooltip).
  *(~8 tasks, ~6 commits)*

**Sub-plan 4C — Session detail page + Failure Summary + metadata + capabilities.**
- Session detail route wiring.
- Breadcrumb with full session ID + copy.
- Three-panel metadata grid (Identity / Run / Result), status as
  outlined pill, category link, failure reason row.
- Failure Summary card (REASON / FIRST ERROR / STACK TRACE) with
  Copy + Open runbook actions.
- Right panel: Recording card (video / live / empty) + flat
  capabilities tabs.
- Runbook route `/runbooks/:category` with `GET` endpoint + 4 stub
  markdown files.
  *(~12 tasks, ~9 commits)*

**Sub-plan 4D — Log viewer.**
- Tab row with inline counts + Errors-only toggle.
- Compact single-line log rows with inline JSON preview, `>` expand.
- `JsonBlock` syntax highlighter.
- Copy-on-hover and right-click action menu.
- Jump to timestamp in video.
  *(~9 tasks, ~7 commits)*

Dependencies:
- 4A is prerequisite for 4B (header buttons) and 4C (route).
- 4B and 4C can land in either order after 4A.
- 4D depends on 4C (attaches to the new session detail page layout).

## 9. Testing and Verification

- `vitest` — existing 75 tests must continue passing. New tests:
  - `build-filter-bar.test.tsx` — click Passed → table filters.
  - `filter-pill.test.tsx` — counts render, active state, click
    toggles.
  - `metadata-group.test.tsx` — status pill is read-only,
    failure-reason label is present when status=failed.
  - `log-row.test.tsx` — compact + expanded rendering, copy
    callback wiring.
  - `json-block.test.tsx` — basic tokenization (string/number/key).
  - `parseStackFromReason.test.ts` — 3 input fixtures.
- **Manual / Playwright**:
  - 1440×900, 1024×768, 390×844 for: `/builds` empty, `/builds` with
    build selected + failed session visible, `/builds/:b/sessions/:s`
    for a failed run without video, and same for a passed run with
    video. Stored at
    `web/screenshots/phase-4-<subplan-letter>/`.
  - Confirm no page errors across all three routes.
- **Cross-browser smoke**: Chromium (primary) + Safari
  (`--engine=webkit`) at 1440×900 for the session detail page. We
  use `backdrop-blur-md` and arbitrary-value Tailwind, both safe
  across current evergreen browsers.

## 10. Risks

| Risk | Mitigation |
|---|---|
| File split breaks imports used elsewhere | Grep for `session-dashboard/session-dashboard` before deletion; keep a 1-line re-export shim in the old path if any consumer is found, deleted in Phase 6 cleanup. |
| JSON syntax highlighter regex misses edge cases | Keep a fallback that renders raw `<pre>` text if tokenizer throws; small test suite covers common shapes. |
| Polling race after route navigation | `useBuildsData` cancels inflight fetches in cleanup; detail page uses its own single-shot fetch, not the polling cycle. |
| Bulk retry re-enqueues an already-running duplicate | `/session/retry` endpoint looks up each session and rejects if its original device is currently busy on a fresh session with a matching `build_id + session.name`. Conflict returned in `failed` array with reason "duplicate in progress". |
| Export JSON grows unbounded for large builds | Cap `session_ids` request body at 5000; frontend confirmation modal warns if exceeded. Backend streams CSV via Node `Readable` so memory stays flat. |
| Runbook markdown has a broken link | Renderer catches `react-markdown` errors in an ErrorBoundary and shows a "Runbook unavailable" inline message with a back link to the session. |
| Jump-to-timestamp seeks beyond video duration | Clamp `currentTime` to `video.duration - 1`; if still out of range, no-op with a toast "Timestamp not covered by video". |

## 11. Open Questions

- **Absolute time format locale.** The reference shows
  `23/04/2026, 06:53:25` — day-first. Assuming we ship DD/MM/YYYY
  in all locales for v1. A `navigator.language`-aware formatter is
  a follow-up if ops teams in the US push back.
- **Retry failed confirmation.** Modal or toast? Reference doesn't
  show either. Default: confirmation modal listing the N sessions
  about to re-queue ("This will re-queue 2 failed sessions. Continue?").
- **Localstorage keys.** `xenon.log-density`, `xenon.log-errors-only`.
  Existing code uses `xenon.` prefix elsewhere, assumed safe.
- **Runbook authoring.** Stubs ship now; real content is a separate
  doc-writing task. Who owns that follow-up?

## 12. Next Step

Once approved, write four implementation plans (4A, 4B, 4C, 4D) via
`writing-plans`. Each becomes its own mergeable PR. Plan 4A has
been drafted previously; it needs a revision pass to match the new
spec (bulk checkboxes, Retry/Export header, stacked columns,
outlined status pill, absolute time, status-summary cards in left
rail).
