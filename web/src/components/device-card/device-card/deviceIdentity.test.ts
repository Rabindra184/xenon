import { describe, expect, it } from 'vitest';
import {
  deviceFormFactor,
  deviceSubtitle,
  deviceTeamName,
  deviceTitle,
  type IdentityInput,
} from './deviceIdentity';

const d = (over: Partial<IdentityInput> = {}): IdentityInput => ({
  name: 'star2ltexx',
  platform: 'android',
  sdk: '10',
  deviceType: 'real',
  ...over,
});

describe('deviceTitle', () => {
  it('prefers the marketing name', () => {
    expect(deviceTitle(d({ marketingName: 'Galaxy S9+' }))).toBe('Galaxy S9+');
  });

  it('falls back to today’s name', () => {
    expect(deviceTitle(d())).toBe('star2ltexx');
    expect(deviceTitle(d({ marketingName: '  ' }))).toBe('star2ltexx');
  });
});

describe('deviceSubtitle', () => {
  it('reads maker, model and OS for a real device', () => {
    expect(deviceSubtitle(d({ manufacturer: 'samsung', model: 'SM-G965F' }))).toBe(
      'Samsung SM-G965F · Android 10',
    );
  });

  it('says Emulator or Simulator instead of a maker', () => {
    expect(deviceSubtitle(d({ deviceType: 'emulator', sdk: '14' }))).toBe('Emulator · Android 14');
    expect(deviceSubtitle(d({ deviceType: 'simulator', platform: 'ios', sdk: '18.2' }))).toBe(
      'Simulator · iOS 18.2',
    );
  });

  it('leaves out what it does not know', () => {
    expect(deviceSubtitle(d())).toBe('Android 10');
  });
});

describe('deviceFormFactor', () => {
  it('uses the reported form factor, a phone when unknown', () => {
    expect(deviceFormFactor(d({ formFactor: 'tablet' }))).toBe('tablet');
    expect(deviceFormFactor(d())).toBe('phone');
  });
});

describe('deviceTeamName', () => {
  it("names a device's team from the map, then its own name, then an id prefix", () => {
    const teams = new Map([['t1', 'QA']]);
    expect(
      deviceTeamName({ teamId: 't1', teamName: 'Old' }, teams),
    ).toBe('QA');
    expect(
      deviceTeamName({ teamId: 't2', teamName: 'Mobile' }, teams),
    ).toBe('Mobile');
    expect(
      deviceTeamName({ teamId: 'abcdef123', teamName: null }, teams),
    ).toBe('Team abcdef');
    expect(
      deviceTeamName({ teamId: null, teamName: null }, teams),
    ).toBeNull();
  });
});
