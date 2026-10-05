import type http from 'http';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * The proxy for one of Xenon's own calls to another server, from the
 * environment, by the rule axios (0.27's http adapter) applies to Xenon's
 * axios calls, so every call to a URL takes the same path whichever client
 * makes it:
 * - `http_proxy` or `HTTP_PROXY` for an http URL, `https_proxy` or
 *   `HTTPS_PROXY` for an https one, the lower-case name first (ws and wss
 *   count as http and https);
 * - none when `no_proxy` or `NO_PROXY` (the lower-case name first; a
 *   comma-separated list) has `*`, the URL's host name, or a suffix of it
 *   starting with a dot (`.lab.example`). An entry is a host name only: one
 *   with a port matches nothing, as in axios.
 *
 * Through 2.15 a command forwarded to a node took HTTP_PROXY or HTTPS_PROXY
 * whatever its scheme and ignored NO_PROXY, the live-preview and logcat
 * sockets ignored every proxy, and so did a node fetching its hub's keys.
 */
export function envProxyFor(
  target: URL | string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const url = typeof target === 'string' ? new URL(target) : target;
  const scheme = url.protocol.replace(/:$/, '').replace(/^ws(s?)$/, 'http$1');
  if (scheme !== 'http' && scheme !== 'https') return undefined;
  const proxy = env[`${scheme}_proxy`] || env[`${scheme.toUpperCase()}_PROXY`];
  if (!proxy) return undefined;

  const noProxy = env.no_proxy || env.NO_PROXY;
  if (noProxy) {
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const exempt = noProxy
      .split(',')
      .map((entry) => entry.trim())
      .some(
        (entry) =>
          entry !== '' &&
          (entry === '*' || entry === host || (entry.startsWith('.') && host.endsWith(entry))),
      );
    if (exempt) return undefined;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(proxy) ? proxy : `http://${proxy}`;
}

/**
 * An agent sending an HTTP request for `target` through its proxy, or
 * undefined to go straight there: the request in absolute form to the proxy
 * for an http URL, a CONNECT tunnel for an https one.
 */
export function proxyAgentFor(target: URL | string): http.Agent | undefined {
  const proxy = envProxyFor(target);
  if (!proxy) return undefined;
  const url = typeof target === 'string' ? new URL(target) : target;
  return url.protocol === 'https:' ? new HttpsProxyAgent(proxy) : new HttpProxyAgent(proxy);
}

/**
 * An agent opening a WebSocket for `target` (ws or wss) through its proxy, or
 * undefined to go straight there. Always a CONNECT tunnel: an upgrade sent to
 * a proxy in absolute form is not reliably passed on.
 */
export function socketProxyAgentFor(target: URL | string): http.Agent | undefined {
  const proxy = envProxyFor(target);
  return proxy ? new HttpsProxyAgent(proxy) : undefined;
}
