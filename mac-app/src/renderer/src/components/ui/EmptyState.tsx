import type { ReactNode } from 'react';

/**
 * What a list or screen says when there is nothing in it yet: what is missing,
 * why, and the one thing to do next (`action`). `icon` is decoration.
 */
export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      {icon && (
        <div aria-hidden="true" className="text-dim">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
