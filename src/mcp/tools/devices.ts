import { z } from 'zod';
import { defineTool } from '../tool';
import { invokeApi } from '../invokeApi';
import { answerOf, ToolRefusal } from '../toolCall';
import type { McpCaller } from '../mcpCredential';
import { MCP_LEASE_DEFAULT_MS } from '../../services/lease/leaseStatus';

/**
 * The phone tools, ported from Xenon Studio's `appium-mcp-plugin`
 * (`src/tools/devices.ts`) with its names, descriptions and arguments, so
 * prompts and skills written for Studio keep working. `authToken` is
 * accepted and ignored: the caller is the one `/xenon/mcp` signed in.
 */

/** A `GET /xenon/api/devices` row, as far as the tools read it. */
interface RawDevice {
  udid: string;
  name?: string;
  platform: string;
  sdk?: string;
  busy: boolean;
  offline?: boolean;
  session_id?: string | null;
  teamId?: string | null;
  /** The server that reports the phone. Two servers can report one udid. */
  host?: string;
  /** The caller's own active lease on it (grid.ts, for a tool's call only). */
  myLease?: MyLease;
}

/** The caller's own lease on a phone: its lockId and when it ends (epoch ms). */
interface MyLease {
  lockId: string;
  expiresAt: number;
}

/** A phone as `xenon_list_devices` answers it (Studio's shape). */
interface Device {
  udid: string;
  name?: string;
  platform: string;
  os?: string;
  busy: boolean;
  lockedBy?: string;
  teamId?: string | null;
  /** The server that reports the phone, `''` when the row names none. */
  host: string;
  /** The caller's own lease on it, with its end: release it when done. */
  myLease?: MyLease;
}

function toDevice(d: RawDevice): Device {
  return {
    udid: d.udid,
    name: d.name,
    platform: d.platform,
    os: d.sdk,
    busy: d.busy,
    lockedBy: d.session_id ?? undefined,
    teamId: d.teamId ?? undefined,
    host: d.host ?? '',
    ...(d.myLease ? { myLease: d.myLease } : {}),
  };
}

/** The lab's phones the caller may see: `GET /devices` as the caller. */
async function devicesOf(caller: McpCaller): Promise<RawDevice[]> {
  return answerOf(await invokeApi(caller, { method: 'GET', path: '/devices' }));
}

const listDevicesParams = z.object({
  authToken: z.string().optional(),
  platform: z.enum(['android', 'ios']).optional(),
  status: z.enum(['free', 'busy', 'offline']).optional(),
  name: z.string().optional(),
});

/** `xenon_list_devices`: `GET /devices` as the caller, filtered and reshaped. */
export const listDevicesTool = defineTool({
  name: 'xenon_list_devices',
  scope: 'xenon:devices:read',
  description:
    'List Xenon lab devices, optionally filtered by platform (android/ios), status ' +
    '(free/busy/offline), and name (case-insensitive substring match). Returns ' +
    '{udid,name,platform,os,busy,lockedBy?,teamId?,host} for each matching device. ' +
    'Two devices can share a udid when they are on different servers; host is the server ' +
    "that reports the device, and it tells them apart ('' when the lab names none). " +
    'A device you hold a lease on also has myLease {lockId,expiresAt}: when that lease ends ' +
    '(epoch ms). Release it with xenon_release_device when you are done.',
  params: listDevicesParams,
  annotations: { readOnlyHint: true, destructiveHint: false },
  async run(args, caller) {
    const devices = await devicesOf(caller);
    return devices
      .filter((d) => {
        if (args.platform && d.platform !== args.platform) return false;
        if (args.status) {
          const busy = Boolean(d.busy);
          const offline = Boolean(d.offline);
          if (args.status === 'free' && (busy || offline)) return false;
          if (args.status === 'busy' && !busy) return false;
          if (args.status === 'offline' && !offline) return false;
        }
        if (args.name && !(d.name ?? '').toLowerCase().includes(args.name.toLowerCase())) {
          return false;
        }
        return true;
      })
      .map(toDevice);
  },
});

/** `POST /sdk/leases`'s answer, as far as acquire reads it. */
interface LeaseAnswer {
  leaseId: string;
  leaseToken: string;
  /** The leased phone's row. */
  device?: { host?: string };
  /** Carries `xe:options.leaseId` and `leaseToken`: a session must present them to get the leased phone. */
  appiumCapabilities?: Record<string, unknown>;
}

/**
 * Two or more servers report the udid: which hosts to pass (Studio's
 * wording, which skills and prompts act on). `''` is a row that names no
 * server, which can still be picked with host `''`.
 */
function ambiguousPhoneMessage(hosts: string[], udid: string): string {
  const phone = `a phone named ${udid}`;
  const named = hosts.filter((h) => h !== '');
  if (named.length === 0) {
    return `Two or more servers have ${phone}. Pass { udid, host } with the host of the phone you mean.`;
  }
  if (hosts.includes('')) {
    return (
      `Two or more servers have ${phone}: ${named.join(', ')}, and one with no server named. ` +
      "Pass { udid, host } with one of these hosts, or host '' for the one with no server named."
    );
  }
  return `Two or more servers have ${phone}: ${named.join(', ')}. Pass { udid, host } with one of these hosts.`;
}

/**
 * The lease went to the same udid on another server than the one asked for.
 * Studio's check for a hub older than 2.36, kept as a guard: this hub leases
 * by host, so it means a fault, and the lease is given back.
 */
const WRONG_PHONE_LEASED =
  "This hub can't lease a phone by its server. Upgrade the hub to Xenon 2.36 or later.";

/** Added when that lease couldn't be given back: it needs no heartbeat, so it ends at its expiresAt. */
const WRONG_LEASE_KEPT =
  " The lease on the other phone couldn't be given back; the lab ends it within 15 minutes.";

const leasePath = (lockId: string) => `/sdk/leases/${encodeURIComponent(lockId)}`;

const acquireDeviceParams = z.object({
  authToken: z.string().optional(),
  udid: z.string(),
  host: z.string().optional(),
});

/**
 * `xenon_acquire_device`: a lease of one phone, through `POST /sdk/leases`
 * as the caller. Taken by a tool, it is an agent's lease (sdk-leases.ts):
 * no heartbeats, 15 minutes unless extended, under the caller's grant.
 */
export const acquireDeviceTool = defineTool({
  name: 'xenon_acquire_device',
  scope: 'xenon:devices:lock',
  description:
    'Acquire (lease) a lab device for exclusive use. Pass its udid, and its host from ' +
    'xenon_list_devices when two devices share that udid. Returns ' +
    '{udid,host,lockId,leaseToken,appiumCapabilities}. Start the Appium session on this device ' +
    'with the returned appiumCapabilities: they carry the lease, and the lab gives a leased ' +
    'device only to a session that presents it. The caller MUST keep both lockId and ' +
    'leaseToken: they are required to later release the device via xenon_release_device. ' +
    'The lease needs no heartbeats and lasts 15 minutes; xenon_extend_device makes it last ' +
    'longer. Release the device with xenon_release_device as soon as you are done with it. ' +
    'Errors: ambiguous_phone (two devices share the udid: pass one of the hosts the message ' +
    'lists); hub_upgrade_required (the hub is too old to lease a device by its host: it ' +
    'leased the other device and gave that lease back; do not retry, tell the user to upgrade it).',
  params: acquireDeviceParams,
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run(args, caller) {
    const named = (await devicesOf(caller)).filter((d) => d.udid === args.udid);
    const matches =
      args.host === undefined ? named : named.filter((d) => (d.host ?? '') === args.host);
    if (matches.length === 0) {
      const where = args.host ? ` on ${args.host}` : '';
      throw new ToolRefusal('not_found', `Device not found: ${args.udid}${where}`, 404);
    }
    if (matches.length > 1) {
      const hosts = matches.map((d) => d.host ?? '');
      throw new ToolRefusal('ambiguous_phone', ambiguousPhoneMessage(hosts, args.udid), 409);
    }
    const device = matches[0];
    const host = device.host ?? '';

    const lease: LeaseAnswer = answerOf(
      await invokeApi(caller, {
        method: 'POST',
        path: '/sdk/leases',
        body: {
          filters: { platform: device.platform, udid: args.udid, ...(host ? { host } : {}) },
          reason: 'agent acquire',
        },
      }),
    );

    const leasedHost = lease.device?.host;
    if (host && leasedHost && leasedHost !== host) {
      const given = await invokeApi(caller, {
        method: 'DELETE',
        path: leasePath(lease.leaseId),
        headers: { 'x-xenon-lease-token': lease.leaseToken },
      }).catch(() => undefined);
      const givenBack = given !== undefined && given.status < 400;
      throw new ToolRefusal(
        'hub_upgrade_required',
        givenBack ? WRONG_PHONE_LEASED : WRONG_PHONE_LEASED + WRONG_LEASE_KEPT,
        409,
      );
    }

    return {
      udid: args.udid,
      host: leasedHost || host,
      lockId: lease.leaseId,
      leaseToken: lease.leaseToken,
      appiumCapabilities: lease.appiumCapabilities,
    };
  },
});

const releaseDeviceParams = z.object({
  authToken: z.string().optional(),
  udid: z.string(),
  lockId: z.string(),
  leaseToken: z.string(),
});

/** `xenon_release_device`: `DELETE /sdk/leases/:id` with the lease token. */
export const releaseDeviceTool = defineTool({
  name: 'xenon_release_device',
  scope: 'xenon:devices:lock',
  description:
    'Release a device lease previously created by xenon_acquire_device. Requires the ' +
    'lockId and leaseToken returned by that call.',
  params: releaseDeviceParams,
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run(args, caller) {
    answerOf(
      await invokeApi(caller, {
        method: 'DELETE',
        path: leasePath(args.lockId),
        headers: { 'x-xenon-lease-token': args.leaseToken },
      }),
    );
    return { released: true };
  },
});

const extendDeviceParams = z.object({
  authToken: z.string().optional(),
  lockId: z.string(),
  leaseToken: z.string(),
  durationMs: z.number().int().positive().optional(),
});

/**
 * `xenon_extend_device`: `POST /sdk/leases/:id/extend` with the lease token,
 * by LeaseService.extend's rules: the lease lasts at least `durationMs`
 * (15 minutes when absent) from now, never less than it already does, and at
 * most 24 hours after it was taken.
 */
export const extendDeviceTool = defineTool({
  name: 'xenon_extend_device',
  scope: 'xenon:devices:lock',
  description:
    'Make a device lease from xenon_acquire_device last longer. Requires its lockId and ' +
    'leaseToken; durationMs is how long from now it should last at least (15 minutes when ' +
    'left out). A lease never gets shorter, and lasts at most 24 hours after it was taken. ' +
    'Returns {lockId,expiresAt}, expiresAt being when it ends (epoch ms).',
  params: extendDeviceParams,
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run(args, caller) {
    const answer: { expiresAt: number } = answerOf(
      await invokeApi(caller, {
        method: 'POST',
        path: `${leasePath(args.lockId)}/extend`,
        headers: { 'x-xenon-lease-token': args.leaseToken },
        body: { durationMs: args.durationMs ?? MCP_LEASE_DEFAULT_MS },
      }),
    );
    return { lockId: args.lockId, expiresAt: answer.expiresAt };
  },
});
