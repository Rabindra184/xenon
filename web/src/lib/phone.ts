/**
 * One phone, as the server names it: its udid and the host of the server it
 * is on. A udid alone can name two phones (an emulator's `emulator-5554`
 * repeats on every machine), so every per-phone request sends both.
 */
export interface PhoneRef {
  udid: string;
  host: string;
}

/** The one key for a phone in sets, maps, React keys, drag data and ids. */
export function phoneKey(p: PhoneRef): string {
  return `${p.udid}@${p.host}`;
}

export function samePhone(a: PhoneRef, b: PhoneRef): boolean {
  return a.udid === b.udid && a.host === b.host;
}

/** `prefix` plus the phone's key, safe as an element id and in a selector. */
export function phoneDomId(prefix: string, p: PhoneRef): string {
  return `${prefix}${phoneKey(p).replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/**
 * `/control/<udid>/<action>?host=<host>`, relative to `/xenon/api` as
 * `apiClient`'s paths are. Any other query follows the host; a `host` in it
 * is dropped, so the request is always about the phone `p` names.
 */
export function controlPath(
  p: PhoneRef,
  action: string,
  query: Record<string, string> = {},
): string {
  const rest = Object.entries(query).filter(([k]) => k !== 'host');
  const search = [['host', p.host], ...rest]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `/control/${encodeURIComponent(p.udid)}/${action}?${search}`;
}

/** `controlPath` with the `/xenon/api` prefix, for a raw fetch, an `<img>` or a beacon. */
export function controlUrl(p: PhoneRef, action: string, query?: Record<string, string>): string {
  return `/xenon/api${controlPath(p, action, query)}`;
}

/**
 * A phone's server as testers read it: `10.0.0.2:4723`, not
 * `http://10.0.0.2:4723`. A host that isn't a URL is shown as it is.
 */
export function serverLabel(host: string): string {
  try {
    return new URL(host.includes('://') ? host : `http://${host}`).host || host;
  } catch {
    return host;
  }
}

/**
 * Whether two or more servers have a phone of `udid` among `phones`. Only
 * then does a label need the server to tell them apart.
 */
export function udidRepeats(phones: PhoneRef[], udid: string): boolean {
  return new Set(phones.filter((p) => p.udid === udid).map((p) => p.host)).size > 1;
}
