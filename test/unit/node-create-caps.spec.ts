import { expect } from 'chai';
import { capsForNode } from '../../src/services/session/nodeCreateCaps';

/**
 * The capabilities a hub sends the node whose phone it allocated. The hub has
 * checked the credentials, applied the team rule and resolved the lease; the
 * node gets a request that stands on its own: that one phone, and nothing the
 * node can't act on.
 */
describe('capsForNode — the copy of a create a node gets', () => {
  const sent = () => ({
    alwaysMatch: {
      platformName: 'Android',
      'appium:udids': 'phone-1,phone-2',
      'xe:options': { leaseId: 'lse_1', buildId: 'b-1', token: 'SECRET' },
    },
    firstMatch: [
      { 'appium:udid': 'phone-1', 'appium:systemPort': 8201 },
      { 'appium:udid': 'phone-2', 'xenon:options': { leaseId: 'lse_1', leaseToken: 'SECRET' } },
    ],
  });

  it('names exactly the phone the hub allocated, once, in alwaysMatch', () => {
    const copy: any = capsForNode(sent(), 'phone-1');
    expect(copy.alwaysMatch['appium:udid']).to.equal('phone-1');
    expect(copy.alwaysMatch['appium:udids']).to.equal(undefined);
    for (const entry of copy.firstMatch) {
      expect(entry['appium:udid']).to.equal(undefined);
      expect(entry['appium:udids']).to.equal(undefined);
    }
    // What the hub allocated for it travels.
    expect(copy.firstMatch[0]['appium:systemPort']).to.equal(8201);
  });

  it('drops the lease id, which only the hub can resolve, from both namespaces', () => {
    const copy: any = capsForNode(sent(), 'phone-1');
    expect(JSON.stringify(copy)).to.not.include('lse_1');
    expect(copy.alwaysMatch['xe:options']).to.deep.equal({ buildId: 'b-1' });
  });

  it('never carries a credential', () => {
    expect(JSON.stringify(capsForNode(sent(), 'phone-1'))).to.not.include('SECRET');
  });

  it('does not modify the caps the hub keeps', () => {
    const caps = sent();
    const before = JSON.stringify(caps);
    capsForNode(caps, 'phone-1');
    expect(JSON.stringify(caps)).to.equal(before);
  });

  it('copes with missing buckets', () => {
    expect(capsForNode({ alwaysMatch: undefined } as any, 'p')).to.deep.equal({
      alwaysMatch: { 'appium:udid': 'p' },
      firstMatch: [{}],
    });
  });
});
