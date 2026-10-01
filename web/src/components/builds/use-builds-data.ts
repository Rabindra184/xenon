import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import XenonApiService from '../../api-service';
import { useSocket } from '../../hooks/useSocket';
import type { IBuild } from '../../interfaces/IBuild';
import type { ISession } from '../../interfaces/ISession';
import { sinceFor, type TimeFilter } from './derive';

const REFRESH_INTERVAL_MS = 3000;

/**
 * Sessions come a page at a time, newest first. The newest page is polled;
 * older pages are loaded when asked for (showMore) and fetched once.
 */
export const SESSION_PAGE_SIZE = 200;
/**
 * The most rows a poll asks for once older pages are loaded: it covers every
 * session from the older pages' newest up, so a row the newest page loses as
 * sessions arrive is still loaded. GET /session's own most.
 */
export const SESSION_POLL_MAX = 2000;

const byNewest = (a: ISession, b: ISession) =>
  a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1;

/** The polled rows and the older pages as one list, each session once, the polled row winning. */
function mergePages(head: ISession[], tail: ISession[]): ISession[] {
  const byId = new Map<string, ISession>();
  for (const s of tail) byId.set(s.id, s);
  for (const s of head) byId.set(s.id, s);
  return Array.from(byId.values()).sort(byNewest);
}

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
  /** Older sessions may exist beyond the loaded ones. */
  hasMore: boolean;
  loadingMore: boolean;
  /** Load the next page of older sessions. */
  showMore: () => Promise<void>;
}

export function useBuildsData(options: BuildsDataOptions = {}): UseBuildsData {
  const { withSessions = false, timeFilter = 'all' } = options;
  const [builds, setBuilds] = useState<IBuild[]>([]);
  // The polled newest rows, and the older pages loaded on demand.
  const [head, setHead] = useState<ISession[]>([]);
  const [tail, setTail] = useState<ISession[]>([]);
  const tailRef = useRef<ISession[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const { on: onSocketEvent } = useSocket();

  // The selected build's sessions, or the period's. The period's start moves
  // with the clock, so it is taken on every fetch.
  const scope = useCallback(
    (): { buildId?: string; since?: string } =>
      selectedBuildId
        ? { buildId: selectedBuildId }
        : { since: sinceFor(timeFilter, Date.now()) ?? undefined },
    [selectedBuildId, timeFilter],
  );

  // A new build or period starts from its newest page again. Declared before
  // the fetch below, so it runs first when either changes.
  useEffect(() => {
    tailRef.current = [];
    setTail([]);
    setHasMore(false);
  }, [selectedBuildId, timeFilter]);

  const loadSessions = useCallback(async (): Promise<ISession[]> => {
    if (!withSessions) return [];
    const older = tailRef.current;
    if (older.length === 0) {
      const page = (await XenonApiService.getSessions({
        ...scope(),
        limit: SESSION_PAGE_SIZE,
      })) as ISession[];
      if (Array.isArray(page)) setHasMore(page.length === SESSION_PAGE_SIZE);
      return page;
    }
    // Everything from the older pages' newest row up, within the scope.
    const { since, ...rest } = scope();
    const floor = older[0].createdAt;
    return (await XenonApiService.getSessions({
      ...rest,
      since: since && since > floor ? since : floor,
      limit: SESSION_POLL_MAX,
    })) as ISession[];
  }, [withSessions, scope]);

  const fetchData = useCallback(async () => {
    try {
      const [buildList, sessionList] = await Promise.all([
        XenonApiService.getBuilds() as Promise<IBuild[]>,
        loadSessions(),
      ]);
      if (!alive.current) return;
      setBuilds(Array.isArray(buildList) ? buildList : []);
      setHead(Array.isArray(sessionList) ? sessionList : []);
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

  const sessions = useMemo(() => mergePages(head, tail), [head, tail]);

  const showMore = useCallback(async () => {
    const oldest = sessions[sessions.length - 1];
    if (!withSessions || loadingMore || !oldest) return;
    setLoadingMore(true);
    try {
      const page = (await XenonApiService.getSessions({
        ...scope(),
        before: oldest.createdAt,
        beforeId: oldest.id,
        limit: SESSION_PAGE_SIZE,
      })) as ISession[];
      if (!alive.current || !Array.isArray(page)) return;
      tailRef.current = mergePages([], [...tailRef.current, ...page]);
      setTail(tailRef.current);
      setHasMore(page.length === SESSION_PAGE_SIZE);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  }, [sessions, withSessions, loadingMore, scope]);

  return {
    builds,
    selectedBuildId,
    sessions,
    loading,
    error,
    selectBuild: setSelectedBuildId,
    refresh: fetchData,
    hasMore,
    loadingMore,
    showMore,
  };
}
