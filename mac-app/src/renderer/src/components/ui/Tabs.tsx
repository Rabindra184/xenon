import { createContext, useContext, useId, type ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../cn';

/**
 * Tabs on Radix, as parts that can sit apart in the layout: the list in a
 * sidebar and the panels in <main>, say. `Tabs` holds the chosen value and the
 * orientation and wraps both (it renders a plain div; its layout is the
 * caller's). `TabList` is role tablist: one Tab stop for the whole list, then
 * arrow keys between tabs (Up and Down when vertical, Left and Right when
 * horizontal). `TabTrigger` is a role tab, and `TabPanel` its role tabpanel.
 *
 *   <Tabs value={place} onValueChange={setPlace} orientation="vertical" className="flex">
 *     <nav className="w-44"><TabList aria-label="Places">
 *       <TabTrigger value="home" icon={<House size={16} />}>Home</TabTrigger>
 *     </TabList></nav>
 *     <main id="content"><TabPanel value="home">…</TabPanel></main>
 *   </Tabs>
 */

export type TabsOrientation = 'horizontal' | 'vertical';

const Orientation = createContext<TabsOrientation>('horizontal');

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  orientation?: TabsOrientation;
  className?: string;
  children: ReactNode;
}

export function Tabs({ value, onValueChange, orientation = 'horizontal', className, children }: TabsProps) {
  return (
    <Orientation.Provider value={orientation}>
      <TabsPrimitive.Root value={value} onValueChange={onValueChange} orientation={orientation} className={className}>
        {children}
      </TabsPrimitive.Root>
    </Orientation.Provider>
  );
}

/** Names the list: an `aria-label`, or the id of a visible heading in `aria-labelledby`. */
export type TabListName =
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-labelledby': string; 'aria-label'?: never };

export type TabListProps = TabListName & {
  /** Width and placement are the caller's: the list fills its container. */
  className?: string;
  children: ReactNode;
};

export function TabList({ className, children, ...name }: TabListProps) {
  const vertical = useContext(Orientation) === 'vertical';
  return (
    <TabsPrimitive.List
      {...name}
      className={cn('flex', vertical ? 'flex-col gap-0.5' : 'items-end gap-1 border-b border-line', className)}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export interface TabTriggerProps {
  value: string;
  /** A Lucide icon at size 14 or 16, before the name. It is decoration: the name is the children. */
  icon?: ReactNode;
  /**
   * Something small after the name, such as a Badge or a dot. It is not part of
   * the tab's accessible name, which stays exactly the children ("Setup"), so a
   * tab can be found by its name whatever it carries. It is the tab's
   * description instead, so a symbol needs an aria-label that says what it
   * means (`<Badge role="img" aria-label="Needs attention">!</Badge>`).
   */
  badge?: ReactNode;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

/** One tab. The chosen one is marked by an accent bar as well as by colour. */
export function TabTrigger({ value, icon, badge, disabled, className, children }: TabTriggerProps) {
  const vertical = useContext(Orientation) === 'vertical';
  const badgeId = useId();
  return (
    <TabsPrimitive.Trigger
      value={value}
      disabled={disabled}
      // The badge is hidden from the name computation and read as the description.
      aria-describedby={badge ? badgeId : undefined}
      className={cn(
        'focus-ring inline-flex h-8 items-center gap-2 px-3 text-sm font-medium text-muted transition-colors',
        'hover:text-ink disabled:opacity-50 data-[state=active]:text-ink',
        vertical
          ? 'w-full justify-start rounded-md border-l-2 border-transparent hover:bg-surface2 data-[state=active]:border-accent data-[state=active]:bg-surface2'
          : '-mb-px rounded-t-md border-b-2 border-transparent data-[state=active]:border-accent',
        className
      )}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      )}
      <span className={cn('min-w-0', vertical && 'flex-1 text-left')}>{children}</span>
      {badge && (
        <span id={badgeId} aria-hidden="true" className="inline-flex shrink-0">
          {badge}
        </span>
      )}
    </TabsPrimitive.Trigger>
  );
}

export interface TabPanelProps {
  value: string;
  className?: string;
  children: ReactNode;
}

/** The content of one tab. Only the chosen tab's panel is in the page. */
export function TabPanel({ value, className, children }: TabPanelProps) {
  return (
    <TabsPrimitive.Content value={value} className={cn('focus-ring min-w-0', className)}>
      {children}
    </TabsPrimitive.Content>
  );
}
