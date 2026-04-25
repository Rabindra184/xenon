import React from 'react';

export type KpiState = 'healthy' | 'neutral' | 'warn' | 'critical';

interface Props {
  label: string;
  value: React.ReactNode;
  /** Optional smaller "/ N" denominator next to the value. */
  secondaryValue?: React.ReactNode;
  /** Subtitle line under the value, prefixed with a colored dot. */
  subtitle: string;
  state?: KpiState;
}

const accentBarCls: Record<KpiState, string> = {
  healthy:  'bg-[var(--green)]',
  neutral:  'bg-[var(--border-strong)]',
  warn:     'bg-[var(--amber)]',
  critical: 'bg-[var(--red)]',
};

const dotCls: Record<KpiState, string> = {
  healthy:  'bg-[var(--green)]',
  neutral:  'bg-[var(--text-dim)]',
  warn:     'bg-[var(--amber)]',
  critical: 'bg-[var(--red)]',
};

const subtitleCls: Record<KpiState, string> = {
  healthy:  'text-[var(--green)]',
  neutral:  'text-[var(--text-muted)]',
  warn:     'text-[var(--amber)]',
  critical: 'text-[var(--red)]',
};

export const KpiCard: React.FC<Props> = ({ label, value, secondaryValue, subtitle, state = 'neutral' }) => (
  <div className="relative overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--border-strong)] transition-colors">
    <span className={`absolute left-0 top-0 bottom-0 w-[2px] ${accentBarCls[state]}`} />
    <div className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[var(--text-muted)]">
      {label}
    </div>
    <div className="mt-3 flex items-baseline gap-2">
      <span className="text-3xl font-semibold text-[var(--text)] tabular-nums">{value}</span>
      {secondaryValue !== undefined && secondaryValue !== null && (
        <span className="text-sm font-mono text-[var(--text-dim)]">/ {secondaryValue}</span>
      )}
    </div>
    <div className={`mt-3 flex items-center gap-1.5 text-xs ${subtitleCls[state]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotCls[state]}`} />
      <span>{subtitle}</span>
    </div>
  </div>
);
