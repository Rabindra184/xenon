import * as React from 'react';
import { cn } from '../../lib/utils';
import './select.css';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Control height. 'md' = 36px (default, matches Input), 'sm' = 32px. */
  selectSize?: 'sm' | 'md';
}

/**
 * Shared dropdown. Renders a native <select> with unified kit styling so every
 * dropdown in the app looks the same and keeps native keyboard/accessibility
 * behavior. Use `selectSize="sm"` for compact toolbars.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, selectSize = 'md', children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn('select-base', selectSize === 'sm' && 'select-sm', className)}
      {...props}
    >
      {children}
    </select>
  ),
);

Select.displayName = 'Select';

export { Select };
