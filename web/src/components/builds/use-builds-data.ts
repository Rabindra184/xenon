import { useEffect, useState, useCallback, useRef } from 'react';
import XenonApiService from '../../api-service';
import { useSocket } from '../../hooks/useSocket';
import type { IBuild } from '../../interfaces/IBuild';
import type { ISession } from '../../interfaces/ISession';

const REFRESH_INTERVAL_MS = 3000;

export interface UseBuildsData {
  builds: IBuild[];
  selectedBuildId: string | null;
  sessions: ISession[];
  loading: boolean;
  error: string | null;
  selectBuild: (id: string | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  refresh: () => void;
}

export function useBuildsData(): UseBuildsData {
  const [builds, setBuilds] = useState<IBuild[]>([]);
  const [sessions, setSessions] = useState<ISession[]>([]);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const { on: onSocketEvent } = useSocket();

  const fetchData = useCallback(async () => {
    try {
      const [buildList, sessionList] = await Promise.all([
        XenonApiService.getBuilds() as Promise<IBuild[]>,
        selectedBuildId
          ? (XenonApiService.getSessions({ buildId: selectedBuildId, query: searchQuery }) as Promise<ISession[]>)
          : Promise.resolve([] as ISession[]),
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
  }, [selectedBuildId, searchQuery]);

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
    searchQuery,
    setSearchQuery,
    refresh: fetchData,
  };
}
