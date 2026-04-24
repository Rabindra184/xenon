# Table Primitive Adoption in Sessions + ProfilingView Design

**Date:** 2026-04-24
**Branch:** `refactor/web-adopt-table-primitive-sessions`
**Status:** Proposed

## Goal

Migrate the three remaining raw `<table>` usages in the session-dashboard surface (including `ProfilingView`) to the existing `ui/Table` primitive. This is the closing pass on Table adoption across the web dashboard; after merge, every data table in `web/src/` renders through the primitive.

## Scope

In scope — exactly 3 tables across 2 files:

| File | Line | Table | Columns | Notes |
|------|------|-------|---------|-------|
| `web/src/components/session-dashboard/ProfilingView.tsx` | 221 | `profiling-table` | 4 (time, CPU%, memory MB, system CPU) | Data rows from `data.map()` |
| `web/src/components/session-dashboard/session-dashboard.tsx` | 481 | `sessions-table` | 6 (name, device, status, start, duration, actions) | Empty state row uses `colSpan={6}` |
| `web/src/components/session-dashboard/session-dashboard.tsx` | 864 | `capabilities-table` | 2 (key, value) | Conditionally rendered via `selectedCapTab` switcher; sticky `<thead>` |

Out of scope:

- Any change to the `Table` primitive (`ui/Table.tsx`) — it already concatenates caller className with its own `.tbl`, which is exactly what we need
- Any CSS changes — per-table classes (`.sessions-table`, `.capabilities-table`, `.profiling-table`) layer real styling (sticky headers, column widths, monospace numeric cells) on top of the `.tbl` base; they are not orphan
- New unit tests — primitive is unchanged, no new behavior introduced
- `teams.tsx` and `api-keys.tsx` — already migrated in PR #17

## Non-goals

- Do not consolidate per-table styling into the primitive. The call-site classes are legitimate specialized overrides, not duplicates of `.tbl`.
- Do not touch the `.sessions-table-wrapper`, `.profiling-table-wrapper`, or `.sessions-table-actions` classes — they wrap the table from the outside.
- Do not migrate session-dashboard's non-table list markup (command list, log list). Those already use non-table layouts.

## Background

PR #17 introduced the `Table`/`THead`/`TBody`/`TR`/`TH`/`TD` primitives and migrated `api-keys.tsx` and `teams.tsx`. Those migrations dropped their per-table classes because `.tbl` alone was sufficient. The three remaining raw tables in session-dashboard have legitimate per-table CSS (sticky header on `capabilities-table`, column-width constraints on `sessions-table`, monospace numeric cells on `profiling-table`), so they keep their classes via `<Table className="...">` — the primitive concatenates caller className with `.tbl`.

This is the last batch; after merge, grep for `<table` in `web/src` should return only the primitive definition itself and any unrelated layout/html use cases.

## Architecture

No new files. Two files modified:

- `ProfilingView.tsx` — swap `<table>/<thead>/<tbody>/<tr>/<th>/<td>` for `<Table>/<THead>/<TBody>/<TR>/<TH>/<TD>`; add import
- `session-dashboard.tsx` — same swap for both tables; add import

Element mapping is 1:1 — no structural changes. The primitive components accept the same HTML attributes (`React.HTMLAttributes<HTMLTableElement>` etc.) and render the same tags, so `colSpan`, `onClick`, `key`, inline styles, and all other props pass through unchanged.

## Migration details per table

### `ProfilingView.tsx` (line 221)

```tsx
// Before
<table className="profiling-table">
  <thead>...</thead>
  <tbody>
    {data.map((row) => (<tr key={row.timestamp}>...</tr>))}
  </tbody>
</table>

// After
<Table className="profiling-table">
  <THead>...</THead>
  <TBody>
    {data.map((row) => (<TR key={row.timestamp}>...</TR>))}
  </TBody>
</Table>
```

### `session-dashboard.tsx` sessions-table (line 481)

Same swap. Preserve the `colSpan={6}` empty-state row — `TD` is a thin wrapper over `<td>` and accepts `colSpan` via `React.TdHTMLAttributes`.

### `session-dashboard.tsx` capabilities-table (line 864)

Same swap. The table is inside a conditional tab renderer (`selectedCapTab === 'desired' ? ... : ...`) — migration preserves the conditional; only the tag names change.

## Tests

No new tests. Existing tests (75 total across 15 files) must still pass. Build must still succeed.

## Rollout

- Branch: `refactor/web-adopt-table-primitive-sessions` (already created from `main`)
- Commits (order):
  1. ProfilingView migration
  2. session-dashboard migration (both tables)
- Single PR titled `refactor(web): adopt Table primitive in session dashboard + ProfilingView`

## Risks

- **Column width shift.** `.tbl` sets `width: 100%` — all three tables already expect this via their per-table rules. No change.
- **Vertical alignment of TD.** `.tbl tbody td` sets `vertical-align: middle` and `padding: 10px 12px`. The per-table rules (`.sessions-table td`, `.capabilities-table td`, `.profiling-table td`) may override or augment these — spot-check that the resulting padding/alignment matches pre-migration. Mitigation: visual smoke test.
- **Hover state.** `.tbl tbody tr:hover` sets `background: var(--bg-elevated)`. Per-table rules already have hover overrides — verify the cascade order produces the intended outcome, particularly for `capabilities-table` which has its own explicit hover rule.

## Success criteria

- `grep -rn "<table" web/src` returns only `web/src/components/ui/Table.tsx:7` (the primitive's own `<table>` tag) and any unrelated layout-html occurrences noted during cataloguing (none found in the current pass).
- `npm test` passes (75/75).
- `npm run build` succeeds with no new warnings.
- Visually: sessions list, capabilities modal, profiling tab render identically to pre-migration.
- Net LOC: minimal (~20 lines changed in JSX; no CSS changes).
