import { describe, expect, it } from 'vitest';
import { idleWatchEnabled, planRestore, releaseMessage, restoreMessage } from './idleRestore';

describe('idleWatchEnabled', () => {
  it('watches when devices are open and nothing is recording', () => {
    expect(idleWatchEnabled(1, 'idle')).toBe(true);
  });
  // The release stopped the streams under a recording: measured, the whole
  // 38 s recording came back FAILED, 28 bytes.
  it('never watches during a recording', () => {
    for (const phase of ['starting', 'recording', 'stopping']) {
      expect(idleWatchEnabled(2, phase)).toBe(false);
    }
  });
  it('does not watch an empty grid', () => {
    expect(idleWatchEnabled(0, 'idle')).toBe(false);
  });
});

describe('planRestore', () => {
  const saved = [
    { udid: 'A', name: 'Galaxy S9+' },
    { udid: 'B', name: 'Pixel 8 Pro' },
    { udid: 'C', name: 'iPad Air' },
    { udid: 'D', name: 'moto g54' },
    { udid: 'E', name: 'Galaxy Tab' },
  ];
  const devices = [
    { udid: 'E', name: 'Galaxy Tab', busy: false, offline: false },
    { udid: 'A', name: 'Galaxy S9+', busy: false, offline: false },
    { udid: 'B', name: 'Pixel 8 Pro', busy: true, session_id: 'manual_u42_B' },
    { udid: 'C', name: 'iPad Air', busy: false, offline: true },
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
      [{ udid: 'A', name: 'Galaxy S9+' }],
      [{ udid: 'A', name: 'Galaxy S9+', busy: true, session_id: 'manual_me_A' }],
      'me',
    );
    expect(plan.restore.map((d) => d.udid)).toEqual(['A']);
  });

  it('skips a device running a test session', () => {
    const plan = planRestore(
      [{ udid: 'A', name: 'Galaxy S9+' }],
      [{ udid: 'A', busy: true, session_id: '8f2c1a9e' }],
      'me',
    );
    expect(plan.skipped).toEqual([{ name: 'Galaxy S9+', reason: 'in_use' }]);
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
