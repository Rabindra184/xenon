import { expect } from 'chai';
import { appleFamilyOf } from '../../src/data-service/appleFamily';

/**
 * Whether a phone is an iPhone or an iPad, for `appium:iPhoneOnly` and
 * `appium:iPadOnly`. Its model and form factor are read before its name: a
 * real phone is named by its owner.
 */
describe('appleFamilyOf', () => {
  const ios = (over: Record<string, unknown>) =>
    ({ platform: 'ios', name: 'unknown', ...over }) as any;

  it('reads the family from the model first', () => {
    expect(appleFamilyOf(ios({ model: 'iPhone17,3', name: 'My iPad' }))).to.equal('iphone');
    expect(appleFamilyOf(ios({ model: 'iPad13,4', name: 'iPhone spare' }))).to.equal('ipad');
  });

  it('reads it from the form factor when there is no model (a simulator)', () => {
    expect(appleFamilyOf(ios({ formFactor: 'phone', name: 'Test device 1' }))).to.equal('iphone');
    expect(appleFamilyOf(ios({ formFactor: 'tablet', name: 'Test device 2' }))).to.equal('ipad');
  });

  it('puts an Apple TV in neither family', () => {
    expect(appleFamilyOf(ios({ formFactor: 'tv', name: 'iPad-like TV' }))).to.equal(undefined);
  });

  it('falls back to the marketing name, then the name, for an old row', () => {
    expect(appleFamilyOf(ios({ marketingName: 'iPad Air (5th generation)', name: 'x' }))).to.equal(
      'ipad',
    );
    expect(appleFamilyOf(ios({ name: 'iPhone 13' }))).to.equal('iphone');
    expect(appleFamilyOf(ios({ name: 'iPad (9th generation)' }))).to.equal('ipad');
    expect(appleFamilyOf(ios({ name: 'unknown' }))).to.equal(undefined);
  });

  it('is case-insensitive about a name', () => {
    expect(appleFamilyOf(ios({ name: 'IPHONE 12' }))).to.equal('iphone');
  });

  it('is nothing for a device that is not iOS', () => {
    expect(
      appleFamilyOf({ platform: 'android', name: 'Pixel Tablet', formFactor: 'tablet' } as any),
    ).to.equal(undefined);
    expect(
      appleFamilyOf({ platform: 'android', name: 'iPhone clone', model: 'iPhone1,1' } as any),
    ).to.equal(undefined);
  });
});
