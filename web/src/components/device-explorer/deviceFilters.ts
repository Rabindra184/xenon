import type { IDevice } from '../../interfaces/IDevice';
import { platformLabel } from '../../lib/labels';
import { deviceTitle } from '../device-card/device-card/deviceIdentity';
import {
  DEVICE_STATES,
  deviceState,
  type DeviceState,
} from '../device-card/device-card/deviceState';

// One state per device, shared with the cards, so the filters add up to All.
export type StatusFilter = 'all' | DeviceState;
export type PlatformFilter = 'all' | 'android' | 'ios' | 'tvos';
export type TypeFilter = 'all' | 'real' | 'virtual';

export interface DeviceFilters {
  status: StatusFilter;
  platform: PlatformFilter;
  type: TypeFilter;
  /** As typed: the box is filled from the link, so it keeps a trailing space. */
  q: string;
}

export const NO_FILTERS: DeviceFilters = { status: 'all', platform: 'all', type: 'all', q: '' };

const STATUSES: StatusFilter[] = ['all', ...DEVICE_STATES];
const PLATFORMS: PlatformFilter[] = ['all', 'android', 'ios', 'tvos'];
const TYPES: TypeFilter[] = ['all', 'real', 'virtual'];

// An unknown value (an old link, a typo) counts as All.
function pick<T extends string>(value: string | null, allowed: T[]): T {
  return allowed.includes(value as T) ? (value as T) : allowed[0];
}

export function parseFilters(params: URLSearchParams): DeviceFilters {
  const q = params.get('q') ?? '';
  return {
    status: pick(params.get('status'), STATUSES),
    platform: pick(params.get('platform'), PLATFORMS),
    type: pick(params.get('type'), TYPES),
    q: q.trim() ? q : '',
  };
}

/** Defaults are left out, so plain /devices shows everything. */
export function filtersToParams(f: DeviceFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.status !== 'all') params.set('status', f.status);
  if (f.platform !== 'all') params.set('platform', f.platform);
  if (f.type !== 'all') params.set('type', f.type);
  if (f.q.trim()) params.set('q', f.q);
  return params;
}

export function isVirtual(d: Pick<IDevice, 'deviceType' | 'realDevice'>): boolean {
  if (d.deviceType === 'simulator' || d.deviceType === 'emulator') return true;
  return !d.deviceType && d.realDevice === false;
}

function platformOf(d: IDevice): PlatformFilter | null {
  const p = (d.platform || '').toLowerCase();
  return p === 'android' || p === 'ios' || p === 'tvos' ? p : null;
}

/** Everything the card shows, so any of it can be searched. */
export function searchText(d: IDevice): string {
  const kind =
    d.deviceType === 'emulator' ? 'Emulator' : d.deviceType === 'simulator' ? 'Simulator' : '';
  return [
    deviceTitle(d),
    d.name,
    d.manufacturer,
    d.model,
    platformLabel(d.platform),
    d.sdk,
    kind,
    d.teamName,
    d.udid,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** `ignore` leaves one filter out, for that control's own counts. */
export function deviceMatches(
  d: IDevice,
  f: DeviceFilters,
  now: number,
  ignore?: 'status' | 'platform' | 'type',
): boolean {
  if (ignore !== 'status' && f.status !== 'all' && deviceState(d, now) !== f.status) return false;
  if (ignore !== 'platform' && f.platform !== 'all' && platformOf(d) !== f.platform) return false;
  if (ignore !== 'type' && f.type !== 'all') {
    if ((f.type === 'virtual') !== isVirtual(d)) return false;
  }
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = searchText(d);
  return words.every((w) => text.includes(w));
}

export interface FacetCounts {
  status: Record<StatusFilter, number>;
  platform: Record<PlatformFilter, number>;
  type: Record<TypeFilter, number>;
}

const zeros = <T extends string>(keys: T[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;

/**
 * Each control's counts apply the other filters and the search but not its
 * own selection, so a number is what clicking it would show.
 */
export function facetCounts(devices: IDevice[], f: DeviceFilters, now: number): FacetCounts {
  const status = zeros(STATUSES);
  const platform = zeros(PLATFORMS);
  const type = zeros(TYPES);
  for (const d of devices) {
    if (deviceMatches(d, f, now, 'status')) {
      status.all += 1;
      status[deviceState(d, now)] += 1;
    }
    if (deviceMatches(d, f, now, 'platform')) {
      platform.all += 1;
      const p = platformOf(d);
      if (p) platform[p] += 1;
    }
    if (deviceMatches(d, f, now, 'type')) {
      type.all += 1;
      type[isVirtual(d) ? 'virtual' : 'real'] += 1;
    }
  }
  return { status, platform, type };
}

/** tvOS gets a segment only when the lab has one: an always-empty one is noise. */
export function hasTvos(devices: IDevice[]): boolean {
  return devices.some((d) => platformOf(d) === 'tvos');
}

/** Anything other than every device: Clear shows only then. */
export function isFiltered(f: DeviceFilters): boolean {
  return f.status !== 'all' || f.platform !== 'all' || f.type !== 'all' || f.q.trim() !== '';
}

/** "5 devices" when every device shows, else "2 of 5 devices". */
export function resultLabel(shown: number, total: number): string {
  const noun = (n: number) => (n === 1 ? 'device' : 'devices');
  return shown === total ? `${total} ${noun(total)}` : `${shown} of ${total} ${noun(total)}`;
}
