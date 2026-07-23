import { expect } from 'chai';
import { resolveAndroidH264 } from '../../src/app/routers/androidH264Config';

describe('resolveAndroidH264', () => {
  it('undefined/false → disabled', () => {
    expect(resolveAndroidH264(undefined)).to.deep.equal({ enabled: false, source: 'scrcpy' });
    expect(resolveAndroidH264(false)).to.deep.equal({ enabled: false, source: 'scrcpy' });
  });
  it('true → enabled with scrcpy (the new meaning of true)', () => {
    expect(resolveAndroidH264(true)).to.deep.equal({ enabled: true, source: 'scrcpy' });
  });
  it('object → enabled; source defaults to scrcpy, honored when explicit', () => {
    expect(resolveAndroidH264({})).to.deep.equal({ enabled: true, source: 'scrcpy' });
    expect(resolveAndroidH264({ source: 'screenrecord' })).to.deep.equal({
      enabled: true,
      source: 'screenrecord',
    });
  });
});
