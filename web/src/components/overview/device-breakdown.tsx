import React from 'react';
import type { OsBreakdown } from './use-overview-data';

interface Props {
  rows: OsBreakdown[];
}

/**
 * Pick a stable color for each row based on label prefix. Falls back to the
 * border-strong grey for "Other" / unknown.
 */
function rowColor(label: string): string {
  const lower = label.toLowerCase();
  if (lower.startsWith('tvos'))    return 'bg-[var(--green)]';
  if (lower.startsWith('ios'))     return 'bg-[var(--blue)]';
  if (lower.startsWith('android')) return 'bg-[var(--amber)]';
  if (lower === 'other')           return 'bg-[var(--border-strong)]';
  return 'bg-[var(--green-dim)]';
}

export const DeviceBreakdown: React.FC<Props> = ({ rows }) => {
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <header className="px-4 py-3 border-b border-[var(--border)]">
        <h2 className="text-sm font-semibold text-[var(--text)]">Fleet composition</h2>
        <div className="text-xs text-[var(--text-dim)] mt-0.5">
          By operating system · {total} {total === 1 ? 'device' : 'devices'}
        </div>
      </header>

      {total === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-[var(--text-dim)]">
          No devices to break down.
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="h-2 w-full rounded-full overflow-hidden flex bg-[var(--surface-2)]">
            {rows.map((r) => (
              <div
                key={r.label}
                className={`${rowColor(r.label)} h-full`}
                style={{ width: `${(r.count / total) * 100}%` }}
                title={`${r.label}: ${r.count}`}
              />
            ))}
          </div>
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-sm ${rowColor(r.label)}`} />
                  <span className="font-mono text-[var(--text)]">{r.label}</span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[var(--text-dim)]">
                  <span className="tabular-nums">{r.count}</span>
                  <span className="tabular-nums w-10 text-right">{Math.round((r.count / total) * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
