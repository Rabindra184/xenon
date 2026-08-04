import { describe, it, expect } from 'vitest';
import { formatDeviceNetworkAddress } from './formatDeviceNetworkAddress';

describe('formatDeviceNetworkAddress', () => {
  it('prefers device.ip over host', () => {
    expect(
      formatDeviceNetworkAddress({
        ip: '192.168.0.106',
        host: 'http://127.0.0.1:4723',
      }),
    ).toBe('192.168.0.106');
  });

  it('hides loopback Xenon server URLs when ip is missing', () => {
    expect(
      formatDeviceNetworkAddress({
        host: 'http://127.0.0.1:4723',
      }),
    ).toBe('—');
  });

  it('shows non-loopback node host when ip is missing', () => {
    expect(
      formatDeviceNetworkAddress({
        host: 'http://192.168.0.5:4723',
      }),
    ).toBe('192.168.0.5:4723');
  });

  it('rejects MAC addresses stored in device.ip', () => {
    expect(
      formatDeviceNetworkAddress({
        ip: '88:1e:5a:d6:7b:47',
        host: 'http://192.168.0.104:4723',
      }),
    ).toBe('192.168.0.104:4723');
  });
});
