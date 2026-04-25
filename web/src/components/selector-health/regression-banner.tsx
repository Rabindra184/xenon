import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, X } from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import { formatStrategy } from '../../utils/strategy-labels';

interface RegressionEvent {
  original_strategy: string;
  original_selector: string;
  resolved_at?: string | null;
  regression_count?: number;
  receivedAt: number;
}

const AUTO_DISMISS_MS = 30_000;
// Multiple regressions inside this window collapse to a single
// "N selectors regressed" banner instead of stacking individually.
const AGGREGATE_WINDOW_MS = 5 * 60_000;

// Top-of-page alert for SELECTOR_REGRESSED socket events. The backend
// emits one of these whenever a heal arrives for a tuple that's currently
// in Pending or Resolved (regression hook in event-manager). The banner
// auto-dismisses after 30 s; multiple regressions inside a 5-minute window
// fold into a single aggregated banner.
export function RegressionBanner() {
  const { on } = useSocket();
  const navigate = useNavigate();
  const [events, setEvents] = useState<RegressionEvent[]>([]);

  useEffect(() => {
    const unsub = on('selector_regressed', (data: any) => {
      setEvents((curr) => {
        const cutoff = Date.now() - AGGREGATE_WINDOW_MS;
        const fresh = curr.filter((x) => x.receivedAt >= cutoff);
        return [
          ...fresh,
          {
            original_strategy: data?.original_strategy ?? '',
            original_selector: data?.original_selector ?? '',
            resolved_at: data?.resolved_at ?? null,
            regression_count: data?.regression_count,
            receivedAt: Date.now(),
          },
        ];
      });
    });
    return () => {
      unsub && unsub();
    };
  }, [on]);

  useEffect(() => {
    if (events.length === 0) return;
    const t = setTimeout(() => setEvents([]), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [events]);

  if (events.length === 0) return null;

  const dismiss = () => setEvents([]);
  const goActive = () => {
    navigate('/selector-health?tab=active');
    setEvents([]);
  };

  if (events.length === 1) {
    const single = events[0];
    return (
      <div className="sh-regression-banner" role="alert">
        <RefreshCw size={14} className="sh-regression-banner__icon" />
        <span>
          A previously-fixed selector regressed:{' '}
          <strong>
            {formatStrategy(single.original_strategy)}: {single.original_selector}
          </strong>{' '}
          healed again.
        </span>
        <button
          type="button"
          className="sh-regression-banner__action"
          onClick={goActive}
        >
          Show in Active →
        </button>
        <button
          type="button"
          className="sh-regression-banner__close"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="sh-regression-banner" role="alert">
      <RefreshCw size={14} className="sh-regression-banner__icon" />
      <span>
        <strong>{events.length} selectors</strong> have regressed in the last 5 minutes.
      </span>
      <button
        type="button"
        className="sh-regression-banner__action"
        onClick={goActive}
      >
        Show all →
      </button>
      <button
        type="button"
        className="sh-regression-banner__close"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
}
