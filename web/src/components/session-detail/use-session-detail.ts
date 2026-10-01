import { useEffect, useRef, useState } from 'react';
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
  notFound: boolean;
  refresh: () => void;
}

/** How often a running session's page asks for its status and commands. */
export const LIVE_REFRESH_MS = 4000;

const isSession = (s: unknown): s is ISession =>
  !!s &&
  typeof s === 'object' &&
  typeof (s as any).id === 'string' &&
  typeof (s as any).status === 'string';

export function useSessionDetail(sessionId: string | null): UseSessionDetail {
  const [session, setSession] = useState<ISession | null>(null);
  const [sessionLogs, setSessionLogs] = useState<LogLike[]>([]);
  const [deviceLogs, setDeviceLogs] = useState<LogLike[]>([]);
  const [debugLogs, setDebugLogs] = useState<LogLike[]>([]);
  const [profiling, setProfiling] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  // The session the page has shown: a reload of the same one keeps it on
  // screen instead of going back to the loading state.
  const shownId = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setSessionLogs([]);
      setDeviceLogs([]);
      setDebugLogs([]);
      setProfiling([]);
      setNotFound(false);
      setLoading(false);
      return;
    }
    let alive = true;
    if (shownId.current !== sessionId) setLoading(true);
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
        const valid = isSession(s);
        setSession(valid ? s : null);
        if (!valid) {
          // Phase 4A: when the dashboard's team filter hides a session, the
          // backend responds with `{ error: true, message: 'Session not found' }`
          // — same shape as a real 404 on a missing id. The page treats both
          // as a redirect-with-toast scenario; we don't try to distinguish
          // here.
          setNotFound(
            !!s &&
              typeof s === 'object' &&
              ((s as any).error === true || typeof (s as any).message === 'string'),
          );
          setError(typeof (s as any)?.message === 'string' ? (s as any).message : 'Session not found');
        } else {
          shownId.current = sessionId;
          setNotFound(false);
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

  // While the session runs, follow its status and its commands. The device
  // and debug logs are large, so they are fetched again once, when it ends.
  const running = session?.status === 'running';
  useEffect(() => {
    if (!sessionId || !running) return;
    let alive = true;
    const id = setInterval(async () => {
      try {
        const [s, sl] = await Promise.all([
          XenonApiService.getSession(sessionId),
          XenonApiService.getSessionLogs(sessionId),
        ]);
        if (!alive || !isSession(s)) return;
        setSession(s);
        if (Array.isArray(sl)) setSessionLogs(sl as LogLike[]);
        if (s.status !== 'running') setRefreshTick((t) => t + 1);
      } catch {
        // The next tick asks again.
      }
    }, LIVE_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sessionId, running]);

  return {
    session,
    sessionLogs,
    deviceLogs,
    debugLogs,
    profiling,
    loading,
    error,
    notFound,
    refresh: () => setRefreshTick((t) => t + 1),
  };
}
