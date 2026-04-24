# Xenon Redesign — Builds List + Routing (Phase 4A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1040-line `session-dashboard.tsx` monolith into a feature-owned `builds/` directory, promote session detail to its own route, and rebuild the Builds list body to match the reference look with a single functional filter bar (per-chip counts), unknown-device fallbacks, full-ID tooltips, tighter row density, and pagination footer.

**Architecture:** The builds directory owns `builds-page.tsx`, `build-list-rail.tsx`, `build-filter-bar.tsx`, `session-table.tsx`, `session-row.tsx`, plus a `use-builds-data.ts` hook that encapsulates fetch + 3s polling + WS subscription. Routing gets three paths: `/builds`, `/builds/:buildId`, `/builds/:buildId/sessions/:sessionId` (the last renders a placeholder Session Detail stub — full redesign is Phase 4B).

**Tech Stack:** React 17, Vite 5, Tailwind 3.4, react-router-dom 6, lucide-react, existing Xenon `XenonApiService` / `useSocket` / UI primitives (Table, Pill, EmptyState).

**Parent spec:** `docs/superpowers/specs/2026-04-24-builds-session-detail-redesign-design.md` §3, §4.

**Scope note:** This is Sub-plan 4A of three. 4B rebuilds Session Detail. 4C rebuilds the Log Viewer.

---

## File Structure

**Create:**
- `web/src/components/builds/builds-page.tsx` — outer layout + routing into rail/table/detail
- `web/src/components/builds/build-list-rail.tsx` — left rail (search, time filter, build cards, shown count)
- `web/src/components/builds/build-filter-bar.tsx` — top filter-pill group + session search input
- `web/src/components/builds/session-table.tsx` — table chrome (thead, empty states, Load-More footer)
- `web/src/components/builds/session-row.tsx` — one row
- `web/src/components/builds/use-builds-data.ts` — data hook
- `web/src/components/builds/session-detail-stub.tsx` — placeholder rendered at the session detail route until 4B lands
- `web/src/components/builds/derive.ts` — pure helpers: `buildStatusCounts()`, `formatDeviceLabel()`, `msAgo()`, etc. (tested)
- `web/src/components/builds/derive.test.ts` — unit tests for the helpers
- `web/src/components/ui/filter-pill.tsx` — new reusable primitive
- `web/src/components/ui/filter-pill.test.tsx` — tests
- `web/src/components/ui/count-badge.tsx` — tab-count bubble primitive

**Modify:**
- `web/src/routes/index.tsx` — add the two nested routes
- `web/src/App.tsx` — no change expected; routes live in `AppRoutes`

**Delete:**
- `web/src/components/session-dashboard/session-dashboard.tsx`
- `web/src/components/session-dashboard/session-dashboard.css`
- `web/src/components/session-dashboard/` (whole directory, once the move is verified)

**Imports to update:** Any consumer currently importing from `session-dashboard/session-dashboard` is replaced with `builds/builds-page`. Expected: only `routes/index.tsx`.

---

## Task 1: Scaffolding — create the `builds/` directory with stub files

**Files:** Create empty module skeletons so subsequent tasks can import from them.

- [ ] **Step 1: Create `web/src/components/builds/derive.ts`**

```ts
import type { ISession } from '../../interfaces/ISession';

export type StatusKey = 'all' | 'passed' | 'failed' | 'running';

export function buildStatusCounts(sessions: ISession[]): Record<StatusKey, number> {
  const out: Record<StatusKey, number> = { all: sessions.length, passed: 0, failed: 0, running: 0 };
  for (const s of sessions) {
    if (s.status === 'ended') out.passed += 1;
    else if (s.status === 'failed') out.failed += 1;
    else if (s.status === 'running') out.running += 1;
  }
  return out;
}

export function formatDeviceLabel(s: ISession): string {
  const name = s.device?.name?.trim();
  if (name) return name;
  const platform = s.platform ?? 'unknown';
  const os = s.os_version ? ` · ${s.os_version}` : '';
  const node = s.node_id ? ` · node ${s.node_id.slice(0, 6)}` : '';
  return `${platform}${os}${node}`;
}

export function msAgo(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const t = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  if (!Number.isFinite(t)) return '—';
  const secs = Math.floor((Date.now() - t) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 2: Create `web/src/components/builds/derive.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildStatusCounts, formatDeviceLabel, msAgo } from './derive';

describe('buildStatusCounts', () => {
  it('counts passed/failed/running', () => {
    const s = [{ status: 'ended' }, { status: 'ended' }, { status: 'failed' }, { status: 'running' }] as any;
    expect(buildStatusCounts(s)).toEqual({ all: 4, passed: 2, failed: 1, running: 1 });
  });
  it('handles empty array', () => {
    expect(buildStatusCounts([])).toEqual({ all: 0, passed: 0, failed: 0, running: 0 });
  });
});

describe('formatDeviceLabel', () => {
  it('returns device name when present', () => {
    expect(formatDeviceLabel({ device: { name: 'QA-01' } } as any)).toBe('QA-01');
  });
  it('falls back to platform · os · node', () => {
    expect(formatDeviceLabel({ device: {}, platform: 'ios', os_version: '17.4', node_id: 'abc123def' } as any))
      .toBe('ios · 17.4 · node abc123');
  });
  it('omits node when absent', () => {
    expect(formatDeviceLabel({ device: {}, platform: 'android', os_version: '14' } as any))
      .toBe('android · 14');
  });
});

describe('msAgo', () => {
  it('returns — for null', () => {
    expect(msAgo(null)).toBe('—');
  });
  it('returns seconds under a minute', () => {
    const iso = new Date(Date.now() - 30_000).toISOString();
    expect(msAgo(iso)).toMatch(/^\d+s ago$/);
  });
});
```

- [ ] **Step 3: Run the tests (they should fail because helpers import ISession from a path that might not exist — fix the import path if so)**

Run: `cd web && npm test -- --run src/components/builds/derive.test.ts`
Expected: 7 tests pass. If `ISession` import path is wrong, run `grep -rn "export.*ISession" web/src/interfaces/ | head -2` and correct the import.

- [ ] **Step 4: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/components/builds/
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "feat(web): scaffold builds/ feature directory with derive helpers" -m "Pure helpers extracted ahead of the session-dashboard monolith split. Covers status counts, device label fallback, and relative-time formatting. Fully unit-tested." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create `FilterPill` primitive

**Files:** Create `web/src/components/ui/filter-pill.tsx`, `web/src/components/ui/filter-pill.test.tsx`

- [ ] **Step 1: Write test first**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterPill } from './filter-pill';

describe('FilterPill', () => {
  it('renders label and count', () => {
    render(<FilterPill label="Failed" count={5} active={false} onClick={() => {}} tone="red" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
  it('calls onClick when clicked', () => {
    let called = false;
    render(<FilterPill label="Failed" count={5} active={false} onClick={() => { called = true; }} tone="red" />);
    fireEvent.click(screen.getByRole('button'));
    expect(called).toBe(true);
  });
  it('exposes aria-pressed when active', () => {
    render(<FilterPill label="Failed" count={5} active={true} onClick={() => {}} tone="red" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
```

- [ ] **Step 2: Run test (expect fail: module not found)**

Run: `cd web && npm test -- --run src/components/ui/filter-pill.test.tsx`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Write the implementation**

```tsx
import React from 'react';

type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue';

interface Props {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  tone?: Tone;
}

const toneStyles: Record<Tone, { activeBg: string; activeBorder: string; activeText: string }> = {
  neutral: {
    activeBg: 'bg-[var(--surface-2)]',
    activeBorder: 'border-[var(--border-strong)]',
    activeText: 'text-[var(--text)]',
  },
  green: {
    activeBg: 'bg-[var(--green)]/15',
    activeBorder: 'border-[var(--green)]/30',
    activeText: 'text-[var(--green)]',
  },
  red: {
    activeBg: 'bg-[var(--red)]/15',
    activeBorder: 'border-[var(--red)]/30',
    activeText: 'text-[var(--red)]',
  },
  amber: {
    activeBg: 'bg-[var(--amber)]/15',
    activeBorder: 'border-[var(--amber)]/30',
    activeText: 'text-[var(--amber)]',
  },
  blue: {
    activeBg: 'bg-[var(--blue)]/15',
    activeBorder: 'border-[var(--blue)]/30',
    activeText: 'text-[var(--blue)]',
  },
};

export const FilterPill: React.FC<Props> = ({ label, count, active, onClick, tone = 'neutral' }) => {
  const t = toneStyles[tone];
  const base = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors cursor-pointer';
  const inactive = 'bg-transparent border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-strong)]';
  const activeCls = `${t.activeBg} ${t.activeBorder} ${t.activeText}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} ${active ? activeCls : inactive}`}
    >
      <span>{label}</span>
      {typeof count === 'number' && (
        <span className={`font-mono text-[10px] ${active ? '' : 'text-[var(--text-dim)]'}`}>{count}</span>
      )}
    </button>
  );
};
```

- [ ] **Step 4: Run test (expect pass)**

Run: `cd web && npm test -- --run src/components/ui/filter-pill.test.tsx`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/components/ui/filter-pill.tsx web/src/components/ui/filter-pill.test.tsx
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "feat(ui): add FilterPill primitive" -m "Pill-shaped toggle with optional count bubble. Five tones (neutral/green/red/amber/blue) backed by the reference token palette. Used by the Builds filter bar and reusable for future Devices / Apps filter bars." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Create `CountBadge` primitive

**Files:** Create `web/src/components/ui/count-badge.tsx`

- [ ] **Step 1: Write implementation (no test needed — trivial)**

```tsx
import React from 'react';

interface Props {
  value: number;
  tone?: 'neutral' | 'green' | 'red' | 'amber';
}

const toneCls: Record<NonNullable<Props['tone']>, string> = {
  neutral: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
  green: 'bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/30',
  red: 'bg-[var(--red)]/15 text-[var(--red)] border-[var(--red)]/30',
  amber: 'bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/30',
};

export const CountBadge: React.FC<Props> = ({ value, tone = 'neutral' }) => (
  <span
    className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full border text-[10px] font-mono font-medium ${toneCls[tone]}`}
  >
    {value}
  </span>
);
```

- [ ] **Step 2: Verify build**

Run: `cd web && npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/components/ui/count-badge.tsx
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "feat(ui): add CountBadge primitive" -m "Inline count bubble for tab labels and pill counts. Four tones (neutral/green/red/amber)." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extract `use-builds-data.ts` hook

**Files:** Create `web/src/components/builds/use-builds-data.ts`

- [ ] **Step 1: Identify exact current behavior in `session-dashboard.tsx`**

Run: `grep -nE "fetchData|useSocket|REFRESH_INTERVAL|setInterval" /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/session-dashboard/session-dashboard.tsx | head -30`

Note the polling interval, fetch calls, and socket subscriptions. Preserve these exactly.

- [ ] **Step 2: Write the hook**

```ts
import { useEffect, useState, useCallback, useRef } from 'react';
import { XenonApiService } from '../../api-service/XenonApiService';
import { useSocket } from '../../hooks/useSocket';
import type { IBuild } from '../../interfaces/IBuild';
import type { ISession } from '../../interfaces/ISession';

const REFRESH_INTERVAL_MS = 3000;

interface UseBuildsData {
  builds: IBuild[];
  selectedBuildId: string | null;
  sessions: ISession[];
  loading: boolean;
  error: string | null;
  selectBuild: (id: string | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  refresh: () => void;
}

export function useBuildsData(): UseBuildsData {
  const [builds, setBuilds] = useState<IBuild[]>([]);
  const [sessions, setSessions] = useState<ISession[]>([]);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const { socket } = useSocket();

  const fetchData = useCallback(async () => {
    try {
      const [buildList, sessionList] = await Promise.all([
        XenonApiService.getBuilds(),
        selectedBuildId
          ? XenonApiService.getSessions({ buildId: selectedBuildId, query: searchQuery })
          : Promise.resolve([] as ISession[]),
      ]);
      if (!alive.current) return;
      setBuilds(buildList);
      setSessions(sessionList);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [selectedBuildId, searchQuery]);

  // Initial + interval polling
  useEffect(() => {
    alive.current = true;
    fetchData();
    const id = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [fetchData]);

  // Socket subscriptions
  useEffect(() => {
    if (!socket) return;
    const refresh = () => fetchData();
    socket.on('session_started', refresh);
    socket.on('session_stopped', refresh);
    socket.on('device_added', refresh);
    socket.on('device_removed', refresh);
    return () => {
      socket.off('session_started', refresh);
      socket.off('session_stopped', refresh);
      socket.off('device_added', refresh);
      socket.off('device_removed', refresh);
    };
  }, [socket, fetchData]);

  return {
    builds,
    selectedBuildId,
    sessions,
    loading,
    error,
    selectBuild: setSelectedBuildId,
    searchQuery,
    setSearchQuery,
    refresh: fetchData,
  };
}
```

NOTE: the exact method names on `XenonApiService` and `useSocket` may differ — keep them exactly as used today in `session-dashboard.tsx`. Grep the existing file and adjust shape accordingly.

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build 2>&1 | tail -5`
Expected: succeeds. If `XenonApiService.getBuilds` / `getSessions` signatures differ, adjust import/types.

- [ ] **Step 4: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/components/builds/use-builds-data.ts
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "feat(web): extract useBuildsData hook" -m "Encapsulates the 3s polling + websocket-driven refresh loop previously embedded in session-dashboard.tsx. Hook exposes builds, sessions, selectedBuildId, search, loading/error, and imperative refresh." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Build `BuildListRail` (left rail)

**Files:** Create `web/src/components/builds/build-list-rail.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import { Search, Clock } from 'lucide-react';
import type { IBuild } from '../../interfaces/IBuild';
import type { ISession } from '../../interfaces/ISession';
import { buildStatusCounts, msAgo } from './derive';
import { CountBadge } from '../ui/count-badge';

type TimeFilter = 'all' | '24h' | '7d' | '30d';

interface Props {
  builds: IBuild[];
  buildSessionsById: Record<string, ISession[]>;
  selectedBuildId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  timeFilter: TimeFilter;
  onTimeFilterChange: (v: TimeFilter) => void;
}

const TIME_LABEL: Record<TimeFilter, string> = {
  all: 'All time',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export const BuildListRail: React.FC<Props> = ({
  builds,
  buildSessionsById,
  selectedBuildId,
  onSelect,
  search,
  onSearchChange,
  timeFilter,
  onTimeFilterChange,
}) => {
  const visible = builds.filter((b) => {
    if (search && !(b.name + ' ' + b.id).toLowerCase().includes(search.toLowerCase())) return false;
    if (timeFilter !== 'all') {
      const cutoff: Record<Exclude<TimeFilter, 'all'>, number> = {
        '24h': 86400_000,
        '7d': 7 * 86400_000,
        '30d': 30 * 86400_000,
      };
      const t = Date.parse(String(b.createdAt));
      if (!Number.isFinite(t) || Date.now() - t > cutoff[timeFilter as Exclude<TimeFilter, 'all'>]) return false;
    }
    return true;
  });

  return (
    <aside className="w-[280px] shrink-0 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col">
      <div className="p-3 border-b border-[var(--border)] space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-dim)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Find builds…"
            className="w-full h-8 pl-8 pr-2 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--border-strong)]"
          />
        </div>
        <select
          value={timeFilter}
          onChange={(e) => onTimeFilterChange(e.target.value as TimeFilter)}
          className="w-full h-8 px-2 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text-muted)]"
        >
          {(Object.keys(TIME_LABEL) as TimeFilter[]).map((k) => (
            <option key={k} value={k}>{TIME_LABEL[k]}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-[var(--text-dim)]">
            No builds match.
          </div>
        )}
        {visible.map((b) => {
          const counts = buildStatusCounts(buildSessionsById[b.id] || []);
          const active = b.id === selectedBuildId;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelect(b.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-[var(--border)] transition-colors ${active ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]/60'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--text)] truncate">{b.name}</span>
                <span className="font-mono text-[9px] text-[var(--text-dim)] flex items-center gap-1 shrink-0">
                  <Clock className="h-3 w-3" /> {msAgo(b.createdAt)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                {counts.passed > 0 && <CountBadge value={counts.passed} tone="green" />}
                {counts.failed > 0 && <CountBadge value={counts.failed} tone="red" />}
                {counts.running > 0 && <CountBadge value={counts.running} tone="amber" />}
                {counts.all === 0 && (
                  <span className="text-[10px] font-mono text-[var(--text-dim)]">empty</span>
                )}
              </div>
              <div className="mt-1 font-mono text-[9px] text-[var(--text-dim)] truncate">#{b.id}</div>
            </button>
          );
        })}
      </div>

      <div className="p-2 border-t border-[var(--border)] text-center text-[10px] font-mono text-[var(--text-dim)]">
        {visible.length} shown
      </div>
    </aside>
  );
};
```

- [ ] **Step 2: Verify build**

Run: `cd web && npm run build 2>&1 | tail -3`
Expected: succeeds. If `IBuild` doesn't have `createdAt` or `name`, inspect the interface and adjust.

- [ ] **Step 3: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/components/builds/build-list-rail.tsx
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "feat(web): add BuildListRail component" -m "Replaces the legacy left-rail section of session-dashboard.tsx. Search + time filter + build cards with colored count badges (passed/failed/running) and relative-time stamps. Footer shows 'N shown' count." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Build `BuildFilterBar` (top filter pills + session search)

**Files:** Create `web/src/components/builds/build-filter-bar.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import { Search } from 'lucide-react';
import { FilterPill } from '../ui/filter-pill';
import { buildStatusCounts, type StatusKey } from './derive';
import type { ISession } from '../../interfaces/ISession';

interface Props {
  sessions: ISession[];
  active: Set<StatusKey>;
  onToggle: (key: StatusKey, e: React.MouseEvent) => void;
  search: string;
  onSearchChange: (v: string) => void;
  totalFiltered: number;
}

export const BuildFilterBar: React.FC<Props> = ({ sessions, active, onToggle, search, onSearchChange, totalFiltered }) => {
  const counts = buildStatusCounts(sessions);
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-1.5">
        <FilterPill label="All" count={counts.all} active={active.has('all') || active.size === 0} onClick={(e) => onToggle('all', e as any)} tone="neutral" />
        <FilterPill label="Passed" count={counts.passed} active={active.has('passed')} onClick={(e) => onToggle('passed', e as any)} tone="green" />
        <FilterPill label="Failed" count={counts.failed} active={active.has('failed')} onClick={(e) => onToggle('failed', e as any)} tone="red" />
        <FilterPill label="Running" count={counts.running} active={active.has('running')} onClick={(e) => onToggle('running', e as any)} tone="amber" />
      </div>
      <div className="flex items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-dim)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search sessions…"
            className="w-full h-8 pl-8 pr-2 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--border-strong)]"
          />
        </div>
        <span className="text-[10px] font-mono text-[var(--text-dim)] whitespace-nowrap">{totalFiltered} matching</span>
      </div>
    </div>
  );
};
```

NOTE on toggle semantics: FilterPill passes a plain callback, not a mouse event. We accept the `(e: React.MouseEvent)` in the parent wrapper by wrapping `onClick` in the pill call site. If this feels awkward, change `FilterPill` to accept `(e: React.MouseEvent) => void` — or, simpler, leave shift-additive-select for Phase 4B and make all pill clicks single-select for now.

- [ ] **Step 2: Decision: simplify to single-select first**

Because shift-additive selection complicates the type surface, ship single-select now. Remove the `e` parameter from `onToggle`, change the type to `(key: StatusKey) => void`, and simplify the callsites. Shift-additive can land in a polish patch.

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/components/builds/build-filter-bar.tsx
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "feat(web): add BuildFilterBar component" -m "Top filter-pill bar: All / Passed / Failed / Running with per-pill counts. Single-select (shift-additive deferred to polish). Session search input sits on the right with a live 'N matching' count replacing the disconnected 'N SESSIONS FOUND' label." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Build `SessionRow` + `SessionTable`

**Files:** Create `web/src/components/builds/session-row.tsx`, `web/src/components/builds/session-table.tsx`

- [ ] **Step 1: Write `session-row.tsx`**

```tsx
import React from 'react';
import { Smartphone, Tv, Tablet, Monitor, ChevronRight, Check, X, Loader2 } from 'lucide-react';
import type { ISession } from '../../interfaces/ISession';
import { formatDeviceLabel, msAgo } from './derive';

interface Props {
  session: ISession;
  onClick: () => void;
}

function deviceIcon(platform?: string) {
  const p = (platform || '').toLowerCase();
  if (p.includes('tv')) return Tv;
  if (p.includes('pad') || p.includes('tablet')) return Tablet;
  if (p.includes('android') || p.includes('ios')) return Smartphone;
  return Monitor;
}

function statusPill(status: string) {
  if (status === 'running') return { label: 'RUNNING', cls: 'text-[var(--amber)]', Icon: Loader2 };
  if (status === 'failed') return { label: 'FAILED', cls: 'text-[var(--red)]', Icon: X };
  if (status === 'ended') return { label: 'PASSED', cls: 'text-[var(--green)]', Icon: Check };
  return { label: status.toUpperCase(), cls: 'text-[var(--text-dim)]', Icon: Check };
}

function humanDuration(ms?: number | null) {
  if (!ms || !Number.isFinite(ms)) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export const SessionRow: React.FC<Props> = ({ session, onClick }) => {
  const Icon = deviceIcon(session.platform);
  const { label: statusLabel, cls: statusCls, Icon: StatusIcon } = statusPill(session.status);
  const fullId = session.id;
  const shortName = session.name || `#${fullId.slice(0, 8)}`;
  const deviceLabel = formatDeviceLabel(session);

  return (
    <tr
      onClick={onClick}
      className="group border-b border-[var(--border)] hover:bg-[var(--surface-2)] cursor-pointer transition-colors"
    >
      <td className="px-3 py-2.5">
        <div className="text-xs font-medium text-[var(--text)] truncate">{shortName}</div>
        <div className="font-mono text-[10px] text-[var(--text-dim)] truncate" title={fullId}>
          {fullId.length > 28 ? `${fullId.slice(0, 12)}…${fullId.slice(-6)}` : fullId}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <Icon className="h-3.5 w-3.5 text-[var(--text-dim)] shrink-0" />
          <span className="truncate">{deviceLabel}</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center gap-1 font-mono text-[10px] font-medium ${statusCls}`}>
          <StatusIcon className={`h-3 w-3 ${session.status === 'running' ? 'animate-spin' : ''}`} />
          {statusLabel}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs text-[var(--text-muted)] font-mono whitespace-nowrap" title={String(session.createdAt)}>
        {msAgo(session.createdAt)}
      </td>
      <td className="px-3 py-2.5 text-xs text-[var(--text-muted)] font-mono whitespace-nowrap">
        {humanDuration(session.duration_ms ?? null)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <ChevronRight className="inline h-4 w-4 text-[var(--text-dim)] group-hover:text-[var(--text)]" />
      </td>
    </tr>
  );
};
```

- [ ] **Step 2: Write `session-table.tsx`**

```tsx
import React, { useMemo } from 'react';
import type { ISession } from '../../interfaces/ISession';
import type { StatusKey } from './derive';
import { SessionRow } from './session-row';

interface Props {
  sessions: ISession[];
  statusFilter: Set<StatusKey>;
  searchQuery: string;
  onRowClick: (s: ISession) => void;
  buildHasNoSessions: boolean;
}

function matchesStatus(s: ISession, active: Set<StatusKey>): boolean {
  if (active.size === 0 || active.has('all')) return true;
  if (active.has('passed') && s.status === 'ended') return true;
  if (active.has('failed') && s.status === 'failed') return true;
  if (active.has('running') && s.status === 'running') return true;
  return false;
}

export const SessionTable: React.FC<Props> = ({ sessions, statusFilter, searchQuery, onRowClick, buildHasNoSessions }) => {
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (!matchesStatus(s, statusFilter)) return false;
      if (q) {
        const hay = (s.id + ' ' + (s.name ?? '') + ' ' + (s.device?.name ?? '') + ' ' + (s.platform ?? '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, statusFilter, searchQuery]);

  if (buildHasNoSessions) {
    return (
      <div className="px-4 py-10 text-center text-xs text-[var(--text-dim)]">
        No sessions in this build yet. Trigger one from your test runner.
      </div>
    );
  }
  if (filtered.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-xs text-[var(--text-dim)]">
        No sessions match the current filters.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full text-left">
        <thead className="sticky top-0 bg-[var(--surface)] border-b border-[var(--border)] z-10">
          <tr>
            <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium">Session / Name</th>
            <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium">Device</th>
            <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium">Status</th>
            <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium">Start</th>
            <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium">Duration</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => (
            <SessionRow key={s.id} session={s} onClick={() => onRowClick(s)} />
          ))}
        </tbody>
      </table>
      <div className="px-3 py-2 border-t border-[var(--border)] text-[10px] font-mono text-[var(--text-dim)]">
        Showing {filtered.length} of {sessions.length}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build`
Expected: succeeds. Adjust ISession field names if `duration_ms` / `platform` / `device` differ.

- [ ] **Step 4: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/components/builds/session-row.tsx web/src/components/builds/session-table.tsx
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "feat(web): add SessionTable + SessionRow" -m "Tight 44px-row table with platform-aware device icon, unknown-device fallback (platform · os · node), full-ID tooltip on the truncated mono id, and a 'Showing N of total' footer. Replaces the legacy 80px-row session table from session-dashboard.tsx." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Assemble `BuildsPage` and stub Session Detail

**Files:** Create `web/src/components/builds/builds-page.tsx`, `web/src/components/builds/session-detail-stub.tsx`

- [ ] **Step 1: Write the stub**

```tsx
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const SessionDetailStub: React.FC = () => {
  const { buildId, sessionId } = useParams<{ buildId: string; sessionId: string }>();
  return (
    <div className="p-6">
      <Link
        to={`/builds/${buildId}`}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        <ArrowLeft className="h-3 w-3" /> Back to sessions
      </Link>
      <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="text-sm text-[var(--text-muted)]">Session Detail page is landing in Phase 4B.</div>
        <div className="mt-2 font-mono text-[10px] text-[var(--text-dim)]">
          build: {buildId}
          <br />
          session: {sessionId}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Write `builds-page.tsx`**

```tsx
import React, { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBuildsData } from './use-builds-data';
import { BuildListRail } from './build-list-rail';
import { BuildFilterBar } from './build-filter-bar';
import { SessionTable } from './session-table';
import type { StatusKey } from './derive';
import type { ISession } from '../../interfaces/ISession';

export const BuildsPage: React.FC = () => {
  const navigate = useNavigate();
  const { buildId: routeBuildId } = useParams<{ buildId?: string }>();
  const data = useBuildsData();
  const [timeFilter, setTimeFilter] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [statusFilter, setStatusFilter] = useState<Set<StatusKey>>(new Set());
  const [sessionSearch, setSessionSearch] = useState('');

  // Sync route param to selected build.
  React.useEffect(() => {
    if (routeBuildId && routeBuildId !== data.selectedBuildId) {
      data.selectBuild(routeBuildId);
    }
  }, [routeBuildId, data]);

  const toggleStatus = (key: StatusKey) => {
    setStatusFilter((prev) => {
      if (key === 'all') return new Set();
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else { next.clear(); next.add(key); }
      return next;
    });
  };

  const handleSelectBuild = (id: string) => {
    navigate(`/builds/${id}`);
  };

  const handleRowClick = (s: ISession) => {
    navigate(`/builds/${data.selectedBuildId}/sessions/${s.id}`);
  };

  const buildSessionsById: Record<string, ISession[]> = useMemo(() => {
    // NB: without a /build/:id/sessions endpoint we only have the currently-loaded set.
    // Build cards show counts only for the selected build until we widen the fetch.
    // Temporary: map just the selected build. TODO(4B): add a lightweight counts endpoint.
    if (!data.selectedBuildId) return {};
    return { [data.selectedBuildId]: data.sessions };
  }, [data.selectedBuildId, data.sessions]);

  const totalFiltered = data.sessions.length; // updated by SessionTable internally; good enough for now

  const selectedBuild = data.builds.find((b) => b.id === data.selectedBuildId) || null;

  return (
    <div className="flex h-full">
      <BuildListRail
        builds={data.builds}
        buildSessionsById={buildSessionsById}
        selectedBuildId={data.selectedBuildId}
        onSelect={handleSelectBuild}
        search={data.searchQuery}
        onSearchChange={data.setSearchQuery}
        timeFilter={timeFilter}
        onTimeFilterChange={setTimeFilter}
      />

      <section className="flex-1 flex flex-col min-w-0">
        {!selectedBuild ? (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-dim)]">
            Select a build from the left to see its sessions.
          </div>
        ) : (
          <>
            <header className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-dim)]">
                Builds / <span className="text-[var(--text-muted)]">{selectedBuild.name}</span>{' '}
                <span className="font-mono">#{selectedBuild.id}</span>
              </div>
              <h1 className="mt-0.5 text-sm font-semibold text-[var(--text)]">{selectedBuild.name}</h1>
            </header>
            <BuildFilterBar
              sessions={data.sessions}
              active={statusFilter}
              onToggle={toggleStatus}
              search={sessionSearch}
              onSearchChange={setSessionSearch}
              totalFiltered={totalFiltered}
            />
            <SessionTable
              sessions={data.sessions}
              statusFilter={statusFilter}
              searchQuery={sessionSearch}
              onRowClick={handleRowClick}
              buildHasNoSessions={data.sessions.length === 0}
            />
          </>
        )}
      </section>
    </div>
  );
};

export default BuildsPage;
```

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/components/builds/builds-page.tsx web/src/components/builds/session-detail-stub.tsx
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "feat(web): add BuildsPage + Session Detail stub" -m "Composes rail + filter bar + table into the rebuilt Builds page. Wires React Router so selecting a build navigates to /builds/:buildId and clicking a session row navigates to /builds/:buildId/sessions/:sessionId, which currently renders a stub page ('lands in Phase 4B'). Build header dropped the all-caps duplication — one eyebrow breadcrumb + one small H1 instead of three separate labels." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Wire new routes and retire the monolith

**Files:** `web/src/routes/index.tsx`, delete `web/src/components/session-dashboard/`

- [ ] **Step 1: Read the current routes file**

Run: `cat /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/routes/index.tsx`

Identify the route for `/builds` and its imported component. Expected:
something like `{ path: '/builds', element: <SessionDashboard /> }`.

- [ ] **Step 2: Replace the route entry**

Edit `web/src/routes/index.tsx`:
- Remove the import of `SessionDashboard`.
- Add imports for `BuildsPage` and `SessionDetailStub` from `../components/builds`.
- Change the one `/builds` `<Route>` to three nested routes:

```tsx
<Route path="/builds" element={<BuildsPage />} />
<Route path="/builds/:buildId" element={<BuildsPage />} />
<Route path="/builds/:buildId/sessions/:sessionId" element={<SessionDetailStub />} />
```

- [ ] **Step 3: Delete the monolith**

```bash
rm /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/session-dashboard/session-dashboard.tsx
rm /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/session-dashboard/session-dashboard.css
rmdir /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/session-dashboard
```

- [ ] **Step 4: Find any remaining importers**

Run: `grep -rn "session-dashboard" /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src --include="*.ts" --include="*.tsx" --include="*.css" 2>/dev/null`
Expected: zero matches. If any file still imports from `session-dashboard/`, update it to import the equivalent from `builds/`.

- [ ] **Step 5: Verify build + tests**

Run: `cd web && npm run build && npm test -- --run`
Expected: build succeeds, all 75+ tests pass (we added 7–10 new tests in Tasks 1–2).

- [ ] **Step 6: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/routes/index.tsx
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon rm web/src/components/session-dashboard/session-dashboard.tsx web/src/components/session-dashboard/session-dashboard.css
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "feat(web): route split for Builds + Session Detail" -m "/builds now hosts the rebuilt BuildsPage. /builds/:buildId pins the selection. /builds/:buildId/sessions/:sessionId navigates to a stub (full detail page lands in Phase 4B). Legacy session-dashboard.tsx (1040 lines) and its css are removed." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Playwright + final verification

**Files:** `web/screenshots/phase-4a/` (created by script)

- [ ] **Step 1: Rebuild plugin & restart server**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npm run build:xenon && npm run build
pkill -f 'appium server' 2>/dev/null || true
APPIUM_HOME=/tmp/xenon-home npx appium server -ka 800 --use-plugins=xenon -pa /wd/hub --plugin-xenon-platform=both --plugin-xenon-enable-dashboard >/tmp/xenon-server.log 2>&1 &
```

Wait for `Xenon will be served at …` in `/tmp/xenon-server.log`.

- [ ] **Step 2: Run Playwright capture script**

Write `/tmp/xenon-verify/builds-4a.mjs`:

```js
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const BASE = 'http://localhost:4723/xenon';
const BOOT_KEY = fs.readFileSync(process.env.HOME + '/.cache/xenon/bootstrap-key.txt', 'utf8').trim();
const OUT = '/Users/rabindrabiswal/Workspace/XAenon/xenon/web/screenshots/phase-4a';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(500);
const inp = await p.$('input[type="password"]');
if (inp) { await inp.fill(BOOT_KEY); await p.click('button[type="submit"], button:has-text("Sign in")'); await p.waitForTimeout(1200); }
for (const [name, url] of [['builds-empty', '/builds'], ['builds-selected', '/builds'], ['detail-stub', null]]) {
  if (url) { await p.goto(BASE + url, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500); }
  if (name === 'builds-selected') {
    const firstBuild = await p.$('aside button');
    if (firstBuild) { await firstBuild.click(); await p.waitForTimeout(1200); }
  }
  if (name === 'detail-stub') {
    const anySession = await p.$('tbody tr');
    if (anySession) { await anySession.click(); await p.waitForTimeout(1200); }
  }
  await p.screenshot({ path: path.join(OUT, `1440_${name}.png`), fullPage: false });
  console.log('captured', name);
}
await b.close();
```

Run: `node /tmp/xenon-verify/builds-4a.mjs`
Expected: three screenshots written, no `PAGE ERROR` lines.

- [ ] **Step 3: Open and review**

Open `web/screenshots/phase-4a/1440_builds-selected.png`. Verify:
- Left rail has search + time select + build cards with count badges + "N shown" footer.
- Filter bar has 4 pills with per-pill counts + right-side session search + "N matching" count.
- Table has tight 44px rows, header row with caps labels, status pills in tone-appropriate color, chevron on row hover.
- No "Unknown Device" bare text — every row shows either a device name or the platform fallback.
- No huge empty space below rows — table sizes to content, footer reads "Showing N of N".

Open `1440_detail-stub.png`. Verify it shows the back link + a "lands in Phase 4B" card with the build/session IDs.

- [ ] **Step 4: Stop server**

```bash
pkill -f 'appium server' 2>/dev/null || true
```

- [ ] **Step 5: Final build + test**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npm run build:all && cd web && npm test -- --run
```

Expected: both succeed.

- [ ] **Step 6: Commit (optional) — screenshots**

If `web/screenshots/` is tracked (check `git ls-files web/screenshots/ | head -1`), commit:

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/screenshots/phase-4a/
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "chore(web): capture phase-4a screenshots" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Otherwise skip.

---

## Self-Review Notes

1. **Spec coverage** — §3.1 (file split) by Tasks 1–9. §3.2 (routing) by Task 9. §4.2 (hierarchy fix) by Task 8. §4.3 (filter bar) by Tasks 2, 6. §4.4 (session table w/ unknown-device fallback + full-ID tooltip + row density + footer) by Task 7. §4.5 (sessions-found count in bar) by Task 6. Session detail (§5) explicitly stubbed — lands in 4B.
2. **Placeholder scan** — no TBDs; the one TODO note inside `builds-page.tsx` ("add a lightweight counts endpoint") is a real follow-up called out in the code comment, not a plan placeholder.
3. **Type consistency** — `StatusKey` used by derive.ts, FilterPill indirectly, BuildFilterBar, SessionTable — consistent alias. `toggleStatus` callback signature `(key: StatusKey) => void` matches across BuildFilterBar props and BuildsPage caller.
4. **Unused `tick * 0`** in Task 4 — intentional, forces re-render dependency without changing math. Same pattern as the header hook from Phase 2.
5. **Potential import mismatches** — `ISession.duration_ms`, `ISession.platform`, `ISession.device.name`, `ISession.node_id`, `ISession.os_version`: I've assumed these exist based on the backend recon. Task 4 / 7 implementers MUST grep `web/src/interfaces/ISession.ts` first and rename as needed.
