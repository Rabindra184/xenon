import type { NextFunction, Request, Response } from 'express';
import type { OutgoingHttpHeaders } from 'http';
import { Container } from 'typedi';
import log from '../../logger';
import { PluginContext } from '../../PluginContext';
import { isOwnDevice, localDeviceHosts } from '../../device-managers/localDeviceHosts';
import { resolveActor } from '../../services/device-access/actor';
import { HUB_TOKEN_HEADER, HubSessionTokenIssuer } from '../../gateway/hubSessionToken';
import { relayAnswer, sendToNode } from '../../gateway/forwardToNode';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { ownershipUnavailableBody } from '../../services/device-access/deviceAccessPolicy';
import {
  controlAction,
  findControlDeviceInStore,
  lookupControlDevice,
  readControlUdid,
  type ControlDevice,
  type FindControlDevice,
} from '../../middleware/controlDevice';

/**
 * /control on another server's phone: a node's, or a cloud provider's.
 *
 * The handlers in control.ts act on this server's own phones, with this
 * server's adb and go-ios. On a hub they used to run for a node's phone too,
 * against a phone the hub doesn't have: only five actions were sent on to the
 * node. This sits after the team and ownership guards and decides every
 * request for another server's phone before any handler runs, so an action
 * added later is refused for it until someone puts it on a list below.
 */

/**
 * Sent on to the phone's node, and the node's answer relayed unchanged. Each
 * is about the phone alone. The preview's are too: the node holds the phone
 * for the preview, counts its viewers and releases it, by its own rules and
 * with the hub's user, so none of that is kept here.
 */
export const NODE_FORWARDED_CONTROL: readonly string[] = [
  'POST tap',
  'POST swipe',
  'POST text',
  'POST keyevent',
  'POST touchandhold',
  'GET screenshot',
  'GET clipboard',
  'POST clipboard',
  'POST lock',
  'POST unlock',
  'GET display',
  'POST uninstall',
  'GET apps',
  'GET logs',
  'POST shell',
  'GET inspector/snapshot',
  'POST stream/start',
  'GET stream/status',
  'POST stream/leave',
  'POST stream/stop',
  // The MJPEG stream itself: relayed for as long as the viewer watches.
  'GET stream',
];

/**
 * Answered by this server's own handler.
 * - appium-session: the session runs through this server, which routes its
 *   commands, so its id and base path are this server's.
 * - stream/ticket: the viewer's ticket is this server's, minted after its
 *   team check. The stream it opens is relayed from the node: GET stream
 *   above, and the H.264 and logcat sockets (src/app/ws/nodeSocketRelay.ts),
 *   which get a ticket of the node's own.
 */
export const ANSWERED_HERE: readonly string[] = ['GET appium-session', 'POST stream/ticket'];

// Not on either list, and why, so nobody adds them as a plain forward:
// - upload-install is a multipart upload;
// - install-repository-app installs a file from this server's app library,
//   which the node doesn't have;
// - install takes a path, which names a file on one machine only;
// - omni-scan and test-locator run this server's AI settings on a
//   screenshot.

/**
 * A node that hasn't started answering in this long is treated as gone. Once
 * it has, the answer may take as long as it takes: a stream lasts as long as
 * its viewer.
 */
export const NODE_CONTROL_TIMEOUT_MS = 60_000;

// Cloud metadata endpoints — never proxy to these regardless of caller.
const FORBIDDEN_PROXY_HOSTS = new Set([
  '169.254.169.254', // AWS/Azure/GCP IMDS
  'metadata.google.internal',
  'metadata.goog',
  '100.100.100.200', // Alibaba ECS metadata
  'fd00:ec2::254', // AWS IMDSv6
]);

/**
 * The node's origin from the phone's reported host: scheme, host and port
 * only, dropping any path, query or fragment the host string carried. Null
 * for a cloud-metadata target or a scheme other than http(s).
 */
export function safeNodeOrigin(deviceHost: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(deviceHost);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (FORBIDDEN_PROXY_HOSTS.has(parsed.hostname)) return null;
  return `${parsed.protocol}//${parsed.host}`;
}

/** The node's own URL for this request, or null if the host is unsafe. */
export function nodeControlUrl(deviceHost: string, req: Request): string | null {
  const origin = safeNodeOrigin(deviceHost);
  if (!origin) return null;
  const forwardPath = req.originalUrl.startsWith('/') ? req.originalUrl : `/${req.originalUrl}`;
  return `${origin}${withoutTicket(forwardPath)}`;
}

/**
 * The path without a `ticket` query parameter. A viewer's ticket is this
 * server's, already spent here, and not the node's business: the node gets
 * the hub's token instead.
 */
function withoutTicket(path: string): string {
  const q = path.indexOf('?');
  if (q < 0) return path;
  const params = new URLSearchParams(path.slice(q + 1));
  if (!params.has('ticket')) return path;
  params.delete('ticket');
  const query = params.toString();
  return query ? `${path.slice(0, q)}?${query}` : path.slice(0, q);
}

/**
 * A phone another server drives. Decided by the phone's own row (its nodeId,
 * else its exact host against this server's own hosts), never by the Host
 * header the caller used: a substring match on that header forwarded a lab's
 * own phone back to itself, with no login, whenever the lab was reached as
 * `localhost`.
 */
export function isOtherServersPhone(device: ControlDevice): boolean {
  if (!device.host) return false;
  const context = Container.get(PluginContext);
  return !isOwnDevice(localDeviceHosts(context.pluginArgs, context.port), context.nodeId, device);
}

function originOf(host: string): string {
  try {
    return new URL(host).origin;
  } catch {
    return host;
  }
}

function refuse(res: Response, error: string, message: string) {
  return res.status(501).json({ success: false, error, message });
}

export interface NodePhoneControlDeps {
  findDevice?: FindControlDevice;
  timeoutMs?: number;
  markNodeBusy?: (udid: string, host: string) => Promise<void>;
}

export function nodePhoneControl(deps: NodePhoneControlDeps = {}) {
  const findDevice = deps.findDevice ?? findControlDeviceInStore;
  const timeoutMs = deps.timeoutMs ?? NODE_CONTROL_TIMEOUT_MS;
  const markNodeBusy =
    deps.markNodeBusy ??
    ((udid: string, host: string) => DeviceStoreFactory.getStore().markNodeBusy(udid, host));

  return async function (req: Request, res: Response, next: NextFunction) {
    const action = controlAction(req);
    if (!action) return next();
    const udid = readControlUdid(req, res, 'nodePhoneControl');
    if (udid === null) return;
    if (!udid) return next();

    // The guards' memoized lookup: usually no query of its own.
    let device: ControlDevice | null | undefined;
    try {
      device = await lookupControlDevice(res, udid, findDevice);
    } catch (e: any) {
      // Falling through would let the handler, with its own lookup, run a
      // node's phone here: fail closed.
      // Answered as every /control lookup failure is.
      log.error(`nodePhoneControl: device lookup failed for ${udid}: ${e?.message ?? e}`);
      return res.status(503).json(ownershipUnavailableBody());
    }
    if (!device || !isOtherServersPhone(device)) return next();

    const key = `${req.method} ${action}`;
    if (ANSWERED_HERE.includes(key)) return next();
    if (device.cloud) {
      return refuse(
        res,
        'not_available_for_cloud_phone',
        "This phone is a cloud provider's. Device control isn't available for it here.",
      );
    }
    const node = originOf(device.host as string);
    if (!NODE_FORWARDED_CONTROL.includes(key)) {
      return refuse(
        res,
        'not_available_through_hub',
        `This phone is on node ${node}, and the hub doesn't pass ${action} on to nodes yet.`,
      );
    }
    return forward(req, res, { udid, device, node, timeoutMs, markNodeBusy });
  };
}

/**
 * Send the request to the phone's node, signed for the caller: the hub's
 * control token (hubSessionToken.ts) names the user, whether they are an
 * admin, the phone and its node. This hub already checked them (the guards
 * before this); a node with auth enabled accepts the token for /control on
 * that phone and runs its own ownership guard with that user. None of the
 * caller's own headers go: its credentials were checked here and are not the
 * node's business. Sent once: a retry after a slow node's timeout or 5xx
 * could land the same tap twice.
 */
interface ForwardTarget {
  udid: string;
  device: ControlDevice;
  node: string;
  timeoutMs: number;
  markNodeBusy: (udid: string, host: string) => Promise<void>;
}

async function forward(req: Request, res: Response, target: ForwardTarget) {
  const { udid, device, node, timeoutMs } = target;
  const url = nodeControlUrl(device.host as string, req);
  if (!url) return res.status(400).json({ error: 'Unsafe device host' });

  const actor = resolveActor(req);
  const headers: OutgoingHttpHeaders = {
    accept: req.headers.accept ?? 'application/json',
    'accept-encoding': 'identity',
  };
  // Null when this server can't sign (it warns once): the call goes without,
  // which a node with auth disabled accepts and one with auth enabled refuses.
  const token = actor.userId
    ? await Container.get(HubSessionTokenIssuer).controlTokenFor({
        userId: actor.userId,
        isAdmin: actor.isAdmin,
        udid,
        host: device.host as string,
      })
    : null;
  if (token) headers[HUB_TOKEN_HEADER] = token;
  let body: Buffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = Buffer.from(JSON.stringify(req.body ?? {}));
    headers['content-type'] = 'application/json';
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  // The caller left: stop waiting for the node on their behalf.
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.on('close', onClose);

  log.debug(`Forwarding ${req.method} ${controlAction(req)} for ${udid} to node ${node}`);
  try {
    const upstream = await sendToNode({
      url,
      method: req.method,
      headers,
      body,
      signal: controller.signal,
    });
    // The node has answered: from here the answer takes as long as it takes.
    clearTimeout(timer);
    const status = upstream.statusCode ?? 502;
    if (req.method === 'POST' && controlAction(req) === 'stream/start' && status < 300) {
      // The node holds the phone for the preview now, and says so in its
      // next report, up to an interval away. Until then this server could
      // hand the phone to a session the node would refuse.
      await target.markNodeBusy(udid, device.host as string).catch((e: any) => {
        log.warn(`nodePhoneControl: could not mark ${udid} busy for its node: ${e?.message ?? e}`);
      });
    }
    await relayAnswer(upstream, res, false);
  } catch (e: any) {
    if (res.headersSent || res.destroyed) {
      res.destroy();
    } else if (timedOut) {
      res.status(504).json({
        success: false,
        error: 'node_timeout',
        message: `Node ${node} didn't answer within ${Math.round(timeoutMs / 1000)} s.`,
      });
    } else {
      log.warn(`nodePhoneControl: node ${node} unreachable for ${udid}: ${e?.message ?? e}`);
      res.status(502).json({
        success: false,
        error: 'node_unreachable',
        message: `Xenon could not reach node ${node} for this phone: ${e?.code ?? e?.message ?? e}`,
      });
    }
  } finally {
    clearTimeout(timer);
    res.off('close', onClose);
  }
}
