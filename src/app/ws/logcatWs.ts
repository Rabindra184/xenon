import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import log from '../../logger';
import type { LogcatMultiplexer } from '../../device-managers/android/LogcatMultiplexer';
import type { LogcatRecord } from '../../services/logcat/logcatParse';

const LOGCAT_PATH_RE = /^\/xenon\/api\/control\/([^/]+)\/logcat$/;

/** Parse the logcat stream upgrade path; returns null for any non-matching URL. */
export function parseLogcatWsPath(url: string): { udid: string; ticket: string } | null {
  const [pathname, query = ''] = url.split('?');
  const m = LOGCAT_PATH_RE.exec(pathname);
  if (!m) return null;
  const ticket = new URLSearchParams(query).get('ticket');
  if (!ticket) return null;
  return { udid: decodeURIComponent(m[1]), ticket };
}

export interface LogcatWsDeps {
  /** Redeem a single-use stream ticket; throws if invalid. */
  redeem: (ticket: string, udid: string) => Promise<{ actorId: string }>;
  /**
   * Resolve the ownership decision for this actor + device — the same policy
   * `deviceAccessGuard` evaluates for REST reads/mutations. Throws on lookup
   * failure (never resolves `false` for "I don't know"): device logs carry
   * auth tokens and PII, so an undetermined owner must fail closed like every
   * other consumer of `evaluateDeviceAccess`.
   */
  authorize: (udid: string, actorId: string) => Promise<boolean>;
  /** Start (or reuse) the device's logcat stream and return its multiplexer. */
  startStream: (udid: string) => Promise<LogcatMultiplexer>;
  /** Drop a record when the socket's kernel backlog exceeds this (OOM guard). */
  maxBufferedBytes?: number;
}

/**
 * Attach the logcat WebSocket upgrade handler to the plugin's HTTP server.
 * Only claims `/xenon/api/control/:udid/logcat` — other upgrades (socket.io,
 * the h264 stream) are left for their own listeners.
 *
 * Authentication mirrors `attachH264Ws`: a single-use, udid-bound stream
 * ticket. Authorization does not — device logs routinely carry auth tokens,
 * deep-link URLs and PII from whatever app is under test, so this endpoint
 * additionally re-evaluates device ownership (`deps.authorize`, backed by the
 * same `evaluateDeviceAccess` the REST guard uses) *after* the ticket
 * redeems. A ticket minted before someone else took the device does not, by
 * itself, grant a log stream — the ownership check runs at connect time, not
 * at mint time.
 */
export function attachLogcatWs(server: Server, deps: LogcatWsDeps): void {
  const wss = new WebSocketServer({ noServer: true });
  const maxBuffered = deps.maxBufferedBytes ?? 4 * 1024 * 1024;

  server.on('upgrade', (req, socket, head) => {
    const parsed = req.url ? parseLogcatWsPath(req.url) : null;
    if (!parsed) return; // not our path — let other upgrade listeners handle it

    wss.handleUpgrade(req, socket as any, head, async (ws: WebSocket) => {
      // Register cleanup BEFORE the awaits below. redeem + authorize +
      // startStream can together take seconds; a client that disconnects in
      // that window must still be removed from the multiplexer once it's
      // joined — otherwise clientCount stays inflated and the idle watchdog
      // never stops the process. Same trap documented in h264StreamWs.ts.
      let closed = false;
      let cleanup: () => void = () => undefined;
      const onClose = () => {
        closed = true;
        cleanup();
      };
      ws.on('close', onClose);
      ws.on('error', onClose);

      let actorId: string;
      try {
        ({ actorId } = await deps.redeem(parsed.ticket, parsed.udid));
      } catch {
        try {
          ws.close(1008, 'unauthorized');
        } catch {
          /* noop */
        }
        return;
      }
      if (closed) return; // disconnected during redeem

      let allowed: boolean;
      try {
        allowed = await deps.authorize(parsed.udid, actorId);
      } catch (e: any) {
        // Ownership could not be determined — fail closed, exactly as
        // deviceAccessGuard does when its own lookups throw (503 there; here
        // there is no HTTP response to shape, so 1011 "server error" is the
        // WS analogue). Never fall through to allow.
        log.error(`[${parsed.udid}] logcat WS authorize failed: ${e?.message ?? e}`);
        try {
          ws.close(1011, 'ownership unavailable');
        } catch {
          /* noop */
        }
        return;
      }
      if (!allowed) {
        log.warn(`[${parsed.udid}] logcat WS denied: actor ${actorId} does not hold this device`);
        try {
          ws.close(1008, 'device held by another user');
        } catch {
          /* noop */
        }
        return;
      }
      if (closed) return; // disconnected during authorize

      let mux: LogcatMultiplexer;
      try {
        mux = await deps.startStream(parsed.udid);
      } catch (e: any) {
        log.warn(`[${parsed.udid}] logcat WS start failed: ${e?.message ?? e}`);
        try {
          ws.close(1011, 'stream failed');
        } catch {
          /* noop */
        }
        return;
      }
      if (closed) return; // disconnected during startStream

      // Shadow the multiplexer's own per-client drop count. The mux only
      // reports "N lines dropped" on the next record THIS client accepts
      // (LogcatMultiplexer.push) — a client that disconnects while backed up
      // never gets one more accepted record to carry that marker, so its
      // final gap would otherwise vanish with no record of it anywhere. This
      // counter is incremented under exactly the same two conditions the mux
      // itself counts a drop (a refused canAccept(), or a failed send), so it
      // stays in lockstep with the mux's real internal count, and is logged
      // server-side on teardown since there is no client left to show it to.
      let pendingDrops = 0;
      const canAccept = (): boolean => {
        const ok = ws.bufferedAmount < maxBuffered;
        if (!ok) pendingDrops += 1;
        return ok;
      };
      const send = (r: LogcatRecord): void => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send(JSON.stringify(r));
          pendingDrops = 0;
        } catch {
          // A send that throws is a sink the multiplexer will otherwise keep
          // fanning records into forever — it only counts a throw as a drop
          // and moves on, it never evicts. Force the socket closed so the
          // close/error listeners above fire and this client is actually
          // removed.
          pendingDrops += 1;
          try {
            ws.terminate();
          } catch {
            /* already gone */
          }
        }
      };

      const remove = mux.addClient(send, canAccept);
      cleanup = () => {
        remove();
        if (pendingDrops > 0) {
          log.warn(
            `[${parsed.udid}] logcat WS client disconnected with ${pendingDrops} line(s) dropped and never delivered`,
          );
        }
      };
      log.info(`[${parsed.udid}] logcat WS client connected`);
    });
  });
}
