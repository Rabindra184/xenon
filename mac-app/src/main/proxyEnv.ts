// A proxy that needs a password is passed to Xenon in the environment, not as
// its `proxy` option: the option goes into the config file, and no secret
// value may be written to a file. Xenon takes HTTP(S)_PROXY when the option is
// unset (src/helpers/outboundProxy.ts in the plugin), reading the lower-case
// names first, and its option sent loopback hosts direct; NO_PROXY does that
// for the environment's proxy.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The proxy settings' address with the user name and `password` in it, as
 * Xenon builds one from its `proxy` option: the protocol (http unless set,
 * written with or without its colon), the user name and password escaped, the
 * host, and the port when there is one. Null unless the proxy is an object
 * with a host and a user name, since a password alone authenticates nobody.
 */
export function proxyUrl(proxy: unknown, password: string): string | null {
  if (!isRecord(proxy) || !isRecord(proxy.auth)) return null;
  const { host, port, protocol } = proxy;
  const { username } = proxy.auth;
  if (typeof host !== 'string' || host.trim() === '') return null;
  if (typeof username !== 'string' || username === '') return null;
  const scheme = typeof protocol === 'string' && protocol !== '' ? protocol.replace(/:$/, '') : 'http';
  const credentials = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
  return `${scheme}://${credentials}@${host.trim()}${port ? `:${port}` : ''}`;
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

/** A NO_PROXY list with the loopback hosts added after the hosts it names, each host once. */
export function withLoopback(noProxy: string | undefined): string {
  const hosts: string[] = [];
  for (const entry of [...(noProxy ?? '').split(','), ...LOOPBACK_HOSTS]) {
    const host = entry.trim();
    if (host !== '' && !hosts.includes(host)) hosts.push(host);
  }
  return hosts.join(',');
}

/**
 * The environment that sends Xenon's calls through the proxy at `url`: both
 * spellings of HTTP_PROXY and HTTPS_PROXY, since Xenon reads the lower-case one
 * first, and NO_PROXY (`noProxy`, the list already in force) with the loopback
 * hosts added, under both spellings, so they go direct as they did with the option.
 */
export function proxyEnv(url: string, noProxy: string | undefined): Record<string, string> {
  const direct = withLoopback(noProxy);
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    NO_PROXY: direct,
    no_proxy: direct
  };
}
