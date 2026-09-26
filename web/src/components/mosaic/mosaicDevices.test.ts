import { describe, expect, it } from 'vitest';
import { deviceLabel, pickerToggle, tileFromDevice } from './mosaicDevices';

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
