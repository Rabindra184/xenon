import { expect } from 'chai';
import { extractAccessKeyTokenPair, extractSessionToken } from '../../src/XenonCapabilityManager';

describe('extractAccessKeyTokenPair', () => {
  it('returns the pair when xe:options has both', () => {
    const r = extractAccessKeyTokenPair({
      alwaysMatch: { 'xe:options': { accessKey: 'xen_abc', token: 'tok' } },
    } as any);
    expect(r).to.deep.equal({ accessKey: 'xen_abc', token: 'tok' });
  });
  it('still reads the pair from xenon:options alone', () => {
    const r = extractAccessKeyTokenPair({
      alwaysMatch: { 'xenon:options': { accessKey: 'xen_abc', token: 'tok' } },
    } as any);
    expect(r).to.deep.equal({ accessKey: 'xen_abc', token: 'tok' });
  });
  it('lets xe:options win field by field over xenon:options', () => {
    const r = extractAccessKeyTokenPair({
      alwaysMatch: {
        'xenon:options': { accessKey: 'xen_old', token: 'tok_old' },
        'xe:options': { token: 'tok_new' },
      },
    } as any);
    expect(r).to.deep.equal({ accessKey: 'xen_old', token: 'tok_new' });
  });
  it('returns undefined when token is missing', () => {
    const r = extractAccessKeyTokenPair({
      alwaysMatch: { 'xe:options': { accessKey: 'xen_abc' } },
    } as any);
    expect(r).to.be.undefined;
  });
  it('returns undefined when there are no Xenon options', () => {
    const r = extractAccessKeyTokenPair({ alwaysMatch: {} } as any);
    expect(r).to.be.undefined;
  });
  it('ignores df:options in every spelling', () => {
    for (const name of ['df:options', 'xenon:df:options', 'appium:df:options']) {
      const r = extractAccessKeyTokenPair({
        alwaysMatch: { [name]: { accessKey: 'xen_abc', token: 'tok' } },
      } as any);
      expect(r, name).to.be.undefined;
    }
  });
});

describe('extractSessionToken', () => {
  it('reads xe:options.sessionToken', () => {
    expect(
      extractSessionToken({ alwaysMatch: { 'xe:options': { sessionToken: 'jwt' } } } as any),
    ).to.equal('jwt');
  });
  it('still reads xenon:options.sessionToken alone', () => {
    expect(
      extractSessionToken({ alwaysMatch: { 'xenon:options': { sessionToken: 'jwt' } } } as any),
    ).to.equal('jwt');
  });
  it('prefers xe:options when both carry one', () => {
    expect(
      extractSessionToken({
        alwaysMatch: { 'xenon:options': { sessionToken: 'jwt_old' } },
        firstMatch: [{ 'xe:options': { sessionToken: 'jwt_new' } }],
      } as any),
    ).to.equal('jwt_new');
  });
  it('returns null when absent, empty or not a string, and for df:options', () => {
    expect(extractSessionToken({ alwaysMatch: {} } as any)).to.equal(null);
    expect(
      extractSessionToken({ alwaysMatch: { 'xe:options': { sessionToken: '' } } } as any),
    ).to.equal(null);
    expect(
      extractSessionToken({ alwaysMatch: { 'xe:options': { sessionToken: 7 } } } as any),
    ).to.equal(null);
    expect(
      extractSessionToken({ alwaysMatch: { 'df:options': { sessionToken: 'jwt' } } } as any),
    ).to.equal(null);
  });
});
