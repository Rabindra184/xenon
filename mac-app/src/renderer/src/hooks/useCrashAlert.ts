import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerStatus } from '@shared/types';
import { crashAlert, type Place } from '../navigation';

export interface CrashAlert {
  /** Logs' "new problem" dot. */
  logsAlert: boolean;
  /** Give it every status the main process sends (useServer's onStatus). */
  onStatus(prev: ServerStatus, next: ServerStatus): void;
}

/**
 * Logs' dot: on when the server stops unexpectedly, off once Logs is open
 * (see crashAlert). It looks at every status the main process sends rather
 * than the one drawn, since two can arrive in one render.
 */
export function useCrashAlert(place: Place): CrashAlert {
  const [logsAlert, setLogsAlert] = useState(false);
  const placeRef = useRef(place);
  placeRef.current = place;
  const lastStatus = useRef<ServerStatus>('stopped');

  const onStatus = useCallback((prev: ServerStatus, next: ServerStatus) => {
    lastStatus.current = next;
    // The place is read now, not when the updater runs.
    const at = placeRef.current;
    setLogsAlert((alert) => crashAlert({ status: prev, alert }, { status: next, place: at }));
  }, []);

  // Opening Logs clears it; any other place keeps it.
  useEffect(() => {
    const status = lastStatus.current;
    setLogsAlert((alert) => crashAlert({ status, alert }, { status, place }));
  }, [place]);

  return { logsAlert, onStatus };
}
