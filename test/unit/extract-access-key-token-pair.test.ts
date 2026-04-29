import { expect } from 'chai';
import { extractAccessKeyTokenPair } from '../../src/XenonCapabilityManager';

describe('extractAccessKeyTokenPair', () => {
  it('returns the pair when df:options has both', () => {
    const r = extractAccessKeyTokenPair({
      alwaysMatch: { 'df:options': { accessKey: 'xen_abc', token: 'tok' } },
    } as any);
    expect(r).to.deep.equal({ accessKey: 'xen_abc', token: 'tok' });
  });
  it('returns undefined when token is missing', () => {
    const r = extractAccessKeyTokenPair({
      alwaysMatch: { 'df:options': { accessKey: 'xen_abc' } },
    } as any);
    expect(r).to.be.undefined;
  });
  it('returns undefined when df:options is absent', () => {
    const r = extractAccessKeyTokenPair({ alwaysMatch: {} } as any);
    expect(r).to.be.undefined;
  });
});
