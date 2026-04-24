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

export const BuildFilterBar: React.FC<Props> = ({
  sessions,
  active,
  onChange,
  search,
  onSearchChange,
  totalMatching,
  totalUnfiltered,
}) => {
  const counts = buildStatusCounts(sessions);
  return (
    <div className="bg-[var(--surface)]">
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2">
        <FilterPill
          label="ALL"
          count={counts.all}
          active={active === 'all'}
          onClick={() => onChange('all')}
          tone="neutral"
          bullet={false}
        />
        <FilterPill
          label="PASSED"
          count={counts.passed}
          active={active === 'passed'}
          onClick={() => onChange('passed')}
          tone="green"
        />
        <FilterPill
          label="FAILED"
          count={counts.failed}
          active={active === 'failed'}
          onClick={() => onChange('failed')}
          tone="red"
        />
        <FilterPill
          label="RUNNING"
          count={counts.running}
          active={active === 'running'}
          onClick={() => onChange('running')}
          tone="amber"
        />
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
