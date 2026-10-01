import React from 'react';
import { Search } from 'lucide-react';
import { FilterPill } from '../ui/filter-pill';
import { Input } from '../ui/input';
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
  /** The server's list stopped at its limit: these are the newest only. */
  capped?: boolean;
}

export const BuildFilterBar: React.FC<Props> = ({
  sessions,
  active,
  onChange,
  search,
  onSearchChange,
  totalMatching,
  totalUnfiltered,
  capped = false,
}) => {
  const counts = buildStatusCounts(sessions);
  return (
    // One row: the table keeps as much of the height as it can.
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]">
      <div role="group" aria-label="Status" className="flex items-center gap-1.5">
        <FilterPill
          label="All"
          count={counts.all}
          active={active === 'all'}
          onClick={() => onChange('all')}
          tone="neutral"
          bullet={false}
        />
        <FilterPill
          label="Passed"
          count={counts.passed}
          active={active === 'passed'}
          onClick={() => onChange('passed')}
          tone="green"
        />
        <FilterPill
          label="Failed"
          count={counts.failed}
          active={active === 'failed'}
          onClick={() => onChange('failed')}
          tone="red"
        />
        <FilterPill
          label="Running"
          count={counts.running}
          active={active === 'running'}
          onClick={() => onChange('running')}
          tone="amber"
        />
      </div>
      <span className="ml-auto text-[11px] text-[var(--text-dim)] tabular-nums whitespace-nowrap">
        {totalMatching} of {totalUnfiltered} sessions{capped ? ' (the newest)' : ''}
      </span>
      <div className="relative w-64 shrink-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-dim)]" />
        <Input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search tests, devices, people…"
          aria-label="Search sessions"
          className="w-full h-8 pl-8 pr-2 text-xs"
        />
      </div>
    </div>
  );
};
