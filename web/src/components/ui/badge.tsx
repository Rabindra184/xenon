import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
import './badge.css';

const badgeVariants = cva('badge-base', {
  variants: {
    variant: {
      default: 'badge-variant-default',
      success: 'badge-variant-success',
      warning: 'badge-variant-warning',
      error: 'badge-variant-error',
      outline: 'badge-variant-outline',
      secondary: 'badge-variant-secondary',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
