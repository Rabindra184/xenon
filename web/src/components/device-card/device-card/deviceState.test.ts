import { describe, expect, it } from 'vitest';
import {
  DEVICE_STATES,
  activityLabel,
  controlAvailability,
  deviceState,
  type DeviceStateInput,
} from './deviceState';

const NOW = Date.parse('2026-09-26T10:00:00Z');
const MIN = 60_000;

const dev = (over: Partial<DeviceStateInput> = {}): DeviceStateInput => ({
  udid: 'U1',
  offline: false,
  userBlocked: false,
  busy: false,
  session_id: null,
  reservedBy: undefined,
  reservedUntil: undefined,
  sessionStartTime: 0,
  ...over,
});

const member = { userId: 'me', email: 'me@acme.com', name: 'Me', role: 'MEMBER' as const };
const admin = { ...member, role: 'ADMIN' as const };

describe('deviceState', () => {
  it('is ready when nothing holds the device', () => {
    expect(deviceState(dev(), NOW)).toBe('ready');
  });

  // Maintenance used to render as a red "Error".
  it('calls a device an admin blocked "maintenance"', () => {
    expect(deviceState(dev({ userBlocked: true }), NOW)).toBe('maintenance');
  });

  it('ranks offline, then maintenance, then busy, then reserved', () => {
    const all = { offline: true, userBlocked: true, busy: true, reservedUntil: NOW + MIN };
    expect(deviceState(dev(all), NOW)).toBe('offline');
    expect(deviceState(dev({ ...all, offline: false }), NOW)).toBe('maintenance');
    expect(deviceState(dev({ ...all, offline: false, userBlocked: false }), NOW)).toBe('busy');
    expect(deviceState(dev({ reservedUntil: NOW + MIN }), NOW)).toBe('reserved');
  });

  it('treats an expired reservation as ready', () => {
    expect(deviceState(dev({ reservedUntil: NOW - 1 }), NOW)).toBe('ready');
  });

  // The filters read All 7 = Ready 2 + Busy 2 + Reserved 1 + Offline 1: the
  // device in maintenance was in no filter at all.
  it('puts every device in exactly one filter', () => {
    const fleet = [
      dev(),
      dev({ busy: true, session_id: 'abc' }),
      dev({ reservedUntil: NOW + MIN }),
      dev({ userBlocked: true }),
      dev({ userBlocked: true, busy: true, session_id: 'abc' }),
      dev({ offline: true, busy: true }),
    ];
    const counts = DEVICE_STATES.map((s) => fleet.filter((d) => deviceState(d, NOW) === s).length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(fleet.length);
    expect(DEVICE_STATES).toContain('maintenance');
  });
});

describe('activityLabel', () => {
  it('names a running test and how long it has run', () => {
    const d = dev({ busy: true, session_id: '8f2c1a9e-3b7d', sessionStartTime: NOW - 12 * MIN });
    expect(activityLabel(d, member, NOW)).toBe('Test session · 12m');
  });

  it('names a running test even without a start time', () => {
    expect(activityLabel(dev({ busy: true, session_id: '8f2c1a9e' }), member, NOW)).toBe(
      'Test session running',
    );
  });

  // The card showed "SID · manual_u42", the raw lock id.
  it('says who holds live control, never the lock id', () => {
    const mine = dev({ busy: true, session_id: 'manual_me_U1' });
    const theirs = dev({ busy: true, session_id: 'manual_u42_U1' });
    expect(activityLabel(mine, member, NOW)).toBe('Live control by you');
    expect(activityLabel(theirs, member, NOW)).toBe('Live control by another user');
  });

  it('says who reserved the device and for how much longer', () => {
    const d = dev({ reservedBy: 'priya@acme.com', reservedUntil: NOW + 46 * MIN + 16_100 });
    expect(activityLabel(d, member, NOW)).toBe('Reserved by priya@acme.com · 46m left');
  });

  it('says "you" for your own reservation', () => {
    const d = dev({ reservedBy: 'me@acme.com', reservedUntil: NOW + 90 * MIN });
    expect(activityLabel(d, member, NOW)).toBe('Reserved by you · 1h 30m left');
  });

  it('has nothing to say about an idle device', () => {
    expect(activityLabel(dev(), member, NOW)).toBe(null);
  });
});

describe('controlAvailability', () => {
  it('allows control of a ready device', () => {
    expect(controlAvailability(dev(), member)).toEqual({ enabled: true });
  });

  it('refuses an offline device, and says why', () => {
    expect(controlAvailability(dev({ offline: true }), admin)).toEqual({
      enabled: false,
      reason: 'Device is offline',
    });
  });

  it('refuses a device in maintenance, except to an admin', () => {
    expect(controlAvailability(dev({ userBlocked: true }), member)).toEqual({
      enabled: false,
      reason: 'In maintenance',
    });
    expect(controlAvailability(dev({ userBlocked: true }), admin).enabled).toBe(true);
  });

  it('refuses a device running a test', () => {
    expect(controlAvailability(dev({ busy: true, session_id: 'abc' }), member)).toEqual({
      enabled: false,
      reason: 'A test is running on this device',
    });
  });

  // The card offered Control on a device another user held; the server then
  // answered 409 on every action.
  it('refuses a device another user controls, except to an admin', () => {
    const theirs = dev({ busy: true, session_id: 'manual_u42_U1' });
    expect(controlAvailability(theirs, member)).toEqual({
      enabled: false,
      reason: 'Another user is controlling this device',
    });
    expect(controlAvailability(theirs, admin).enabled).toBe(true);
  });

  it('allows control of a device you already control', () => {
    const mine = dev({ busy: true, session_id: 'manual_me_U1' });
    expect(controlAvailability(mine, member)).toEqual({ enabled: true });
  });
});
