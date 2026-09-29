import { IPluginArgs } from '../interfaces/IPluginArgs';

/**
 * A phone's `host` column names the server that drives it, and a hub keeps its
 * own phones and every node's in one table. Two servers on one machine share
 * an IP and differ only by port, so "is this row mine?" has to compare the
 * whole host. Matching on the IP made a hub on :4724 delete the phone a node
 * on :4725 had just registered.
 *
 * Discovery builds a local phone's host with the functions below, and
 * localDeviceHosts() is made from the same functions, so the two can't drift.
 */

export type LocalHostArgs = Pick<
  IPluginArgs,
  'bindHostOrIp' | 'remoteMachineProxyIP' | 'adbRemote'
>;

/** This server's origin, `http://<bindHostOrIp>:<port>`. */
export function serverOrigin(args: Pick<IPluginArgs, 'bindHostOrIp'>, port: number): string {
  return `http://${args.bindHostOrIp}:${port}`;
}

/** An `adbRemote` entry, `host[:port]`, with adb's default port 5037. */
export function parseAdbRemote(value: string): { adbHost: string; adbPort: number } {
  const [adbHost, adbPort] = value.split(':');
  return { adbHost, adbPort: parseInt(adbPort) || 5037 };
}

/**
 * An Android phone: a phone on a remote adb server is filed under that
 * server; otherwise under remoteMachineProxyIP with this server's port;
 * otherwise under this server.
 */
export function androidDeviceHost(
  args: LocalHostArgs,
  port: number,
  adb?: { adbHost?: string | null; adbPort?: number },
): string {
  if (adb?.adbHost != null) return `http://${adb.adbHost}:${adb.adbPort}`;
  if (args.remoteMachineProxyIP !== undefined) return `http://${args.remoteMachineProxyIP}:${port}`;
  return serverOrigin(args, port);
}

/** A real iOS device: remoteMachineProxyIP as given (no port added), otherwise this server. */
export function iosRealDeviceHost(args: LocalHostArgs, port: number): string {
  return args.remoteMachineProxyIP ? String(args.remoteMachineProxyIP) : serverOrigin(args, port);
}

/** An iOS simulator: always this server. */
export function iosSimulatorHost(args: LocalHostArgs, port: number): string {
  return serverOrigin(args, port);
}

export interface LocalDeviceHosts {
  /** This server's origin. */
  origin: string;
  /** Every host this server's discovery can write for a phone it drives. */
  hosts: ReadonlySet<string>;
}

export function localDeviceHosts(args: LocalHostArgs, port: number): LocalDeviceHosts {
  return {
    origin: serverOrigin(args, port),
    hosts: new Set([
      serverOrigin(args, port),
      androidDeviceHost(args, port),
      ...(args.adbRemote ?? []).map((value) =>
        androidDeviceHost(args, port, parseAdbRemote(value)),
      ),
      iosRealDeviceHost(args, port),
      iosSimulatorHost(args, port),
    ]),
  };
}

/** Whether a row's host is one this server writes: exact, never by IP or prefix. */
export function isLocalDeviceHost(
  local: LocalDeviceHosts,
  host: string | null | undefined,
): boolean {
  return host != null && local.hosts.has(host);
}

/**
 * Whether a phone's row is this server's own, for stale cleanup. A row names
 * the server process that found it (`nodeId`, new on every boot; a node's
 * report carries the node's), so that decides: another server's phone is
 * never pruned as this one's, even under a host this server also files
 * phones under (a shared remoteMachineProxyIP or adb server), and is
 * host-checked as the other server's. A row with no nodeId falls back to its
 * host.
 */
export function isOwnDevice(
  local: LocalDeviceHosts,
  nodeId: string,
  device: { host?: string | null; nodeId?: string | null },
): boolean {
  if (device.nodeId) return device.nodeId === nodeId;
  return isLocalDeviceHost(local, device.host);
}

/**
 * Which phones a server forgets when it starts: the hosts to clear, or
 * undefined for every phone.
 *
 * A hub keeps its nodes' phones. Their sessions keep running on the nodes
 * while the hub restarts, and the hub finds where to route them from those
 * rows (SessionManager.recoverActiveSessions, gateway/sessionLocator.ts). A
 * node that died meanwhile is pruned by removeStaleDevices, and a live one's
 * next report refreshes its rows. A hub's own phones are cleared as before:
 * discovery adds back the attached ones, and their sessions died with it.
 * A node clears everything, as it always has.
 */
export function devicesClearedAtBoot(
  args: Pick<IPluginArgs, 'hub'>,
  local: LocalDeviceHosts,
): string[] | undefined {
  return args.hub === undefined ? [...local.hosts] : undefined;
}
