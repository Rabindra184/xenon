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
  if (key === 'passed')  return s.status === 'ended' || s.status === 'passed';
  if (key === 'failed')  return s.status === 'failed';
  if (key === 'running') return s.status === 'running';
  return true;
}

export const SessionTable: React.FC<Props> = ({
  sessions,
  statusFilter,
  searchQuery,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onOpenRow,
  buildHasNoSessions,
}) => {
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (!matchesStatus(s, statusFilter)) return false;
      if (q) {
        const hay = (
          s.id + ' ' +
          (s.name ?? '') + ' ' +
          (s.device_name ?? '') + ' ' +
          (s.device_platform ?? '') + ' ' +
          (s.device_version ?? '') + ' ' +
          (s.node_id ?? '')
        ).toLowerCase();
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
