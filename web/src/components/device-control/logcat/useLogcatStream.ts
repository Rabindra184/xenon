import { useCallback, useEffect, useRef, useState } from 'react';

export interface LogcatRecord {
  ts: number;
  pid: number;
  tid: number;
  level: string;
  tag: string;
  message: string;
  pkg?: string;
  synthetic?: boolean;
}

export interface LogcatStreamState {
  records: LogcatRecord[];
  connected: boolean;
  clear: () => void;
  /**
   * Set once the server closes the socket with 1008 — `logcatWs.ts` uses that
   * code for both an invalid/expired ticket and a denied ownership check (see
   * `deviceAccessGuard`). Retrying cannot change the answer (authorization
   * will not spontaneously flip), so the hook stops the auto-retry loop and
   * surfaces the server's close reason instead of going quiet. Cleared by a
   * fresh connect (new `udid`/`enabled`) or by `retry()`.
   */
  deniedReason: string | null;
  /**
   * True once `MAX_ATTEMPTS` reconnect attempts have all failed. Previously
   * the hook just stopped scheduling retries here with no visible signal —
   * `connected` stays false forever and looks identical to "still trying".
   * `retry()` clears this and restarts the connect loop from attempt 0.
   */
  exhausted: boolean;
  /** Manually restart the connect loop — clears both terminal states above. */
  retry: () => void;
}

const CLIENT_BUFFER = 5000;
const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 10_000;
const MAX_ATTEMPTS = 10;
// React 17 does not batch state updates made outside of its own event
// handlers (a WebSocket `message` handler is exactly such a context), so
// without coalescing, a burst of logcat lines — a boot, a crash, a chatty
// app — forces one synchronous re-render PER LINE. Frames are buffered here
// and applied to `records` in one array copy per flush window instead.
const FLUSH_INTERVAL_MS = 50;

/**
 * Opens the logcat WebSocket for a device: mint a single-use ticket, connect,
 * keep a bounded buffer. Reconnects with bounded backoff — an unbounded retry
 * loop against a dead device wedges the lab (same reason UniversalMjpegProxy
 * caps its retries) — except when the server's close code says retrying
 * cannot help (1008) or explicitly invites an immediate reconnect (1012).
 */
export function useLogcatStream(udid: string, enabled: boolean): LogcatStreamState {
  const [records, setRecords] = useState<LogcatRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const [deniedReason, setDeniedReason] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const cancelledRef = useRef(false);
  const retryTimerRef = useRef<number | undefined>(undefined);
  // Populated by the effect below on every (re)run; retry() calls through
  // this ref so a manual retry can restart the *current* connect loop
  // without the effect itself depending on a "please reconnect" counter.
  const connectRef = useRef<() => void>(() => undefined);

  // Frames arrive one at a time from the socket but are applied to state in
  // batches — see FLUSH_INTERVAL_MS above.
  const pendingRef = useRef<LogcatRecord[]>([]);
  const flushTimerRef = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current;
    pendingRef.current = [];
    setRecords((prev) => {
      const merged = prev.concat(batch);
      // FREEZE only pauses auto-scroll in the view — this hook keeps
      // accumulating and trimming regardless, so frozen records are already
      // present (just off-screen) the moment the user unfreezes.
      return merged.length > CLIENT_BUFFER ? merged.slice(-CLIENT_BUFFER) : merged;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== undefined) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = undefined;
      flush();
    }, FLUSH_INTERVAL_MS);
  }, [flush]);

  const clear = useCallback(() => {
    pendingRef.current = [];
    setRecords([]);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setDeniedReason(null);
      setExhausted(false);
      return;
    }

    cancelledRef.current = false;
    setDeniedReason(null);
    setExhausted(false);
    attemptsRef.current = 0;

    const scheduleRetry = () => {
      if (cancelledRef.current) return;
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        // Previously returned silently: `connected` stayed false forever and
        // the toolbar pill sat on CONNECTING with no way out but a remount.
        setExhausted(true);
        return;
      }
      const delay = Math.min(BACKOFF_START_MS * 2 ** attemptsRef.current, BACKOFF_MAX_MS);
      attemptsRef.current += 1;
      retryTimerRef.current = window.setTimeout(connect, delay);
    };

    const connect = async () => {
      if (cancelledRef.current) return;
      try {
        const res = await fetch(`/xenon/api/control/${encodeURIComponent(udid)}/stream/ticket`, {
          method: 'POST',
          credentials: 'include',
        });
        if (cancelledRef.current) return;
        // A non-2xx (e.g. a transient 500) used to fall through the
        // `!ticket` check below and return with no retry scheduled,
        // stranding the pane silently until remount. Treat it like a thrown
        // fetch error.
        if (!res.ok) {
          scheduleRetry();
          return;
        }
        const { ticket } = await res.json();
        if (cancelledRef.current) return;
        if (!ticket) {
          scheduleRetry();
          return;
        }

        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(
          `${proto}://${window.location.host}/xenon/api/control/${encodeURIComponent(
            udid,
          )}/logcat?ticket=${encodeURIComponent(ticket)}`,
        );
        wsRef.current = ws;

        ws.onopen = () => {
          attemptsRef.current = 0;
          setConnected(true);
        };
        ws.onmessage = (e) => {
          try {
            const r: LogcatRecord = JSON.parse(e.data);
            pendingRef.current.push(r);
            scheduleFlush();
          } catch {
            /* ignore a malformed frame rather than tearing down the stream */
          }
        };
        ws.onclose = (event) => {
          setConnected(false);
          // Surface whatever arrived before the close immediately rather
          // than waiting for the next scheduled flush.
          flush();
          if (event.code === 1008) {
            // logcatWs.ts: ticket redeem failed or the ownership check
            // denied ("device held by another user" / "device not found").
            // Authorization will not change on its own — stop the loop and
            // tell the user why instead of retrying into the same denial 10
            // times and then going quiet.
            cancelledRef.current = true;
            setDeniedReason(event.reason || 'access denied');
            return;
          }
          if (event.code === 1012) {
            // logcatWs.ts: the upstream `adb logcat` process ended (device
            // reboot, an explicit stop(), or the server's own idle
            // watchdog) and the server closed deliberately. Expected, not a
            // failure — retried through the same bounded backoff as any
            // other reconnect (still capped: a device that can never keep
            // logcat alive must not be retried forever), but unlike an
            // abnormal close below, nothing is logged — the server already
            // told us why over the wire.
            scheduleRetry();
            return;
          }
          // Abnormal close: no code logcatWs.ts sends on purpose (a dropped
          // connection, a proxy timeout, 1011 ownership-lookup failure).
          // Same bounded-backoff retry as 1012 — the client can't tell
          // "the server's proxy hiccuped" from "the device rebooted", and
          // both deserve a reconnect attempt, not a terminal state — but
          // worth a console warning since nothing told us this one was
          // expected.
          console.warn(`[logcat] WS closed unexpectedly (code ${event.code}) — retrying`);
          scheduleRetry();
        };
        ws.onerror = () => ws.close();
      } catch {
        scheduleRetry();
      }
    };

    connectRef.current = () => {
      cancelledRef.current = false;
      attemptsRef.current = 0;
      setDeniedReason(null);
      setExhausted(false);
      connect();
    };
    connect();

    return () => {
      cancelledRef.current = true;
      if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current);
      if (flushTimerRef.current !== undefined) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = undefined;
      }
      // Deliver whatever's buffered rather than dropping it silently — this
      // also covers the effect re-running on a udid/enabled change, not just
      // an actual unmount.
      flush();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [udid, enabled, flush, scheduleFlush]);

  const retry = useCallback(() => {
    connectRef.current();
  }, []);

  return { records, connected, clear, deniedReason, exhausted, retry };
}
