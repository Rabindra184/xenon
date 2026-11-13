import { describe, it, expect } from 'vitest';
import { CommandIndex } from './command-index';

const H = 'http://127.0.0.1:4723';

describe('CommandIndex', () => {
  it('returns nav items for empty query', () => {
    const idx = new CommandIndex();
    const res = idx.search('', 8);
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((r) => r.kind === 'nav')).toBe(true);
  });

  it('finds Settings for "set"', () => {
    const idx = new CommandIndex();
    const res = idx.search('set', 8);
    expect(res.some((r) => r.label === 'Settings')).toBe(true);
  });

  it('finds devices by partial name', () => {
    const idx = new CommandIndex();
    idx.setDevices([
      { udid: 'ABC-1', host: H, name: 'iPhone 15 Pro' },
      { udid: 'XYZ-9', host: H, name: 'Pixel 8' },
    ]);
    const res = idx.search('iph', 8);
    expect(res.some((r) => r.kind === 'device' && r.label === 'iPhone 15 Pro')).toBe(true);
  });

  it('finds device by UDID', () => {
    const idx = new CommandIndex();
    idx.setDevices([{ udid: 'XYZ-9', host: H, name: 'Pixel 8' }]);
    const res = idx.search('xyz', 8);
    expect(res.some((r) => r.kind === 'device' && r.label === 'Pixel 8')).toBe(true);
  });

  it('respects max cap', () => {
    const idx = new CommandIndex();
    idx.setDevices([
      { udid: 'A1', host: H, name: 'a' },
      { udid: 'A2', host: H, name: 'aa' },
      { udid: 'A3', host: H, name: 'aaa' },
    ]);
    expect(idx.search('a', 2).length).toBe(2);
  });

  it('routes device selection to the phone’s device control, by udid and host', () => {
    const idx = new CommandIndex();
    idx.setDevices([{ udid: 'XYZ-9', host: 'http://10.0.0.1:4723', name: 'Pixel 8' }]);
    const res = idx.search('pixel', 8);
    expect(res[0].path).toBe('/devices/XYZ-9/control?host=http%3A%2F%2F10.0.0.1%3A4723');
  });

  // A hub and its node can both list emulator-5554: two entries, one per phone.
  it('keeps two servers’ phones of one udid apart', () => {
    const idx = new CommandIndex();
    idx.setDevices([
      { udid: 'emulator-5554', host: 'http://10.0.0.1:4723', name: 'Pixel 7' },
      { udid: 'emulator-5554', host: 'http://10.0.0.2:4724', name: 'Pixel 8' },
    ]);
    const res = idx.search('emulator-5554', 8);
    expect(res.map((r) => r.id)).toEqual([
      'device:emulator-5554@http://10.0.0.1:4723',
      'device:emulator-5554@http://10.0.0.2:4724',
    ]);
    expect(res.map((r) => r.path)).toEqual([
      '/devices/emulator-5554/control?host=http%3A%2F%2F10.0.0.1%3A4723',
      '/devices/emulator-5554/control?host=http%3A%2F%2F10.0.0.2%3A4724',
    ]);
    // Each says which server it is on, as testers read it; a udid one server
    // has needs no host.
    expect(res.map((r) => r.sub)).toEqual([
      'emulator-5554 · 10.0.0.1:4723',
      'emulator-5554 · 10.0.0.2:4724',
    ]);
    idx.setDevices([{ udid: 'emulator-5554', host: 'http://10.0.0.1:4723', name: 'Pixel 7' }]);
    expect(idx.search('emulator-5554', 8)[0].sub).toBe('emulator-5554');
  });

  it('routes session selection to /builds with query param', () => {
    const idx = new CommandIndex();
    idx.setSessions([{ id: 'abc/def', name: 'my session' }]);
    const res = idx.search('my', 8);
    expect(res[0].path).toBe('/builds?session=abc%2Fdef');
  });

  it('spec "settings" path is preserved', () => {
    const idx = new CommandIndex();
    const res = idx.search('settings', 8);
    const settingsItem = res.find((r) => r.label === 'Settings');
    expect(settingsItem?.path).toBe('/settings');
  });
});

describe('CommandIndex — builds and the destinations it used to miss', () => {
  it('finds a build by name and opens it', () => {
    const idx = new CommandIndex();
    idx.setBuilds([
      { id: 'b-1', name: 'author-appium-java skill', sessionCount: 2, failedCount: 1 },
    ]);
    const [hit] = idx.search('author-appium');
    expect(hit).toMatchObject({
      kind: 'build',
      label: 'author-appium-java skill',
      sub: '2 sessions · 1 failed',
      path: '/builds/b-1',
    });
  });

  it.each([
    ['Live devices', '/devices/live'],
    ['Selector health', '/selector-health'],
    ['Users', '/settings/users'],
    ['Profile', '/profile'],
  ])('navigates to %s', (label, path) => {
    const idx = new CommandIndex();
    expect(idx.search(label)[0]).toMatchObject({ kind: 'nav', label, path });
  });
});
