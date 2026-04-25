import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import XenonApiService from '../../api-service';
import { IDevice } from '../../interfaces/IDevice';
import { ISession } from '../../interfaces/ISession';
import { useSocket } from '../../hooks/useSocket';

export type ActivityEventKind = 'session' | 'session-end' | 'session-failed' | 'node' | 'heal';

export interface ActivityEvent {
  id: string;
  ts: number;
  kind: ActivityEventKind;
  message: React.ReactNode;
}

export interface HourBucket {
  /** "HH:00" label for the bar's hour. */
  hour: string;
  /** Sessions whose startTime falls in this hour bucket. */
  sessions: number;
  /** Heals — kept at 0 until the backend exposes a heals timeline. */
  heals: number;
}

export interface OsBreakdown {
  label: string;
  count: number;
}

export interface OverviewData {
  devices: IDevice[];
  activeSessions: ISession[];
  queuedSessions: number;
  healsToday: number | null;
  failures24h: number;
  failuresDelta: number | null;
  activity: ActivityEvent[];
  sessionTrend: HourBucket[];
  totalSessions24h: number;
  osBreakdown: OsBreakdown[];
}

const MAX_ACTIVITY = 20;

function withinMs(iso: string | undefined, windowMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t < windowMs;
}

/**
 * Bucket the last 24 sessions' startTime by hour-of-day, ending at the
 * current hour. Returns 24 entries [oldest, …, current].
 */
function bucketSessionsBy24h(sessions: ISession[]): { trend: HourBucket[]; total: number } {
  const now = new Date();
  const currentHour = now.getHours();
  const buckets: HourBucket[] = [];
  for (let i = 0; i < 24; i++) {
    const h = (currentHour - (23 - i) + 24) % 24;
    buckets.push({
      hour: `${String(h).padStart(2, '0')}:00`,
      sessions: 0,
      heals: 0,
    });
  }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let total = 0;
  for (const s of sessions) {
    const t = s.startTime ? Date.parse(s.startTime) : NaN;
    if (!Number.isFinite(t) || t < cutoff) continue;
    const ageHours = Math.floor((Date.now() - t) / (60 * 60 * 1000));
    const slot = 23 - ageHours;
    if (slot >= 0 && slot < 24) {
      buckets[slot].sessions += 1;
      total += 1;
    }
  }
  return { trend: buckets, total };
}

/**
 * Group devices into "iOS 17.4 / tvOS 17.2 / Android 13" style buckets,
 * sorted by descending count and capped at the top 6 (everything else
 * collapses into "Other").
 */
function groupOsBreakdown(devices: IDevice[]): OsBreakdown[] {
  const counts = new Map<string, number>();
  for (const d of devices) {
    const platform = (d as any).platform || (d as any).device_platform || 'unknown';
    const version =
      (d as any).platformVersion || (d as any).version || (d as any).device_version || '';
    const platformLabel = platform === 'ios' ? 'iOS' : platform === 'tvos' ? 'tvOS' : platform.charAt(0).toUpperCase() + platform.slice(1);
    const key = version ? `${platformLabel} ${version}` : platformLabel;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted.length <= 6) {
    return sorted.map(([label, count]) => ({ label, count }));
  }
  const top = sorted.slice(0, 5);
  const otherCount = sorted.slice(5).reduce((acc, [, n]) => acc + n, 0);
  return [
    ...top.map(([label, count]) => ({ label, count })),
    { label: 'Other', count: otherCount },
  ];
}

/**
 * Aggregates REST + socket data for the Overview page.
 *
 * REST (one-shot on mount):
 *  - GET /device — IDevice[]
 *  - GET /session — ISession[]
 *  - GET /queue/length — number
 *
 * Socket (live, from src/enums/SocketEvents.ts):
 *  - session_started, session_stopped  → active/queued + activity
 *  - node_connected, node_disconnected → activity
 *
 * Heal events are not exposed yet — `healsToday` stays null and the trend
 * keeps `heals=0` per bar. Same for `failuresDelta` without historical
 * aggregates.
 */
export function useOverviewData(): OverviewData {
  const [devices, setDevices] = useState<IDevice[]>([]);
  const [sessions, setSessions] = useState<ISession[]>([]);
  const [queued, setQueued] = useState<number>(0);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const { on } = useSocket();
  const counter = useRef(0);

  useEffect(() => {
    let cancelled = false;

    XenonApiService.getDevices()
      .then((d: IDevice[]) => { if (!cancelled && Array.isArray(d)) setDevices(d); })
      .catch(() => { /* ignore */ });

    XenonApiService.getSessions()
      .then((s: ISession[]) => { if (!cancelled && Array.isArray(s)) setSessions(s); })
      .catch(() => { /* ignore */ });

    XenonApiService.getPendingSessionsCount()
      .then((r: any) => {
        if (cancelled) return;
        const n = typeof r === 'number' ? r : typeof r?.count === 'number' ? r.count : 0;
        setQueued(n);
      })
      .catch(() => { /* ignore */ });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    const push = (kind: ActivityEventKind, message: React.ReactNode) => {
      counter.current += 1;
      const ev: ActivityEvent = {
        id: `${Date.now()}-${counter.current}`,
        ts: Date.now(),
        kind,
        message,
      };
      setActivity((a) => [ev, ...a].slice(0, MAX_ACTIVITY));
    };

    const onStart = (payload: any) => {
      if (payload && payload.session) {
        setSessions((prev) => {
          const existing = prev.find((s) => s.id === payload.session.id);
          if (existing) return prev;
          return [payload.session as ISession, ...prev];
        });
      }
      const sid: string = payload?.session?.id || payload?.sessionId || '';
      const sidShort = sid ? sid.slice(0, 6) : '';
      push('session', <>Session <strong>{sidShort || '—'}</strong> started</>);
    };

    const onStop = (payload: any) => {
      const sid: string = payload?.session?.id || payload?.sessionId || '';
      const failed: boolean = Boolean(payload?.session?.failure_reason || payload?.failure_reason);
      if (sid) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sid ? { ...s, status: failed ? 'failed' : 'finished' } : s)),
        );
      }
      const sidShort = sid ? sid.slice(0, 6) : '';
      push(
        failed ? 'session-failed' : 'session-end',
        failed ? <>Session <strong>{sidShort || '—'}</strong> failed</> : <>Session <strong>{sidShort || '—'}</strong> ended</>,
      );
    };

    const onNodeUp = (payload: any) => {
      const nodeId = payload?.nodeId || payload?.id || 'node';
      push('node', <>Node <strong>{String(nodeId)}</strong> connected</>);
    };
    const onNodeDown = (payload: any) => {
      const nodeId = payload?.nodeId || payload?.id || 'node';
      push('node', <>Node <strong>{String(nodeId)}</strong> disconnected</>);
    };

    unsubs.push(on('session_started', onStart));
    unsubs.push(on('session_stopped', onStop));
    unsubs.push(on('node_connected', onNodeUp));
    unsubs.push(on('node_disconnected', onNodeDown));

    return () => { unsubs.forEach((u) => u && u()); };
  }, [on]);

  const activeSessions = sessions.filter((s) => s.status === 'running');
  const failures24h = sessions.filter(
    (s) => s.failure_reason && withinMs(s.endTime || s.startTime, 24 * 60 * 60 * 1000),
  ).length;

  const { trend: sessionTrend, total: totalSessions24h } = useMemo(
    () => bucketSessionsBy24h(sessions),
    [sessions],
  );
  const osBreakdown = useMemo(() => groupOsBreakdown(devices), [devices]);

  return {
    devices,
    activeSessions,
    queuedSessions: queued,
    healsToday: null,
    failures24h,
    failuresDelta: null,
    activity,
    sessionTrend,
    totalSessions24h,
    osBreakdown,
  };
}
