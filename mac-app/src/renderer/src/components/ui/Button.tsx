import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../cn';

const VARIANTS = {
  primary: 'bg-accent text-accent-fg font-medium hover:bg-accent-dim',
  danger: 'bg-danger text-white font-medium hover:bg-danger/80',
  ghost: 'border border-line-strong text-ink hover:bg-surface2'
} as const;

const SIZES = {
  sm: 'px-2 py-1 text-xs rounded',
  md: 'px-3 py-1.5 text-sm rounded-md'
} as const;

export function Button({
  variant = 'ghost',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  icon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'focus-ring inline-flex items-center gap-1.5 disabled:opacity-50',
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
}
