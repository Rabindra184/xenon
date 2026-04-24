import React from 'react';

export interface MetadataRow {
  label: string;
  value: React.ReactNode;
  /** Render the value with a monospace font (useful for IDs / timestamps). */
  mono?: boolean;
  /** Tint the value — used by the Result panel for failed / passed coloring. */
  tone?: 'default' | 'red' | 'green' | 'amber';
}

interface Props {
  label: string;
  rows: MetadataRow[];
}

const toneCls: Record<NonNullable<MetadataRow['tone']>, string> = {
  default: 'text-[var(--text)]',
  red: 'text-[var(--red)]',
  green: 'text-[var(--green)]',
  amber: 'text-[var(--amber)]',
};

export const MetadataCard: React.FC<Props> = ({ label, rows }) => (
  <div className="flex-1 min-w-0 p-4">
    <div className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[var(--text-dim)] mb-3">
      {label}
    </div>
    <dl className="space-y-2">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="flex items-baseline justify-between gap-3">
          <dt className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-dim)] shrink-0">
            {r.label}
          </dt>
          <dd
            className={`text-xs text-right truncate min-w-0 ${r.mono ? 'font-mono' : ''} ${toneCls[r.tone ?? 'default']}`}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  </div>
);
