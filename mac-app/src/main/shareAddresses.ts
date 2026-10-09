import type { Profile, ShareAddresses } from '@shared/types';

/** '' for no base path; otherwise one leading slash and no trailing one: 'wd/hub/' and '/wd/hub' both give '/wd/hub'. */
function normalBasePath(basePath: string): string {
  const inner = basePath.replace(/^\/+/, '').replace(/\/+$/, '');
  return inner === '' ? '' : `/${inner}`;
}

/**
 * A Mac's name as its .local name needs it: one label, lower case. A .local
 * name is a single label, so a longer name gives only its first: the Mac's own
 * "Lab-Mac.local" is "lab-mac", and a DHCP or DNS host name such as
 * "lab-mac.corp.example.com" is "lab-mac" too (R27), never a
 * "…example.com.local" nobody can reach. Spaces and trailing dots are dropped.
 */
export function localLabel(name: string): string {
  const trimmed = name.trim().toLowerCase().replace(/\.+$/, '');
  return trimmed.split('.')[0];
}

/** The address tests on this Mac connect to: localhost, the port and the base path. */
export function testAddress(server: Pick<Profile['server'], 'port' | 'basePath'>): string {
  return `http://localhost:${server.port}${normalBasePath(server.basePath)}`;
}

/**
 * The two addresses a tester gives out: the one for tests run on this Mac, and
 * the one colleagues on the same network use to reach it, the Mac's name on the
 * local network with .local added. `hostname` is that name as main resolved it
 * (the Mac's Bonjour name, see macName.ts); it is cut to one label here too.
 */
export function shareAddresses(server: Pick<Profile['server'], 'port' | 'basePath'>, hostname: string): ShareAddresses {
  return {
    test: testAddress(server),
    colleagues: `http://${localLabel(hostname)}.local:${server.port}${normalBasePath(server.basePath)}`
  };
}
