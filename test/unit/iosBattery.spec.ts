import { expect } from 'chai';
import { parseBatteryCapacity } from '../../src/device-managers/ios/iosBattery';

describe('parseBatteryCapacity', () => {
  it('reads BatteryCurrentCapacity from ideviceinfo battery-domain output', () => {
    const out = [
      'BatteryCurrentCapacity: 87',
      'BatteryIsCharging: false',
      'ExternalConnected: true',
      'FullyCharged: false',
      'HasBattery: true',
    ].join('\n');
    expect(parseBatteryCapacity(out)).to.equal(87);
  });

  it('handles a full charge', () => {
    expect(parseBatteryCapacity('BatteryCurrentCapacity: 100\nFullyCharged: true')).to.equal(100);
  });

  it('clamps out-of-range values into 0–100', () => {
    expect(parseBatteryCapacity('BatteryCurrentCapacity: 250')).to.equal(100);
  });

  it('returns undefined when the field is absent', () => {
    expect(parseBatteryCapacity('HasBattery: true\nExternalConnected: false')).to.equal(undefined);
  });

  it('is safe on empty / undefined input', () => {
    expect(parseBatteryCapacity('')).to.equal(undefined);
    expect(parseBatteryCapacity(undefined as unknown as string)).to.equal(undefined);
  });
});
