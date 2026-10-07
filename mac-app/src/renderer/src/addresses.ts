import type { Profile, ServerState } from '@shared/types';
import { isServerActive } from './serverStatus';

// Which address Copy Test Address and Home's address card give out. The
// addresses themselves are worked out in main (share:addresses), which knows
// the Mac's name; this decides whose port and base path they are for.

export type AddressSource = Pick<Profile['server'], 'port' | 'basePath'>;

/**
 * The port and base path of the server tests can connect to. While a server is
 * active (starting, running or stopping) that is the profile it was started
 * for, which may not be the open one, on the port it runs on; otherwise the
 * open profile's. Null when there is none to give: no profile is open, or the
 * active server's profile was removed (its base path went with it).
 */
export function testAddressSource(
  server: Pick<ServerState, 'status' | 'profileId' | 'port'>,
  open: Profile | null,
  profiles: readonly Profile[]
): AddressSource | null {
  if (isServerActive(server.status)) {
    const running = server.profileId === null ? undefined : profiles.find((p) => p.id === server.profileId);
    if (running === undefined) return null;
    return { port: server.port ?? running.server.port, basePath: running.server.basePath };
  }
  return open === null ? null : { port: open.server.port, basePath: open.server.basePath };
}

/**
 * The colleagues' address, or null when it names no Mac: when the Mac's name
 * resolved to nothing, it is just ".local", which nobody can reach.
 */
export function shownColleaguesAddress(colleagues: string): string | null {
  let host: string;
  try {
    host = new URL(colleagues).hostname;
  } catch {
    return null;
  }
  return host.endsWith('.local') && host.length > '.local'.length ? colleagues : null;
}
