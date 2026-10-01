import { useCallback, useEffect, useRef, useState } from 'react';
import XenonApiService from '../../api-service';
import { useSocket } from '../../hooks/useSocket';
import type { ISessionSummary } from '../../interfaces/ISessionSummary';
import { sinceFor, type TimeFilter } from './derive';

// The summary counts the whole period on the server, so it is refreshed less
// often than the list; a session starting or stopping refreshes it at once.
const REFRESH_INTERVAL_MS = 15_000;

/**
 * The summary strip's numbers: one build's when one is chosen, else every
 * session since the start of `timeFilter`, with the period before it.
 */
export function useSessionSummary(
  timeFilter: TimeFilter,
  buildId: string | null,
): ISessionSummary | null {
  const [summary, setSummary] = useState<ISessionSummary | null>(null);
  const alive = useRef(true);
  // Answers can arrive out of order when the filter changes; only the latest counts.
  const latest = useRef(0);
  const { on: onSocketEvent } = useSocket();

  const fetchSummary = useCallback(async () => {
    const call = ++latest.current;
    try {
      const next = (await XenonApiService.getSessionSummary(
        buildId ? { buildId } : { since: sinceFor(timeFilter, Date.now()) },
      )) as ISessionSummary;
      if (alive.current && call === latest.current && next && next.current) setSummary(next);
    } catch {
      // Keep the last numbers; the next refresh tries again.
    }
  }, [timeFilter, buildId]);

  useEffect(() => {
    alive.current = true;
    setSummary(null);
    fetchSummary();
    const id = setInterval(fetchSummary, REFRESH_INTERVAL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [fetchSummary]);

  useEffect(() => {
    const unsubs = [
      onSocketEvent('session_started', fetchSummary),
      onSocketEvent('session_stopped', fetchSummary),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [onSocketEvent, fetchSummary]);

  return summary;
}
