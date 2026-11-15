import { z } from 'zod';
import { defineTool } from '../tool';
import { invokeApi } from '../invokeApi';
import { answerOf } from '../toolCall';

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
  };
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
    "that reports the device, and it tells them apart ('' when the lab names none).",
  params: listDevicesParams,
  annotations: { readOnlyHint: true, destructiveHint: false },
  async run(args, caller) {
    const devices: RawDevice[] = answerOf(
      await invokeApi(caller, { method: 'GET', path: '/devices' }),
    );
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
