import { expect } from 'chai';
import { parseAndroidIdentity } from '../../src/device-managers/android/androidIdentity';

// Captured 2026-09-26 from the lab's Galaxy S9+ (381103b720057ece).
const S9 =
  'model=SM-G965F\nmanufacturer=samsung\ncharacteristics=phone\ndevice_name=Galaxy S9+\navd_name=\n';
const EMULATOR =
  'model=sdk_gphone64_arm64\nmanufacturer=Google\ncharacteristics=emulator\n' +
  'device_name=sdk_gphone64_arm64\navd_name=Pixel_6_API_34\n';

describe('parseAndroidIdentity', () => {
  it('reads a real phone', () => {
    expect(parseAndroidIdentity(S9, { realDevice: true })).to.deep.equal({
      marketingName: 'Galaxy S9+',
      model: 'SM-G965F',
      manufacturer: 'samsung',
      formFactor: 'phone',
    });
  });

  it('names an emulator after its AVD, spaces for underscores', () => {
    const id = parseAndroidIdentity(EMULATOR, { realDevice: false });
    expect(id.marketingName).to.equal('Pixel 6 API 34');
    expect(id.formFactor).to.equal('phone');
  });

  it('knows a tablet and a TV', () => {
    expect(
      parseAndroidIdentity('characteristics=tablet,nosdcard\n', { realDevice: true }).formFactor,
    ).to.equal('tablet');
    expect(parseAndroidIdentity('characteristics=tv\n', { realDevice: true }).formFactor).to.equal(
      'tv',
    );
  });

  // `settings get` prints the literal string "null" for an unset value.
  it('treats empty values and the literal null as unknown', () => {
    const id = parseAndroidIdentity('model=\nmanufacturer=samsung\ndevice_name=null\n', {
      realDevice: true,
    });
    expect(id.marketingName).to.equal(null);
    expect(id.model).to.equal(null);
    expect(id.manufacturer).to.equal('samsung');
  });

  it('returns nothing it cannot read', () => {
    expect(parseAndroidIdentity('error: device offline', { realDevice: true })).to.deep.equal({
      marketingName: null,
      model: null,
      manufacturer: null,
      formFactor: null,
    });
  });
});
