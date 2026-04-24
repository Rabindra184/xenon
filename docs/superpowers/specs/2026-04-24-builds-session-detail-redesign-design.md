# Builds + Session Detail Redesign — Design

**Date:** 2026-04-24
**Status:** Draft (awaiting user review)
**Author:** claude-opus-4-7 (on behalf of @Rabindra184)
**Parent spec:** `2026-04-24-xenon-dashboard-redesign-design.md` (this is Phase 4)

## 1. Summary

Rebuild the Builds page (`/builds`) and Session Detail screen to match
the reference aesthetic established by Phases 1–2, and to fix UX
issues the user identified during review. The Builds list becomes a
scannable, filterable session browser with functional per-chip filter
counts. The Session Detail becomes a proper route with grouped
metadata, a read-only failure summary, tab counts, syntax-highlighted
logs, and a failure summary pane that replaces the "No video" card.

This is frontend-only. No new backend endpoints in this phase.
Bulk-select and session retry are deferred to a later phase because
they require backend work.

## 2. Goals and Non-Goals

### Goals

- **Architectural:** split the 1040-line `session-dashboard.tsx`
  monolith into route-owned components (BuildsPage + SessionDetail
  page) so each is editable without reading the other's internals.
- **Routing:** promote session detail from a conditional render to a
  proper route (`/builds/:buildId/sessions/:sessionId`) so users can
  deep-link, refresh, and open in new tabs.
- **Filtering (Builds list):** fold the duplicate status toggle
  systems (top status chips + left-rail filter strip) into a single
  filter bar with per-chip counts that actually filter the table.
- **Failure info (Session detail):** make the failure reason loud and
  findable. Label it. Surface the underlying `failure_reason` string
  (currently stored in DB but hidden). When there is no video
  recording, use that real-estate for a structured failure summary.
- **Log readability:** syntax-highlighted JSON payloads, tight
  single-line row layout with collapsible payloads, copy-on-hover,
  per-tab counts.
- **Metadata hierarchy:** group the metadata bar into Identity /
  Run / Result sections with proper labels.
- **Empty states:** capability tables, no-sessions cases, and
  truncated device/session IDs all get tooltips or explicit empty
  copy.

### Non-Goals

- **Bulk-select / retry / export** — API surface doesn't exist
  (`src/app/routers/` has no retry/requeue/bulk-delete endpoints).
  We'll scaffold the UI shape but the actual operations are out of
  scope for this phase. A follow-up spec will pair backend endpoints
  with the UI.
- **New telemetry** — no new metrics, no new websocket events. We
  surface what's already in `ISession` and the log feeds.
- **Video player replacement** — keep the native HTML `<video>` /
  MJPEG `<img>` approach. Custom player is a separate ask.
- **AI analysis rewrite** — the existing accordion stays visually
  refreshed but structurally intact. The markdown renderer keeps
  working as-is.

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

### 4.1 Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ Breadcrumb: Xenon / Builds                                          │
│ H1: Builds     H2 subtitle: n builds · N sessions today   [+ Retry] │
├─────────────┬───────────────────────────────────────────────────────┤
│             │ ┌───────────────────────────────────────────────────┐ │
│ LEFT RAIL   │ │ FILTER BAR (pill group)                           │ │
│ (280px)     │ │  [All 42]  [Passed 36]  [Failed 5]  [Running 1]   │ │
│             │ │  Search sessions…                                 │ │
│ - search    │ └───────────────────────────────────────────────────┘ │
│ - time      │ ┌───────────────────────────────────────────────────┐ │
│   dropdown  │ │ SESSION TABLE                                     │ │
│ - build     │ │ ┌─────────────────────────────────────────────┐   │ │
│   cards     │ │ │ name / id │ device │ status │ time │ dur    │   │ │
│             │ │ └─────────────────────────────────────────────┘   │ │
│ footer:     │ │ rows, sortable headers                            │ │
│ "42 shown"  │ └───────────────────────────────────────────────────┘ │
└─────────────┴───────────────────────────────────────────────────────┘
```

### 4.2 Redundancy fix: one hierarchy

The current page shows the build name three times in three different
weights (left rail card + H1 "DEFAULT BUILD" + eyebrow "BUILD
#A70AC97A"). After redesign:

- **Left rail card:** build name, time, status counts.
- **Main pane H1:** the sessions table is primary; the build
  identifier is a small breadcrumb above the filter bar ("Builds /
  Default Build · #A70AC97A"). No giant all-caps repeat.

### 4.3 Filter bar

Single horizontal pill group. No more two filter systems:

- `All (42)` — default, unfiltered.
- `Passed (36)`, `Failed (5)`, `Running (1)` — each shows count of
  sessions matching that status in the currently-visible build.
- Clicking a pill toggles it on; clicking a second pill swaps (not
  additive). Holding Shift makes it additive (multi-select).
- Pill that's active gets a colored background (green / red / amber)
  at 15% alpha with a 30%-alpha border, matching Phase-2 status-pill
  pattern.
- Right side of the bar: the session search input. Smaller than the
  top-bar global search (40% width max); dominates the table, not
  the page.

The old left-rail Passed/Failed/Running toggle strip is deleted. The
left rail keeps only search + time filter + build cards.

### 4.4 Session table

Columns:

| Header | Content | Width |
|---|---|---|
| (select) | checkbox (Phase 4 stretch — disabled until bulk API lands) | 32px |
| Session | nickname + ID row | 1.4fr |
| Device | platform icon + nickname OR fallback OS+node when unknown | 1fr |
| Status | colored pill | 90px |
| Start | relative time ("6h ago") with ISO tooltip | 110px |
| Duration | `6h 7m 38s` format | 90px |
| (action) | chevron | 32px |

**Unknown device fallback.** When `session.device.name` is missing,
show `{platform} · {os_version} · node {node_id}` instead of "Unknown
Device". Never show just the phone icon with no text.

**Full IDs.** `#orphan-f` stays as the primary label but the full
name is exposed via a `title` tooltip AND a copy-on-hover button in
a hover state of the row.

**Empty state.** Table renders an `<EmptyState>` with:
- No build selected → "Select a build from the left to see sessions."
- Build selected + zero sessions (before any filter) → "No sessions
  in this build yet. Trigger one from your test runner."
- Zero results after filter → "No sessions match '{query}' /
  filter(s). Clear filters." with a Clear button.

**Density.** Row height 44px, not 80px. Currently the table feels
sparse because rows are tall and there are only 2 of them; tightening
the row + letting the table size to content (not full-viewport)
removes the "huge empty space" complaint.

**Pagination.** Below the table: `Showing 42 of 42 · Load 500 more`
button when there are more than 500 (current fetch limit). For now
`Load more` is disabled (table fetches all 500 at once) but the
visible "Showing N of total" footer gives visual resolution instead
of abrupt emptiness.

### 4.5 "Sessions found" count

Move from the far-right corner into the filter bar's right edge,
directly under the search input: `42 matching`. Disconnected
floating text is deleted.

## 5. Session Detail Page

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Back · Xenon / Builds / Default Build / 📋 orphan-fresh-ses-002   │
│ H1: orphan-fresh-sess-002  (shows the FULL id, with [copy] icon)    │
├─────────────────────────────────────────────────────────────────────┤
│ METADATA — grouped 3 ways                                           │
│ ┌─ Identity ────────────┬── Run ──────────┬── Result ─────────┐     │
│ │ Device · QA-01        │ Start  10:31 AM │ Status  ❌ Failed │     │
│ │ Platform iOS 17.4     │ Dur    6h 7m    │ Reason  Hub restart│     │
│ │ Node    primary       │ Trace 5b2e…9f3c │  (category: infra) │     │
│ └───────────────────────┴─────────────────┴────────────────────┘     │
├─────────────────────────────────────────────────────────────────────┤
│ AI ANALYSIS (accordion, default expanded)                           │
├──────────────────────────┬──────────────────────────────────────────┤
│ LOG VIEWER (left 60%)    │ EVIDENCE (right 40%)                     │
│  [Text Logs (142)]       │ ┌─ Video or Failure Summary ─────────┐   │
│  [Performance (3)]       │ │ (see 5.4 below)                    │   │
│  [Evidence (1)]          │ └────────────────────────────────────┘   │
│  [Device Logs (281)]     │ ┌─ Capabilities ──┐                      │
│  [Debug Logs (12)]       │ │ [Desired] [Session]                    │
│  [Profiling] (Android)   │ │ key: value                             │
│                          │ └────────────────┘                       │
│  [search logs]           │                                          │
│  [timestamp | event | ⋯] │                                          │
│  [timestamp | event | ⋯] │                                          │
└──────────────────────────┴──────────────────────────────────────────┘
```

### 5.2 Metadata bar — Identity / Run / Result

Three adjacent panels, each with a small uppercase label, a
vertical divider between groups.

- **Identity** — Device nickname, platform+OS, node ID, tags
  (truncated).
- **Run** — Start time (absolute + relative tooltip), duration, trace
  ID (mono, truncated + copy), span ID (hidden behind "more").
- **Result** — Status badge (pill, read-only — no longer looks like an
  input field), the `failure_category` labeled as `Failure category`,
  and the full `failure_reason` text shown below with a `Failure
  reason:` label. Long failure reasons clamp to 2 lines with a
  "Show more" link.

For non-failed sessions, the Result group shows a green check with
"Completed" or a blue spinner with "Running — {elapsed}".

### 5.3 Failure Summary pane (replaces "No video available")

When `status === 'failed'` AND there is no `video_recording`:

```
┌─────────────────────────────────────────────┐
│ ⚠ Session failed · Hub restart              │
│                                             │
│ Failure reason                              │
│ {failure_reason raw string, full text}      │
│                                             │
│ First error log                             │
│ 10:31:42  session_stopped                   │
│   { failure_category: "infrastructure", … } │
│                                             │
│ Top of stack                                │
│ at DeviceManager.releaseDevice              │
│ at SessionManager.cleanup                   │
│                                             │
│ [ Copy failure report ]                     │
└─────────────────────────────────────────────┘
```

The "first error log" is the first entry in
`device_logs + debug_logs` where `is_success === false` OR the entry
containing the `session_stopped` event. Stack parse is a
best-effort: scan the `failure_reason` for `at <fn>` lines and
render up to 5. When there's no stack, omit the section.

When `status !== 'failed'` OR there IS a video, the pane shows the
video or the existing `<img>` live stream as today, retextured.

"Copy failure report" copies a Markdown block:

```markdown
**Session:** orphan-fresh-sess-002
**Build:** Default Build (#A70AC97A)
**Device:** QA-01 (iOS 17.4)
**Duration:** 6h 7m 38s
**Failure category:** infrastructure
**Failure reason:** Hub restart
**First error:** 10:31:42 session_stopped …
```

### 5.4 Log Viewer

**Tabs.** Same six tabs as today (plus Profiling when Android/iOS).
Each tab label gets a count bubble: `Device Logs (142)`. Counts come
from the parallel fetches in `use-session-detail.ts`. Profiling tab
only appears when counts > 0.

**Filter row** below the tabs:
- "Errors only" checkbox (existing) — tightened to a small pill
  toggle.
- Search input (existing) — narrower; ghost placeholder "filter by
  text, locator, command…".
- A new "density" toggle: `Compact | Expanded` (expanded = today's
  layout; compact = one-line rows with collapse affordance). Default:
  Compact on first visit, remembered in localStorage.

**Log row (compact mode).**

```
10:31:42  ●  GET /element/…/text           12ms    ✓   [⋯]
          ⌄  (click to expand JSON body + response + screenshot)
```

Row parts:
- mono timestamp (56px, fixed width)
- colored dot (status: green success, red error, amber healed)
- event or method+path, 1 line, ellipsis on overflow
- duration badge, right-aligned
- status check/cross icon
- `⋯` action menu: Copy event, Copy ID, Jump to timestamp in video
  (disabled if no video), Pin to top
- expand chevron row-level: click opens the full JSON viewer below

**Log row (expanded mode)** — matches today's visual: header strip +
full body JSON + response + screenshot (when `showScreenshots` on).

**JSON viewer.** Lightweight self-built highlighter (no new
dependency if we can avoid it; use a ~40-line TSX helper that
tokenizes strings/numbers/booleans/keys and wraps them in spans with
token colors from our palette). If regex-based tokenizing gets
hairy, fall back to `react-syntax-highlighter` or `prismjs`
(+~25KB gz). Decision made at implementation time.

**Copy-on-hover.** Each log row shows a copy icon in a hover
overlay at the right edge. Copies the full JSON body to clipboard.

**Jump to timestamp.** Action menu has a "Jump to timestamp in
video" entry. Disabled when there's no video. When clicked, sets the
`<video>` element's `currentTime` to
`(log.timestamp - session.startedAt) / 1000`. No scrubbing UI
needed — just seek.

### 5.5 Capabilities panel

Two-tab subpanel (Desired / Session) using the existing
`SegmentedControl`.

- When empty: `<EmptyState>` with `"No {desired|session}
  capabilities reported for this session."` and a Info icon.
- Rows render as key / mono-value pairs, not a fake table with
  headers. Long values collapse to 1 line with "Show more".

## 6. New Components and Shared Primitives

Components to create (all under their Feature directory):

- `FilterPill` (`components/ui/filter-pill.tsx`) — takes `{ active,
  label, count, onClick, color }`. Used by the Builds filter bar.
  Written to also serve future Devices / Apps filter bars.
- `CountBadge` (`components/ui/count-badge.tsx`) — small inline count
  bubble for tab labels (`Device Logs [142]`). Reusable.
- `MetadataGroup` (`components/session-detail/metadata-group.tsx`) —
  three-column grid with uppercase group labels. Used by
  MetadataBar.
- `JsonBlock` (`components/session-detail/json-block.tsx`) —
  syntax-highlighted `<pre>` rendering.
- `LogRow` (`components/session-detail/log-row.tsx`) — shared row
  between all log tab types (text / device / debug).

## 7. Data Strategy

All data still comes from existing APIs. No new endpoints.

New client-side derivations:

- `buildStatusCounts(sessions)` → `{ passed, failed, running, all }`
  drives the filter-pill counts.
- `firstErrorLog(logs)` → the earliest entry where `!is_success` or
  the `session_stopped` log, drives Failure Summary.
- `parseStackFromReason(reason)` → best-effort extract `at …` frames
  from `failure_reason`.
- `humanizeCapability(value)` → string or JSON prettified with
  type-aware truncation.

The 3s polling loop stays, keyed off the `/builds/:buildId` route.
When the route unmounts (user navigates to a session), polling
pauses. When the detail route unmounts (user goes back), builds
route resumes polling.

## 8. Phased Implementation Order

Within Phase 4, we split into three mergeable sub-plans because the
total scope is ~25 tasks. Each sub-plan is its own PR.

**Sub-plan 4A — Builds list + routing.**
- Route split, file-structure split (feature dirs, extracts from
  monolith).
- New filter bar with functional per-chip counts.
- Table redesign: columns, unknown-device fallback, full-ID
  tooltips, row density.
- Sessions-found count, empty states, Load-More footer.
- Delete old `session-dashboard/` Builds portion.
  *(~10 tasks, ~7 commits)*

**Sub-plan 4B — Session detail page + metadata + failure summary.**
- Route wiring.
- Metadata grouped bar, labeled failure reason.
- Failure summary pane (replaces "No video").
- Capabilities empty states.
- Truncated breadcrumb with copy.
  *(~10 tasks, ~7 commits)*

**Sub-plan 4C — Log viewer.**
- Tab counts + density toggle.
- Compact / expanded log rows.
- JSON syntax highlighting.
- Copy-on-hover and jump-to-timestamp.
  *(~8 tasks, ~6 commits)*

The three sub-plans are independent — none blocks another. Sub-plan
4A is pre-requisite for the routing changes; 4B and 4C can land in
either order after 4A.

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
| Bulk-select UI without backend disappoints | Ship checkboxes *disabled* with a tooltip ("Bulk actions land in a future release") — don't pretend the feature works. |
| Jump-to-timestamp seeks beyond video duration | Clamp `currentTime` to `video.duration - 1`; if still out of range, no-op with a toast "Timestamp not covered by video". |

## 11. Open Questions

- **Bulk retry API**: out of scope here. Should I draft a follow-up
  spec proposing `POST /session/:id/retry` + `POST /session/batch-retry`?
  Assumption: yes, but as its own doc after Phase 4 ships.
- **Build name duplication**: I've proposed picking the main-pane
  breadcrumb over the giant H1. If the user prefers the H1 to stay
  (branding / scanability), we'll swap and delete the breadcrumb
  instead.
- **Localstorage keys**: we're introducing `xenon.log-density` and
  `xenon.builds-filter`. Agreed naming convention? Current codebase
  uses the `xenon.` prefix in other spots (CommandPalette events),
  so I assume yes.

## 12. Next Step

Once approved, write three implementation plans (4A, 4B, 4C) via
`writing-plans`. Each becomes its own mergeable PR.
