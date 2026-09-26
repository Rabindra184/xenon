import { describe, expect, it } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';
import {
  deviceMatches,
  facetCounts,
  filtersToParams,
  hasTvos,
  isFiltered,
  isVirtual,
  NO_FILTERS,
  parseFilters,
  resultLabel,
  type DeviceFilters,
} from './deviceFilters';

const NOW = 1_700_000_000_000;
const dev = (over: Partial<IDevice>): IDevice => ({
  name: 'x',
  host: 'http://127.0.0.1:4723',
  udid: 'U',
  sdk: '14',
  deviceType: 'real',
  offline: false,
  userBlocked: false,
  busy: false,
  platform: 'android',
  realDevice: true,
  ...over,
});

const S9 = dev({
  udid: '381103b720057ece',
  name: 'star2ltexx',
  marketingName: 'Galaxy S9+',
  model: 'SM-G965F',
  manufacturer: 'samsung',
  sdk: '10',
  teamName: 'Payments',
});
const IPHONE = dev({
  udid: '00008150-000E78612168C01C',
  name: 'iPhone',
  marketingName: 'iPhone 17 Pro',
  platform: 'ios',
  sdk: '26.1',
  busy: true,
  session_id: 'sess-1',
});
const SIM = dev({
  udid: 'SIM-1',
  name: 'iPhone 16 Simulator',
  platform: 'ios',
  deviceType: 'simulator',
  realDevice: false,
  sdk: '18.2',
});
const EMU = dev({
  udid: 'emulator-5554',
  name: 'Pixel 8 API 34',
  deviceType: 'emulator',
  realDevice: false,
  offline: true,
});
const TV = dev({ udid: 'TV-1', name: 'Living Room', platform: 'tvos', sdk: '18.0' });
const ALL = [S9, IPHONE, SIM, EMU];

const f = (over: Partial<DeviceFilters>): DeviceFilters => ({ ...NO_FILTERS, ...over });
const shown = (filters: DeviceFilters) =>
  ALL.filter((d) => deviceMatches(d, filters, NOW)).map((d) => d.udid);

describe('parseFilters / filtersToParams', () => {
  it('round-trips every filter through the link', () => {
    const filters = f({ status: 'ready', platform: 'ios', type: 'real', q: 'galaxy' });
    const params = filtersToParams(filters);
    expect(params.toString()).toBe('status=ready&platform=ios&type=real&q=galaxy');
    expect(parseFilters(params)).toEqual(filters);
  });

  it('leaves defaults out, so plain /devices shows everything', () => {
    expect(filtersToParams(NO_FILTERS).toString()).toBe('');
    expect(filtersToParams(f({ q: '   ' })).toString()).toBe('');
    expect(parseFilters(new URLSearchParams(''))).toEqual(NO_FILTERS);
  });

  it('treats an unknown value as All', () => {
    expect(parseFilters(new URLSearchParams('status=banana&platform=windows&type=robot'))).toEqual(
      NO_FILTERS,
    );
  });

  it('accepts tvOS', () => {
    expect(parseFilters(new URLSearchParams('platform=tvos')).platform).toBe('tvos');
  });

  // The box is filled from the link: trimming there would eat the space typed
  // before the next word.
  it('keeps a trailing space while you type', () => {
    expect(parseFilters(filtersToParams(f({ q: 'samsung ' }))).q).toBe('samsung ');
  });
});

describe('isVirtual', () => {
  it('counts simulators and emulators as virtual', () => {
    expect(isVirtual({ deviceType: 'simulator', realDevice: false })).toBe(true);
    expect(isVirtual({ deviceType: 'emulator', realDevice: false })).toBe(true);
    expect(isVirtual({ deviceType: 'real', realDevice: true })).toBe(false);
  });

  it('falls back to realDevice when the type is missing', () => {
    expect(isVirtual({ deviceType: undefined as any, realDevice: false })).toBe(true);
    expect(isVirtual({ deviceType: undefined as any, realDevice: true })).toBe(false);
  });
});

describe('deviceMatches', () => {
  it('filters by platform', () => {
    expect(shown(f({ platform: 'ios' }))).toEqual([IPHONE.udid, SIM.udid]);
    expect(shown(f({ platform: 'android' }))).toEqual([S9.udid, EMU.udid]);
  });

  it('filters by type', () => {
    expect(shown(f({ type: 'real' }))).toEqual([S9.udid, IPHONE.udid]);
    expect(shown(f({ type: 'virtual' }))).toEqual([SIM.udid, EMU.udid]);
  });

  it('filters by status', () => {
    expect(shown(f({ status: 'busy' }))).toEqual([IPHONE.udid]);
    expect(shown(f({ status: 'offline' }))).toEqual([EMU.udid]);
  });

  it('combines the filters', () => {
    expect(shown(f({ platform: 'ios', type: 'virtual' }))).toEqual([SIM.udid]);
    expect(shown(f({ platform: 'android', type: 'real', status: 'ready' }))).toEqual([S9.udid]);
  });
});

describe('search', () => {
  // The card shows "Galaxy S9+"; search used to match only name and udid.
  it('finds the name the card shows, and the codename', () => {
    expect(shown(f({ q: 'Galaxy' }))).toEqual([S9.udid]);
    expect(shown(f({ q: 'star2' }))).toEqual([S9.udid]);
  });

  it('needs every word, in any order, across maker, model and OS version', () => {
    expect(shown(f({ q: '10 samsung' }))).toEqual([S9.udid]);
    expect(shown(f({ q: 'sm-g965f' }))).toEqual([S9.udid]);
    expect(shown(f({ q: 'samsung 26' }))).toEqual([]);
  });

  it('finds a UDID fragment, the kind of virtual device and the team', () => {
    expect(shown(f({ q: '000e7861' }))).toEqual([IPHONE.udid]);
    expect(shown(f({ q: 'emulator' }))).toEqual([EMU.udid]);
    expect(shown(f({ q: 'payments' }))).toEqual([S9.udid]);
  });

  it('matches everything for an empty or blank query', () => {
    expect(shown(f({ q: '  ' }))).toHaveLength(4);
  });
});

describe('facetCounts', () => {
  it('counts each control with the other filters but not its own', () => {
    const c = facetCounts(ALL, f({ platform: 'ios' }), NOW);
    expect(c.status).toEqual({
      all: 2,
      ready: 1,
      busy: 1,
      reserved: 0,
      maintenance: 0,
      offline: 0,
    });
    expect(c.platform).toEqual({ all: 4, android: 2, ios: 2, tvos: 0 });
    expect(c.type).toEqual({ all: 2, real: 1, virtual: 1 });
  });

  it('applies the search to every control', () => {
    const c = facetCounts(ALL, f({ q: 'iphone' }), NOW);
    expect(c.platform).toEqual({ all: 2, android: 0, ios: 2, tvos: 0 });
    expect(c.status.all).toBe(2);
    expect(c.type.all).toBe(2);
  });

  it('adds each control up to its All', () => {
    const c = facetCounts([...ALL, TV], f({ status: 'ready' }), NOW);
    const sum = (r: Record<string, number>) =>
      Object.entries(r).reduce((n, [k, v]) => (k === 'all' ? n : n + v), 0);
    expect(sum(c.status)).toBe(c.status.all);
    expect(sum(c.platform)).toBe(c.platform.all);
    expect(sum(c.type)).toBe(c.type.all);
  });
});

describe('hasTvos', () => {
  it('is true only when the list has a tvOS device', () => {
    expect(hasTvos(ALL)).toBe(false);
    expect(hasTvos([...ALL, TV])).toBe(true);
  });
});

describe('isFiltered', () => {
  it('is false with nothing filtered, or only a blank search', () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered(f({ q: '   ' }))).toBe(false);
  });

  it('is true for each filter on its own', () => {
    const each = [
      f({ status: 'ready' }),
      f({ platform: 'ios' }),
      f({ type: 'virtual' }),
      f({ q: 'galaxy' }),
    ];
    for (const x of each) expect(isFiltered(x)).toBe(true);
  });
});

describe('resultLabel', () => {
  it('says how many devices show', () => {
    expect(resultLabel(5, 5)).toBe('5 devices');
    expect(resultLabel(1, 1)).toBe('1 device');
    expect(resultLabel(2, 5)).toBe('2 of 5 devices');
    expect(resultLabel(0, 5)).toBe('0 of 5 devices');
  });
});
