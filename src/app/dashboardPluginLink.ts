import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { publicServerBase } from '../services/publicUrl';

/**
 * Where the appium-dashboard-plugin is, when it runs on this Appium server
 * (at `/dashboard`), for the device list: `request['dashboard-plugin-url']`
 * is where Xenon itself fetches the plugin's sessions, and
 * `request['dashboard-plugin-link']` the base of each device's
 * `dashboard_link`, for people to open.
 *
 * Both come from configuration, never from a request. Through 2.14 they came
 * from the Host header of the first /xenon/api request after startup, before
 * the login: Xenon sent a GET to `<that host>/dashboard/api/ping`, kept
 * `<that host>/dashboard` for the life of the process if the answer had
 * `pong`, fetched `<that host>/dashboard/api/sessions` on every device list,
 * and gave every user a link to that host. A forged Host made Xenon call a
 * server of the sender's choosing and point everyone at it.
 *
 * - Xenon reaches the plugin on this server's own address and port
 *   (`ownServerOrigin`, a wildcard bind address on 127.0.0.1).
 * - People get `<XENON_PUBLIC_URL>/dashboard`, or `/dashboard` on the server
 *   their browser already has open when XENON_PUBLIC_URL isn't set.
 *
 * The ping runs once it succeeds; after a failure it is retried with an
 * exponential back-off (1 s doubling to 30 s), so a server without the plugin
 * doesn't ping on every request.
 */
export const DASHBOARD_RETRY_MAX_MS = 30_000;

export interface DashboardPluginDeps {
  /** This server, as this process reaches it: `http://127.0.0.1:4723`. */
  ownServerOrigin: string;
  /** InternalHttpClient.get. */
  get: (url: string) => Promise<any>;
  /** The address people reach this server at, or null. Defaults to XENON_PUBLIC_URL. */
  publicBase?: () => string | null;
  now?: () => number;
  warn?: (message: string) => void;
}

/** A server's own origin from its bind address and port; a wildcard is reached on 127.0.0.1. */
export function ownServerOrigin(address: string | undefined, port: number): string {
  const wildcard = !address || address === '0.0.0.0' || address === '::';
  const host = wildcard ? '127.0.0.1' : address.includes(':') ? `[${address}]` : address;
  return `http://${host}:${port}`;
}

export function dashboardPluginMiddleware(deps: DashboardPluginDeps): RequestHandler {
  const now = deps.now ?? Date.now;
  const publicBase = deps.publicBase ?? (() => publicServerBase());
  const pluginUrl = `${deps.ownServerOrigin}/dashboard`;
  let found: Promise<boolean> | null = null;
  let nextRetryAt = 0;
  let retryDelayMs = 1000;

  const ping = async (): Promise<boolean> => {
    try {
      const response: any = await deps.get(`${pluginUrl}/api/ping`);
      if (response && response['pong']) return true;
    } catch (err: any) {
      deps.warn?.(
        `[Xenon] Dashboard ping failed, retrying in ${retryDelayMs}ms: ${err?.message || err}`,
      );
    }
    nextRetryAt = now() + retryDelayMs;
    retryDelayMs = Math.min(retryDelayMs * 2, DASHBOARD_RETRY_MAX_MS);
    return false;
  };

  return async (req: Request, _res: Response, next: NextFunction) => {
    if (found === null && now() >= nextRetryAt) {
      // Requests arriving meanwhile wait for this one ping. A failed one is
      // forgotten, so the next request after the back-off pings again.
      const attempt = ping();
      found = attempt;
      void attempt.then((ok) => {
        if (!ok && found === attempt) found = null;
      });
    }
    const present = found ? await found : false;
    (req as any)['dashboard-plugin-url'] = present ? pluginUrl : '';
    (req as any)['dashboard-plugin-link'] = present ? `${publicBase() ?? ''}/dashboard` : '';
    next();
  };
}
