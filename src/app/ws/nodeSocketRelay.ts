import { Container } from 'typedi';
import { WebSocket } from 'ws';
import log from '../../logger';
import { HUB_TOKEN_HEADER, HubSessionTokenIssuer } from '../../gateway/hubSessionToken';
import { readAnswer, sendToNode } from '../../gateway/forwardToNode';
import {
  findControlDeviceInStore,
  type ControlDevice,
  type FindControlDevice,
} from '../../middleware/controlDevice';
import { isOtherServersPhone, safeNodeOrigin } from '../routers/nodePhoneControl';

/**
 * The live preview's H.264 socket and the logcat socket, for another server's
 * phone. The viewer's ticket is this server's (stream/ticket is answered
 * here, after the team check) and is redeemed here; the socket itself is the
 * node's, opened with a ticket the node mints for the same user, and relayed.
 * The node keeps doing what it does for its own viewers: the multiplexer,
 * the replay, the slow-viewer drops and the idle release.
 */

/** The node, or this server's own rule, refused: the viewer gets 1008. */
export class NodeSocketRefused extends Error {}

/** How long the node has to mint its ticket and open its socket. */
export const NODE_SOCKET_TIMEOUT_MS = 15_000;

/** Unwritten bytes to the viewer beyond which reading from the node pauses. */
export const RELAY_HIGH_WATER_BYTES = 4 * 1024 * 1024;

export interface NodeSocketRequest {
  udid: string;
  /** The redeemed ticket's user, signed into the node's control token. */
  actor: { actorId: string; isAdmin?: boolean };
  path: 'stream/h264' | 'logcat';
  /** Passed to the node's socket as they came (logcat's levels and process). */
  query?: URLSearchParams;
}

export interface NodeSocketDeps {
  findDevice?: FindControlDevice;
  controlToken?: (grant: {
    userId: string;
    isAdmin: boolean;
    udid: string;
    host: string;
  }) => Promise<string | null>;
  timeoutMs?: number;
}

/**
 * The node's socket for another server's phone, open and paused until
 * relaySocket reads it; null for this server's own phone, which the caller
 * serves itself. Throws NodeSocketRefused when the phone is a cloud
 * provider's or the node refuses the user, and any other error when the node
 * can't be reached.
 */
export async function openNodeSocket(
  request: NodeSocketRequest,
  deps: NodeSocketDeps = {},
): Promise<WebSocket | null> {
  const findDevice = deps.findDevice ?? findControlDeviceInStore;
  const controlToken =
    deps.controlToken ?? ((grant) => Container.get(HubSessionTokenIssuer).controlTokenFor(grant));
  const timeoutMs = deps.timeoutMs ?? NODE_SOCKET_TIMEOUT_MS;
  const { udid, actor, path } = request;

  const device: ControlDevice | null | undefined = await findDevice(udid);
  if (!device || !isOtherServersPhone(device)) return null;
  if (device.cloud) throw new NodeSocketRefused("a cloud provider's phone");
  const origin = safeNodeOrigin(device.host as string);
  if (!origin) throw new NodeSocketRefused('unsafe device host');

  const token = await controlToken({
    userId: actor.actorId,
    isAdmin: !!actor.isAdmin,
    udid,
    host: device.host as string,
  });
  const base = `/xenon/api/control/${encodeURIComponent(udid)}`;
  const answer = await readAnswer(
    await sendToNode({
      url: `${origin}${base}/stream/ticket`,
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(token ? { [HUB_TOKEN_HEADER]: token } : {}),
      },
      body: Buffer.from('{}'),
      signal: AbortSignal.timeout(timeoutMs),
    }),
  );
  if (answer.status >= 400 && answer.status < 500) {
    throw new NodeSocketRefused(`the node answered ${answer.status} for a ticket`);
  }
  if (answer.status >= 300) throw new Error(`the node answered ${answer.status} for a ticket`);
  const ticket = JSON.parse(answer.body.toString('utf8'))?.ticket;
  if (typeof ticket !== 'string') throw new Error('the node sent no ticket');

  const query = new URLSearchParams(request.query);
  query.set('ticket', ticket);
  const url = `${origin.replace(/^http/, 'ws')}${base}/${path}?${query}`;
  const socket = new WebSocket(url, { handshakeTimeout: timeoutMs, perMessageDeflate: false });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => {
      // Paused until something reads it: the node sends H.264's config
      // packet and logcat's replay as soon as it opens, and a message with
      // no listener yet is lost. relaySocket resumes it.
      socket.pause();
      resolve();
    });
    socket.once('error', reject);
  });
  log.info(`[${udid}] ${path} socket opened on node ${origin}`);
  return socket;
}

/** A close code a server may send. 1005, 1006 and 1015 only describe a close. */
function isSendable(code: number): boolean {
  return (
    (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
    (code >= 3000 && code <= 4999)
  );
}

function closeWith(ws: WebSocket, code: number, reason: Buffer): void {
  if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) return;
  try {
    if (code === 1005) ws.close();
    // The node's connection dropped with no close: the viewer retries.
    else if (!isSendable(code)) ws.close(1011, 'node connection lost');
    else ws.close(code, reason.toString());
  } catch {
    ws.terminate();
  }
}

/**
 * Relay `viewer` to and from `node` until either closes. Messages pass
 * unchanged, binary or text as they came, and the node's close code and
 * reason reach the viewer. While more than `highWaterBytes` sent to the
 * viewer are still unwritten, reading from the node pauses: the node then
 * sees a slow viewer and applies its own rule, rather than this server
 * buffering without bound.
 */
export function relaySocket(
  viewer: WebSocket,
  node: WebSocket,
  highWaterBytes = RELAY_HIGH_WATER_BYTES,
): void {
  let unwritten = 0;
  let paused = false;

  node.on('message', (data, isBinary) => {
    if (viewer.readyState !== WebSocket.OPEN) return;
    const size = (data as Buffer).length;
    unwritten += size;
    viewer.send(data, { binary: isBinary }, () => {
      unwritten -= size;
      if (paused && unwritten <= highWaterBytes / 2) {
        paused = false;
        node.resume();
      }
    });
    if (!paused && unwritten > highWaterBytes) {
      paused = true;
      node.pause();
    }
  });
  viewer.on('message', (data, isBinary) => {
    if (node.readyState === WebSocket.OPEN) node.send(data, { binary: isBinary });
  });

  node.on('close', (code: number, reason: Buffer) => closeWith(viewer, code, reason));
  viewer.on('close', () => {
    if (node.readyState === WebSocket.OPEN || node.readyState === WebSocket.CONNECTING) {
      node.close(1000);
    }
  });
  // A 'close' follows each; nothing more to do here.
  node.on('error', () => undefined);
  viewer.on('error', () => undefined);
  // openNodeSocket hands the node's socket over paused; read it now.
  node.resume();
}
