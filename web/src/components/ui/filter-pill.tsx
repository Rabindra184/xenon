import React from 'react';

type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue';

interface Props {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  tone?: Tone;
  bullet?: boolean;
}

const dotCls: Record<Tone, string> = {
  neutral: 'bg-[var(--text-dim)]',
  green:   'bg-[var(--green)]',
  red:     'bg-[var(--red)]',
  amber:   'bg-[var(--amber)]',
  blue:    'bg-[var(--blue)]',
};

export const FilterPill: React.FC<Props> = ({
  label,
  count,
  active,
  onClick,
  tone = 'neutral',
  bullet = true,
}) => {
  const base =
    'inline-flex items-center gap-2 h-8 px-3 rounded-md border text-[11px] font-semibold uppercase tracking-wider transition-colors cursor-pointer';
  const inactive =
    'bg-transparent border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]/50';
  const activeCls =
    'bg-[var(--surface-2)] border-[var(--border-strong)] text-[var(--text)]';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} ${active ? activeCls : inactive}`}
    >
      {bullet && tone !== 'neutral' && (
        <span className={`h-1.5 w-1.5 rounded-full ${dotCls[tone]}`} />
      )}
      <span>{label}</span>
      {typeof count === 'number' && (
        <span className="font-mono text-[10px] text-[var(--text-dim)]">{count}</span>
      )}
    </button>
  );
};
