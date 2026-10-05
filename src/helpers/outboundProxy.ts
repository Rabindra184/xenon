import type http from 'http';
import type { AxiosRequestConfig } from 'axios';
import { Container } from 'typedi';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { AgentConnectOpts } from 'agent-base';
import log from '../logger';
import { PluginContext } from '../PluginContext';

/**
 * The proxy for one of Xenon's own calls to another server (a hub's to its
 * nodes and to a cloud provider, a node's to its hub, and the rest of
 * Xenon's internal calls), one rule whichever client makes the call:
 *
 * 1. None for a host `no_proxy` / `NO_PROXY` names (envProxyFor's list).
 * 2. The `proxy` plugin option when it is set, for http and https alike,
 *    except for a loopback host (`localhost`, 127.x, ::1): a proxy elsewhere
 *    can't reach this machine's loopback.
 * 3. Else the environment's proxy for the URL's scheme (envProxyFor).
 *
 * Through 2.15 the option reached one call, the create a hub sends to a node
 * or a cloud provider; that session's commands, screenshots and heartbeats,
 * device control, the sockets and a node's calls to its hub took the
 * environment's proxy instead, or none.
 */
export function outboundProxyFor(
  target: URL | string,
  opts: {
    env?: NodeJS.ProcessEnv;
    /** The `proxy` option; the running server's when not given. */
    option?: unknown;
    warn?: (message: string) => void;
  } = {},
): string | undefined {
  const url = toUrl(target);
  const scheme = schemeOf(url);
  if (!scheme) return undefined;
  const env = opts.env ?? process.env;
  if (namedByNoProxy(url, env)) return undefined;
  const option = 'option' in opts ? opts.option : pluginProxyOption();
  const configured = proxyOptionUrl(option, opts.warn ?? warnOnce);
  if (configured && !isLoopback(url.hostname)) return configured;
  return schemeProxy(scheme, env);
}

/**
 * The environment's proxy for a URL, by the rule axios (0.27's http adapter)
 * applies to Xenon's axios calls:
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
  const url = toUrl(target);
  const scheme = schemeOf(url);
  if (!scheme || namedByNoProxy(url, env)) return undefined;
  return schemeProxy(scheme, env);
}

/** What the caller's own TLS settings say about the server behind the proxy. */
export interface TargetTls {
  rejectUnauthorized?: boolean;
}

/**
 * An agent sending an HTTP request for `target` through its proxy, or
 * undefined to go straight there: the request in absolute form to the proxy
 * for an http URL, a CONNECT tunnel for an https one.
 */
export function proxyAgentFor(target: URL | string, tls: TargetTls = {}): http.Agent | undefined {
  const proxy = outboundProxyFor(target);
  if (!proxy) return undefined;
  const url = toUrl(target);
  return url.protocol === 'https:' ? new TunnelAgent(proxy, tls) : new HttpProxyAgent(proxy);
}

/**
 * An agent opening a WebSocket for `target` (ws or wss) through its proxy, or
 * undefined to go straight there. Always a CONNECT tunnel: an upgrade sent to
 * a proxy in absolute form is not reliably passed on.
 */
export function socketProxyAgentFor(
  target: URL | string,
  tls: TargetTls = {},
): http.Agent | undefined {
  const proxy = outboundProxyFor(target);
  return proxy ? new TunnelAgent(proxy, tls) : undefined;
}

/**
 * An axios request's proxy settings for `target`: through its proxy's agent,
 * or none. Either way `proxy: false`, since the decision is made here, by
 * outboundProxyFor; axios's own lookup reads the environment only. With no
 * proxy, the caller's own agents stay.
 */
export function axiosProxyConfig(
  target: URL | string,
  tls: TargetTls = {},
): Pick<AxiosRequestConfig, 'proxy' | 'httpAgent' | 'httpsAgent'> {
  const agent = proxyAgentFor(target, tls);
  return agent ? { proxy: false, httpAgent: agent, httpsAgent: agent } : { proxy: false };
}

/**
 * A CONNECT tunnel that checks the server behind it as the caller asked.
 * HttpsProxyAgent's own options are for the connection to the proxy; the
 * tunnelled TLS takes the request's, which axios doesn't fill in. So through
 * 2.15 `tlsRejectUnauthorized` never reached a node or cloud provider that a
 * proxy stood in front of.
 */
class TunnelAgent extends HttpsProxyAgent<string> {
  constructor(
    proxy: string,
    private readonly targetTls: TargetTls,
  ) {
    super(proxy);
  }

  async connect(req: http.ClientRequest, opts: AgentConnectOpts) {
    const tls =
      this.targetTls.rejectUnauthorized === undefined
        ? {}
        : { rejectUnauthorized: this.targetTls.rejectUnauthorized };
    return super.connect(req, { ...opts, ...tls } as AgentConnectOpts);
  }
}

/**
 * The `proxy` option as a proxy URL: a string as it is (http:// added when
 * it names no scheme), or `{ protocol, host, port, auth: { username,
 * password } }` (protocol http by default, credentials escaped). One that
 * names no host is no proxy, said once.
 */
function proxyOptionUrl(option: unknown, warn: (message: string) => void): string | undefined {
  if (option === undefined || option === null || option === '') return undefined;
  if (typeof option === 'string') {
    const text = option.trim();
    if (text === '') return undefined;
    return hasScheme(text) ? text : `http://${text}`;
  }
  const value = option as { protocol?: unknown; host?: unknown; port?: unknown; auth?: any };
  if (typeof option !== 'object' || typeof value.host !== 'string' || value.host.trim() === '') {
    warn(
      `The proxy option ${JSON.stringify(option)} names no host, so it is not used: ` +
        "Xenon's calls to other servers take the environment's proxy, if any.",
    );
    return undefined;
  }
  const protocol =
    typeof value.protocol === 'string' && value.protocol !== ''
      ? value.protocol.replace(/:$/, '')
      : 'http';
  const port = value.port === undefined || value.port === null ? '' : `:${value.port}`;
  const username = value.auth?.username;
  const password = value.auth?.password;
  const credentials =
    typeof username === 'string' && username !== ''
      ? `${encodeURIComponent(username)}${
          typeof password === 'string' ? `:${encodeURIComponent(password)}` : ''
        }@`
      : '';
  return `${protocol}://${credentials}${value.host.trim()}${port}`;
}

const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  log.warn(message);
}

function pluginProxyOption(): unknown {
  try {
    return Container.get(PluginContext).pluginArgs?.proxy;
  } catch {
    return undefined;
  }
}

function toUrl(target: URL | string): URL {
  return typeof target === 'string' ? new URL(target) : target;
}

function schemeOf(url: URL): 'http' | 'https' | undefined {
  const scheme = url.protocol.replace(/:$/, '').replace(/^ws(s?)$/, 'http$1');
  return scheme === 'http' || scheme === 'https' ? scheme : undefined;
}

function hostOf(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, '$1');
}

function namedByNoProxy(url: URL, env: NodeJS.ProcessEnv): boolean {
  const noProxy = env.no_proxy || env.NO_PROXY;
  if (!noProxy) return false;
  const host = hostOf(url);
  return noProxy
    .split(',')
    .map((entry) => entry.trim())
    .some(
      (entry) =>
        entry !== '' &&
        (entry === '*' || entry === host || (entry.startsWith('.') && host.endsWith(entry))),
    );
}

function schemeProxy(scheme: 'http' | 'https', env: NodeJS.ProcessEnv): string | undefined {
  const proxy = env[`${scheme}_proxy`] || env[`${scheme.toUpperCase()}_PROXY`];
  if (!proxy) return undefined;
  return hasScheme(proxy) ? proxy : `http://${proxy}`;
}

function hasScheme(text: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127(\.\d{1,3}){3}$/.test(host) ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1'
  );
}
