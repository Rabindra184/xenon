import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { NetworkConditioningService } from '../../../src/services/NetworkConditioningService';
import { InterceptorService } from '../../../src/services/InterceptorService';
import { PhoneNetworkLedger } from '../../../src/services/network/PhoneNetworkLedger';
import { PhoneNetworkRestore } from '../../../src/services/network/PhoneNetworkRestore';
import { saveRegistrations } from '../../helpers/container-registration';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { FakeAdb, fakeAdb, useFakeAdb } from '../../helpers/fake-adb';

const phone = { udid: 'R5CT', platform: 'android', deviceType: 'real', host: 'h' } as any;

/**
 * A `xenon: setNetworkProfile` that reaches the server after its session
 * ended (a client that deleted while the command still ran, Appium ending
 * the session mid-command) must change nothing. Through 2.36 only a session
 * that had a profile was marked ended, so for one that ended without a
 * profile a late Offline turned the radios off, nothing reset it, and the
 * ledger's row was skipped as the record of a live session: the phone stayed
 * offline until the server restarted.
 */
describe('A network profile change after its session ended', function () {
  this.timeout(60_000);
  useScratchDatabase();
  let adb: FakeAdb;
  useFakeAdb(() => adb);
  let restoreRegs: () => void;
  let net: NetworkConditioningService;
  let ledger: PhoneNetworkLedger;

  beforeEach(async () => {
    adb = fakeAdb({
      'shell settings get global wifi_on': '1',
      'shell settings get global mobile_data': '1',
    });
    restoreRegs = saveRegistrations(NetworkConditioningService, InterceptorService);
    net = new NetworkConditioningService();
    Container.set(NetworkConditioningService, net);
    Container.set(InterceptorService, { hasCapture: () => false, sessionIds: () => [] } as any);
    ledger = new PhoneNetworkLedger();
    for (const entry of await ledger.list()) await ledger.forget(entry.sessionId);
  });

  afterEach(() => {
    sinon.restore();
    restoreRegs();
  });

  it('is refused for a session that ended with no profile', async () => {
    await new PhoneNetworkRestore().restoreSession('s-late', 'session deleted');

    const outcome = await net.setProfile('s-late', phone, 'Offline');

    expect(outcome.appTraffic).to.equal('none');
    expect(adb.commands('R5CT')).to.deep.equal([]);
    expect(net.has('s-late')).to.equal(false);
    expect(await ledger.list()).to.deep.equal([]);
  });

  it('is refused for a session that ended with a profile, as before', async () => {
    await net.setProfile('s-had', phone, '3G');
    await new PhoneNetworkRestore().restoreSession('s-had', 'session deleted');
    adb.calls.length = 0;

    await net.setProfile('s-had', phone, 'Offline');

    expect(adb.commands('R5CT')).to.deep.equal([]);
    expect(net.has('s-had')).to.equal(false);
  });

  it('still applies to a session that has not ended', async () => {
    await new PhoneNetworkRestore().restoreSession('s-other', 'session deleted');
    const outcome = await net.setProfile('s-live', phone, 'Offline');
    expect(outcome.appTraffic).to.equal('radios');
    expect(adb.commands('R5CT')).to.include('shell svc wifi disable');
    await net.reset('s-live');
  });
});
