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

/**
 * A wire record plus a client-side ingest sequence number.
 *
 * The wire type carries no id and no sequence (see `logcatParse.ts`), and the
 * buffer trims from the FRONT once it is full — so a list index is not a
 * stable identity: every trim shifts every index by one and React would patch
 * all 5000 rows. `seq` is assigned once, on ingest, and never reused for the
 * life of the hook, which gives the row list a key that survives trimming.
 */
export interface BufferedLogcatRecord extends LogcatRecord {
  seq: number;
}

export interface LogcatStreamState {
  records: BufferedLogcatRecord[];
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
export function useLogcatStream(
  udid: string,
  enabled: boolean,
  /**
   * Source-side narrowing, for platforms that filter before sending (iOS).
   * Serialised into the upgrade URL, so a change here reconnects — which is
   * the point: on iOS the level dropdown genuinely changes what the device
   * sends, rather than what the browser shows. Android passes nothing and
   * filters client-side as before.
   */
  sourceFilter?: { levels?: string[]; process?: string },
): LogcatStreamState {
  // A string, not the object: an object literal rebuilt on every render would
  // re-run the effect and reconnect the socket on every keystroke in the
  // filter box.
  const filterKey = `${(sourceFilter?.levels ?? []).join(',')}|${sourceFilter?.process ?? ''}`;
  const [records, setRecords] = useState<BufferedLogcatRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const [deniedReason, setDeniedReason] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);
  // Populated by the effect below on every (re)run; retry() calls through
  // this ref so a manual retry can restart the *current* connect loop
  // without the effect itself depending on a "please reconnect" counter.
  const connectRef = useRef<() => void>(() => undefined);

  // Frames arrive one at a time from the socket but are applied to state in
  // batches — see FLUSH_INTERVAL_MS above.
  const pendingRef = useRef<BufferedLogcatRecord[]>([]);
  const flushTimerRef = useRef<number | undefined>(undefined);
  // Monotonic for the life of the hook — never reset by clear(), a reconnect
  // or a buffer trim, so a `seq` can never collide with one React still has
  // mounted. See BufferedLogcatRecord.
  const seqRef = useRef(0);
  /**
   * Close code of the socket this one is replacing, or undefined on a first
   * connect. Read once by the next `onopen` to decide whether the server still
   * has a replay buffer for us — see the reset there.
   */
  const lastCloseCodeRef = useRef<number | undefined>(undefined);

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

    setDeniedReason(null);
    setExhausted(false);
    attemptsRef.current = 0;

    /**
     * This run's cancellation token. Deliberately a fresh object per effect
     * run rather than a ref shared across runs.
     *
     * A shared ref is what leaked a socket on every filter change. Cleanup set
     * it true and closed the socket — but `close()` delivers its event
     * asynchronously, and by then the NEXT run had reset the same ref to
     * false. The dying socket's `onclose` therefore read as an unexpected
     * close, called `scheduleRetry()`, and BACKOFF_START_MS later reconnected
     * from ITS closure — carrying the previous filter. That socket overwrote
     * `wsRef.current`, orphaning the correctly-filtered one, which no later
     * cleanup could reach.
     *
     * Measured against an iPhone 14 before the fix: 16 connects to 4
     * disconnects from a single tab, and the survivor was always the
     * unfiltered one — so `package:` looked right in the pane (the browser
     * still filters locally) while the device firehose kept arriving, which is
     * exactly what pushing `--process` down to ostrace exists to prevent.
     */
    const run = { cancelled: false };

    const scheduleRetry = () => {
      if (run.cancelled) return;
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
      if (run.cancelled) return;
      try {
        const res = await fetch(`/xenon/api/control/${encodeURIComponent(udid)}/stream/ticket`, {
          method: 'POST',
          credentials: 'include',
        });
        if (run.cancelled) return;
        // A non-2xx (e.g. a transient 500) used to fall through the
        // `!ticket` check below and return with no retry scheduled,
        // stranding the pane silently until remount. Treat it like a thrown
        // fetch error.
        if (!res.ok) {
          scheduleRetry();
          return;
        }
        const { ticket } = await res.json();
        if (run.cancelled) return;
        if (!ticket) {
          scheduleRetry();
          return;
        }

        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const [levelsPart, processPart] = filterKey.split('|');
        const extra =
          (levelsPart ? `&levels=${encodeURIComponent(levelsPart)}` : '') +
          (processPart ? `&process=${encodeURIComponent(processPart)}` : '');
        const ws = new WebSocket(
          `${proto}://${window.location.host}/xenon/api/control/${encodeURIComponent(
            udid,
          )}/logcat?ticket=${encodeURIComponent(ticket)}${extra}`,
        );
        wsRef.current = ws;

        ws.onopen = () => {
          attemptsRef.current = 0;
          // Start the buffer over on EVERY successful open, not just the
          // first. The server replays its whole buffer to any joining client
          // (`LogcatMultiplexer.addClient`, REPLAY_BUFFER_SIZE = 2000) and the
          // mux outlives a client disconnect by IDLE_TIMEOUT_MS = 30s, while
          // this hook reconnects in 0.5–10s. So a reconnect inside that window
          // — a wifi blip, a sleep/wake, a proxy timeout, all of which arrive
          // as an abnormal 1006 close we now retry up to 10 times — lands on a
          // still-live mux and replays records this client already has. Left
          // unreset, two or three blips fill the 5000-record buffer with
          // duplicates and evict the real history: exactly the duplicate bug
          // the 3-second `adb logcat -d` poll had, which this stream exists to
          // kill. The wire record carries no id or sequence, so exact
          // client-side dedup is impossible; discarding and re-taking the
          // server's replay is the only correct option. Cost: history older
          // than the server's 2000-record replay is lost on a reconnect.
          //
          // EXCEPT after 1012. That code means the upstream logcat died, and
          // `LogcatStreamService` deletes the session BEFORE closing the mux,
          // so the reconnect gets a brand-new multiplexer with an EMPTY replay
          // — there is nothing coming back to replace what we drop. Clearing
          // there would blank the pane at exactly the moment the preceding
          // lines matter most (reboot, cable pull, adb hiccup) and would erase
          // the server's synthetic `E/xenon "log stream ended (…)"` marker
          // about 500ms after it arrived — a marker the filter is deliberately
          // unable to hide, precisely so loss is never silent. 1012 is the one
          // code where the server guarantees a fresh buffer, so it is the one
          // code that must not reset.
          if (lastCloseCodeRef.current !== 1012) {
            pendingRef.current = [];
            setRecords([]);
          }
          lastCloseCodeRef.current = undefined;
          setConnected(true);
        };
        ws.onmessage = (e) => {
          try {
            const r: LogcatRecord = JSON.parse(e.data);
            pendingRef.current.push({ ...r, seq: seqRef.current++ });
            scheduleFlush();
          } catch {
            /* ignore a malformed frame rather than tearing down the stream */
          }
        };
        ws.onclose = (event) => {
          setConnected(false);
          // Remembered for the next onopen's reset decision — whether the
          // server will still be holding a replay buffer for us depends on
          // why this socket died.
          lastCloseCodeRef.current = event.code;
          // Surface whatever arrived before the close immediately rather
          // than waiting for the next scheduled flush.
          flush();
          if (event.code === 1008) {
            // logcatWs.ts: ticket redeem failed or the ownership check
            // denied ("device held by another user" / "device not found").
            // Authorization will not change on its own — stop the loop and
            // tell the user why instead of retrying into the same denial 10
            // times and then going quiet.
            run.cancelled = true;
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
      run.cancelled = false;
      attemptsRef.current = 0;
      setDeniedReason(null);
      setExhausted(false);
      connect();
    };
    connect();

    return () => {
      run.cancelled = true;
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
  }, [udid, enabled, filterKey, flush, scheduleFlush]);

  const retry = useCallback(() => {
    connectRef.current();
  }, []);

  return { records, connected, clear, deniedReason, exhausted, retry };
}
