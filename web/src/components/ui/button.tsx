import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
import './button.css';

const buttonVariants = cva('button-base', {
  variants: {
    variant: {
      default: 'button-variant-default',
      outline: 'button-variant-outline',
      ghost: 'button-variant-ghost',
      link: 'button-variant-link',
      destructive: 'button-variant-destructive',
    },
    size: {
      default: 'button-default',
      sm: 'button-sm',
      lg: 'button-lg',
      icon: 'button-icon',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);

Button.displayName = 'Button';

export { Button, buttonVariants };
