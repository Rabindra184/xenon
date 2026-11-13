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
 * `apiClient`'s paths are. Any other query follows the host.
 */
export function controlPath(
  p: PhoneRef,
  action: string,
  query: Record<string, string> = {},
): string {
  const search = Object.entries({ host: p.host, ...query })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `/control/${encodeURIComponent(p.udid)}/${action}?${search}`;
}

/** `controlPath` with the `/xenon/api` prefix, for a raw fetch, an `<img>` or a beacon. */
export function controlUrl(p: PhoneRef, action: string, query?: Record<string, string>): string {
  return `/xenon/api${controlPath(p, action, query)}`;
}
