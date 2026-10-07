import type { Profile, ShareAddresses } from '@shared/types';

/** '' for no base path; otherwise one leading slash and no trailing one: 'wd/hub/' and '/wd/hub' both give '/wd/hub'. */
function normalBasePath(basePath: string): string {
  const inner = basePath.replace(/^\/+/, '').replace(/\/+$/, '');
  return inner === '' ? '' : `/${inner}`;
}

/** The Mac's name as a .local name needs it: lower case, without trailing dots, and without the .local it may already end in. */
function normalHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '').replace(/\.local$/, '');
}

/**
 * The two addresses a tester gives out: the one for tests run on this Mac, and
 * the one colleagues on the same network use to reach it (the Mac's own name
 * on the local network, which is why `.local` is added to the hostname).
 */
export function shareAddresses(server: Pick<Profile['server'], 'port' | 'basePath'>, hostname: string): ShareAddresses {
  const base = normalBasePath(server.basePath);
  return {
    test: `http://localhost:${server.port}${base}`,
    colleagues: `http://${normalHost(hostname)}.local:${server.port}${base}`
  };
}
