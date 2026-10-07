import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../cn';

const VARIANTS = {
  primary: 'bg-accent text-accent-fg font-medium hover:bg-accent-dim',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface2',
  // text-danger-fg is the on-accent colour: 4.5:1 or better on the danger red in
  // both themes (white is 3.8:1 in dark). The hover keeps the red at 90% so the
  // label stays above 4.5:1 too.
  danger: 'bg-danger text-danger-fg font-medium hover:bg-danger/90',
  quiet: 'text-muted hover:bg-surface2 hover:text-ink'
} as const;

// Targets are at least 24 px: sm is h-6, md is h-8.
const SIZES = {
  sm: 'h-6 gap-1 px-2 text-xs rounded',
  md: 'h-8 gap-1.5 px-3 text-sm rounded-md'
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        // aria-disabled is "busy, but keep focus here" (see SidebarStatus); it looks the same as disabled.
        'focus-ring inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors disabled:opacity-50 aria-disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});
