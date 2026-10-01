import http from 'http';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import log from '../../logger';
import { HUB_TOKEN_HEADER, HubSessionTokenIssuer } from '../../gateway/hubSessionToken';
import { sendToNode } from '../../gateway/forwardToNode';
import { isOtherServersPhone, safeNodeOrigin } from '../../app/routers/nodePhoneControl';
import {
  findControlDeviceInStore,
  type ControlDevice,
  type FindControlDevice,
} from '../../middleware/controlDevice';

const relayLog = log.scope('NodeRecordingSource');

/**
 * Where a recording reads a phone that isn't this server's: a loopback port,
 * as for its own phones (their MJPEG servers), closed when the recording ends.
 */
export interface RecordingSource {
  port: number;
  close(): Promise<void>;
}

interface ControlGrant {
  userId: string;
  isAdmin: boolean;
  udid: string;
  host: string;
}

export interface NodeRecordingDeps {
  findDevice?: FindControlDevice;
  controlToken?: (grant: ControlGrant) => Promise<string | null>;
}

const defaultControlToken = (grant: ControlGrant) =>
  Container.get(HubSessionTokenIssuer).controlTokenFor(grant);

/**
 * A node's phone, recorded on this server: a loopback server whose every
 * connection gets the node's MJPEG stream (`GET /control/<udid>/stream`),
 * signed afresh for the recording's user. ffmpeg reads it like one of this
 * server's own phones, and reconnects on any hiccup; the hub's control token
 * lasts a minute and a recording much longer, so each connection signs again.
 * The node counts the connection as a viewer, so its idle release leaves the
 * stream running for as long as the recording reads it. Loopback only, like
 * this server's own phones' MJPEG servers.
 */
export async function openNodeMjpegRelay(
  target: { udid: string; host: string; actorId: string },
  deps: NodeRecordingDeps = {},
): Promise<RecordingSource> {
  const { udid, host, actorId } = target;
  const origin = safeNodeOrigin(host);
  if (!origin) throw new Error(`Unsafe device host for ${udid}`);
  const controlToken = deps.controlToken ?? defaultControlToken;
  const url = `${origin}/xenon/api/control/${encodeURIComponent(udid)}/stream`;

  const server = http.createServer(async (_req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const token = await controlToken({ userId: actorId, isAdmin: false, udid, host });
      const upstream = await sendToNode({
        url,
        method: 'GET',
        headers: {
          accept: '*/*',
          'accept-encoding': 'identity',
          ...(token ? { [HUB_TOKEN_HEADER]: token } : {}),
        },
        signal: controller.signal,
      });
      const type = upstream.headers['content-type'];
      res.writeHead(upstream.statusCode ?? 502, {
        ...(type ? { 'content-type': type } : {}),
        'cache-control': 'no-cache',
      });
      upstream.on('error', () => res.destroy());
      upstream.pipe(res);
    } catch (err: any) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      relayLog.warn(`[${udid}] node ${origin} stream unavailable: ${err?.message ?? err}`);
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`node unreachable: ${err?.code ?? err?.message ?? err}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  relayLog.info(`[${udid}] recording relay for node ${origin} on 127.0.0.1:${port}`);
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/**
 * The recording source for a phone: a relay to its node for another server's
 * phone, null for this server's own (or an unknown) phone, which the caller
 * reads locally as before. A cloud provider's phone can't be recorded here.
 */
export async function recordingSourceFor(
  udid: string,
  actorId: string,
  deps: NodeRecordingDeps = {},
): Promise<RecordingSource | null> {
  const findDevice = deps.findDevice ?? findControlDeviceInStore;
  const device: ControlDevice | null | undefined = await findDevice(udid);
  if (!device || !isOtherServersPhone(device)) return null;
  if (device.cloud) {
    throw new Error(`${udid} is a cloud provider's phone and can't be recorded here.`);
  }
  return openNodeMjpegRelay({ udid, host: device.host as string, actorId }, deps);
}
