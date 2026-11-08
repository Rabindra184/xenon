import { Container } from 'typedi';
import { PluginContext } from '../../PluginContext';
import { isLocalDeviceHost, localDeviceHosts } from '../../device-managers/localDeviceHosts';
import { PortAllocatorService } from './PortAllocatorService';

/**
 * A lease's driver ports are reserved in the database of the phone's server.
 * For a node's phone that is the node, reached over HTTP with the hub's node
 * credentials (`XENON_HUB_ACCESS_KEY` / `XENON_HUB_TOKEN`). For this server's
 * own phone it is this server, so the reservation is made here, in process,
 * with no credentials.
 *
 * Through 2.20 an own phone's reservation went over HTTP too, to this
 * server's own `/ports/allocate`, so with sign-in on every lease, a single
 * server's with no nodes included, needed the node credentials, and without
 * them answered `503 device_unhealthy`. A phone under an `adbRemote` host was
 * posted to the adb server's port.
 */
export interface OwnPorts {
  /** Whether a phone filed under `host` is this server's own. */
  isOwnHost(host: string): boolean;
  /** The allocator behind this server's `/ports` routes. */
  allocator(): Pick<PortAllocatorService, 'allocate' | 'extend' | 'release'>;
}

/**
 * A host this server's discovery files its phones under: its origin, its
 * remoteMachineProxyIP and adbRemote forms. Exact, never by IP or prefix, as
 * the rest of Xenon decides "is this row mine?" (localDeviceHosts.ts).
 */
export function isThisServersHost(host: string | null | undefined): boolean {
  const context = Container.get(PluginContext);
  return isLocalDeviceHost(localDeviceHosts(context.pluginArgs, context.port), host);
}

let sharedAllocator: PortAllocatorService | undefined;

export function defaultOwnPorts(): OwnPorts {
  return {
    isOwnHost: (host) => isThisServersHost(host),
    allocator: () => (sharedAllocator ??= new PortAllocatorService()),
  };
}
