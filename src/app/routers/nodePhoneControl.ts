import type { NextFunction, Request, Response } from 'express';
import type { IncomingMessage, OutgoingHttpHeaders } from 'http';
import { randomBytes } from 'crypto';
import fs from 'fs';
import { Readable } from 'stream';
import { Container } from 'typedi';
import log from '../../logger';
import { PluginContext } from '../../PluginContext';
import { isOwnDevice, localDeviceHosts } from '../../device-managers/localDeviceHosts';
import { resolveActor } from '../../services/device-access/actor';
import { HUB_TOKEN_HEADER, HubSessionTokenIssuer } from '../../gateway/hubSessionToken';
import {
  readAnswer,
  relayAnswer,
  sendAnswer,
  sendToNode,
  type NodeAnswer,
} from '../../gateway/forwardToNode';
import { formatManualLock } from '../../services/recording/manualLock';
import { SessionOwnerResolver } from '../../services/device-access/SessionOwnerResolver';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { RecordingStore } from '../../services/recording/recording-store';
import {
  denyBody,
  ownershipUnavailableBody,
} from '../../services/device-access/deviceAccessPolicy';
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
  // The upload is streamed on as it came: nothing here reads it first.
  'POST upload-install',
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

/**
 * Answered by this server's own handler for a node's phone (a cloud
 * provider's is refused), which does its part here and asks the node for
 * the rest:
 * - install-repository-app: the app is in this server's library, checked
 *   against the caller's teams here, and sent to the node's upload-install
 *   (installFileOnNode).
 * - omni-scan, test-locator: Omni-Vision runs here, with this server's AI
 *   settings, on the node's screenshot (screenshotFromNode).
 */
export const ANSWERED_HERE_FOR_NODES: readonly string[] = [
  'POST install-repository-app',
  'GET omni-scan',
  'POST test-locator',
];

// Not on any list, so refused: install takes a path, which names a file on
// one machine only.

/**
 * A node that hasn't started answering in this long is treated as gone. Once
 * it has, the answer may take as long as it takes: a stream lasts as long as
 * its viewer.
 */
export const NODE_CONTROL_TIMEOUT_MS = 60_000;

/**
 * An install is answered when it is done, which can take minutes (a large
 * app, a slow phone): its node gets this long to start answering instead.
 */
export const NODE_INSTALL_TIMEOUT_MS = 15 * 60_000;

/** Forwarded actions that are installs, and get NODE_INSTALL_TIMEOUT_MS. */
const INSTALLS: readonly string[] = ['POST upload-install'];

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

interface ControlGrant {
  userId: string;
  isAdmin: boolean;
  udid: string;
  host: string;
}

export interface NodePhoneControlDeps {
  findDevice?: FindControlDevice;
  timeoutMs?: number;
  installTimeoutMs?: number;
  markNodeBusy?: (udid: string, host: string, hold?: string) => Promise<void>;
  /** A user's name, for a node's refusal that names the holder by id only. */
  describeHolder?: (userId: string) => Promise<string | null>;
  controlToken?: (grant: ControlGrant) => Promise<string | null>;
  /** This server's recording of the phone, if one is running. */
  activeRecordingFor?: (udid: string) => Promise<{ groupId: string } | null>;
}

export function nodePhoneControl(deps: NodePhoneControlDeps = {}) {
  const findDevice = deps.findDevice ?? findControlDeviceInStore;
  const activeRecordingFor =
    deps.activeRecordingFor ??
    ((udid: string) => Container.get(RecordingStore).activeRecordingFor(udid));
  const forwardDeps: ForwardDeps = {
    timeoutMs: deps.timeoutMs ?? NODE_CONTROL_TIMEOUT_MS,
    installTimeoutMs: deps.installTimeoutMs ?? NODE_INSTALL_TIMEOUT_MS,
    markNodeBusy:
      deps.markNodeBusy ??
      ((udid, host, hold) => DeviceStoreFactory.getStore().markNodeBusy(udid, host, hold)),
    describeHolder:
      deps.describeHolder ?? ((id) => Container.get(SessionOwnerResolver).displayName(id)),
    controlToken: deps.controlToken ?? defaultControlToken,
  };

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
    if (ANSWERED_HERE_FOR_NODES.includes(key)) return next();
    const node = originOf(device.host as string);
    if (!NODE_FORWARDED_CONTROL.includes(key)) {
      return refuse(
        res,
        'not_available_through_hub',
        `This phone is on node ${node}, and the hub doesn't pass ${action} on to nodes yet.`,
      );
    }
    if (key === 'POST stream/stop') {
      // This server may be recording the phone from the node's stream
      // (nodeRecordingSource.ts). The node doesn't know, and stopping its
      // stream would cut the recording short: refused as /control refuses a
      // stop for its own phones being recorded.
      const recording = await activeRecordingFor(udid).catch((e: any) => {
        log.error(`nodePhoneControl: recording lookup failed for ${udid}: ${e?.message ?? e}`);
        return undefined;
      });
      if (recording === undefined) return res.status(503).json(ownershipUnavailableBody());
      if (recording) {
        return res.status(409).json({
          success: false,
          error: 'device_recording',
          message: 'This device is being recorded. Stop the recording first.',
          groupId: recording.groupId,
        });
      }
    }
    return forward(req, res, { udid, device, node }, forwardDeps);
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
}

type ForwardDeps = Required<
  Pick<
    NodePhoneControlDeps,
    'timeoutMs' | 'installTimeoutMs' | 'markNodeBusy' | 'describeHolder' | 'controlToken'
  >
>;

const defaultControlToken = (grant: ControlGrant) =>
  Container.get(HubSessionTokenIssuer).controlTokenFor(grant);

/**
 * The headers of a call to the phone's node, signed for the caller. Null
 * token when this server can't sign (it warns once): the call goes without,
 * which a node with auth disabled accepts and one with auth enabled refuses.
 */
async function signedHeaders(
  req: Request,
  udid: string,
  device: ControlDevice,
  controlToken: (grant: ControlGrant) => Promise<string | null>,
): Promise<OutgoingHttpHeaders> {
  const actor = resolveActor(req);
  const headers: OutgoingHttpHeaders = {
    accept: req.headers.accept ?? 'application/json',
    'accept-encoding': 'identity',
  };
  const token = actor.userId
    ? await controlToken({
        userId: actor.userId,
        isAdmin: actor.isAdmin,
        udid,
        host: device.host as string,
      })
    : null;
  if (token) headers[HUB_TOKEN_HEADER] = token;
  return headers;
}

interface NodeCall {
  url: string;
  method: string;
  headers: OutgoingHttpHeaders;
  body?: Buffer | Readable;
  /** How long the node has to start answering. */
  timeoutMs: number;
  node: string;
  udid: string;
}

/**
 * Send one call to the node and relay its answer to `res`. A node that can't
 * be reached is 502, and one that hasn't started answering in `timeoutMs` is
 * 504; once it has, the answer takes as long as it takes. `onAnswer` sees the
 * node's answer first and may reply itself (returning true). Sent once: a
 * retry after a slow node's timeout or 5xx could land the same tap twice.
 */
async function relayNodeCall(
  res: Response,
  call: NodeCall,
  onAnswer?: (upstream: IncomingMessage) => Promise<boolean>,
): Promise<void> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, call.timeoutMs);
  // The caller left: stop waiting for the node on their behalf.
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.on('close', onClose);

  try {
    const upstream = await sendToNode({
      url: call.url,
      method: call.method,
      headers: call.headers,
      body: call.body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (onAnswer && (await onAnswer(upstream))) return;
    await relayAnswer(upstream, res, false);
  } catch (e: any) {
    if (res.headersSent || res.destroyed) {
      res.destroy();
    } else if (timedOut) {
      res.status(504).json({
        success: false,
        error: 'node_timeout',
        message: `Node ${call.node} didn't answer within ${Math.round(call.timeoutMs / 1000)} s.`,
      });
    } else {
      log.warn(
        `nodePhoneControl: node ${call.node} unreachable for ${call.udid}: ${e?.message ?? e}`,
      );
      res.status(502).json({
        success: false,
        error: 'node_unreachable',
        message: `Xenon could not reach node ${call.node} for this phone: ${e?.code ?? e?.message ?? e}`,
      });
    }
  } finally {
    clearTimeout(timer);
    res.off('close', onClose);
  }
}

async function forward(req: Request, res: Response, target: ForwardTarget, deps: ForwardDeps) {
  const { udid, device, node } = target;
  const url = nodeControlUrl(device.host as string, req);
  if (!url) return res.status(400).json({ error: 'Unsafe device host' });

  const key = `${req.method} ${controlAction(req)}`;
  const actor = resolveActor(req);
  const headers = await signedHeaders(req, udid, device, deps.controlToken);
  let body: Buffer | Readable | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const type = req.headers['content-type'];
    if (typeof type === 'string' && type.toLowerCase().startsWith('multipart/')) {
      // An upload, streamed on as it came: the route's own parser runs after
      // this, so nothing here has read it.
      body = req;
      headers['content-type'] = type;
      if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
    } else {
      body = Buffer.from(JSON.stringify(req.body ?? {}));
      headers['content-type'] = 'application/json';
    }
  }

  log.debug(`Forwarding ${key} for ${udid} to node ${node}`);
  const timeoutMs = INSTALLS.includes(key) ? deps.installTimeoutMs : deps.timeoutMs;
  await relayNodeCall(
    res,
    { url, method: req.method, headers, body, timeoutMs, node, udid },
    async (upstream) => {
      const status = upstream.statusCode ?? 502;
      if (key === 'POST stream/start' && status < 300) {
        // The node holds the phone for the preview now, and says so in its
        // next report, up to an interval away. Until then this server could
        // hand the phone to a session the node would refuse, and would show
        // no holder. The node writes the same hold for the same user.
        const hold = actor.userId ? formatManualLock(actor.userId, udid) : undefined;
        await deps.markNodeBusy(udid, device.host as string, hold).catch((e: any) => {
          log.warn(
            `nodePhoneControl: could not mark ${udid} busy for its node: ${e?.message ?? e}`,
          );
        });
      }
      if (status === 409) {
        await relayRefusal(await readAnswer(upstream), res, deps.describeHolder);
        return true;
      }
      return false;
    },
  );
}

/**
 * A file as a multipart upload in one field, streamed from disk, with its
 * length known so the node's parser can apply its limit up front.
 */
async function multipartFile(
  field: string,
  file: { path: string; name: string },
): Promise<{ type: string; length: number; stream: Readable }> {
  const boundary = `----xenon-${randomBytes(12).toString('hex')}`;
  const name = file.name.replace(/["\\\r\n]/g, '_');
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${name}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const { size } = await fs.promises.stat(file.path);
  const stream = Readable.from(
    (async function* () {
      yield head;
      yield* fs.createReadStream(file.path);
      yield tail;
    })(),
  );
  return {
    type: `multipart/form-data; boundary=${boundary}`,
    length: head.length + size + tail.length,
    stream,
  };
}

export interface NodeFileDeps {
  controlToken?: (grant: ControlGrant) => Promise<string | null>;
  timeoutMs?: number;
}

/**
 * Install a file of this server's on another server's phone: sent to the
 * node's upload-install as a multipart upload, signed for the caller, and
 * the node's answer relayed. install-repository-app's, for an app from this
 * server's library, which the node doesn't have. The file's name keeps the
 * extension the node's installer reads.
 */
export async function installFileOnNode(
  req: Request,
  res: Response,
  udid: string,
  device: ControlDevice,
  file: { path: string; name: string },
  deps: NodeFileDeps = {},
): Promise<void> {
  const origin = safeNodeOrigin(device.host as string);
  if (!origin) {
    res.status(400).json({ error: 'Unsafe device host' });
    return;
  }
  const headers = await signedHeaders(req, udid, device, deps.controlToken ?? defaultControlToken);
  const upload = await multipartFile('app', file);
  headers['content-type'] = upload.type;
  headers['content-length'] = upload.length;
  log.info(`Sending ${file.name} to node ${origin} to install on ${udid}`);
  await relayNodeCall(res, {
    url: `${origin}/xenon/api/control/${encodeURIComponent(udid)}/upload-install`,
    method: 'POST',
    headers,
    body: upload.stream,
    timeoutMs: deps.timeoutMs ?? NODE_INSTALL_TIMEOUT_MS,
    node: origin,
    udid,
  });
}

/**
 * The node's screenshot of another server's phone, base64, for work this
 * server does on it: Omni-Vision, with this server's AI settings. Throws when
 * the node doesn't give one.
 */
export async function screenshotFromNode(
  req: Request,
  udid: string,
  device: ControlDevice,
  deps: NodeFileDeps = {},
): Promise<string> {
  const origin = safeNodeOrigin(device.host as string);
  if (!origin) throw new Error('Unsafe device host');
  const headers = await signedHeaders(req, udid, device, deps.controlToken ?? defaultControlToken);
  headers.accept = 'application/json';
  const answer = await readAnswer(
    await sendToNode({
      url: `${origin}/xenon/api/control/${encodeURIComponent(udid)}/screenshot`,
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(deps.timeoutMs ?? NODE_CONTROL_TIMEOUT_MS),
    }),
  );
  if (answer.status !== 200) {
    throw new Error(`Node ${origin} answered ${answer.status} for a screenshot`);
  }
  const shot = JSON.parse(answer.body.toString('utf8'))?.screenshot;
  if (typeof shot !== 'string' || !shot) throw new Error(`Node ${origin} sent no screenshot`);
  return shot;
}

const HOLDER_REFUSALS = new Set(['device_held_by_another_user', 'device_in_use_by_session']);

/**
 * A node's 409, with the holder's name filled in when the node could only
 * give their id: its database has no rows for this server's users, so it
 * says "another user". The wording is denyBody's, as for this server's own
 * refusals. Anything else is passed on as it came.
 */
async function relayRefusal(
  answer: NodeAnswer,
  res: Response,
  describeHolder: (userId: string) => Promise<string | null>,
): Promise<void> {
  let refusal: any;
  try {
    refusal = JSON.parse(answer.body.toString('utf8'));
  } catch {
    return sendAnswer(res, answer);
  }
  const holderId = refusal?.holder?.userId;
  if (!HOLDER_REFUSALS.has(refusal?.error) || typeof holderId !== 'string' || refusal.holder.name) {
    return sendAnswer(res, answer);
  }
  const name = await describeHolder(holderId).catch(() => null);
  if (!name) return sendAnswer(res, answer);
  res.status(409).json({ ...refusal, ...denyBody(refusal.error, holderId, name) });
}
