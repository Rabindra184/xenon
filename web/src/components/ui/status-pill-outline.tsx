import React from 'react';

export type StatusTone = 'ready' | 'running' | 'failed' | 'passed' | 'offline';

interface Props {
  label: string;
  tone: StatusTone;
}

const toneCls: Record<StatusTone, string> = {
  ready:   'border-[var(--green)]/40 text-[var(--green)]',
  passed:  'border-[var(--green)]/40 text-[var(--green)]',
  running: 'border-[var(--amber)]/40 text-[var(--amber)]',
  failed:  'border-[var(--red)]/40   text-[var(--red)]',
  offline: 'border-[var(--text-dim)]/40 text-[var(--text-dim)]',
};

export const StatusPillOutline: React.FC<Props> = ({ label, tone }) => (
  <span
    className={`inline-flex items-center justify-center h-6 px-2.5 rounded border text-[10px] font-mono font-semibold tracking-wider ${toneCls[tone]}`}
  >
    {label}
  </span>
);
