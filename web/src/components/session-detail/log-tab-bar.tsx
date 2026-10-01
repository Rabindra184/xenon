import React from 'react';
import { formatTabCount, type LogTabKey } from './log-derive';

export interface LogTab {
  key: LogTabKey;
  label: string;
  count: number;
  /** Hide entirely when count === 0 (e.g., Profiling for non-mobile sessions). */
  hideWhenEmpty?: boolean;
}

interface Props {
  tabs: LogTab[];
  active: LogTabKey;
  onChange: (k: LogTabKey) => void;
  errorsOnly: boolean;
  onErrorsOnlyChange: (v: boolean) => void;
  /** The filter applies to list tabs only, not the timeline or screenshots. */
  showErrorsOnly?: boolean;
}

export const LogTabBar: React.FC<Props> = ({
  tabs,
  active,
  onChange,
  errorsOnly,
  onErrorsOnlyChange,
  showErrorsOnly = true,
}) => {
  const visibleTabs = tabs.filter((t) => !(t.hideWhenEmpty && t.count === 0));
  return (
    <div className="flex items-center justify-between gap-4 px-3 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-1 overflow-x-auto">
        {visibleTabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              aria-pressed={isActive}
              // An empty tab stays clickable, dimmed and without a count.
              data-empty={t.count === 0 ? 'true' : 'false'}
              className={`relative inline-flex items-center gap-1.5 h-9 px-3 text-xs whitespace-nowrap transition-colors ${
                isActive
                  ? 'text-[var(--text)]'
                  : t.count === 0
                    ? 'text-[var(--text-dim)] hover:text-[var(--text-muted)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <span>{t.label}</span>
              {t.count > 0 && (
                <span
                  className={`text-[10px] tabular-nums ${isActive ? 'text-[var(--text-muted)]' : 'text-[var(--text-dim)]'}`}
                >
                  {formatTabCount(t.count)}
                </span>
              )}
              {isActive && (
                <span className="absolute left-2 right-2 bottom-0 h-[2px] bg-[var(--color-accent)] rounded-t" />
              )}
            </button>
          );
        })}
      </div>
      {showErrorsOnly && (
        <label className="inline-flex items-center gap-2 text-[11px] text-[var(--text-muted)] cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => onErrorsOnlyChange(e.target.checked)}
            aria-label="Show only error rows"
          />
          Errors only
        </label>
      )}
    </div>
  );
};
