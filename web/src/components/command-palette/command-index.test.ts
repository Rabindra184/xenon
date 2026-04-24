import { describe, it, expect } from 'vitest';
import { CommandIndex } from './command-index';

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
      { udid: 'ABC-1', name: 'iPhone 15 Pro' },
      { udid: 'XYZ-9', name: 'Pixel 8' },
    ]);
    const res = idx.search('iph', 8);
    expect(res.some((r) => r.kind === 'device' && r.label === 'iPhone 15 Pro')).toBe(true);
  });

  it('finds device by UDID', () => {
    const idx = new CommandIndex();
    idx.setDevices([{ udid: 'XYZ-9', name: 'Pixel 8' }]);
    const res = idx.search('xyz', 8);
    expect(res.some((r) => r.kind === 'device' && r.label === 'Pixel 8')).toBe(true);
  });

  it('respects max cap', () => {
    const idx = new CommandIndex();
    idx.setDevices([
      { udid: 'A1', name: 'a' },
      { udid: 'A2', name: 'aa' },
      { udid: 'A3', name: 'aaa' },
    ]);
    expect(idx.search('a', 2).length).toBe(2);
  });

  it('routes device selection to /devices/:udid/control', () => {
    const idx = new CommandIndex();
    idx.setDevices([{ udid: 'XYZ-9', name: 'Pixel 8' }]);
    const res = idx.search('pixel', 8);
    expect(res[0].path).toBe('/devices/XYZ-9/control');
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
