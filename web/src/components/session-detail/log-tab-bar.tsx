import React from 'react';
import type { LogTabKey } from './log-derive';

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
}

export const LogTabBar: React.FC<Props> = ({ tabs, active, onChange, errorsOnly, onErrorsOnlyChange }) => {
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
              className={`relative inline-flex items-center gap-1.5 h-9 px-3 text-xs whitespace-nowrap transition-colors ${
                isActive
                  ? 'text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <span>{t.label}</span>
              <span className={`font-mono text-[10px] ${isActive ? 'text-[var(--text-muted)]' : 'text-[var(--text-dim)]'}`}>
                {t.count}
              </span>
              {isActive && (
                <span className="absolute left-2 right-2 bottom-0 h-[2px] bg-[var(--green)] rounded-t" />
              )}
            </button>
          );
        })}
      </div>
      <label className="inline-flex items-center gap-2 text-[11px] text-[var(--text-muted)] cursor-pointer select-none whitespace-nowrap">
        <input
          type="checkbox"
          checked={errorsOnly}
          onChange={(e) => onErrorsOnlyChange(e.target.checked)}
          aria-label="Show only error rows"
        />
        Errors only
      </label>
    </div>
  );
};
