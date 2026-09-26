import { expect } from 'chai';
import { appleIdentity, simulatorIdentity } from '../../src/device-managers/ios/appleIdentity';

describe('appleIdentity', () => {
  it('names a known iPhone and marks it a phone', () => {
    expect(appleIdentity({ ProductType: 'iPhone16,2', DeviceClass: 'iPhone' })).to.deep.equal({
      marketingName: 'iPhone 15 Pro Max',
      model: 'iPhone16,2',
      manufacturer: 'Apple',
      formFactor: 'phone',
    });
  });

  it('marks an iPad a tablet and an Apple TV a TV', () => {
    expect(appleIdentity({ ProductType: 'iPad14,8', DeviceClass: 'iPad' }).formFactor).to.equal(
      'tablet',
    );
    expect(
      appleIdentity({ ProductType: 'AppleTV14,1', DeviceClass: 'AppleTV' }).formFactor,
    ).to.equal('tv');
  });

  // Too new for the table: say nothing rather than guess from the digits.
  it('gives no name for a model code it does not know', () => {
    const id = appleIdentity({ ProductType: 'iPhone99,9', DeviceClass: 'iPhone' });
    expect(id.marketingName).to.equal(null);
    expect(id.model).to.equal('iPhone99,9');
  });

  it('returns nothing for no info', () => {
    expect(appleIdentity(undefined)).to.deep.equal({
      marketingName: null,
      model: null,
      manufacturer: null,
      formFactor: null,
    });
  });
});

describe('simulatorIdentity', () => {
  it('keeps the simulator name and reads the form factor from it', () => {
    expect(simulatorIdentity('iPhone 16 Pro')).to.deep.equal({
      marketingName: 'iPhone 16 Pro',
      model: null,
      manufacturer: null,
      formFactor: 'phone',
    });
    expect(simulatorIdentity('iPad Air 11-inch (M2)').formFactor).to.equal('tablet');
    expect(simulatorIdentity('Apple TV 4K (3rd generation)').formFactor).to.equal('tv');
  });
});
