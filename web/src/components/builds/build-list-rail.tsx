import React, { useState } from 'react';
import { Search, Layers } from 'lucide-react';
import type { IBuild } from '../../interfaces/IBuild';
import {
  buildDisplayName,
  formatMonthDayTime,
  isUnnamedBuild,
  PERIOD_MS,
  TIME_FILTER_LABEL,
  type TimeFilter,
} from './derive';
import { Input } from '../ui/input';

interface Props {
  builds: IBuild[];
  /** null: All sessions. */
  selectedBuildId: string | null;
  onSelect: (id: string | null) => void;
  /** Builds started in this period are listed. */
  timeFilter: TimeFilter;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A build's sessions by outcome, as one thin bar. */
const OutcomeBar: React.FC<{ build: IBuild }> = ({ build }) => {
  const { passedCount: passed, failedCount: failed, runningCount: running, sessionCount } = build;
  const other = Math.max(0, sessionCount - passed - failed - running);
  if (sessionCount === 0) return null;
  const parts = [
    passed > 0 && `${passed} passed`,
    failed > 0 && `${failed} failed`,
    running > 0 && `${running} running`,
    other > 0 && `${other} without a verdict`,
  ].filter(Boolean);
  return (
    <div
      role="img"
      aria-label={parts.join(', ')}
      title={parts.join(', ')}
      className="mt-2 flex h-1 w-full gap-px overflow-hidden rounded-full bg-[rgb(var(--rgb-fg)/0.08)]"
    >
      {passed > 0 && <span className="bg-[var(--color-success)]" style={{ flexGrow: passed }} />}
      {failed > 0 && <span className="bg-[var(--color-danger)]" style={{ flexGrow: failed }} />}
      {running > 0 && <span className="bg-[var(--color-warning)]" style={{ flexGrow: running }} />}
      {other > 0 && <span style={{ flexGrow: other }} />}
    </div>
  );
};

const RailItem: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'true' : undefined}
    className={`w-full text-left relative px-4 py-2.5 transition-colors ${
      active ? 'bg-[var(--surface-2)]' : 'hover:bg-[rgb(var(--rgb-fg)/0.04)]'
    }`}
  >
    {active && (
      <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[var(--color-accent)]" />
    )}
    {children}
  </button>
);

/**
 * The builds column: All sessions first, then the period's builds, newest
 * first, each with its session count and outcomes. Choosing one filters the
 * table; it is never a required first click.
 */
export const BuildListRail: React.FC<Props> = ({
  builds,
  selectedBuildId,
  onSelect,
  timeFilter,
}) => {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const now = Date.now();

  const visible = builds.filter((b) => {
    if (q && !`${buildDisplayName(b)} ${b.name ?? ''} ${b.id}`.toLowerCase().includes(q))
      return false;
    if (timeFilter !== 'all') {
      const t = Date.parse(String(b.createdAt));
      if (!Number.isFinite(t) || now - t > PERIOD_MS[timeFilter]) return false;
    }
    return true;
  });
  const filtered = q.length > 0 || timeFilter !== 'all';

  return (
    <aside className="w-[280px] shrink-0 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col min-h-0">
      <div className="p-3 border-b border-[var(--border)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-dim)]" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find builds…"
            aria-label="Find builds"
            className="w-full h-8 pl-8 pr-2 text-xs"
          />
        </div>
      </div>

      <nav aria-label="Builds" className="flex-1 overflow-y-auto py-1">
        <RailItem active={selectedBuildId === null} onClick={() => onSelect(null)}>
          <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--text)]">
            <Layers className="h-3.5 w-3.5 text-[var(--text-dim)]" aria-hidden="true" />
            All sessions
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            {TIME_FILTER_LABEL[timeFilter]}, every build
          </div>
        </RailItem>

        <div className="px-4 pt-3 pb-1 text-[11px] font-medium text-[var(--text-dim)]">Builds</div>

        {visible.length === 0 && (
          <div className="px-4 py-6 text-xs text-[var(--text-dim)]">
            {filtered
              ? 'No builds match.'
              : 'No builds yet. They appear here after your first test run.'}
          </div>
        )}
        {visible.map((b) => {
          const unnamed = isUnnamedBuild(b);
          const meta = unnamed
            ? plural(b.sessionCount, 'session')
            : `${formatMonthDayTime(b.createdAt)} · ${plural(b.sessionCount, 'session')}`;
          return (
            <RailItem key={b.id} active={b.id === selectedBuildId} onClick={() => onSelect(b.id)}>
              <div
                className={`text-[13px] font-medium truncate ${unnamed ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}
                title={b.name || undefined}
              >
                {buildDisplayName(b)}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-muted)] tabular-nums">{meta}</div>
              <OutcomeBar build={b} />
            </RailItem>
          );
        })}
      </nav>
    </aside>
  );
};
