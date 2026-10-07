import type { Profile, ServerState } from '@shared/types';
import { isServerActive } from './serverStatus';

// Which address Copy Test Address and Home's address card give out. The
// addresses themselves are worked out in main (share:addresses), which knows
// the Mac's name; this decides whose port and base path they are for.

export type AddressSource = Pick<Profile['server'], 'port' | 'basePath'>;

/**
 * The port and base path of the server tests can connect to. While a server is
 * active (starting, running or stopping) that is the profile it was started
 * for, which may not be the open one, on the port and base path it was started
 * with (the profile may have been edited since, and its server still serves
 * those); otherwise the open profile's. The server says both once it starts,
 * so its profile is only asked for what it has not said. Null when there is
 * none to give: no profile is open, or the active server's profile was removed
 * before it said them.
 */
export function testAddressSource(
  server: Pick<ServerState, 'status' | 'profileId' | 'port' | 'basePath'>,
  open: Profile | null,
  profiles: readonly Profile[]
): AddressSource | null {
  if (isServerActive(server.status)) {
    if (server.port !== null && server.basePath !== null) return { port: server.port, basePath: server.basePath };
    const running = server.profileId === null ? undefined : profiles.find((p) => p.id === server.profileId);
    if (running === undefined) return null;
    return { port: server.port ?? running.server.port, basePath: server.basePath ?? running.server.basePath };
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
