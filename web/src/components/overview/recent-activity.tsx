import React from 'react';
import { Activity as ActivityIcon } from 'lucide-react';
import type { ActivityEvent, ActivityEventKind } from './use-overview-data';

interface Props {
  events: ActivityEvent[];
  /** Live indicator on the header — driven from the socket connection state. */
  live?: boolean;
}

const dotCls: Record<ActivityEventKind, string> = {
  session: 'bg-[var(--green)]',
  'session-end': 'bg-[var(--text-dim)]',
  'session-failed': 'bg-[var(--red)]',
  node: 'bg-[var(--blue)]',
  heal: 'bg-[var(--amber)]',
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const RecentActivity: React.FC<Props> = ({ events, live = true }) => (
  <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-col">
    <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-[var(--text)]">Recent activity</h2>
        <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--text-dim)] uppercase tracking-widest">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              live ? 'bg-[var(--green)] pulse-dot' : 'bg-[var(--text-dim)]'
            }`}
          />
          {live ? 'Live' : 'Offline'}
        </span>
      </div>
    </header>

    {events.length === 0 ? (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center gap-2">
        <div className="h-10 w-10 rounded-full bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
          <ActivityIcon className="h-5 w-5 text-[var(--text-dim)]" />
        </div>
        <div className="text-sm font-medium text-[var(--text)]">No activity yet</div>
        <div className="text-xs text-[var(--text-dim)] max-w-xs">
          Session and heal events will appear here as they happen.
        </div>
      </div>
    ) : (
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
        {events.map((e) => (
          <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="font-mono text-[10px] text-[var(--text-dim)] w-10 shrink-0">
              {fmtTime(e.ts)}
            </span>
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotCls[e.kind]}`} />
            <span className="text-xs text-[var(--text-muted)] truncate">{e.message}</span>
          </div>
        ))}
      </div>
    )}
  </section>
);
