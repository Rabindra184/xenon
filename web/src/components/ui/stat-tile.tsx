import React from 'react';

export type StatTone = 'neutral' | 'good' | 'bad';

const noteCls: Record<StatTone, string> = {
  neutral: 'text-[var(--text-muted)]',
  good: 'text-[var(--color-success)]',
  bad: 'text-[var(--color-danger)]',
};

interface Props {
  label: string;
  value: React.ReactNode;
  /** The value's colour; the default is the body text colour. */
  valueCls?: string;
  /** A short line under the value. */
  note?: React.ReactNode;
  noteTone?: StatTone;
}

/**
 * One headline number with its label and a note: the Sessions page's summary
 * strip and the session detail page's outcome tiles.
 */
export const StatTile: React.FC<Props> = ({
  label,
  value,
  valueCls = 'text-[var(--text)]',
  note,
  noteTone = 'neutral',
}) => (
  <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
    <div className="text-xs text-[var(--text-muted)]">{label}</div>
    <div className={`mt-1 text-2xl font-semibold tabular-nums leading-tight truncate ${valueCls}`}>
      {value}
    </div>
    <div className={`mt-0.5 text-[11px] truncate ${noteCls[noteTone]}`}>{note ?? ' '}</div>
  </div>
);
