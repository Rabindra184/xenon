import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import XenonApiService from '../../api-service';
import { IDevice } from '../../interfaces/IDevice';
import { ISession } from '../../interfaces/ISession';
import { IHealingEvent, IHealingEventsResponse } from '../../interfaces/IHealingEvent';
import { useSocket } from '../../hooks/useSocket';

export type ActivityEventKind = 'session' | 'session-end' | 'session-failed' | 'node' | 'heal';

export interface ActivityEvent {
  id: string;
  ts: number;
  kind: ActivityEventKind;
  message: React.ReactNode;
}

export interface OverviewData {
  devices: IDevice[];
  activeSessions: ISession[];
  queuedSessions: number;
  activity: ActivityEvent[];
}

const MAX_ACTIVITY = 20;

function shortDeviceLabel(ev: IHealingEvent): string {
  return ev.deviceName || (ev.deviceUdid ? ev.deviceUdid.slice(0, 8) : 'device');
}

function healMessage(ev: IHealingEvent): React.ReactNode {
  const cmd = ev.commandName || 'selector';
  const device = shortDeviceLabel(ev);
  if (ev.tier) {
    return (
      <>
        <strong>{ev.tier}</strong> healed <strong>{cmd}</strong> on <strong>{device}</strong>
      </>
    );
  }
  return (
    <>
      Healed <strong>{cmd}</strong> on <strong>{device}</strong>
    </>
  );
}

/**
 * Aggregates REST + socket data for the Overview page.
 *
 * REST (mount): devices, sessions, queue length, recent healing events (activity seed).
 * Socket: session_started/stopped, node_connected/disconnected, healing_event.
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

    const loadDevices = () => {
      XenonApiService.getDevices()
        .then((d: IDevice[]) => {
          if (!cancelled && Array.isArray(d)) setDevices(d);
        })
        .catch(() => {
          /* ignore */
        });
    };
    loadDevices();
    const devicePoll = setInterval(loadDevices, 30_000);

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
        const n = typeof r === 'number' ? r : typeof r?.count === 'number' ? r.count : 0;
        setQueued(n);
      })
      .catch(() => {
        /* ignore */
      });

    XenonApiService.getRecentHealingEvents()
      .then((r: IHealingEventsResponse) => {
        if (cancelled || !r) return;
        const events = Array.isArray(r.events) ? r.events : [];
        if (events.length === 0) return;
        setActivity((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          const seeded: ActivityEvent[] = events
            .filter((e) => !seen.has(e.id))
            .map((e) => ({
              id: e.id,
              ts: Date.parse(e.createdAt) || Date.now(),
              kind: 'heal' as ActivityEventKind,
              message: healMessage(e),
            }));
          return [...seeded, ...prev].sort((a, b) => b.ts - a.ts).slice(0, MAX_ACTIVITY);
        });
      })
      .catch(() => {
        /* ignore */
      });

    return () => {
      cancelled = true;
      clearInterval(devicePoll);
    };
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
        failed ? (
          <>Session <strong>{sidShort || '—'}</strong> failed</>
        ) : (
          <>Session <strong>{sidShort || '—'}</strong> ended</>
        ),
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

    const onHeal = (payload: any) => {
      const ev = payload as IHealingEvent;
      if (!ev || !ev.id) return;
      const activityEvent: ActivityEvent = {
        id: ev.id,
        ts: Date.parse(ev.createdAt) || Date.now(),
        kind: 'heal',
        message: healMessage(ev),
      };
      setActivity((a) => {
        if (a.some((x) => x.id === activityEvent.id)) return a;
        return [activityEvent, ...a].slice(0, MAX_ACTIVITY);
      });
    };

    unsubs.push(on('session_started', onStart));
    unsubs.push(on('session_stopped', onStop));
    unsubs.push(on('node_connected', onNodeUp));
    unsubs.push(on('node_disconnected', onNodeDown));
    unsubs.push(on('healing_event', onHeal));

    return () => {
      unsubs.forEach((u) => u && u());
    };
  }, [on]);

  const activeSessions = sessions.filter((s) => s.status === 'running');

  return {
    devices,
    activeSessions,
    queuedSessions: queued,
    activity,
  };
}
