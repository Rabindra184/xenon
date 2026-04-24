# Table Primitive Adoption (Sessions + ProfilingView) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the 3 remaining raw `<table>` blocks in `session-dashboard/*.tsx` to the `ui/Table` primitive. Keep per-table classNames because they layer real styling on top of `.tbl`.

**Architecture:** Two files modified. No primitive changes, no CSS changes, no new tests. Mechanical 1:1 tag swaps: `<table>`→`<Table>`, `<thead>`→`<THead>`, `<tbody>`→`<TBody>`, `<tr>`→`<TR>`, `<th>`→`<TH>`, `<td>`→`<TD>`. `className`, `colSpan`, `onClick`, `key`, and all other props pass through unchanged via the primitive's spread signature.

**Tech Stack:** React 17, TypeScript 5, existing `Table` primitive at `web/src/components/ui/Table.tsx`.

---

## File Structure

**Modify:**
- `web/src/components/session-dashboard/ProfilingView.tsx` — 1 table (lines 220–269)
- `web/src/components/session-dashboard/session-dashboard.tsx` — 2 tables:
  - `SessionTableRow` at lines 170–221 (renders `<tr>` + 6 `<td>` for sessions-table body)
  - sessions-table outer at lines 481–508 (with `colSpan={6}` empty-state row)
  - capabilities-table at lines 864–910 (conditionally rendered, with 4 conditional render branches containing `<tr>`/`<td>`)

No files created.

---

## Task 1: Migrate ProfilingView

**Files:**
- Modify: `web/src/components/session-dashboard/ProfilingView.tsx`

- [ ] **Step 1: Add Table primitive import**

Open `web/src/components/session-dashboard/ProfilingView.tsx`. Add this import after the `Spinner` import (currently the last import, line 15):

```tsx
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table';
```

- [ ] **Step 2: Replace the table block**

Find the table block (currently lines 221–268):

```tsx
        <table className="profiling-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>CPU %</th>
              <th>Memory MB</th>
              <th>System CPU</th>
            </tr>
          </thead>
          <tbody>
            {data
              .slice()
              .reverse()
              .map((entry: IProfiling) => (
                <tr key={entry.id}>
                  <td className="time-cell">{new Date(entry.timestamp).toLocaleTimeString()}</td>
                  <td>
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar cpu"
                        style={{ width: `${Math.min(parseFloat(entry.cpu || '0'), 100)}%` }}
                      />
                      <span className="progress-text">{entry.cpu}%</span>
                    </div>
                  </td>
                  <td>
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar memory"
                        style={{
                          width: `${Math.min(
                            (parseFloat(entry.memory || '0') / (1024 * 1024)) * 100,
                            100,
                          )}%`,
                        }}
                      />
                      <span className="progress-text">
                        {(parseFloat(entry.memory || '0') / 1024).toFixed(1)} MB
                      </span>
                    </div>
                  </td>
                  <td className="details-cell">
                    {entry.total_cpu_used ? `${entry.total_cpu_used}%` : '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
```

Replace it with:

```tsx
        <Table className="profiling-table">
          <THead>
            <TR>
              <TH>Timestamp</TH>
              <TH>CPU %</TH>
              <TH>Memory MB</TH>
              <TH>System CPU</TH>
            </TR>
          </THead>
          <TBody>
            {data
              .slice()
              .reverse()
              .map((entry: IProfiling) => (
                <TR key={entry.id}>
                  <TD className="time-cell">{new Date(entry.timestamp).toLocaleTimeString()}</TD>
                  <TD>
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar cpu"
                        style={{ width: `${Math.min(parseFloat(entry.cpu || '0'), 100)}%` }}
                      />
                      <span className="progress-text">{entry.cpu}%</span>
                    </div>
                  </TD>
                  <TD>
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar memory"
                        style={{
                          width: `${Math.min(
                            (parseFloat(entry.memory || '0') / (1024 * 1024)) * 100,
                            100,
                          )}%`,
                        }}
                      />
                      <span className="progress-text">
                        {(parseFloat(entry.memory || '0') / 1024).toFixed(1)} MB
                      </span>
                    </div>
                  </TD>
                  <TD className="details-cell">
                    {entry.total_cpu_used ? `${entry.total_cpu_used}%` : '—'}
                  </TD>
                </TR>
              ))}
          </TBody>
        </Table>
```

The outer `<div className="profiling-table-wrapper">` stays as-is.

- [ ] **Step 3: Verify no raw table tags remain in this file**

Run: `grep -n "<table\|<thead\|<tbody\|<tr \|<tr>\|<th>\|<td " web/src/components/session-dashboard/ProfilingView.tsx`
Expected: empty output.

- [ ] **Step 4: Run build + tests**

```bash
cd web && npm run build
cd web && npx vitest run
```
Expected: build succeeds, 75/75 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/session-dashboard/ProfilingView.tsx
git commit -m "refactor(web): adopt Table primitive in ProfilingView"
```

---

## Task 2: Migrate session-dashboard.tsx

**Files:**
- Modify: `web/src/components/session-dashboard/session-dashboard.tsx`

This task migrates two tables in one file. The sessions-table's body rows are rendered via the `SessionTableRow` component (defined at line 170), so that component must be migrated along with the table.

- [ ] **Step 1: Add Table primitive import**

Open `web/src/components/session-dashboard/session-dashboard.tsx`. The existing import block spans lines 1–33. Add this import after the `EmptyState` import (line 29):

```tsx
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table';
```

Place it before the `ProfilingView` import (line 30) so the ui/* imports stay grouped.

- [ ] **Step 2: Migrate `SessionTableRow` (line 170)**

Find the `SessionTableRow` block (currently lines 170–221):

```tsx
const SessionTableRow = React.memo(
  ({ session, onSelect }: { session: ISession; onSelect: (id: string) => void }) => {
    const duration = getDuration(session);
    return (
      <tr className={`session-table-row ${session.status}`} onClick={() => onSelect(session.id)}>
        <td>
          <div className="cell-id">
            <span className="id-text">#{session.id?.slice(0, 8) || 'unknown'}</span>
            {session.name && <span className="name-text">{session.name}</span>}
            {session.tags && (
              <div className="session-tags-pills">
                {parseJson(session.tags)?.map((tag: string) => (
                  <span key={tag} className="tag-pill-mini">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </td>
        <td>
          <div className="cell-platform text-neon-purple">
            <Smartphone
              size={14}
              color={session.device_platform?.toLowerCase() === 'ios' ? '#8b5cf6' : '#a78bfa'}
            />
            <span style={{ marginLeft: '6px' }}>{session.device_name || 'Unknown Device'}</span>
          </div>
        </td>
        <td>
          <span
            className={`status-text ${
              ['success', 'passed'].includes(session.status)
                ? 'text-neon-green'
                : session.status === 'failed'
                  ? 'text-neon-red'
                  : 'text-neon-amber'
            }`}
            style={{ fontWeight: 700, fontSize: '10px' }}
          >
            {session.status?.toUpperCase() || 'UNKNOWN'}
          </span>
        </td>
        <td className="text-neon-dim">{formatDate(session.startTime)}</td>
        <td className="text-neon-dim">{safeFormatDuration(duration)}</td>
        <td className="cell-actions">
          <ChevronRight size={16} />
        </td>
      </tr>
    );
  },
);
```

Replace with:

```tsx
const SessionTableRow = React.memo(
  ({ session, onSelect }: { session: ISession; onSelect: (id: string) => void }) => {
    const duration = getDuration(session);
    return (
      <TR className={`session-table-row ${session.status}`} onClick={() => onSelect(session.id)}>
        <TD>
          <div className="cell-id">
            <span className="id-text">#{session.id?.slice(0, 8) || 'unknown'}</span>
            {session.name && <span className="name-text">{session.name}</span>}
            {session.tags && (
              <div className="session-tags-pills">
                {parseJson(session.tags)?.map((tag: string) => (
                  <span key={tag} className="tag-pill-mini">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </TD>
        <TD>
          <div className="cell-platform text-neon-purple">
            <Smartphone
              size={14}
              color={session.device_platform?.toLowerCase() === 'ios' ? '#8b5cf6' : '#a78bfa'}
            />
            <span style={{ marginLeft: '6px' }}>{session.device_name || 'Unknown Device'}</span>
          </div>
        </TD>
        <TD>
          <span
            className={`status-text ${
              ['success', 'passed'].includes(session.status)
                ? 'text-neon-green'
                : session.status === 'failed'
                  ? 'text-neon-red'
                  : 'text-neon-amber'
            }`}
            style={{ fontWeight: 700, fontSize: '10px' }}
          >
            {session.status?.toUpperCase() || 'UNKNOWN'}
          </span>
        </TD>
        <TD className="text-neon-dim">{formatDate(session.startTime)}</TD>
        <TD className="text-neon-dim">{safeFormatDuration(duration)}</TD>
        <TD className="cell-actions">
          <ChevronRight size={16} />
        </TD>
      </TR>
    );
  },
);
```

- [ ] **Step 3: Migrate sessions-table outer block (line 481)**

Find (currently lines 481–508):

```tsx
        <table className="sessions-table">
          <thead>
            <tr>
              <th>Session / Name</th>
              <th>Device</th>
              <th>Status</th>
              <th>Start Time</th>
              <th>Duration</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s: ISession) => (
              <SessionTableRow key={s.id} session={s} onSelect={setSelectedSessionId} />
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="table-empty">
                  <EmptyState
                    icon={<Activity size={20} />}
                    title="No sessions yet"
                    description="No sessions have run against this build. Trigger one from your test runner or the CLI."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
```

Replace with:

```tsx
        <Table className="sessions-table">
          <THead>
            <TR>
              <TH>Session / Name</TH>
              <TH>Device</TH>
              <TH>Status</TH>
              <TH>Start Time</TH>
              <TH>Duration</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {sessions.map((s: ISession) => (
              <SessionTableRow key={s.id} session={s} onSelect={setSelectedSessionId} />
            ))}
            {sessions.length === 0 && (
              <TR>
                <TD colSpan={6} className="table-empty">
                  <EmptyState
                    icon={<Activity size={20} />}
                    title="No sessions yet"
                    description="No sessions have run against this build. Trigger one from your test runner or the CLI."
                  />
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
```

- [ ] **Step 4: Migrate capabilities-table (line 864)**

Find (currently lines 864–910):

```tsx
                <table className="capabilities-table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCapTab === 'desired' ? (
                      desiredCaps && typeof desiredCaps === 'object' ? (
                        Object.entries(desiredCaps).map(([key, value]) => (
                          <tr key={key}>
                            <td>{key}</td>
                            <td>
                              {typeof value === 'object'
                                ? JSON.stringify(value).slice(0, 80)
                                : String(value)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={2} className="table-empty">
                            No desired capabilities available
                          </td>
                        </tr>
                      )
                    ) : caps && typeof caps === 'object' ? (
                      Object.entries(caps).map(([key, value]) => (
                        <tr key={key}>
                          <td>{key}</td>
                          <td>
                            {typeof value === 'object'
                              ? JSON.stringify(value).slice(0, 80)
                              : String(value)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="table-empty">
                          No session capabilities available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
```

Replace with:

```tsx
                <Table className="capabilities-table">
                  <THead>
                    <TR>
                      <TH>Key</TH>
                      <TH>Value</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {selectedCapTab === 'desired' ? (
                      desiredCaps && typeof desiredCaps === 'object' ? (
                        Object.entries(desiredCaps).map(([key, value]) => (
                          <TR key={key}>
                            <TD>{key}</TD>
                            <TD>
                              {typeof value === 'object'
                                ? JSON.stringify(value).slice(0, 80)
                                : String(value)}
                            </TD>
                          </TR>
                        ))
                      ) : (
                        <TR>
                          <TD colSpan={2} className="table-empty">
                            No desired capabilities available
                          </TD>
                        </TR>
                      )
                    ) : caps && typeof caps === 'object' ? (
                      Object.entries(caps).map(([key, value]) => (
                        <TR key={key}>
                          <TD>{key}</TD>
                          <TD>
                            {typeof value === 'object'
                              ? JSON.stringify(value).slice(0, 80)
                              : String(value)}
                          </TD>
                        </TR>
                      ))
                    ) : (
                      <TR>
                        <TD colSpan={2} className="table-empty">
                          No session capabilities available
                        </TD>
                      </TR>
                    )}
                  </TBody>
                </Table>
```

- [ ] **Step 5: Verify no raw table tags remain in this file**

Run: `grep -n "<table\|<thead\|<tbody\|<tr \|<tr>\|<th>\|<th \|<th/>\|<th />\|<td>\|<td " web/src/components/session-dashboard/session-dashboard.tsx`
Expected: empty output.

If any match appears, it's a case this plan missed — fix it using the same 1:1 swap pattern before continuing.

- [ ] **Step 6: Run build + tests**

```bash
cd web && npm run build
cd web && npx vitest run
```
Expected: build succeeds, 75/75 tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/session-dashboard/session-dashboard.tsx
git commit -m "refactor(web): adopt Table primitive in session dashboard"
```

---

## Final verification

- [ ] **Step 1: Grep for any remaining raw table markup across the web/ tree**

```bash
grep -rn "<table" /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src
```
Expected: only one hit — `web/src/components/ui/Table.tsx:7` (the primitive's own `<table>` tag).

```bash
grep -rn "<thead\|<tbody" /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src
```
Expected: empty (neither `<thead>` nor `<tbody>` appears in the primitive).

- [ ] **Step 2: Full test run**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm test
```
Expected: 75/75 passing.

- [ ] **Step 3: Full build**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm run build
```
Expected: clean build.

- [ ] **Step 4: Visual smoke test**

Start dev server: `npm run dev` (from repo root). Verify in browser:

- Builds list → session dashboard → sessions table renders with rows and empty state
- Click into a session → scroll to Capabilities section → toggle between Desired/Session tabs; both render their tables
- Click into a session → Profiling tab → profiling table renders with CPU/memory progress bars

If anything visually regresses (column widths, row height, hover state, sticky header on capabilities modal), fix before opening the PR.

- [ ] **Step 5: Push branch**

```bash
git push -u origin refactor/web-adopt-table-primitive-sessions
```

Open PR manually at:
`https://github.com/Rabindra184/xenon/pull/new/refactor/web-adopt-table-primitive-sessions`

PR title: `refactor(web): adopt Table primitive in session dashboard + ProfilingView`
PR body: short — 3 tables migrated, primitive unchanged, no CSS changes, tests unchanged.
