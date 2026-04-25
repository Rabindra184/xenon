import React from 'react';
import type { HourBucket } from './use-overview-data';

interface Props {
  data: HourBucket[];
  totalSessions: number;
  totalHeals: number;
}

export const SessionTrend: React.FC<Props> = ({ data, totalSessions, totalHeals }) => {
  const max = Math.max(1, ...data.map((d) => d.sessions));
  const lastIdx = data.length - 1;
  const midIdx = Math.floor(data.length / 2);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex items-start justify-between px-4 py-3 border-b border-[var(--border)]">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">Session activity</h2>
          <div className="text-xs text-[var(--text-dim)] mt-0.5">Last 24 hours</div>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-dim)]">Sessions</div>
            <div className="text-base font-semibold text-[var(--text)] tabular-nums">{totalSessions}</div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-dim)]">Heals</div>
            <div className="text-base font-semibold text-[var(--green)] tabular-nums">{totalHeals}</div>
          </div>
        </div>
      </header>

      <div className="p-4">
        <div className="flex items-end gap-1 h-32">
          {data.map((d, i) => {
            const hPct = (d.sessions / max) * 100;
            const healPct = (d.heals / max) * 100;
            return (
              <div key={i} className="group relative flex-1 h-full flex flex-col justify-end">
                {d.heals > 0 && (
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-sm bg-[var(--green)]/40"
                    style={{ height: `${healPct}%` }}
                    aria-hidden
                  />
                )}
                <div
                  className="relative w-full rounded-sm bg-[var(--border-strong)] group-hover:bg-[var(--green)] transition-colors"
                  style={{ height: `${Math.max(hPct, 2)}%` }}
                  aria-label={`${d.hour} — ${d.sessions} sessions, ${d.heals} heals`}
                />
                <div className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--surface-2)] border border-[var(--border-strong)] px-2 py-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-lg">
                  <div className="font-mono text-[var(--text-dim)]">{d.hour}</div>
                  <div className="text-[var(--text)]">{d.sessions} sessions · {d.heals} heals</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-[10px] font-mono text-[var(--text-dim)]">
          <span>{data[0]?.hour}</span>
          <span>{data[midIdx]?.hour}</span>
          <span>{data[lastIdx]?.hour}</span>
        </div>
      </div>
    </section>
  );
};
