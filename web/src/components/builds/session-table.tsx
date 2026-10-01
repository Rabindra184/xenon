import React, { useMemo } from 'react';
import type { ISession } from '../../interfaces/ISession';
import type { StatusKey } from './derive';
import { filterSessions } from './derive';
import { SessionRow } from './session-row';

interface Props {
  sessions: ISession[];
  statusFilter: StatusKey;
  searchQuery: string;
  /** Build names by id, as the builds column shows them. */
  buildNames: Map<string, string>;
  /** Show each session's build (the all-sessions view). */
  showBuild: boolean;
  /** Offer selection, for a build's export. */
  showSelection: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onOpenRow: (s: ISession) => void;
  /** Shown when there are no sessions at all, before any filter. */
  empty: React.ReactNode;
}

const th = 'px-3 py-2 text-[11px] font-medium text-[var(--text-dim)]';

export const SessionTable: React.FC<Props> = ({
  sessions,
  statusFilter,
  searchQuery,
  buildNames,
  showBuild,
  showSelection,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onOpenRow,
  empty,
}) => {
  const filtered = useMemo(
    () => filterSessions(sessions, statusFilter, searchQuery),
    [sessions, statusFilter, searchQuery],
  );

  if (sessions.length === 0) return <>{empty}</>;
  if (filtered.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-xs text-[var(--text-dim)]">
        No sessions match the current filters.
      </div>
    );
  }

  const allChecked = filtered.every((s) => selectedIds.has(s.id));
  const someChecked = filtered.some((s) => selectedIds.has(s.id));
  const anyUnnamed = filtered.some((s) => !s.name?.trim());

  return (
    <div className="flex-1 overflow-y-auto">
      {/*
        table-fixed is load-bearing: under the browser default table-layout:auto,
        column widths derive from each cell's min-content BEFORE the `truncate`
        (overflow:hidden) on the test name and failure reason is applied, so a
        long unbroken failure_reason / test name forces the whole table past the
        viewport (guarded by web/test/viewport/overflow.spec.ts on /builds and
        /builds/:buildId). table-fixed makes the column widths authoritative, so
        `truncate` actually constrains the cell. The predictable columns get
        fixed widths; Test and Device share the remainder (responsive across
        1280-1440).
      */}
      <table className="w-full text-left table-fixed">
        <thead className="sticky top-0 bg-[var(--surface)] border-b border-[var(--border)] z-10">
          <tr>
            {showSelection && (
              <th className="pl-4 pr-2 py-2 w-[44px]">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked && !allChecked;
                  }}
                  onChange={() => onToggleSelectAll(filtered.map((s) => s.id))}
                />
              </th>
            )}
            <th className={`${th} pl-4 w-[112px]`}>Status</th>
            <th className={th}>Test</th>
            <th className={th}>Device</th>
            <th className={`${th} w-[124px]`}>Started</th>
            <th className={`${th} w-[84px] text-right`}>Duration</th>
            <th className="w-[40px]">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              buildName={s.build_id ? buildNames.get(s.build_id) : null}
              showBuild={showBuild}
              showSelection={showSelection}
              selected={selectedIds.has(s.id)}
              onToggleSelect={() => onToggleSelect(s.id)}
              onOpen={() => onOpenRow(s)}
            />
          ))}
        </tbody>
      </table>
      {anyUnnamed && (
        <p className="px-4 py-3 text-[11px] text-[var(--text-dim)]">
          Unnamed sessions show their app. Name a test with{' '}
          <code className="font-mono text-[var(--text-muted)]">xe:options.name</code> and a run with{' '}
          <code className="font-mono text-[var(--text-muted)]">xe:options.build</code> in its
          capabilities.
        </p>
      )}
    </div>
  );
};
