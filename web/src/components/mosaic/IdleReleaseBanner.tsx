import * as React from 'react';
import { Clock } from 'lucide-react';
import { Button } from '../ui/button';

interface Props {
  message: string;
  /** Offered right after a release; absent after a partial restore. */
  onRestore?: () => void;
  onDismiss: () => void;
}

/**
 * Stays until dismissed: the person it's for was away when the release
 * happened, so a toast would already be gone. Neutral, not the green `info`
 * banner, which would read as good news.
 */
export function IdleReleaseBanner({ message, onRestore, onDismiss }: Props) {
  return (
    <div
      role="status"
      className="text-sm rounded border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] px-3 py-2 flex items-center gap-2"
    >
      <Clock aria-hidden size={14} className="shrink-0 text-[var(--text-dim)]" />
      <span className="flex-1">{message}</span>
      {onRestore && (
        <Button variant="tonal" size="sm" onClick={onRestore}>
          Restore devices
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
