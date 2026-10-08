// A proxy that needs a password is passed to Xenon in the environment, not as
// its `proxy` option: the option goes into the config file, and no secret
// value may be written to a file. Xenon takes HTTP(S)_PROXY when the option is
// unset (src/helpers/outboundProxy.ts in the plugin), reading the lower-case
// names first, and its option sent loopback hosts direct; NO_PROXY does that
// for the environment's proxy.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A proxy written as one address, parsed as Xenon reads it: http:// added when it names no scheme. Null when it doesn't parse. */
function parseProxyString(proxy: string): URL | null {
  const text = proxy.trim();
  if (text === '') return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    return null;
  }
}

/** Escaped text as written, unescaped; as written when it isn't valid escaping. */
function unescape(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The user name and password in a proxy written as one address (`http://qa:pw@host:3128`,
 * or `qa:pw@host:3128`), unescaped; the password is '' when it has none. Null when it names
 * no user and no password, or doesn't parse.
 */
export function proxyStringCredentials(proxy: string): { username: string; password: string } | null {
  const url = parseProxyString(proxy);
  if (url === null || (url.username === '' && url.password === '')) return null;
  return { username: unescape(url.username), password: unescape(url.password) };
}

/** The proxy address without its password, with its user name kept, so the Keychain's can go back in at launch. */
export function proxyStringWithoutPassword(proxy: string): string {
  const url = parseProxyString(proxy);
  if (url === null) return proxy;
  return `${url.protocol}//${url.username === '' ? '' : `${url.username}@`}${url.host}`;
}

/** The proxy address with its user name and `password` (escaped); null when it names no user or doesn't parse. */
export function proxyStringUrl(proxy: string, password: string): string | null {
  const url = parseProxyString(proxy);
  if (url === null || url.username === '') return null;
  return `${url.protocol}//${url.username}:${encodeURIComponent(password)}@${url.host}`;
}

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

// `.localhost` names every host under localhost, which the option sent direct too (isLoopback).
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', '.localhost'];

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
