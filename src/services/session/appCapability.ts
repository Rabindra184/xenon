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

/**
 * The uploaded app a hub sends a node with its create (ENH-19), beside the
 * ticketed URL in `appium:app`: enough for the node to recognise a build it
 * already holds (`NodeAppCache`) without asking the hub again. An older node
 * ignores it and lets its driver download the URL, as before.
 */
export interface HubApp {
  /** The App row's id on the hub. */
  id: string;
  /** The bytes' md5, which the hub keeps unique per app. */
  md5: string;
  size: number;
  /** The file's extension, dot included (`.apk`, `.ipa`, `.zip`). */
  extension: string;
}

/** The `xe:options` field a hub sends it in. */
export const HUB_APP_OPTION = 'hubApp';

const APP_ID = /^[A-Za-z0-9-]{1,64}$/;
const MD5 = /^[0-9a-f]{32}$/;
const EXTENSION = /^\.[a-z0-9]{1,8}$/;

/**
 * A `hubApp` value as a node may use it, or undefined. Every field names a
 * file on the node's disk, so each is held to a strict form.
 */
export function readHubApp(value: unknown): HubApp | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { id, md5, size, extension } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !APP_ID.test(id)) return undefined;
  if (typeof md5 !== 'string' || !MD5.test(md5)) return undefined;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) return undefined;
  if (typeof extension !== 'string' || !EXTENSION.test(extension)) return undefined;
  return { id, md5, size, extension };
}

/** The app capability's current value (alwaysMatch first), if it is a string. */
export function appCapabilityOf(caps: ISessionCapability): string | undefined {
  const buckets = [
    caps?.alwaysMatch,
    Array.isArray(caps?.firstMatch) ? caps.firstMatch[0] : undefined,
  ];
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const key of APP_KEYS) {
      const value = (bucket as any)[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }
  return undefined;
}

/** `url` without its query: a download URL with its ticket taken off. */
export function withoutQuery(url: string): string {
  const at = url.indexOf('?');
  return at === -1 ? url : url.slice(0, at);
}
