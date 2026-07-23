import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import log from '../../logger';
import type { H264Packet } from '../../device-managers/android/H264Multiplexer';
import type { H264Multiplexer } from '../../device-managers/android/H264Multiplexer';

/**
 * Authenticated H.264 video WebSocket.
 *
 * Wire format (binary): `[1 byte type][8 bytes LE double ptsMs][H.264 Annex-B]`
 * where type is 0=config, 1=key, 2=delta. The browser player configures its
 * WebCodecs decoder from the SPS/PPS in the `config` frame, then decodes key/
 * delta frames.
 */
const TYPE_CODE: Record<H264Packet['type'], number> = { config: 0, key: 1, delta: 2 };

export function encodeWsFrame(p: H264Packet): Buffer {
  const header = Buffer.alloc(9);
  header.writeUInt8(TYPE_CODE[p.type], 0);
  header.writeDoubleLE(p.ptsMs, 1);
  return Buffer.concat([header, p.data]);
}

const H264_PATH_RE = /^\/xenon\/api\/control\/([^/]+)\/stream\/h264$/;

/** Parse the h264 stream upgrade path; returns null for any non-matching URL. */
export function parseH264WsPath(url: string): { udid: string; ticket: string } | null {
  const [pathname, query = ''] = url.split('?');
  const m = H264_PATH_RE.exec(pathname);
  if (!m) return null;
  const ticket = new URLSearchParams(query).get('ticket');
  if (!ticket) return null;
  return { udid: decodeURIComponent(m[1]), ticket };
}

export interface H264WsDeps {
  /** Redeem a single-use stream ticket; throws if invalid. */
  redeem: (ticket: string, udid: string) => Promise<{ actorId: string }>;
  /** Start (or reuse) the device's H.264 stream and return its multiplexer. */
  startStream: (udid: string) => Promise<H264Multiplexer>;
  /** Drop a frame when the socket's kernel backlog exceeds this (OOM guard). */
  maxBufferedBytes?: number;
}

/**
 * Attach the h264 WebSocket upgrade handler to the plugin's HTTP server. Only
 * claims `/xenon/api/control/:udid/stream/h264` — other upgrades (e.g.
 * socket.io) are left for their own listeners. Every connection must redeem a
 * valid stream ticket before any video flows.
 */
export function attachH264Ws(server: Server, deps: H264WsDeps): void {
  const wss = new WebSocketServer({ noServer: true });
  const maxBuffered = deps.maxBufferedBytes ?? 4 * 1024 * 1024;

  server.on('upgrade', (req, socket, head) => {
    const parsed = req.url ? parseH264WsPath(req.url) : null;
    if (!parsed) return; // not our path — let other upgrade listeners handle it

    wss.handleUpgrade(req, socket as any, head, async (ws) => {
      try {
        await deps.redeem(parsed.ticket, parsed.udid);
      } catch {
        try {
          ws.close(1008, 'unauthorized');
        } catch {
          /* noop */
        }
        return;
      }

      let remove = () => undefined as void;
      try {
        const mux = await deps.startStream(parsed.udid);
        remove = mux.addClient((p) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          // Backpressure: drop frames instead of buffering unboundedly. A brief
          // drop self-heals at the next keyframe (delta gaps recover on the GOP).
          if (ws.bufferedAmount > maxBuffered) return;
          ws.send(encodeWsFrame(p));
        });
        log.info(`[${parsed.udid}] H.264 WS client connected`);
      } catch (e: any) {
        log.warn(`[${parsed.udid}] H.264 WS start failed: ${e.message}`);
        try {
          ws.close(1011, 'stream failed');
        } catch {
          /* noop */
        }
        return;
      }

      ws.on('close', () => remove());
      ws.on('error', () => remove());
    });
  });
}
