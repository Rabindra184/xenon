import { expect } from 'chai';
import { resolveNodePairAuth } from '../../../src/services/lease/LeaseService';

describe('resolveNodePairAuth (lease port-allocator hub→node credentials)', () => {
  it('returns the configured hub node-pair credentials when both are set', () => {
    expect(
      resolveNodePairAuth({ hubAccessKey: 'ak_hub', hubToken: 'tok_hub', authDisabled: false }),
    ).to.deep.equal({ accessKey: 'ak_hub', token: 'tok_hub' });
  });

  it('returns empty credentials when auth is disabled and none are configured', () => {
    // Auth-disabled hubs accept any credentials on the node port-allocator, so
    // leasing must still work locally without provisioned node-pair keys.
    expect(
      resolveNodePairAuth({ hubAccessKey: undefined, hubToken: undefined, authDisabled: true }),
    ).to.deep.equal({ accessKey: '', token: '' });
  });

  it('throws a clear, actionable error when auth is enabled but credentials are missing', () => {
    expect(() =>
      resolveNodePairAuth({ hubAccessKey: undefined, hubToken: undefined, authDisabled: false }),
    ).to.throw(/XENON_HUB_ACCESS_KEY/);
  });

  it('treats a half-configured pair (only one of key/token) as unconfigured', () => {
    expect(
      resolveNodePairAuth({ hubAccessKey: 'ak_hub', hubToken: undefined, authDisabled: true }),
    ).to.deep.equal({ accessKey: '', token: '' });
    expect(() =>
      resolveNodePairAuth({ hubAccessKey: 'ak_hub', hubToken: undefined, authDisabled: false }),
    ).to.throw(/XENON_HUB_ACCESS_KEY/);
  });
});
