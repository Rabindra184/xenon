import React from 'react';

interface Props {
  value: number;
  tone?: 'neutral' | 'green' | 'red' | 'amber';
  /** Accessible/hover label describing what this count represents, e.g. "3 passed". Optional. */
  label?: string;
}

const toneCls: Record<NonNullable<Props['tone']>, string> = {
  neutral: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
  green:   'bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/30',
  red:     'bg-[var(--red)]/15   text-[var(--red)]   border-[var(--red)]/30',
  amber:   'bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/30',
};

export const CountBadge: React.FC<Props> = ({ value, tone = 'neutral', label }) => (
  <span
    title={label}
    aria-label={label}
    className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full border text-[10px] font-mono font-medium ${toneCls[tone]}`}
  >
    {value}
  </span>
);
