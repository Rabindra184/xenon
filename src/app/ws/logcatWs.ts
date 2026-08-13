import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import log from '../../logger';
import type { LogcatMultiplexer } from '../../device-managers/android/LogcatMultiplexer';
import type { LogcatRecord } from '../../services/logcat/logcatParse';
import { iosLevelsToLetters } from '../../services/logcat/ostraceParse';

const LOGCAT_PATH_RE = /^\/xenon\/api\/control\/([^/]+)\/logcat$/;

/** What the client asked to stream, beyond which device. */
export interface LogStreamFilter {
  /** os_log level names (iOS only). Ignored on Android, which filters client-side. */
  levels?: string[];
  /** Process name (iOS only), so an app's own logs can be selected at the source. */
  process?: string;
}

/** Parse the logcat stream upgrade path; returns null for any non-matching URL. */
export function parseLogcatWsPath(
  url: string,
): ({ udid: string; ticket: string } & LogStreamFilter) | null {
  const [pathname, query = ''] = url.split('?');
  const m = LOGCAT_PATH_RE.exec(pathname);
  if (!m) return null;
  const params = new URLSearchParams(query);
  const ticket = params.get('ticket');
  if (!ticket) return null;

  // iOS streams are filtered at the source because the unfiltered firehose is
  // 5,485 lines/sec; Android streams everything and filters in the browser.
  // Both arrive here, and the service for the device's platform decides which
  // of these it can honour.
  const levels = (params.get('levels') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const process = params.get('process')?.trim() || undefined;

  return {
    udid: decodeURIComponent(m[1]),
    ticket,
    ...(levels.length ? { levels } : {}),
    ...(process ? { process } : {}),
  };
}

/**
 * Who the redeemed ticket says is calling. Structurally the ticket service's
 * `StreamTicketActor`; declared here so this module stays injectable and does
 * not import the token service.
 */
export interface LogcatWsActor {
  actorId: string;
  isAdmin?: boolean;
  apiKeyId?: string;
}

export interface LogcatWsDeps {
  /** Redeem a single-use stream ticket; throws if invalid. */
  redeem: (ticket: string, udid: string) => Promise<LogcatWsActor>;
  /**
   * Resolve the ownership decision for this actor + device — the same policy
   * `deviceAccessGuard` evaluates for REST reads/mutations. Throws on lookup
   * failure (never resolves `false` for "I don't know"): device logs carry
   * auth tokens and PII, so an undetermined owner must fail closed like every
   * other consumer of `evaluateDeviceAccess`.
   *
   * Takes the whole actor, not just its id: the admin flag and the api-key id
   * are part of the same decision (admin bypass, and recognising a pre-1.13.0
   * `manual_<apiKeyId>_<udid>` lock as the caller's own).
   */
  authorize: (udid: string, actor: LogcatWsActor) => Promise<boolean>;
  /**
   * Start (or reuse) the device's log stream.
   *
   * Returns the multiplexer plus the levels THIS client should see. The second
   * half matters because the multiplexer is shared: on iOS one child serves
   * every viewer and emits the union of what they asked for, so a client that
   * requested less must be narrowed here or it silently inherits another
   * viewer's Debug. Android returns no levels and is filtered in the browser,
   * as it always has been.
   */
  startStream: (
    udid: string,
    filter: LogStreamFilter,
  ) => Promise<{ mux: LogcatMultiplexer; levels?: string[] }>;
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

      let actor: LogcatWsActor;
      try {
        actor = await deps.redeem(parsed.ticket, parsed.udid);
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
        allowed = await deps.authorize(parsed.udid, actor);
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
        // Two different reasons collapse into this one boolean:
        // makeTicketActorAuthorizer denies both a device the store cannot
        // resolve at all (reaped by removeStaleDevices, or not yet seen by
        // the next discovery poll) and a device genuinely held by someone
        // else — `authorize` has no way to tell this layer which. But
        // evaluateDeviceAccess's *first* check unconditionally allows an
        // admin, before it ever looks at who holds the device — so a known,
        // busy device can never deny an admin actor. An admin who still
        // lands here can only be here because the device itself is
        // unresolvable: "held by another user" is a guaranteed lie for an
        // admin, which is exactly the diagnosability bug this branch used to
        // have (an admin hitting a transiently-lost device was told someone
        // else had it). For a non-admin actor a real conflict is possible, so
        // the generic reason stays accurate there and is left alone.
        const unresolvable = !!actor.isAdmin;
        log.warn(
          `[${parsed.udid}] logcat WS denied: actor ${actor.actorId} ${
            unresolvable ? 'device is unresolvable by the store' : 'does not hold this device'
          }`,
        );
        try {
          ws.close(1008, unresolvable ? 'device not found' : 'device held by another user');
        } catch {
          /* noop */
        }
        return;
      }
      if (closed) return; // disconnected during authorize

      let mux: LogcatMultiplexer;
      let effectiveLevels: string[] | undefined;
      try {
        const started = await deps.startStream(parsed.udid, {
          levels: parsed.levels,
          process: parsed.process,
        });
        mux = started.mux;
        effectiveLevels = started.levels;
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
      // final gap would otherwise vanish with no record of it anywhere. It is
      // logged server-side on teardown, since there is no client left to show
      // it to.
      //
      // It counts every record this sink loses, which is a strict superset of
      // what the mux counts:
      //   1. canAccept() refuses — the mux counts this too;
      //   2. send() throws — the mux counts this too;
      //   3. send() is called on a socket that is no longer OPEN. `ws`
      //      swallows that silently (no throw, no 'error' event — it just
      //      charges the bytes to bufferedAmount), so the mux believes the
      //      record was delivered and this layer is the only place the loss
      //      can be recorded. Only reachable from the replay burst in
      //      addClient, which does not consult canAccept, and from a push
      //      landing after a server-initiated close() has moved the socket to
      //      CLOSING but before its 'close' event fires.
      // Because canAccept() also refuses a non-OPEN socket, case 3 can never
      // be reached through push()'s normal path — a drop there is counted on
      // both sides, in lockstep.
      let pendingDrops = 0;
      const canAccept = (): boolean => {
        const ok = ws.readyState === WebSocket.OPEN && ws.bufferedAmount < maxBuffered;
        if (!ok) pendingDrops += 1;
        return ok;
      };
      // This socket's own slice of a stream shared with every other viewer of
      // the device. It cannot be applied upstream: os_trace_relay serves one
      // consumer, so a second child spawned to satisfy a second filter
      // silences both — measured, three concurrent readers and all of them
      // mute. The child therefore emits a superset and each socket narrows it
      // here.
      //
      // Android sends neither field and is unaffected: it streams everything
      // and filters in the browser, as it always has.
      // The levels the stream decided this client gets — which is what it
      // asked for, or the platform's default when it asked for nothing. Using
      // the raw request here instead would leave a client that named no levels
      // unfiltered, and therefore showing another viewer's Debug.
      const allowedLevels = effectiveLevels?.length
        ? iosLevelsToLetters(effectiveLevels)
        : undefined;
      const wanted = (r: LogcatRecord): boolean => {
        // Dropped-line and end-of-stream markers are always shown, for the
        // same reason the browser-side filter always shows them: a reader
        // narrowed to one app still needs to know records went missing.
        if (r.synthetic) return true;
        if (parsed.process && r.pkg !== parsed.process) return false;
        if (allowedLevels && !allowedLevels.has(r.level)) return false;
        return true;
      };

      const send = (r: LogcatRecord): void => {
        // Not for this client — not a drop. Counting it would report a gap
        // that never existed.
        if (!wanted(r)) return;
        if (ws.readyState !== WebSocket.OPEN) {
          pendingDrops += 1;
          return;
        }
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

      // The third argument is not optional in practice: when `adb logcat`
      // exits (or stop() is called) LogcatStreamService pushes its synthetic
      // "log stream ended" record and then drops the multiplexer, which
      // detaches every client. Without an onClose the browser socket stays
      // OPEN, attached to nothing — the mux simply stops calling send(), and
      // "not being called" is not a signal a browser can observe. The tab sits
      // on a frozen buffer, still badged LIVE, and the client's
      // reconnect-on-unexpected-close never fires because there is no close.
      // One leaked socket per dead stream.
      //
      // 1012 (service restart) rather than 1011: the upstream ending is not an
      // error — an operator stop() takes this path too — and it tells the
      // client to come back, which is exactly right since the next connect
      // spawns a fresh logcat.
      const remove = mux.addClient(send, canAccept, () => {
        try {
          ws.close(1012, 'stream ended');
        } catch {
          /* already gone */
        }
      });
      let cleanedUp = false;
      cleanup = () => {
        // 'close' and 'error' can both fire for one socket. remove() is
        // idempotent, but the warn below is not — without this guard a single
        // disconnect reports its drop count twice.
        if (cleanedUp) return;
        cleanedUp = true;
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
