import { useEffect, useState } from 'react';
import XenonApiService from '../../api-service';
import type { ISession } from '../../interfaces/ISession';
import type { LogLike } from './derive';

export interface UseSessionDetail {
  session: ISession | null;
  sessionLogs: LogLike[];
  deviceLogs: LogLike[];
  debugLogs: LogLike[];
  profiling: unknown[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSessionDetail(sessionId: string | null): UseSessionDetail {
  const [session, setSession] = useState<ISession | null>(null);
  const [sessionLogs, setSessionLogs] = useState<LogLike[]>([]);
  const [deviceLogs, setDeviceLogs] = useState<LogLike[]>([]);
  const [debugLogs, setDebugLogs] = useState<LogLike[]>([]);
  const [profiling, setProfiling] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setSessionLogs([]);
      setDeviceLogs([]);
      setDebugLogs([]);
      setProfiling([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    Promise.all([
      XenonApiService.getSession(sessionId),
      XenonApiService.getSessionLogs(sessionId),
      XenonApiService.getDeviceLogs(sessionId),
      XenonApiService.getDebugLogs(sessionId),
      XenonApiService.getProfilingData(sessionId).catch(() => []),
    ])
      .then(([s, sl, dl, bl, pf]) => {
        if (!alive) return;
        // Guard against error-body responses (apiClient.jsonResult doesn't
        // throw on non-2xx — it returns the parsed JSON, which can look like
        // { error: true, message: '…' }). A real session always has both an
        // id and a status string.
        const valid =
          s && typeof s === 'object' && typeof (s as any).id === 'string' && typeof (s as any).status === 'string';
        setSession(valid ? (s as ISession) : null);
        if (!valid) {
          setError(typeof (s as any)?.message === 'string' ? (s as any).message : 'Session not found');
        } else {
          setError(null);
        }
        setSessionLogs(Array.isArray(sl) ? (sl as LogLike[]) : []);
        setDeviceLogs(Array.isArray(dl) ? (dl as LogLike[]) : []);
        setDebugLogs(Array.isArray(bl) ? (bl as LogLike[]) : []);
        setProfiling(Array.isArray(pf) ? (pf as unknown[]) : []);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sessionId, refreshTick]);

  return {
    session,
    sessionLogs,
    deviceLogs,
    debugLogs,
    profiling,
    loading,
    error,
    refresh: () => setRefreshTick((t) => t + 1),
  };
}
