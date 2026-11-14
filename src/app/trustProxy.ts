import log from '../logger';

/**
 * Which proxies in front of this server may say who the caller is.
 *
 * Express's `trust proxy`: with it set, `req.ip` is the address the trusted
 * proxy saw (from X-Forwarded-For), and the sign-in limit counts each caller
 * apart (`loginRateLimiter`). Without it, `req.ip` is the socket's address,
 * which behind a reverse proxy is the proxy's own, so every sign-in counts
 * against one address and five failed sign-ins from anyone lock everyone out
 * for the window.
 *
 * The `trustProxy` plugin option, else `XENON_TRUST_PROXY`, else not set
 * (schema.json gives it no default, so the variable can win: see CLAUDE.md,
 * "Option over environment variable"). The value is Express's own:
 * `true`/`false`, a number of hops (`1`), or addresses, subnets and the names
 * `loopback`, `linklocal`, `uniquelocal`, comma-separated.
 */
export type TrustProxy = boolean | number | string;

export function resolveTrustProxy(
  option: unknown,
  env: string | undefined,
): TrustProxy | undefined {
  const raw = option !== undefined && option !== null && option !== '' ? option : env;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean' || typeof raw === 'number') return raw;
  const text = String(raw).trim();
  if (text === '') return undefined;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^\d+$/.test(text)) return Number(text);
  return text;
}

/**
 * Set `trust proxy` on Appium's Express app, before any route is registered.
 * A value Express can't use (an address it can't parse) is refused with a
 * warning and leaves the setting off, so a typo never stops the server.
 * Answers what was set.
 */
export function applyTrustProxy(
  app: { set(name: string, value: unknown): unknown },
  option: unknown,
  env: string | undefined = process.env.XENON_TRUST_PROXY,
): TrustProxy | undefined {
  const value = resolveTrustProxy(option, env);
  if (value === undefined) return undefined;
  try {
    app.set('trust proxy', value);
  } catch (err: any) {
    log.warn(
      `Ignoring trustProxy ${JSON.stringify(value)}: ${err?.message ?? err}. ` +
        'Sign-ins are counted by the address that connects.',
    );
    return undefined;
  }
  log.info(`Trusting proxies for the caller's address: ${JSON.stringify(value)}`);
  return value;
}
