import type { HTMLAttributes } from 'react';
import { cn } from '../../cn';

export type BadgeTone = 'neutral' | 'ok' | 'attention' | 'info' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-line-strong bg-surface2',
  ok: 'border-status-ready-border bg-status-ready-bg',
  attention: 'border-status-busy-border bg-status-busy-bg',
  info: 'border-status-reserved-border bg-status-reserved-bg',
  danger: 'border-status-error-border bg-status-error-bg'
};

/**
 * A small label for a count or a state ("3", "New"). The text is always in the
 * ordinary text colour; the tint is a hint, never the only signal. A badge made
 * of a symbol alone ("!") needs an aria-label that says what it means.
 */
export function Badge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: { tone?: BadgeTone } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex min-h-4 items-center rounded-full border px-1.5 text-2xs font-medium text-ink',
        TONES[tone],
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
