import React from 'react';
import { strategyLabel } from './format';

/** A small label: a selector's type, a healing method, a status note. */
export const Chip: React.FC<{
  title?: string;
  tone?: 'neutral' | 'warning';
  children: React.ReactNode;
}> = ({ title, tone = 'neutral', children }) => (
  <span
    title={title}
    className={`inline-block max-w-full truncate rounded px-1.5 py-px text-[10px] font-medium ${
      tone === 'warning'
        ? 'border border-[var(--color-warning)] text-[var(--color-warning)]'
        : 'bg-[rgb(var(--rgb-fg)/0.06)] text-[var(--text-muted)]'
    }`}
  >
    {children}
  </span>
);

/** A selector with its type above it, up to two lines, the whole of it on hover. */
export const SelectorText: React.FC<{
  strategy: string | null;
  text: string;
  extra?: React.ReactNode;
}> = ({ strategy, text, extra }) => (
  <div className="min-w-0">
    <div className="mb-0.5 flex min-w-0 items-center gap-1.5">
      <Chip>{strategyLabel(strategy)}</Chip>
      {extra}
    </div>
    <code
      className="line-clamp-2 break-all font-mono text-[11px] leading-snug text-[var(--text)]"
      title={text}
    >
      {text}
    </code>
  </div>
);
