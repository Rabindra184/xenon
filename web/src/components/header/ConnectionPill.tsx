import React from 'react';
import { useConnectionStatus } from '../../hooks/useConnectionStatus';
import { Button } from '../ui/button';

/**
 * The header's live-updates pill, driven by the real socket connection. It
 * replaced a hardcoded "Online" pill and an "Updated Xm ago" timer that
 * counted from when the header mounted and went red after 10 minutes.
 *
 * When nothing will reconnect by itself (the server refused the socket), it
 * says so and offers a reload.
 */
export const ConnectionPill: React.FC = () => {
  const connection = useConnectionStatus();
  return (
    <div className="flex items-center gap-2">
      <div
        role="status"
        title={connection.title}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
          connection.tone === 'live'
            ? 'bg-[var(--color-success)]/10 border-[var(--color-success)]/20 text-[var(--color-success)]'
            : connection.tone === 'reconnecting'
              ? 'bg-[var(--amber)]/10 border-[var(--amber)]/25 text-[var(--amber)]'
              : 'bg-[var(--red)]/10 border-[var(--red)]/25 text-[var(--red)]'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full bg-current ${connection.tone === 'live' ? 'pulse-dot' : ''}`}
          aria-hidden="true"
        />
        <span className="text-caption font-medium">{connection.label}</span>
      </div>
      {connection.action === 'reload' && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
      )}
    </div>
  );
};
