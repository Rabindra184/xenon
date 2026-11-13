import type { IDevice } from '../interfaces/IDevice';
import type { PhoneRef } from './phone';

/**
 * Device control's address for one phone: its udid in the path and its
 * server's host in `?host=`, so a link, a reload or a tab switch opens the
 * phone it names when two servers have that udid.
 */
export function deviceControlPath(p: PhoneRef, tab?: string): string {
  return `/devices/${encodeURIComponent(p.udid)}/control${tab ? `/${tab}` : ''}?host=${encodeURIComponent(p.host)}`;
}

export type ControlPick =
  | { kind: 'found'; device: IDevice }
  | { kind: 'choose'; devices: IDevice[] }
  | { kind: 'none' };

/**
 * Which listed phone a device control link opens. A host names one phone, or
 * none. A link without one (from before links carried the host) opens the
 * only phone of that udid, and lists them when two or more servers have it.
 */
export function pickControlPhone(
  devices: IDevice[],
  udid: string,
  host: string | null,
): ControlPick {
  if (host) {
    const device = devices.find((d) => d.udid === udid && d.host === host);
    return device ? { kind: 'found', device } : { kind: 'none' };
  }
  const same = devices.filter((d) => d.udid === udid);
  if (same.length === 1) return { kind: 'found', device: same[0] };
  if (same.length > 1) return { kind: 'choose', devices: same };
  return { kind: 'none' };
}

/** `path`, which may have a query of its own, followed by `search`'s parameters. */
export function joinSearch(path: string, search: string): string {
  const rest = search.replace(/^\?/, '');
  if (!rest) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${rest}`;
}

/** `search` without its `host`: what is left belongs to the Devices page. */
export function searchWithoutHost(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('host');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
