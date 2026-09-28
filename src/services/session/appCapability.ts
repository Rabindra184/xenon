import { ISessionCapability } from '../../interfaces/ISessionCapability';

/**
 * Where an uploaded app's download URL goes in a session's capabilities.
 *
 * A session may name an uploaded app by id (`appium:app: <id>`). createSession
 * rewrites that to `/xenon/api/apps/<id>/download` on this hub, and the driver
 * downloads it. With auth on, the driver needs a single-use ticket in the URL;
 * that ticket is a bearer secret until the driver spends it, so only the copy
 * of the capabilities the driver reads carries it, and everything Xenon stores
 * or shows (the pending-session row, the Session row, its logs) keeps the
 * plain URL.
 */

const APP_KEYS = ['app', 'appium:app'];

/** The plain download URL for an uploaded app, as the driver will reach it. */
export function appDownloadUrl(host: string, port: number, appId: string): string {
  return `http://${host}:${port}/xenon/api/apps/${appId}/download`;
}

/** `url` with a download ticket appended. */
export function withTicket(url: string, ticket: string): string {
  return `${url}?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Writes `url` over every app capability the client set, in `alwaysMatch` and
 * the first `firstMatch`, in place: Appium hands this same object to the
 * driver.
 */
export function setAppCapability(caps: ISessionCapability, url: string): void {
  const buckets = [
    caps?.alwaysMatch,
    Array.isArray(caps?.firstMatch) ? caps.firstMatch[0] : undefined,
  ];
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const key of APP_KEYS) if ((bucket as any)[key]) (bucket as any)[key] = url;
  }
}

/** A copy of `caps` with every app capability set to `url`. `caps` is not changed. */
export function withAppCapability(caps: ISessionCapability, url: string): ISessionCapability {
  const copy: ISessionCapability = JSON.parse(JSON.stringify(caps));
  setAppCapability(copy, url);
  return copy;
}
