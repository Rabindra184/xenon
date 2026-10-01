import { useEffect, useState, useCallback, useRef } from 'react';
import XenonApiService from '../../api-service';
import { useSocket } from '../../hooks/useSocket';
import type { IBuild } from '../../interfaces/IBuild';
import type { ISession } from '../../interfaces/ISession';
import { sinceFor, type TimeFilter } from './derive';

const REFRESH_INTERVAL_MS = 3000;

/** The server returns at most this many sessions, newest first (GET /session). */
export const SESSION_LIST_LIMIT = 500;

export interface BuildsDataOptions {
  /**
   * Load sessions too: the selected build's, or, with none selected, every
   * build's since the start of `timeFilter`. Off for a page that needs only
   * the builds (the session detail page names its build from them).
   */
  withSessions?: boolean;
  timeFilter?: TimeFilter;
}

export interface UseBuildsData {
  builds: IBuild[];
  selectedBuildId: string | null;
  sessions: ISession[];
  loading: boolean;
  error: string | null;
  selectBuild: (id: string | null) => void;
  refresh: () => void;
}

export function useBuildsData(options: BuildsDataOptions = {}): UseBuildsData {
  const { withSessions = false, timeFilter = 'all' } = options;
  const [builds, setBuilds] = useState<IBuild[]>([]);
  const [sessions, setSessions] = useState<ISession[]>([]);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const { on: onSocketEvent } = useSocket();

  const loadSessions = useCallback((): Promise<ISession[]> => {
    if (!withSessions) return Promise.resolve([]);
    if (selectedBuildId) {
      return XenonApiService.getSessions({ buildId: selectedBuildId }) as Promise<ISession[]>;
    }
    // The period's start moves with the clock, so it is taken on every fetch.
    const since = sinceFor(timeFilter, Date.now()) ?? undefined;
    return XenonApiService.getSessions({ since }) as Promise<ISession[]>;
  }, [withSessions, selectedBuildId, timeFilter]);

  const fetchData = useCallback(async () => {
    try {
      const [buildList, sessionList] = await Promise.all([
        XenonApiService.getBuilds() as Promise<IBuild[]>,
        loadSessions(),
      ]);
      if (!alive.current) return;
      setBuilds(Array.isArray(buildList) ? buildList : []);
      setSessions(Array.isArray(sessionList) ? sessionList : []);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [loadSessions]);

  useEffect(() => {
    alive.current = true;
    fetchData();
    const id = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [fetchData]);

  useEffect(() => {
    const refresh = () => fetchData();
    const unsubs = [
      onSocketEvent('session_started', refresh),
      onSocketEvent('session_stopped', refresh),
      onSocketEvent('device_added', refresh),
      onSocketEvent('device_removed', refresh),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [onSocketEvent, fetchData]);

  return {
    builds,
    selectedBuildId,
    sessions,
    loading,
    error,
    selectBuild: setSelectedBuildId,
    refresh: fetchData,
  };
}
