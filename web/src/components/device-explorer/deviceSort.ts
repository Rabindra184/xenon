import type { IDevice } from '../../interfaces/IDevice';
import { deviceTeamName, deviceTitle } from '../device-card/device-card/deviceIdentity';
import { DEVICE_STATES, deviceState } from '../device-card/device-card/deviceState';
import { isVirtual } from './deviceFilters';

export type SortKey = 'status' | 'device' | 'platform' | 'type' | 'team' | 'host';
export type SortDir = 'asc' | 'desc';
export interface DeviceSort {
  key: SortKey;
  dir: SortDir;
}
export interface SortContext {
  now: number;
  teams?: Map<string, string>;
}

export const DEFAULT_SORT: DeviceSort = { key: 'status', dir: 'asc' };
const KEYS: SortKey[] = ['status', 'device', 'platform', 'type', 'team', 'host'];

// Case-insensitive, and numeric-aware so "9" sorts before "10". A shared
// collator, not `a.localeCompare(b, ...)` per call: the options object makes
// `localeCompare` rebuild its collation every time, and this runs on every
// render (the 10s poll, every search keystroke, every toast).
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const text = (a: string, b: string) => collator.compare(a, b);

function compareBy(a: IDevice, b: IDevice, key: SortKey, ctx: SortContext): number {
  switch (key) {
    case 'status':
      return (
        DEVICE_STATES.indexOf(deviceState(a, ctx.now)) -
        DEVICE_STATES.indexOf(deviceState(b, ctx.now))
      );
    case 'device':
      return text(deviceTitle(a), deviceTitle(b));
    case 'platform':
      return text(a.platform || '', b.platform || '') || text(a.sdk || '', b.sdk || '');
    case 'type':
      return Number(isVirtual(a)) - Number(isVirtual(b));
    case 'team':
      return text(deviceTeamName(a, ctx.teams) ?? '', deviceTeamName(b, ctx.teams) ?? '');
    case 'host':
      return text(a.host || '', b.host || '');
  }
}

/** A sorted copy. Ties fall back to the title, then the UDID, always ascending. */
export function sortDevices(list: IDevice[], sort: DeviceSort, ctx: SortContext): IDevice[] {
  const sign = sort.dir === 'desc' ? -1 : 1;
  return list.slice().sort((a, b) => {
    if (sort.key === 'team') {
      // Shared (no team) goes last whichever way the column is sorted.
      const sa = deviceTeamName(a, ctx.teams) === null;
      const sb = deviceTeamName(b, ctx.teams) === null;
      if (sa !== sb) return sa ? 1 : -1;
    }
    return (
      sign * compareBy(a, b, sort.key, ctx) ||
      text(deviceTitle(a), deviceTitle(b)) ||
      text(a.udid, b.udid)
    );
  });
}

export function parseSort(params: URLSearchParams): DeviceSort {
  const key = params.get('sort') as SortKey | null;
  if (!key || !KEYS.includes(key)) return DEFAULT_SORT;
  return { key, dir: params.get('dir') === 'desc' ? 'desc' : 'asc' };
}

/** Writes the sort into `params`, leaving the default out so plain links stay plain. */
export function sortToParams(params: URLSearchParams, sort: DeviceSort): void {
  params.delete('sort');
  params.delete('dir');
  if (sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir) return;
  params.set('sort', sort.key);
  if (sort.dir === 'desc') params.set('dir', 'desc');
}
