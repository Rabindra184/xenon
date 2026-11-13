import { describe, it, expect } from 'vitest';
import { nameDevice, titleForPath } from './document-title';

describe('titleForPath', () => {
  it.each([
    ['/overview', 'Overview · Xenon'],
    ['/devices/live', 'Live devices · Xenon'],
    ['/builds', 'Sessions · Xenon'],
    ['/builds/abc123', 'Sessions · Xenon'],
    ['/builds/abc123/sessions/s-1', 'Session · Xenon'],
    ['/devices/381103b720057ece/control/logs', '381103b720057ece · Device · Xenon'],
    ['/runbooks/network', 'Runbook · network · Xenon'],
    ['/login', 'Sign in · Xenon'],
    ['/reset-password', 'Reset password · Xenon'],
    ['/settings/', 'Settings · Xenon'],
    ['/something-unknown', 'Xenon'],
  ])('%s → %s', (path, title) => {
    expect(titleForPath(path)).toBe(title);
  });

  it('titles the recordings pages', () => {
    expect(titleForPath('/recordings')).toBe('Recordings · Xenon');
    expect(titleForPath('/recordings/abc-123')).toBe('Recording · Xenon');
  });
});

describe('a device control tab', () => {
  // It read "381103b720057ece · Device", which says nothing in a row of tabs.
  it('is named after the device once its name is known', () => {
    expect(titleForPath('/devices/U-9/control/actions')).toBe('U-9 · Device · Xenon');
    nameDevice({ udid: 'U-9', host: 'http://h1:4723' }, 'Galaxy S9+');
    expect(titleForPath('/devices/U-9/control/actions')).toBe('Galaxy S9+ · Device · Xenon');
    expect(titleForPath('/devices/U-9/control/omni')).toBe('Galaxy S9+ · Device · Xenon');
  });
});

describe('a device control tab of a udid two servers have', () => {
  const H1 = 'http://10.0.0.1:4723';
  const H2 = 'http://10.0.0.2:4724';
  it('is named after the phone its link names', () => {
    nameDevice({ udid: 'emulator-5554', host: H1 }, 'Pixel 7');
    nameDevice({ udid: 'emulator-5554', host: H2 }, 'Pixel 8');
    expect(titleForPath('/devices/emulator-5554/control', `?host=${encodeURIComponent(H2)}`)).toBe(
      'Pixel 8 · Device · Xenon',
    );
    expect(
      titleForPath(
        '/devices/emulator-5554/control/logs',
        `?view=table&host=${encodeURIComponent(H1)}`,
      ),
    ).toBe('Pixel 7 · Device · Xenon');
  });

  it('names no phone when the link has no host and two are known', () => {
    nameDevice({ udid: 'emulator-5556', host: H1 }, 'Pixel 7');
    expect(titleForPath('/devices/emulator-5556/control')).toBe('Pixel 7 · Device · Xenon');
    nameDevice({ udid: 'emulator-5556', host: H2 }, 'Pixel 8');
    expect(titleForPath('/devices/emulator-5556/control')).toBe('emulator-5556 · Device · Xenon');
    expect(titleForPath('/devices/emulator-5556/control', `?host=${encodeURIComponent(H2)}`)).toBe(
      'Pixel 8 · Device · Xenon',
    );
  });

  it('names the one phone it knows when the link has no host', () => {
    nameDevice({ udid: 'U-1', host: H1 }, 'Galaxy S9+');
    expect(titleForPath('/devices/U-1/control')).toBe('Galaxy S9+ · Device · Xenon');
  });
});
