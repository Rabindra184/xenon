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
  it('object with an unrecognized source → defaults to scrcpy', () => {
    expect(resolveAndroidH264({ source: 'bogus' } as any)).to.deep.equal({
      enabled: true,
      source: 'scrcpy',
    });
  });
  it('stringified booleans are handled (form/config may serialize as strings)', () => {
    // "true" enables; "false" MUST disable (without this, a truthy "false" would
    // wrongly enable and the flag could never be turned off).
    expect(resolveAndroidH264('true')).to.deep.equal({ enabled: true, source: 'scrcpy' });
    expect(resolveAndroidH264('false')).to.deep.equal({ enabled: false, source: 'scrcpy' });
    expect(resolveAndroidH264('')).to.deep.equal({ enabled: false, source: 'scrcpy' });
  });
  it('null and other truthy scalars are tolerated', () => {
    expect(resolveAndroidH264(null)).to.deep.equal({ enabled: false, source: 'scrcpy' });
    expect(resolveAndroidH264('yes')).to.deep.equal({ enabled: true, source: 'scrcpy' });
  });
});
