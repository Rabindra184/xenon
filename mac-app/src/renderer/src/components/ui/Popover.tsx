import type { ReactElement, ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../cn';

/**
 * A small floating panel anchored to a button, on Radix: Escape and an outside
 * click close it, and focus returns to the button. `trigger` is the button
 * itself: exactly one element that can take a ref (a Button, a <button>), which
 * receives the click handler and aria attributes. `label` names the panel for a
 * screen reader.
 */
export function Popover({
  trigger,
  label,
  open,
  onOpenChange,
  align = 'start',
  className,
  children
}: {
  trigger: ReactElement;
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          aria-label={label}
          align={align}
          sideOffset={6}
          className={cn(
            'z-50 w-72 rounded-lg border border-line-strong bg-surface2 p-3 text-sm text-ink shadow-md focus:outline-none',
            className
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
