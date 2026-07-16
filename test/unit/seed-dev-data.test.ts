import { expect } from 'chai';
import { buildSeedDevices } from '../../src/scripts/seed-dev-data';

describe('seed-dev-data', () => {
  it('produces devices with hostile, layout-stressing content', () => {
    const devices = buildSeedDevices();
    expect(devices.length).to.be.at.least(6);
    // A full-length iOS UDID is 40 chars — the real width stressor.
    const longest = devices.map((d) => d.udid).sort((a, b) => b.length - a.length)[0];
    expect(longest.length).to.be.at.least(36);
    // Long names are what overflow name columns.
    const longestName = devices.map((d) => d.name).sort((a, b) => b.length - a.length)[0];
    expect(longestName.length).to.be.at.least(40);
  });

  it('gives every device the host required by the composite primary key', () => {
    // Device is @@id([udid, host]) — a row without host cannot be written.
    for (const d of buildSeedDevices()) {
      expect(d.host, `device ${d.udid} needs a host`).to.be.a('string').and.not.empty;
    }
  });

  it('includes the udid the viewport guard navigates to', () => {
    expect(buildSeedDevices().map((d) => d.udid)).to.include('SEED-DEVICE-01');
  });
});
