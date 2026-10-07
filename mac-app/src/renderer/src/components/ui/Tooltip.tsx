import type { ReactElement, ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

/**
 * A short hint on hover and keyboard focus, on Radix. It is for extra help only:
 * the child must already have its own accessible name, and nothing a person
 * needs may live only in a tooltip. `children` is one element that can take a
 * ref (a Button, an <a>, a <button>).
 */
export function Tooltip({
  content,
  side = 'top',
  children
}: {
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={400}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="z-50 max-w-xs rounded-md border border-line-strong bg-surface2 px-2 py-1 text-xs text-ink shadow-md"
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
