import 'reflect-metadata';
import { expect } from 'chai';
import { storedSessionCapabilities } from '../../src/dashboard/event-manager';

/**
 * What a Session row keeps of the capabilities the driver returned.
 *
 * createSession takes Xenon's own credentials out of xe:options and
 * xenon:options before the driver sees them. A client can still put a token
 * somewhere Xenon doesn't read, and the driver hands it back in its response.
 * The Session row is served to the dashboard and the session API, so any
 * secret-named value is redacted there as well.
 */
describe('storedSessionCapabilities', () => {
  const response = {
    platformName: 'Android',
    'appium:udid': '381103b720057ece',
    'xe:options': { leaseId: 'lease-1', name: 'checkout' },
    'vendor:options': { accessKey: 'ak_1', token: 'secret-token' },
    desired: {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'vendor:options': { accessKey: 'ak_1', token: 'secret-token' },
      'other:sessionToken': 'eyJhbGciOi.jwt.value',
    },
  };

  it('keeps what the dashboard shows', () => {
    const stored = storedSessionCapabilities(response);
    const desired = JSON.parse(stored.desired_capabilities);
    const session = JSON.parse(stored.session_capabilities);
    expect(desired).to.include({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
    });
    expect(session).to.include({ platformName: 'Android', 'appium:udid': '381103b720057ece' });
    expect(session['xe:options']).to.deep.equal({ leaseId: 'lease-1', name: 'checkout' });
    expect(session).to.not.have.property('desired');
  });

  it('never stores a token the driver handed back, wherever the client put it', () => {
    const stored = storedSessionCapabilities(response);
    const all = stored.desired_capabilities + stored.session_capabilities;
    expect(all).to.not.include('secret-token');
    expect(all).to.not.include('eyJhbGciOi.jwt.value');
  });

  it('does not change the response it was given', () => {
    const copy = JSON.parse(JSON.stringify(response));
    storedSessionCapabilities(response);
    expect(response).to.deep.equal(copy);
  });

  it('stores {} for a response without desired capabilities', () => {
    expect(storedSessionCapabilities({ platformName: 'iOS' }).desired_capabilities).to.equal('{}');
  });
});
