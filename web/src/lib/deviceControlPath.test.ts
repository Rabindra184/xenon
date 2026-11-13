import { describe, expect, it } from 'vitest';
import type { IDevice } from '../interfaces/IDevice';
import {
  deviceControlPath,
  joinSearch,
  pickControlPhone,
  searchWithoutHost,
} from './deviceControlPath';

const H1 = 'http://10.0.0.1:4723';
const H2 = 'http://10.0.0.2:4724';
const dev = (udid: string, host: string): IDevice =>
  ({ udid, host, name: `${udid} on ${host}`, platform: 'android' }) as IDevice;

describe('deviceControlPath', () => {
  it('names the phone by udid and host', () => {
    expect(deviceControlPath({ udid: 'emulator-5554', host: H1 })).toBe(
      '/devices/emulator-5554/control?host=http%3A%2F%2F10.0.0.1%3A4723',
    );
  });

  it('encodes the udid and keeps the tab', () => {
    expect(deviceControlPath({ udid: 'a b/c', host: H2 }, 'logs')).toBe(
      '/devices/a%20b%2Fc/control/logs?host=http%3A%2F%2F10.0.0.2%3A4724',
    );
  });
});

describe('pickControlPhone', () => {
  const twins = [dev('emulator-5554', H1), dev('emulator-5554', H2), dev('U-9', H1)];

  it('opens the one phone with that udid when the link has no host', () => {
    expect(pickControlPhone(twins, 'U-9', null)).toEqual({ kind: 'found', device: twins[2] });
  });

  it('lists the phones when two servers have the udid and the link has no host', () => {
    expect(pickControlPhone(twins, 'emulator-5554', null)).toEqual({
      kind: 'choose',
      devices: [twins[0], twins[1]],
    });
  });

  it('opens the phone the host names', () => {
    expect(pickControlPhone(twins, 'emulator-5554', H2)).toEqual({
      kind: 'found',
      device: twins[1],
    });
  });

  it('finds nothing for a host no listed phone of that udid has', () => {
    expect(pickControlPhone(twins, 'emulator-5554', 'http://10.0.0.3:4723')).toEqual({
      kind: 'none',
    });
    // A host of another phone is not this udid's.
    expect(pickControlPhone([dev('U-9', H2)], 'U-9', H1)).toEqual({ kind: 'none' });
  });

  it('finds nothing for an unknown udid', () => {
    expect(pickControlPhone(twins, 'nope', null)).toEqual({ kind: 'none' });
  });
});

describe('the rest of a query', () => {
  it('joins a path that has a query with another', () => {
    expect(joinSearch('/p?host=h', '?view=table')).toBe('/p?host=h&view=table');
    expect(joinSearch('/p', '?view=table')).toBe('/p?view=table');
    expect(joinSearch('/p?host=h', '')).toBe('/p?host=h');
    expect(joinSearch('/p?host=h', '?')).toBe('/p?host=h');
  });

  it('drops the host, keeping the rest', () => {
    expect(searchWithoutHost('?host=h&platform=ios')).toBe('?platform=ios');
    expect(searchWithoutHost('?host=h')).toBe('');
    expect(searchWithoutHost('')).toBe('');
  });
});
