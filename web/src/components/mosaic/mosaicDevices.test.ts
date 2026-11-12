import { describe, expect, it } from 'vitest';
import { deviceLabel, pickerToggle, startRefusesTile, tileFromDevice } from './mosaicDevices';

describe('deviceLabel', () => {
  // The Devices page said "Galaxy S9+" while Live Devices said "star2ltexx".
  it('prefers the friendly name the server read from the device', () => {
    expect(deviceLabel({ udid: 'U1', name: 'star2ltexx', marketingName: 'Galaxy S9+' })).toBe(
      'Galaxy S9+',
    );
  });

  it('falls back to today’s name, then the udid', () => {
    expect(deviceLabel({ udid: 'U1', name: 'star2ltexx', marketingName: ' ' })).toBe('star2ltexx');
    expect(deviceLabel({ udid: 'U1' })).toBe('U1');
  });
});

describe('tileFromDevice', () => {
  it('names the tile by its friendly name and sizes it from the screen', () => {
    expect(
      tileFromDevice({
        udid: 'U1',
        name: 'star2ltexx',
        marketingName: 'Galaxy S9+',
        platform: 'android',
        screenWidth: '1080',
        screenHeight: '2220',
      }),
    ).toEqual({
      udid: 'U1',
      name: 'Galaxy S9+',
      mjpegPort: 0,
      aspect: '1080 / 2220',
      screenWidth: 1080,
      screenHeight: 2220,
      platform: 'android',
    });
  });

  it('leaves the size unknown when the device has not reported it', () => {
    const t = tileFromDevice({ udid: 'U1', platform: 'android' });
    expect(t.aspect).toBe('9 / 16');
    expect(t.screenWidth).toBe(undefined);
  });
});

describe('pickerToggle', () => {
  it('adds a device that is not on the grid and removes one that is', () => {
    expect(pickerToggle(false, false)).toBe('add');
    expect(pickerToggle(true, false)).toBe('remove');
  });

  // Removing a recorded device sent stream/stop, which lost the whole
  // recording (now refused by the server) without a word to the user.
  it('blocks both while recording', () => {
    expect(pickerToggle(false, true)).toBe('blocked');
    expect(pickerToggle(true, true)).toBe('blocked');
  });
});

// The tile added before stream/start answers comes off when the answer means
// this page can't show the phone, and stays for anything that recovers by
// itself (GET /stream starts the service).
describe('startRefusesTile', () => {
  it('takes the tile off for a phone someone else holds', () => {
    expect(startRefusesTile({ error: 'device_held_by_another_user', message: 'held' })).toBe(true);
    expect(startRefusesTile({ error: 'device_in_use_by_session', message: 'busy' })).toBe(true);
  });

  it('takes the tile off for a udid two servers have (the page sends no host yet)', () => {
    expect(
      startRefusesTile({
        error: 'ambiguous_phone',
        message:
          'Two servers have a phone named emulator-5554. Name the one you mean with its host.',
        hosts: ['http://10.0.4.21:4723', 'http://10.0.4.22:4723'],
      }),
    ).toBe(true);
  });

  it('keeps it for a start, a retryable refusal or a network failure', () => {
    expect(startRefusesTile({ success: true, type: 'mjpeg' })).toBe(false);
    expect(startRefusesTile({ error: 'device_ownership_unavailable' })).toBe(false);
    expect(startRefusesTile(null)).toBe(false);
  });
});
