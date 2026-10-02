import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, X } from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import { Button } from '../ui/button';

interface BrokeAgain {
  selector: string;
  receivedAt: number;
}

const AUTO_DISMISS_MS = 30_000;
// Several inside this window fold into one "N selectors" banner.
const AGGREGATE_WINDOW_MS = 5 * 60_000;

/**
 * A live note when a selector someone marked fixed heals again (the
 * `selector_regressed` event). It goes after 30 s, or on dismiss.
 */
export function RegressionBanner() {
  const { on } = useSocket();
  const navigate = useNavigate();
  const [events, setEvents] = useState<BrokeAgain[]>([]);

  useEffect(() => {
    const unsub = on('selector_regressed', (data: { original_selector?: string } | undefined) => {
      setEvents((curr) => {
        const cutoff = Date.now() - AGGREGATE_WINDOW_MS;
        return [
          ...curr.filter((x) => x.receivedAt >= cutoff),
          { selector: data?.original_selector ?? '', receivedAt: Date.now() },
        ];
      });
    });
    return () => {
      if (unsub) unsub();
    };
  }, [on]);

  useEffect(() => {
    if (events.length === 0) return;
    const t = setTimeout(() => setEvents([]), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [events]);

  if (events.length === 0) return null;
  const single = events.length === 1 ? events[0] : null;
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-lg border border-[var(--color-warning)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text)]"
    >
      <RefreshCw size={14} className="shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {single ? (
          <>
            A selector you fixed broke again:{' '}
            <code className="font-mono text-xs" title={single.selector}>
              {single.selector}
            </code>
          </>
        ) : (
          `${events.length} selectors you fixed broke again in the last 5 minutes.`
        )}
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          navigate('/selector-health');
          setEvents([]);
        }}
      >
        Show selectors to fix
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setEvents([])}
        className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        <X size={13} />
      </button>
    </div>
  );
}
