import type { ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../cn';

export interface TabItem {
  value: string;
  label: string;
  /** Something small after the label, such as a Badge or a dot. Give it its own accessible name. */
  badge?: ReactNode;
}

/**
 * Tabs on Radix: role tablist/tab/tabpanel, arrow keys between tabs (Up and Down
 * when vertical), one Tab stop for the list. `children` are the TabPanels. The
 * chosen tab is marked by an accent bar as well as by colour.
 */
export function Tabs({
  value,
  onValueChange,
  items,
  orientation = 'horizontal',
  'aria-label': ariaLabel,
  className,
  children
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: TabItem[];
  orientation?: 'horizontal' | 'vertical';
  'aria-label'?: string;
  className?: string;
  children?: ReactNode;
}) {
  const vertical = orientation === 'vertical';
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      orientation={orientation}
      className={cn('flex', vertical ? 'flex-row gap-4' : 'flex-col gap-3', className)}
    >
      <TabsPrimitive.List
        aria-label={ariaLabel}
        className={cn('flex shrink-0', vertical ? 'w-48 flex-col gap-0.5' : 'items-end gap-1 border-b border-line')}
      >
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              'focus-ring inline-flex h-8 items-center gap-2 px-3 text-sm font-medium text-muted transition-colors',
              'hover:text-ink data-[state=active]:text-ink',
              vertical
                ? 'justify-start rounded-md border-l-2 border-transparent hover:bg-surface2 data-[state=active]:border-accent data-[state=active]:bg-surface2'
                : '-mb-px rounded-t-md border-b-2 border-transparent data-[state=active]:border-accent'
            )}
          >
            {item.label}
            {item.badge}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}

/** The content of one tab. Only the chosen tab's panel is in the page. */
export function TabPanel({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Content value={value} className={cn('focus-ring min-w-0 flex-1', className)}>
      {children}
    </TabsPrimitive.Content>
  );
}
