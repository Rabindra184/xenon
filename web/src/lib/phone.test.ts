import { describe, expect, it } from 'vitest';
import { controlPath, controlUrl, phoneDomId, phoneKey, samePhone } from './phone';

const phone = { udid: 'emulator-5554', host: 'http://192.168.0.2:4723' };

describe('phone', () => {
  it('keys a phone by its udid and host', () => {
    expect(phoneKey(phone)).toBe('emulator-5554@http://192.168.0.2:4723');
  });

  it('tells two phones with one udid apart by their host', () => {
    expect(samePhone(phone, { ...phone })).toBe(true);
    expect(samePhone(phone, { ...phone, host: 'http://192.168.0.3:4723' })).toBe(false);
    expect(samePhone(phone, { ...phone, udid: 'emulator-5556' })).toBe(false);
  });

  it('makes an id that is a valid id and selector', () => {
    const id = phoneDomId('reason-', phone);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(id.startsWith('reason-')).toBe(true);
    expect(id).not.toBe(phoneDomId('reason-', { ...phone, host: 'http://192.168.0.3:4723' }));
  });

  it("names the phone's server on every control path", () => {
    expect(controlPath(phone, 'tap')).toBe(
      '/control/emulator-5554/tap?host=http%3A%2F%2F192.168.0.2%3A4723',
    );
  });

  it('encodes the udid', () => {
    expect(controlPath({ ...phone, udid: 'a/b c' }, 'tap')).toBe(
      '/control/a%2Fb%20c/tap?host=http%3A%2F%2F192.168.0.2%3A4723',
    );
  });

  it('adds any other query after the host, encoded', () => {
    expect(controlPath(phone, 'stream', { t: '12', retry: 'a&b' })).toBe(
      '/control/emulator-5554/stream?host=http%3A%2F%2F192.168.0.2%3A4723&t=12&retry=a%26b',
    );
  });

  it('gives the full URL for a raw fetch, an <img> or a beacon', () => {
    expect(controlUrl(phone, 'stream/status')).toBe(
      '/xenon/api/control/emulator-5554/stream/status?host=http%3A%2F%2F192.168.0.2%3A4723',
    );
  });
});
