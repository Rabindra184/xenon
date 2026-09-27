import { describe, expect, it } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';
import { DEFAULT_SORT, parseSort, sortDevices, sortToParams } from './deviceSort';

const d = (udid: string, over: Partial<IDevice> = {}): IDevice =>
  ({
    udid,
    name: udid,
    host: 'http://127.0.0.1:4723',
    sdk: '14',
    deviceType: 'real',
    platform: 'android',
    realDevice: true,
    offline: false,
    userBlocked: false,
    busy: false,
    ...over,
  }) as IDevice;
const ids = (list: IDevice[]) => list.map((x) => x.udid);
const ctx = { now: Date.now() };

describe('sortDevices', () => {
  it('orders by status (ready, busy, reserved, maintenance, offline), then name', () => {
    const list = [
      d('off', { offline: true }),
      d('b', { busy: true, session_id: 'appium-1' }),
      d('maint', { userBlocked: true }),
      d('rdy-z', { name: 'Zeta' }),
      d('rdy-a', { name: 'Alpha' }),
    ];
    expect(ids(sortDevices(list, DEFAULT_SORT, ctx))).toEqual([
      'rdy-a',
      'rdy-z',
      'b',
      'maint',
      'off',
    ]);
  });

  it('reverses on desc but keeps the name tie-break ascending', () => {
    const list = [d('a', { name: 'A' }), d('b', { name: 'B' }), d('x', { offline: true })];
    expect(ids(sortDevices(list, { key: 'status', dir: 'desc' }, ctx))).toEqual(['x', 'a', 'b']);
  });

  it('sorts by device title, ignoring case', () => {
    const list = [d('1', { name: 'beta' }), d('2', { name: 'Alpha' }), d('3', { name: 'gamma' })];
    expect(ids(sortDevices(list, { key: 'device', dir: 'asc' }, ctx))).toEqual(['2', '1', '3']);
  });

  it('sorts by platform, then by OS version numerically (9 before 10)', () => {
    const list = [
      d('i', { platform: 'ios', sdk: '17.0' }),
      d('a10', { sdk: '10' }),
      d('a9', { sdk: '9' }),
    ];
    expect(ids(sortDevices(list, { key: 'platform', dir: 'asc' }, ctx))).toEqual([
      'a9',
      'a10',
      'i',
    ]);
  });

  it('puts real before virtual', () => {
    const list = [d('emu', { deviceType: 'emulator', realDevice: false }), d('phone')];
    expect(ids(sortDevices(list, { key: 'type', dir: 'asc' }, ctx))).toEqual(['phone', 'emu']);
  });

  it('sorts teams by name, with Shared last in both directions', () => {
    const teams = new Map([
      ['t1', 'QA'],
      ['t2', 'Mobile'],
    ]);
    const list = [d('shared'), d('qa', { teamId: 't1' }), d('mob', { teamId: 't2' })];
    expect(ids(sortDevices(list, { key: 'team', dir: 'asc' }, { ...ctx, teams }))).toEqual([
      'mob',
      'qa',
      'shared',
    ]);
    expect(ids(sortDevices(list, { key: 'team', dir: 'desc' }, { ...ctx, teams }))).toEqual([
      'qa',
      'mob',
      'shared',
    ]);
  });

  it('sorts by host', () => {
    const list = [d('n2', { host: 'http://node-b:4723' }), d('n1', { host: 'http://node-a:4723' })];
    expect(ids(sortDevices(list, { key: 'host', dir: 'asc' }, ctx))).toEqual(['n1', 'n2']);
  });

  it('breaks ties by title, then UDID, so the order is stable', () => {
    const list = [d('u2', { name: 'Same' }), d('u1', { name: 'Same' })];
    expect(ids(sortDevices(list, { key: 'type', dir: 'asc' }, ctx))).toEqual(['u1', 'u2']);
  });

  it('does not change the list it was given', () => {
    const list = [d('b', { name: 'B' }), d('a', { name: 'A' })];
    sortDevices(list, { key: 'device', dir: 'asc' }, ctx);
    expect(ids(list)).toEqual(['b', 'a']);
  });
});

describe('sort in the URL', () => {
  it('reads a sort, and falls back to the default for anything else', () => {
    expect(parseSort(new URLSearchParams('sort=team&dir=desc'))).toEqual({
      key: 'team',
      dir: 'desc',
    });
    expect(parseSort(new URLSearchParams('sort=team'))).toEqual({ key: 'team', dir: 'asc' });
    expect(parseSort(new URLSearchParams('sort=nope&dir=desc'))).toEqual(DEFAULT_SORT);
    expect(parseSort(new URLSearchParams(''))).toEqual(DEFAULT_SORT);
  });

  it("writes only what isn't the default", () => {
    const p = new URLSearchParams('status=busy');
    sortToParams(p, DEFAULT_SORT);
    expect(p.toString()).toBe('status=busy');
    sortToParams(p, { key: 'device', dir: 'desc' });
    expect(p.toString()).toBe('status=busy&sort=device&dir=desc');
    sortToParams(p, { key: 'device', dir: 'asc' });
    expect(p.toString()).toBe('status=busy&sort=device');
  });
});
