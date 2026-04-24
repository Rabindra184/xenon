import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import XenonApiService from '../../api-service';
import { IDevice } from '../../interfaces/IDevice';
import { ISession } from '../../interfaces/ISession';
import { useSocket } from '../../hooks/useSocket';
import { ActivityEvent, ActivityEventKind } from './ActivityStream';

export interface OverviewData {
  devices: IDevice[];
  activeSessions: ISession[];
  queuedSessions: number;
  healsToday: number | null;
  failures24h: number;
  failuresDelta: number | null;
  activity: ActivityEvent[];
}

const MAX_ACTIVITY = 20;

function withinMs(iso: string | undefined, windowMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t < windowMs;
}

/**
 * Aggregates REST + socket data for the Overview page.
 *
 * REST (one-shot on mount):
 *  - GET /device — IDevice[]
 *  - GET /session — ISession[]
 *  - GET /queue/length — { count } or similar
 *
 * Socket (live, from src/enums/SocketEvents.ts):
 *  - session_started, session_stopped  → active/queued + activity
 *  - node_connected, node_disconnected → activity
 *
 * Heal events are not exposed on the socket yet — "Heals today" stays null
 * and the tile shows an em dash. Same for failuresDelta without historical
 * aggregates.
 */
export function useOverviewData(): OverviewData {
  const [devices, setDevices] = useState<IDevice[]>([]);
  const [sessions, setSessions] = useState<ISession[]>([]);
  const [queued, setQueued] = useState<number>(0);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const { on } = useSocket();
  const counter = useRef(0);

  // Initial REST load — defensive against each endpoint failing independently.
  useEffect(() => {
    let cancelled = false;

    XenonApiService.getDevices()
      .then((d: IDevice[]) => {
        if (!cancelled && Array.isArray(d)) setDevices(d);
      })
      .catch(() => {
        /* ignore — tile shows 0 */
      });

    XenonApiService.getSessions()
      .then((s: ISession[]) => {
        if (!cancelled && Array.isArray(s)) setSessions(s);
      })
      .catch(() => {
        /* ignore */
      });

    XenonApiService.getPendingSessionsCount()
      .then((r: any) => {
        if (cancelled) return;
        // Endpoint returns either a number or { count: n } depending on backend version
        const n = typeof r === 'number' ? r : typeof r?.count === 'number' ? r.count : 0;
        setQueued(n);
      })
      .catch(() => {
        /* ignore */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Socket wiring — incremental updates to sessions + activity.
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
      push(
        'session',
        <>
          Session <strong>{sidShort || '—'}</strong> started
        </>,
      );
    };

    const onStop = (payload: any) => {
      const sid: string = payload?.session?.id || payload?.sessionId || '';
      const failed: boolean = Boolean(
        payload?.session?.failure_reason || payload?.failure_reason,
      );
      if (sid) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sid ? { ...s, status: failed ? 'failed' : 'finished' } : s)),
        );
      }
      const sidShort = sid ? sid.slice(0, 6) : '';
      push(
        failed ? 'session-failed' : 'session-end',
        failed ? (
          <>
            Session <strong>{sidShort || '—'}</strong> failed
          </>
        ) : (
          <>
            Session <strong>{sidShort || '—'}</strong> ended
          </>
        ),
      );
    };

    const onNodeUp = (payload: any) => {
      const nodeId = payload?.nodeId || payload?.id || 'node';
      push(
        'node',
        <>
          Node <strong>{String(nodeId)}</strong> connected
        </>,
      );
    };
    const onNodeDown = (payload: any) => {
      const nodeId = payload?.nodeId || payload?.id || 'node';
      push(
        'node',
        <>
          Node <strong>{String(nodeId)}</strong> disconnected
        </>,
      );
    };

    unsubs.push(on('session_started', onStart));
    unsubs.push(on('session_stopped', onStop));
    unsubs.push(on('node_connected', onNodeUp));
    unsubs.push(on('node_disconnected', onNodeDown));

    return () => {
      unsubs.forEach((u) => u && u());
    };
  }, [on]);

  const activeSessions = sessions.filter((s) => s.status === 'running');
  const failures24h = sessions.filter(
    (s) => s.failure_reason && withinMs(s.endTime || s.startTime, 24 * 60 * 60 * 1000),
  ).length;

  return {
    devices,
    activeSessions,
    queuedSessions: queued,
    healsToday: null,
    failures24h,
    failuresDelta: null,
    activity,
  };
}
