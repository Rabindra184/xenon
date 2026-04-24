# Xenon Redesign — Builds List + Routing (Phase 4A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1040-line `session-dashboard.tsx` monolith into a feature-owned `builds/` directory, promote session detail to its own route, and rebuild the Builds list body to pixel-closely match the reference screenshot — left-rail status summary cards, bulk-selectable table rows, Retry failed + Export action buttons (UI stubs for now, wired in Plan 4B), two-line stacked cells, outlined status pills, and absolute timestamps.

**Architecture:** The builds directory owns `builds-page.tsx`, `builds-header.tsx`, `build-list-rail.tsx`, `build-filter-bar.tsx`, `session-table.tsx`, `session-row.tsx`, plus a `use-builds-data.ts` hook. Routing gets three paths: `/builds`, `/builds/:buildId`, `/builds/:buildId/sessions/:sessionId` (the last renders a placeholder Session Detail stub — full redesign is Plan 4C).

**Tech Stack:** React 17, Vite 5, Tailwind 3.4, react-router-dom 6, lucide-react, existing Xenon `XenonApiService` / `useSocket` / UI primitives.

**Parent spec:** `docs/superpowers/specs/2026-04-24-builds-session-detail-redesign-design.md` §3, §4, §6.

**Scope note:** This is Sub-plan 4A of four. 4B wires the Retry/Export backend. 4C rebuilds the Session Detail page. 4D rebuilds the log viewer.

---

## File Structure

**Create:**
- `web/src/components/builds/builds-page.tsx`
- `web/src/components/builds/builds-header.tsx`
- `web/src/components/builds/build-list-rail.tsx`
- `web/src/components/builds/build-filter-bar.tsx`
- `web/src/components/builds/session-table.tsx`
- `web/src/components/builds/session-row.tsx`
- `web/src/components/builds/session-detail-stub.tsx`
- `web/src/components/builds/use-builds-data.ts`
- `web/src/components/builds/derive.ts`
- `web/src/components/builds/derive.test.ts`
- `web/src/components/ui/filter-pill.tsx`
- `web/src/components/ui/filter-pill.test.tsx`
- `web/src/components/ui/count-badge.tsx`
- `web/src/components/ui/status-pill-outline.tsx`
- `web/src/components/ui/status-summary-card.tsx`

**Modify:**
- `web/src/routes/index.tsx` — new routes

**Delete:**
- `web/src/components/session-dashboard/session-dashboard.tsx`
- `web/src/components/session-dashboard/session-dashboard.css`

---

## Task 1: Scaffolding — `derive.ts` helpers

**Files:** Create `web/src/components/builds/derive.ts`, `web/src/components/builds/derive.test.ts`

- [ ] **Step 1: Inspect `ISession` interface**

Run: `cat /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/interfaces/ISession.ts`

Note the exact field names for `status`, `failure_reason`, `failure_category`, `platform`, `os_version`, `node_id`, `device`, `duration_ms`, `createdAt`, `endedAt`. Adjust the helpers below if any name differs.

- [ ] **Step 2: Write `derive.ts`**

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

export function deviceNameOrFallback(s: ISession): string {
  const n = s.device?.name?.trim();
  return n && n.length > 0 ? n : 'Unknown Device';
}

export function nodeLabel(s: ISession): string {
  const id = s.node_id || s.device?.node_id;
  return id ? `node-${String(id).slice(-1) === '-' ? id : id}` : '—';
}

export function platformLabel(s: ISession): string {
  const p = s.platform ?? '';
  if (!p) return '—';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function osVersionLabel(s: ISession): string {
  return s.os_version ? `v${s.os_version}` : '';
}

export function formatAbsoluteTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}, ${hh}:${mi}:${ss}`;
}

export function humanDuration(ms?: number | null): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  const totalS = ms / 1000;
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS - h * 3600 - m * 60;
  const sPart = s >= 10 ? s.toFixed(1) : s.toFixed(1);
  if (h > 0) return `${h}h ${m}m ${sPart}s`;
  if (m > 0) return `${m}m ${sPart}s`;
  return `${sPart}s`;
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

export function shortId(id: string, head = 10, tail = 4): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
```

- [ ] **Step 3: Write `derive.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  buildStatusCounts,
  deviceNameOrFallback,
  platformLabel,
  osVersionLabel,
  formatAbsoluteTime,
  humanDuration,
  shortId,
} from './derive';

describe('buildStatusCounts', () => {
  it('counts passed/failed/running', () => {
    const s = [{ status: 'ended' }, { status: 'ended' }, { status: 'failed' }, { status: 'running' }] as any;
    expect(buildStatusCounts(s)).toEqual({ all: 4, passed: 2, failed: 1, running: 1 });
  });
  it('handles empty array', () => {
    expect(buildStatusCounts([])).toEqual({ all: 0, passed: 0, failed: 0, running: 0 });
  });
});

describe('deviceNameOrFallback', () => {
  it('returns device name when present', () => {
    expect(deviceNameOrFallback({ device: { name: 'QA-01' } } as any)).toBe('QA-01');
  });
  it('returns Unknown Device when missing', () => {
    expect(deviceNameOrFallback({ device: {} } as any)).toBe('Unknown Device');
    expect(deviceNameOrFallback({ device: { name: '   ' } } as any)).toBe('Unknown Device');
  });
});

describe('platformLabel', () => {
  it('capitalizes platform', () => {
    expect(platformLabel({ platform: 'android' } as any)).toBe('Android');
    expect(platformLabel({ platform: 'ios' } as any)).toBe('Ios');
  });
  it('returns em-dash when empty', () => {
    expect(platformLabel({ } as any)).toBe('—');
  });
});

describe('osVersionLabel', () => {
  it('prefixes with v', () => {
    expect(osVersionLabel({ os_version: '13' } as any)).toBe('v13');
  });
  it('returns empty string when absent', () => {
    expect(osVersionLabel({ } as any)).toBe('');
  });
});

describe('formatAbsoluteTime', () => {
  it('formats ISO string to dd/MM/yyyy, HH:mm:ss', () => {
    const out = formatAbsoluteTime('2026-04-23T06:53:25Z');
    expect(out).toMatch(/^\d{2}\/\d{2}\/2026, \d{2}:\d{2}:\d{2}$/);
  });
  it('returns em-dash for null', () => {
    expect(formatAbsoluteTime(null)).toBe('—');
  });
});

describe('humanDuration', () => {
  it('formats hours-minutes-seconds', () => {
    expect(humanDuration(6 * 3600_000 + 7 * 60_000 + 38_400)).toBe('6h 7m 38.4s');
  });
  it('returns em-dash for 0 or nullish', () => {
    expect(humanDuration(0)).toBe('—');
    expect(humanDuration(null)).toBe('—');
  });
});

describe('shortId', () => {
  it('truncates long ids', () => {
    expect(shortId('orphan-fresh-sess-001')).toBe('orphan-fre…-001');
  });
  it('leaves short ids alone', () => {
    expect(shortId('abc')).toBe('abc');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd web && npm test -- --run src/components/builds/derive.test.ts`
Expected: all tests pass. If `ISession` field names differ (e.g., `node_id` vs `nodeId`), adjust both the helpers and tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add web/src/components/builds/
git commit -m "feat(web): scaffold builds/ with derive helpers" -m "Pure helpers for the 4A rebuild: status counts, device-name fallback, absolute dd/MM/yyyy time, human-readable durations, and short-id tooltipping. Unit-tested." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `FilterPill` primitive

**Files:** Create `web/src/components/ui/filter-pill.tsx`, `web/src/components/ui/filter-pill.test.tsx`

- [ ] **Step 1: Test-first**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterPill } from './filter-pill';

describe('FilterPill', () => {
  it('renders label and count', () => {
    render(<FilterPill label="FAILED" count={5} active={false} onClick={() => {}} tone="red" />);
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
  it('calls onClick when clicked', () => {
    const spy = vi.fn();
    render(<FilterPill label="FAILED" count={5} active={false} onClick={spy} tone="red" />);
    fireEvent.click(screen.getByRole('button'));
    expect(spy).toHaveBeenCalledOnce();
  });
  it('exposes aria-pressed when active', () => {
    render(<FilterPill label="FAILED" count={5} active onClick={() => {}} tone="red" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
```

Note: if `vi` import is missing, add `import { vi } from 'vitest';` at the top.

- [ ] **Step 2: Run (expect fail)**

Run: `cd web && npm test -- --run src/components/ui/filter-pill.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
import React from 'react';

type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue';

interface Props {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  tone?: Tone;
  bullet?: boolean;
}

const dotCls: Record<Tone, string> = {
  neutral: 'bg-[var(--text-dim)]',
  green:   'bg-[var(--green)]',
  red:     'bg-[var(--red)]',
  amber:   'bg-[var(--amber)]',
  blue:    'bg-[var(--blue)]',
};

export const FilterPill: React.FC<Props> = ({ label, count, active, onClick, tone = 'neutral', bullet = true }) => {
  const base = 'inline-flex items-center gap-2 h-8 px-3 rounded-md border text-[11px] font-semibold uppercase tracking-wider transition-colors cursor-pointer';
  const inactive = 'bg-transparent border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]/50';
  const activeCls = 'bg-[var(--surface-2)] border-[var(--border-strong)] text-[var(--text)]';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} ${active ? activeCls : inactive}`}
    >
      {bullet && tone !== 'neutral' && <span className={`h-1.5 w-1.5 rounded-full ${dotCls[tone]}`} />}
      <span>{label}</span>
      {typeof count === 'number' && (
        <span className="font-mono text-[10px] text-[var(--text-dim)]">{count}</span>
      )}
    </button>
  );
};
```

- [ ] **Step 4: Run (expect pass)**

Run: `cd web && npm test -- --run src/components/ui/filter-pill.test.tsx`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui/filter-pill.tsx web/src/components/ui/filter-pill.test.tsx
git commit -m "feat(ui): add FilterPill primitive" -m "Matches the reference screenshot: ALL-style neutral pill + colored-bullet variants for PASSED / FAILED / RUNNING. Active state gets surface-2 bg with a border-strong ring." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `CountBadge` and `StatusPillOutline` primitives

**Files:** Create `web/src/components/ui/count-badge.tsx`, `web/src/components/ui/status-pill-outline.tsx`

- [ ] **Step 1: Write `count-badge.tsx`**

```tsx
import React from 'react';

interface Props {
  value: number;
  tone?: 'neutral' | 'green' | 'red' | 'amber';
}

const toneCls: Record<NonNullable<Props['tone']>, string> = {
  neutral: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
  green:   'bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/30',
  red:     'bg-[var(--red)]/15   text-[var(--red)]   border-[var(--red)]/30',
  amber:   'bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/30',
};

export const CountBadge: React.FC<Props> = ({ value, tone = 'neutral' }) => (
  <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full border text-[10px] font-mono font-medium ${toneCls[tone]}`}>
    {value}
  </span>
);
```

- [ ] **Step 2: Write `status-pill-outline.tsx`**

```tsx
import React from 'react';

export type StatusTone = 'ready' | 'running' | 'failed' | 'passed' | 'offline';

interface Props { label: string; tone: StatusTone; }

const toneCls: Record<StatusTone, string> = {
  ready:   'border-[var(--green)]/40 text-[var(--green)]',
  passed:  'border-[var(--green)]/40 text-[var(--green)]',
  running: 'border-[var(--amber)]/40 text-[var(--amber)]',
  failed:  'border-[var(--red)]/40   text-[var(--red)]',
  offline: 'border-[var(--text-dim)]/40 text-[var(--text-dim)]',
};

export const StatusPillOutline: React.FC<Props> = ({ label, tone }) => (
  <span className={`inline-flex items-center justify-center h-6 px-2.5 rounded border text-[10px] font-mono font-semibold tracking-wider ${toneCls[tone]}`}>
    {label}
  </span>
);
```

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build 2>&1 | tail -3`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ui/count-badge.tsx web/src/components/ui/status-pill-outline.tsx
git commit -m "feat(ui): add CountBadge + StatusPillOutline primitives" -m "CountBadge: inline count bubble for tab labels + build cards. StatusPillOutline: rectangular outlined pill matching the reference's [FAILED] look — no fill, colored border + text." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `StatusSummaryCard` primitive

**Files:** Create `web/src/components/ui/status-summary-card.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from 'react';
import { CheckCircle2, XCircle, Activity, type LucideIcon } from 'lucide-react';

export type SummaryKind = 'passed' | 'failed' | 'running';

interface Props { kind: SummaryKind; value: number; }

const map: Record<SummaryKind, { Icon: LucideIcon; label: string; tint: string }> = {
  passed:  { Icon: CheckCircle2, label: 'PASSED',  tint: 'text-[var(--green)]' },
  failed:  { Icon: XCircle,      label: 'FAILED',  tint: 'text-[var(--red)]'   },
  running: { Icon: Activity,     label: 'RUNNING', tint: 'text-[var(--amber)]' },
};

export const StatusSummaryCard: React.FC<Props> = ({ kind, value }) => {
  const { Icon, label, tint } = map[kind];
  return (
    <div className="flex-1 flex flex-col items-center gap-1 py-2 rounded-md border border-[var(--border)] bg-[var(--bg)]">
      <Icon className={`h-3.5 w-3.5 ${tint}`} />
      <span className={`text-[9px] font-mono font-semibold tracking-wider ${tint}`}>{label}</span>
      <span className="text-sm font-semibold text-[var(--text)] tabular-nums">{value}</span>
    </div>
  );
};
```

- [ ] **Step 2: Verify build**

Run: `cd web && npm run build 2>&1 | tail -3`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ui/status-summary-card.tsx
git commit -m "feat(ui): add StatusSummaryCard primitive" -m "Three-up KPI-style card for the Builds left-rail summary strip (PASSED / FAILED / RUNNING). Non-interactive glance, not a filter." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `useBuildsData` hook

**Files:** Create `web/src/components/builds/use-builds-data.ts`

- [ ] **Step 1: Inspect existing behavior**

Run: `grep -nE "fetchData|useSocket|REFRESH|setInterval|getBuilds|getSessions" /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/session-dashboard/session-dashboard.tsx | head -25`

Record the existing polling interval, the exact `XenonApiService` method names, and the socket event names subscribed to.

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

  useEffect(() => {
    alive.current = true;
    fetchData();
    const id = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => { alive.current = false; clearInterval(id); };
  }, [fetchData]);

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
    builds, selectedBuildId, sessions, loading, error,
    selectBuild: setSelectedBuildId,
    searchQuery, setSearchQuery,
    refresh: fetchData,
  };
}
```

- [ ] **Step 3: Build**

Run: `cd web && npm run build 2>&1 | tail -3`
Expected: build succeeds. Adjust `XenonApiService` method signatures if they differ.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/builds/use-builds-data.ts
git commit -m "feat(web): extract useBuildsData hook" -m "Encapsulates the 3s polling + websocket-driven refresh loop previously embedded in session-dashboard.tsx." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `BuildListRail` (left rail)

**Files:** Create `web/src/components/builds/build-list-rail.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from 'react';
import { Search, Clock } from 'lucide-react';
import type { IBuild } from '../../interfaces/IBuild';
import type { ISession } from '../../interfaces/ISession';
import { buildStatusCounts, formatAbsoluteTime, shortId } from './derive';
import { CountBadge } from '../ui/count-badge';
import { StatusSummaryCard } from '../ui/status-summary-card';

export type TimeFilter = 'all' | '24h' | '7d' | '30d';

interface Props {
  builds: IBuild[];
  selectedBuildId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  timeFilter: TimeFilter;
  onTimeFilterChange: (v: TimeFilter) => void;
  globalCounts: { passed: number; failed: number; running: number };
  visibleBuildSessionsById: Record<string, ISession[]>;
}

const TIME_LABEL: Record<TimeFilter, string> = {
  all: 'All time',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export const BuildListRail: React.FC<Props> = ({
  builds, selectedBuildId, onSelect, search, onSearchChange,
  timeFilter, onTimeFilterChange, globalCounts, visibleBuildSessionsById,
}) => {
  const visible = builds.filter((b) => {
    if (search && !((b.name + ' ' + b.id).toLowerCase().includes(search.toLowerCase()))) return false;
    if (timeFilter !== 'all') {
      const cutoff: Record<Exclude<TimeFilter, 'all'>, number> = {
        '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000,
      };
      const t = Date.parse(String(b.createdAt));
      if (!Number.isFinite(t) || Date.now() - t > cutoff[timeFilter as Exclude<TimeFilter, 'all'>]) return false;
    }
    return true;
  });

  return (
    <aside className="w-[280px] shrink-0 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col">
      <div className="p-3 space-y-2 border-b border-[var(--border)]">
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

      <div className="p-3 flex items-stretch gap-2 border-b border-[var(--border)]">
        <StatusSummaryCard kind="passed"  value={globalCounts.passed} />
        <StatusSummaryCard kind="failed"  value={globalCounts.failed} />
        <StatusSummaryCard kind="running" value={globalCounts.running} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-[var(--text-dim)]">No builds match.</div>
        )}
        {visible.map((b) => {
          const counts = buildStatusCounts(visibleBuildSessionsById[b.id] || []);
          const active = b.id === selectedBuildId;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelect(b.id)}
              className={`w-full text-left relative px-4 py-3 border-b border-[var(--border)] transition-colors ${active ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]/60'}`}
            >
              {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[var(--green)]" />}
              <div className="text-xs font-semibold text-[var(--text)] truncate">{b.name}</div>
              <div className="mt-1 flex items-center gap-1 font-mono text-[9px] text-[var(--text-dim)]">
                <Clock className="h-3 w-3" />
                {formatAbsoluteTime(b.createdAt)}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                {counts.passed  > 0 && <CountBadge value={counts.passed}  tone="green" />}
                {counts.failed  > 0 && <CountBadge value={counts.failed}  tone="red" />}
                {counts.running > 0 && <CountBadge value={counts.running} tone="amber" />}
                {counts.all === 0 && <span className="text-[10px] font-mono text-[var(--text-dim)]">empty</span>}
              </div>
              <div className="mt-1 font-mono text-[9px] text-[var(--text-dim)] truncate">{shortId(b.id, 10, 4)}</div>
            </button>
          );
        })}
      </div>
    </aside>
  );
};
```

- [ ] **Step 2: Build**

Run: `cd web && npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/builds/build-list-rail.tsx
git commit -m "feat(web): add BuildListRail with status-summary strip" -m "Three sections matching the reference: search + time filter, three StatusSummaryCards (PASSED/FAILED/RUNNING), and the scrolling list of builds. Build cards show absolute createdAt and inline CountBadges per status. Selected state gets a green left-edge bar + surface-2 tint." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `BuildFilterBar`

**Files:** Create `web/src/components/builds/build-filter-bar.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from 'react';
import { Search } from 'lucide-react';
import { FilterPill } from '../ui/filter-pill';
import { buildStatusCounts, type StatusKey } from './derive';
import type { ISession } from '../../interfaces/ISession';

interface Props {
  sessions: ISession[];
  active: StatusKey;
  onChange: (key: StatusKey) => void;
  search: string;
  onSearchChange: (v: string) => void;
  totalMatching: number;
  totalUnfiltered: number;
}

export const BuildFilterBar: React.FC<Props> = ({ sessions, active, onChange, search, onSearchChange, totalMatching, totalUnfiltered }) => {
  const counts = buildStatusCounts(sessions);
  return (
    <div className="bg-[var(--surface)]">
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2">
        <FilterPill label="ALL"     count={counts.all}     active={active === 'all'}     onClick={() => onChange('all')}     tone="neutral" bullet={false} />
        <FilterPill label="PASSED"  count={counts.passed}  active={active === 'passed'}  onClick={() => onChange('passed')}  tone="green" />
        <FilterPill label="FAILED"  count={counts.failed}  active={active === 'failed'}  onClick={() => onChange('failed')}  tone="red" />
        <FilterPill label="RUNNING" count={counts.running} active={active === 'running'} onClick={() => onChange('running')} tone="amber" />
      </div>
      <div className="flex items-center gap-4 px-4 pb-3 border-b border-[var(--border)]">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-dim)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search sessions by ID, name, or device…"
            className="w-full h-8 pl-8 pr-2 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--border-strong)]"
          />
        </div>
        <span className="text-[10px] font-mono text-[var(--text-dim)] whitespace-nowrap">
          {totalMatching} of {totalUnfiltered} sessions
        </span>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Build**

Run: `cd web && npm run build 2>&1 | tail -3`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/builds/build-filter-bar.tsx
git commit -m "feat(web): add BuildFilterBar" -m "Top filter-pill group (ALL / PASSED / FAILED / RUNNING) with per-pill counts + session search + 'N of N sessions' counter matching the reference." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `SessionRow` + `SessionTable`

**Files:** Create `web/src/components/builds/session-row.tsx`, `web/src/components/builds/session-table.tsx`

- [ ] **Step 1: Write `session-row.tsx`**

```tsx
import React from 'react';
import { ChevronRight, Smartphone, Tv, Tablet, Monitor } from 'lucide-react';
import type { ISession } from '../../interfaces/ISession';
import { formatAbsoluteTime, humanDuration, deviceNameOrFallback, platformLabel, osVersionLabel, shortId } from './derive';
import { StatusPillOutline, type StatusTone } from '../ui/status-pill-outline';

interface Props {
  session: ISession;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}

function DeviceIcon({ platform }: { platform?: string }) {
  const p = (platform || '').toLowerCase();
  if (p.includes('tv')) return <Tv className="h-3.5 w-3.5" />;
  if (p.includes('pad') || p.includes('tablet')) return <Tablet className="h-3.5 w-3.5" />;
  if (p.includes('android') || p.includes('ios')) return <Smartphone className="h-3.5 w-3.5" />;
  return <Monitor className="h-3.5 w-3.5" />;
}

function statusToPill(status: string): { label: string; tone: StatusTone } {
  if (status === 'running') return { label: 'RUNNING', tone: 'running' };
  if (status === 'failed')  return { label: 'FAILED',  tone: 'failed'  };
  if (status === 'ended')   return { label: 'PASSED',  tone: 'passed'  };
  return { label: status.toUpperCase(), tone: 'offline' };
}

export const SessionRow: React.FC<Props> = ({ session, selected, onToggleSelect, onOpen }) => {
  const failed = session.status === 'failed';
  const pill = statusToPill(session.status);
  const deviceName = deviceNameOrFallback(session);
  const nodeId = session.node_id || (session as any).device?.node_id || '';
  const subtitleTop = failed && session.failure_reason
    ? session.failure_reason
    : (session.name ?? '');

  return (
    <tr
      onClick={onOpen}
      className="group border-b border-[var(--border)] hover:bg-[var(--surface-2)] cursor-pointer transition-colors align-top"
    >
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select session ${session.id}`}
        />
      </td>
      <td className="px-3 py-3">
        <div className="font-mono text-xs text-[var(--green)]" title={session.id}>
          #{shortId(session.id, 14, 4)}
        </div>
        {subtitleTop && (
          <div className="mt-0.5 text-[11px] text-[var(--text-muted)] truncate max-w-[420px]" title={subtitleTop}>
            {subtitleTop}
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5 text-xs text-[var(--text)]">
          <DeviceIcon platform={session.platform} />
          <span className="truncate max-w-[160px]">{deviceName}</span>
        </div>
        {nodeId && (
          <div className="mt-0.5 font-mono text-[10px] text-[var(--text-dim)]">node-{String(nodeId)}</div>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="text-xs text-[var(--text)]">{platformLabel(session)}</div>
        {session.os_version && (
          <div className="mt-0.5 font-mono text-[10px] text-[var(--text-dim)]">{osVersionLabel(session)}</div>
        )}
      </td>
      <td className="px-3 py-3">
        <StatusPillOutline label={pill.label} tone={pill.tone} />
      </td>
      <td className="px-3 py-3 font-mono text-[11px] text-[var(--text-muted)] whitespace-nowrap">
        {formatAbsoluteTime(session.createdAt)}
      </td>
      <td className="px-3 py-3 font-mono text-[11px] text-[var(--text-muted)] whitespace-nowrap text-right">
        {humanDuration(session.duration_ms ?? null)}
      </td>
      <td className="px-3 py-3 text-right">
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
  statusFilter: StatusKey;
  searchQuery: string;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onOpenRow: (s: ISession) => void;
  buildHasNoSessions: boolean;
}

function matchesStatus(s: ISession, key: StatusKey): boolean {
  if (key === 'all') return true;
  if (key === 'passed')  return s.status === 'ended';
  if (key === 'failed')  return s.status === 'failed';
  if (key === 'running') return s.status === 'running';
  return true;
}

export const SessionTable: React.FC<Props> = ({
  sessions, statusFilter, searchQuery, selectedIds, onToggleSelect, onToggleSelectAll, onOpenRow, buildHasNoSessions,
}) => {
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
      <div className="px-4 py-12 text-center text-xs text-[var(--text-dim)]">
        No sessions in this build yet. Trigger one from your test runner.
      </div>
    );
  }
  if (filtered.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-xs text-[var(--text-dim)]">
        No sessions match the current filters.
      </div>
    );
  }

  const allChecked = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));
  const someChecked = filtered.some((s) => selectedIds.has(s.id));

  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full text-left">
        <thead className="sticky top-0 bg-[var(--surface)] border-b border-[var(--border)] z-10">
          <tr>
            <th className="px-3 py-2 w-[36px]">
              <input
                type="checkbox"
                aria-label="Select all visible"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                onChange={() => onToggleSelectAll(filtered.map((s) => s.id))}
              />
            </th>
            <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium">Session</th>
            <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium">Device · Node</th>
            <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium">Platform</th>
            <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium">Status</th>
            <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium">Start Time</th>
            <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium text-right">Duration</th>
            <th className="px-3 py-2 w-[32px]"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              selected={selectedIds.has(s.id)}
              onToggleSelect={() => onToggleSelect(s.id)}
              onOpen={() => onOpenRow(s)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

- [ ] **Step 3: Build**

Run: `cd web && npm run build`
Expected: succeeds. Adjust ISession field accesses (e.g., `device.node_id`) if the interface differs.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/builds/session-row.tsx web/src/components/builds/session-table.tsx
git commit -m "feat(web): SessionTable + SessionRow matching the reference" -m "Two-line stacked cells (device/node, platform/os_version), outlined STATUS pill, absolute dd/MM/yyyy start times, failure_reason as a subtitle under failed session IDs, and bulk-select checkboxes (header indeterminate when partial)." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `BuildsHeader` with Retry failed + Export stubs

**Files:** Create `web/src/components/builds/builds-header.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from 'react';
import { RefreshCcw, Download } from 'lucide-react';
import type { IBuild } from '../../interfaces/IBuild';

interface Props {
  build: IBuild;
  failedCount: number;
  selectedCount: number;
  onRetryFailed: () => void;
  onExport: (format: 'json' | 'csv') => void;
}

export const BuildsHeader: React.FC<Props> = ({ build, failedCount, selectedCount, onRetryFailed, onExport }) => {
  const canRetry = failedCount > 0 || selectedCount > 0;
  const [exportOpen, setExportOpen] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <header className="flex items-start justify-between gap-4 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
      <div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--text-dim)]">
          <span>Build</span>
          <span className="font-mono text-[var(--green)]">#{build.id}</span>
        </div>
        <h1 className="mt-0.5 text-sm font-semibold text-[var(--text)]">{build.name}</h1>
      </div>

      <div className="flex items-center gap-2" ref={wrap}>
        <button
          type="button"
          onClick={onRetryFailed}
          disabled={!canRetry}
          title={canRetry ? `Retry ${selectedCount || failedCount} session(s)` : 'No failed sessions to retry'}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[var(--border)] text-xs text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          Retry failed
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[var(--border)] text-xs text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          {exportOpen && (
            <div className="absolute top-full right-0 mt-1 w-40 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden z-20">
              <button
                type="button"
                onClick={() => { setExportOpen(false); onExport('json'); }}
                className="w-full text-left px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface-2)]"
              >
                Export as JSON
              </button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); onExport('csv'); }}
                className="w-full text-left px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface-2)]"
              >
                Export as CSV
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
```

NOTE: `onRetryFailed` and `onExport` handlers in Plan 4A are **stubs** — they open a toast saying "Bulk retry lands in next release." The actual wiring to POST endpoints is done in Plan 4B once the backend is in place.

- [ ] **Step 2: Build**

Run: `cd web && npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/builds/builds-header.tsx
git commit -m "feat(web): add BuildsHeader with Retry/Export action buttons" -m "Header matches the reference: Build #id eyebrow + name H1 on the left, Retry failed + Export (JSON/CSV dropdown) actions on the right. Retry is disabled when no failed sessions to retry. Handlers are stubs until Plan 4B adds the backend endpoints." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Session Detail stub + assemble `BuildsPage`

**Files:** Create `web/src/components/builds/session-detail-stub.tsx`, `web/src/components/builds/builds-page.tsx`

- [ ] **Step 1: Stub**

```tsx
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const SessionDetailStub: React.FC = () => {
  const { buildId, sessionId } = useParams<{ buildId: string; sessionId: string }>();
  return (
    <div className="p-6">
      <Link to={`/builds/${buildId}`} className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
        <ArrowLeft className="h-3 w-3" /> Back to sessions
      </Link>
      <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="text-sm text-[var(--text-muted)]">Session Detail page lands in Plan 4C.</div>
        <div className="mt-2 font-mono text-[10px] text-[var(--text-dim)]">
          build: {buildId}<br/>session: {sessionId}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Assemble `builds-page.tsx`**

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBuildsData } from './use-builds-data';
import { BuildListRail, type TimeFilter } from './build-list-rail';
import { BuildFilterBar } from './build-filter-bar';
import { BuildsHeader } from './builds-header';
import { SessionTable } from './session-table';
import { buildStatusCounts, type StatusKey } from './derive';
import type { ISession } from '../../interfaces/ISession';
import { useToast } from '../ui/toast';

export const BuildsPage: React.FC = () => {
  const navigate = useNavigate();
  const { buildId: routeBuildId } = useParams<{ buildId?: string }>();
  const data = useBuildsData();
  const { showToast } = useToast();

  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusKey>('all');
  const [sessionSearch, setSessionSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (routeBuildId && routeBuildId !== data.selectedBuildId) {
      data.selectBuild(routeBuildId);
      setSelectedIds(new Set());
    }
  }, [routeBuildId, data]);

  const handleSelectBuild = (id: string) => navigate(`/builds/${id}`);
  const handleOpenRow = (s: ISession) => navigate(`/builds/${data.selectedBuildId}/sessions/${s.id}`);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const allChecked = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allChecked) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const visibleBuildSessionsById: Record<string, ISession[]> = useMemo(() => {
    if (!data.selectedBuildId) return {};
    return { [data.selectedBuildId]: data.sessions };
  }, [data.selectedBuildId, data.sessions]);

  const globalCounts = useMemo(() => {
    // Cross-build summary. Only the selected build's sessions are loaded today;
    // until a dedicated counts endpoint lands, globalCounts shows the visible set.
    const c = buildStatusCounts(data.sessions);
    return { passed: c.passed, failed: c.failed, running: c.running };
  }, [data.sessions]);

  const selectedBuild = data.builds.find((b) => b.id === data.selectedBuildId) || null;
  const counts = buildStatusCounts(data.sessions);

  const onRetryFailed = () => {
    showToast({ variant: 'info', title: 'Retry failed', message: 'Backend endpoint lands in Plan 4B.' });
  };
  const onExport = (fmt: 'json' | 'csv') => {
    showToast({ variant: 'info', title: 'Export', message: `${fmt.toUpperCase()} export lands in Plan 4B.` });
  };

  return (
    <div className="flex h-full">
      <BuildListRail
        builds={data.builds}
        selectedBuildId={data.selectedBuildId}
        onSelect={handleSelectBuild}
        search={data.searchQuery}
        onSearchChange={data.setSearchQuery}
        timeFilter={timeFilter}
        onTimeFilterChange={setTimeFilter}
        globalCounts={globalCounts}
        visibleBuildSessionsById={visibleBuildSessionsById}
      />

      <section className="flex-1 flex flex-col min-w-0">
        {!selectedBuild ? (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-dim)]">
            Select a build from the left to see its sessions.
          </div>
        ) : (
          <>
            <BuildsHeader
              build={selectedBuild}
              failedCount={counts.failed}
              selectedCount={selectedIds.size}
              onRetryFailed={onRetryFailed}
              onExport={onExport}
            />
            <BuildFilterBar
              sessions={data.sessions}
              active={statusFilter}
              onChange={setStatusFilter}
              search={sessionSearch}
              onSearchChange={setSessionSearch}
              totalMatching={data.sessions.length}
              totalUnfiltered={data.sessions.length}
            />
            <SessionTable
              sessions={data.sessions}
              statusFilter={statusFilter}
              searchQuery={sessionSearch}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onOpenRow={handleOpenRow}
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

NOTE: `useToast` and `showToast` should match the existing toast API. Inspect `web/src/components/ui/toast.tsx` and adjust the call signature if needed.

- [ ] **Step 3: Build**

Run: `cd web && npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/builds/builds-page.tsx web/src/components/builds/session-detail-stub.tsx
git commit -m "feat(web): assemble BuildsPage + Session Detail stub" -m "Composes rail + header + filter bar + table into the rebuilt Builds page. Header action buttons render toasts until Plan 4B wires the backend. Session row click navigates to /builds/:buildId/sessions/:sessionId which renders a stub until Plan 4C lands." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Route wiring + retire monolith

**Files:** Modify `web/src/routes/index.tsx`, delete `web/src/components/session-dashboard/`

- [ ] **Step 1: Read current routes**

Run: `cat /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/routes/index.tsx`

Find the `<Route path="/builds">` entry and its imports.

- [ ] **Step 2: Edit routes/index.tsx**

Replace the single `/builds` route with three nested routes importing from `../components/builds`:

```tsx
import { BuildsPage } from '../components/builds/builds-page';
import { SessionDetailStub } from '../components/builds/session-detail-stub';

// ...inside Routes...
<Route path="/builds" element={<BuildsPage />} />
<Route path="/builds/:buildId" element={<BuildsPage />} />
<Route path="/builds/:buildId/sessions/:sessionId" element={<SessionDetailStub />} />
```

Remove the `SessionDashboard` import.

- [ ] **Step 3: Check consumers**

Run: `grep -rn "session-dashboard" /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src --include="*.ts" --include="*.tsx" 2>/dev/null`
Expected: zero matches beyond the to-be-deleted directory itself.

- [ ] **Step 4: Delete the monolith**

```bash
rm /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/session-dashboard/session-dashboard.tsx
rm /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/session-dashboard/session-dashboard.css
rmdir /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/session-dashboard 2>/dev/null || true
```

- [ ] **Step 5: Verify**

Run: `cd web && npm run build && npm test -- --run`
Expected: build + all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add web/src/routes/index.tsx
git rm web/src/components/session-dashboard/session-dashboard.tsx web/src/components/session-dashboard/session-dashboard.css
git commit -m "feat(web): route split for Builds + retire session-dashboard monolith" -m "/builds hosts BuildsPage. /builds/:buildId pins the selection. /builds/:buildId/sessions/:sessionId renders a stub until Plan 4C lands. Legacy 1040-line session-dashboard.tsx and css are removed." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Playwright verification + final checks

**Files:** `web/screenshots/phase-4a/` (created by script)

- [ ] **Step 1: Rebuild plugin**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npm run build:xenon && npm run build
```

- [ ] **Step 2: Start server**

```bash
pkill -f 'appium server' 2>/dev/null
APPIUM_HOME=/tmp/xenon-home npx appium server -ka 800 --use-plugins=xenon -pa /wd/hub --plugin-xenon-platform=both --plugin-xenon-enable-dashboard > /tmp/xenon-server.log 2>&1 &
```

Wait for `Xenon will be served …` in the log.

- [ ] **Step 3: Playwright script**

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
await p.waitForTimeout(600);
const inp = await p.$('input[type="password"]');
if (inp) { await inp.fill(BOOT_KEY); await p.click('button[type="submit"], button:has-text("Sign in")'); await p.waitForTimeout(1500); }

// Empty state
await p.goto(BASE + '/builds', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
await p.screenshot({ path: path.join(OUT, '1440_builds-empty.png'), fullPage: false });

// Build selected
const firstBuild = await p.$('aside button');
if (firstBuild) { await firstBuild.click(); await p.waitForTimeout(1200); }
await p.screenshot({ path: path.join(OUT, '1440_builds-selected.png'), fullPage: false });

// Filter = Failed
const failedPill = await p.$('button[aria-pressed]:has-text("FAILED")');
if (failedPill) { await failedPill.click(); await p.waitForTimeout(400); }
await p.screenshot({ path: path.join(OUT, '1440_builds-failed-filter.png'), fullPage: false });

// Bulk select
const headerCheckbox = await p.$('thead input[type="checkbox"]');
if (headerCheckbox) { await headerCheckbox.click(); await p.waitForTimeout(300); }
await p.screenshot({ path: path.join(OUT, '1440_builds-bulk-selected.png'), fullPage: false });

// Session detail stub
const row = await p.$('tbody tr');
if (row) { await row.click(); await p.waitForTimeout(1200); }
await p.screenshot({ path: path.join(OUT, '1440_session-detail-stub.png'), fullPage: false });

await b.close();
```

Run: `node /tmp/xenon-verify/builds-4a.mjs`
Expected: five screenshots written. No `PAGE ERROR` lines.

- [ ] **Step 4: Review key screenshot**

Open `web/screenshots/phase-4a/1440_builds-selected.png` and confirm:
- Left rail: search + time select + 3 status-summary cards (PASSED / FAILED / RUNNING counts) + build cards.
- Main pane header: `BUILD #id` eyebrow + build name + `Retry failed` + `Export` buttons right-aligned.
- Filter bar: `[ALL n] [● PASSED n] [● FAILED n] [● RUNNING n]`, with the correct pill highlighted. Session search + `N of N sessions` counter.
- Table: two-line cells (device + node, platform + v{os}), outlined FAILED pill, absolute `dd/MM/yyyy, HH:mm:ss` start time, duration right-aligned, failure_reason subtitle under session ID when failed.
- Header + row checkboxes render.

- [ ] **Step 5: Stop server**

```bash
pkill -f 'appium server' 2>/dev/null || true
```

- [ ] **Step 6: Full verification**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npm run build:all && cd web && npm test -- --run
```

Expected: both green.

- [ ] **Step 7: No commit** — verification only.

---

## Self-Review Notes

1. **Spec coverage** — §4.1 layout by Tasks 6–10. §4.2 status summary strip by Tasks 4, 6. §4.3 main-pane header with Retry/Export by Task 9. §4.4 filter bar by Tasks 2, 7. §4.5 search + count by Task 7. §4.6 session table (columns, stacked cells, failure-reason subtitle, outlined pill, absolute time, bulk checkboxes) by Tasks 3, 8. Routing (§3.2) by Task 11. Non-goals (backend endpoints) correctly deferred to Plan 4B.
2. **Placeholder scan** — no TBDs. The TODO comment inside `builds-page.tsx` about `globalCounts` is an in-code note for Plan 4B follow-up, not a plan placeholder.
3. **Type consistency** — `StatusKey` used by derive, FilterPill (indirectly via onChange type in BuildFilterBar), SessionTable. `StatusTone` for outlined pill. `TimeFilter` re-exported from BuildListRail.
4. **Assumed ISession field names** — `session.node_id`, `session.platform`, `session.os_version`, `session.duration_ms`, `session.createdAt`, `session.failure_reason`, `session.name`, `session.device.name`. Task 1 Step 1 grep must confirm; rename helpers + callsites as needed before proceeding.
5. **Handlers-as-stubs** — `onRetryFailed` and `onExport` toast-only. Plan 4B replaces these with real API calls and a confirmation modal.
