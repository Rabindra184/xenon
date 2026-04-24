import React from 'react';
import { Search, Clock } from 'lucide-react';
import type { IBuild } from '../../interfaces/IBuild';
import { formatAbsoluteTime, shortId } from './derive';
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
}

const TIME_LABEL: Record<TimeFilter, string> = {
  all: 'All time',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export const BuildListRail: React.FC<Props> = ({
  builds,
  selectedBuildId,
  onSelect,
  search,
  onSearchChange,
  timeFilter,
  onTimeFilterChange,
}) => {
  const visible = builds.filter((b) => {
    const name = (b.name ?? '') + ' ' + b.id;
    if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
    if (timeFilter !== 'all') {
      const cutoff: Record<Exclude<TimeFilter, 'all'>, number> = {
        '24h': 86_400_000,
        '7d': 7 * 86_400_000,
        '30d': 30 * 86_400_000,
      };
      const t = Date.parse(String(b.createdAt));
      if (!Number.isFinite(t) || Date.now() - t > cutoff[timeFilter as Exclude<TimeFilter, 'all'>]) return false;
    }
    return true;
  });

  // Status summary across visible builds (aggregates per-build counts that
  // the backend already provides on IBuild).
  const summary = visible.reduce(
    (acc, b) => {
      acc.passed += b.passedCount || 0;
      acc.failed += b.failedCount || 0;
      acc.running += b.runningCount || 0;
      return acc;
    },
    { passed: 0, failed: 0, running: 0 },
  );

  return (
    <aside className="w-[280px] shrink-0 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col">
      {/* Search + time filter */}
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

      {/* Status summary strip */}
      <div className="p-3 flex items-stretch gap-2 border-b border-[var(--border)]">
        <StatusSummaryCard kind="passed"  value={summary.passed} />
        <StatusSummaryCard kind="failed"  value={summary.failed} />
        <StatusSummaryCard kind="running" value={summary.running} />
      </div>

      {/* Build cards */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-[var(--text-dim)]">No builds match.</div>
        )}
        {visible.map((b) => {
          const active = b.id === selectedBuildId;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelect(b.id)}
              className={`w-full text-left relative px-4 py-3 border-b border-[var(--border)] transition-colors ${active ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]/60'}`}
            >
              {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[var(--green)]" />}
              <div className="text-xs font-semibold text-[var(--text)] truncate">
                {b.name || 'Unnamed build'}
              </div>
              <div className="mt-1 flex items-center gap-1 font-mono text-[9px] text-[var(--text-dim)]">
                <Clock className="h-3 w-3" />
                {formatAbsoluteTime(b.createdAt)}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                {b.passedCount  > 0 && <CountBadge value={b.passedCount}  tone="green" />}
                {b.failedCount  > 0 && <CountBadge value={b.failedCount}  tone="red" />}
                {b.runningCount > 0 && <CountBadge value={b.runningCount} tone="amber" />}
                {b.sessionCount === 0 && (
                  <span className="text-[10px] font-mono text-[var(--text-dim)]">empty</span>
                )}
              </div>
              <div className="mt-1 font-mono text-[9px] text-[var(--text-dim)] truncate">{shortId(b.id, 10, 4)}</div>
            </button>
          );
        })}
      </div>
    </aside>
  );
};
