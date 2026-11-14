import { describe, expect, it } from 'vitest';
import { idleWatchEnabled, planRestore, releaseMessage, restoreMessage } from './idleRestore';

describe('idleWatchEnabled', () => {
  it('watches when devices are open and nothing is recording', () => {
    expect(idleWatchEnabled(1, 'idle')).toBe(true);
  });
  // The release stopped the streams under a recording: measured, the whole
  // 38 s recording came back FAILED, 28 bytes.
  it('never watches during a recording', () => {
    for (const phase of ['starting', 'recording', 'stopping'] as const) {
      expect(idleWatchEnabled(2, phase)).toBe(false);
    }
  });
  it('does not watch an empty grid', () => {
    expect(idleWatchEnabled(0, 'idle')).toBe(false);
  });
});

describe('planRestore', () => {
  const saved = [
    { udid: 'A', host: 'http://127.0.0.1:4723', name: 'Galaxy S9+' },
    { udid: 'B', host: 'http://127.0.0.1:4723', name: 'Pixel 8 Pro' },
    { udid: 'C', host: 'http://127.0.0.1:4723', name: 'iPad Air' },
    { udid: 'D', host: 'http://127.0.0.1:4723', name: 'moto g54' },
    { udid: 'E', host: 'http://127.0.0.1:4723', name: 'Galaxy Tab' },
  ];
  const devices = [
    { udid: 'E', host: 'http://127.0.0.1:4723', name: 'Galaxy Tab', busy: false, offline: false },
    { udid: 'A', host: 'http://127.0.0.1:4723', name: 'Galaxy S9+', busy: false, offline: false },
    {
      udid: 'B',
      host: 'http://127.0.0.1:4723',
      name: 'Pixel 8 Pro',
      busy: true,
      session_id: 'manual_u42_B',
    },
    { udid: 'C', host: 'http://127.0.0.1:4723', name: 'iPad Air', busy: false, offline: true },
  ];

  it('restores free devices in the saved order, and skips the rest with a reason', () => {
    const plan = planRestore(saved, devices, 'me');
    expect(plan.restore.map((d) => d.udid)).toEqual(['A', 'E']);
    expect(plan.skipped).toEqual([
      { name: 'Pixel 8 Pro', reason: 'in_use' },
      { name: 'iPad Air', reason: 'offline' },
      { name: 'moto g54', reason: 'gone' },
    ]);
  });

  it('restores a device still held by your own lock', () => {
    const plan = planRestore(
      [{ udid: 'A', host: 'http://127.0.0.1:4723', name: 'Galaxy S9+' }],
      [
        {
          udid: 'A',
          host: 'http://127.0.0.1:4723',
          name: 'Galaxy S9+',
          busy: true,
          session_id: 'manual_me_A',
        },
      ],
      'me',
    );
    expect(plan.restore.map((d) => d.udid)).toEqual(['A']);
  });

  it('skips a device running a test session', () => {
    const plan = planRestore(
      [{ udid: 'A', host: 'http://127.0.0.1:4723', name: 'Galaxy S9+' }],
      [{ udid: 'A', host: 'http://127.0.0.1:4723', busy: true, session_id: '8f2c1a9e' }],
      'me',
    );
    expect(plan.skipped).toEqual([{ name: 'Galaxy S9+', reason: 'in_use' }]);
  });
});

describe('planRestore with two phones of one udid', () => {
  const H1 = 'http://10.0.0.1:4723';
  const H2 = 'http://10.0.0.2:4723';
  // A hub's emulator-5554 runs a test; the node's, which was on the grid, is free.
  it('restores the tile from its own phone’s row, not the first of that udid', () => {
    const plan = planRestore(
      [{ udid: 'emulator-5554', host: H2, name: 'Pixel 8' }],
      [
        { udid: 'emulator-5554', host: H1, name: 'Pixel 8', busy: true, session_id: '8f2c1a9e' },
        { udid: 'emulator-5554', host: H2, name: 'Pixel 8', busy: false },
      ],
      'me',
    );
    expect(plan.restore.map((d) => d.host)).toEqual([H2]);
    expect(plan.skipped).toEqual([]);
  });

  it('says a phone is gone when only the other server’s phone of that udid is listed', () => {
    const plan = planRestore(
      [{ udid: 'emulator-5554', host: H2, name: 'Pixel 8' }],
      [{ udid: 'emulator-5554', host: H1, name: 'Pixel 8', busy: false }],
      'me',
    );
    expect(plan.restore).toEqual([]);
    expect(plan.skipped).toEqual([{ name: 'Pixel 8', reason: 'gone' }]);
  });
});

describe('messages', () => {
  it('says how many devices were released and why', () => {
    expect(releaseMessage(1, 5)).toBe('Released 1 device after 5 minutes without activity.');
    expect(releaseMessage(2, 5)).toBe('Released 2 devices after 5 minutes without activity.');
  });

  it('has nothing to say when everything came back', () => {
    expect(restoreMessage(2, [])).toBe(null);
  });

  it('names what could not come back', () => {
    expect(
      restoreMessage(1, [
        { name: 'Pixel 8 Pro', reason: 'in_use' },
        { name: 'iPad Air', reason: 'offline' },
        { name: 'moto g54', reason: 'gone' },
      ]),
    ).toBe(
      'Restored 1 device. Pixel 8 Pro is now in use by someone else. iPad Air is offline. moto g54 is no longer connected.',
    );
    expect(restoreMessage(0, [{ name: 'Pixel 8 Pro', reason: 'in_use' }])).toBe(
      'No devices restored. Pixel 8 Pro is now in use by someone else.',
    );
  });
});
