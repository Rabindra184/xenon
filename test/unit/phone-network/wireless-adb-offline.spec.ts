import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { NetworkConditioningService } from '../../../src/services/NetworkConditioningService';
import { CommandInterceptor } from '../../../src/interceptors/CommandInterceptor';
import * as DeviceService from '../../../src/data-service/device-service';
import * as OwnDeviceRow from '../../../src/device-managers/ownDeviceRow';
import { PhoneNetworkLedger } from '../../../src/services/network/PhoneNetworkLedger';
import { adbOverNetwork } from '../../../src/services/network/adbTransport';
import { IDevice } from '../../../src/interfaces/IDevice';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { FakeAdb, fakeAdb, useFakeAdb } from '../../helpers/fake-adb';
import { saveRegistrations } from '../../helpers/container-registration';

const RADIOS_ON = {
  'shell settings get global wifi_on': '1',
  'shell settings get global mobile_data': '1',
};

const phone = (udid: string, extra: Partial<IDevice> = {}): IDevice =>
  ({
    udid,
    platform: 'android',
    realDevice: true,
    host: 'http://127.0.0.1:4723',
    ...extra,
  }) as any;

/**
 * An Offline profile turns Wi-Fi off. On a phone driven over wireless adb
 * that cuts adb itself: the undo can never reach the phone, which stays
 * offline (and its ledger row is retried for a week) until someone turns
 * Wi-Fi back on by hand. Through 2.36 Xenon did it anyway.
 */
describe('Offline on a phone driven over wireless adb', function () {
  this.timeout(60_000);
  useScratchDatabase();
  let adb: FakeAdb;
  useFakeAdb(() => adb);
  let ledger: PhoneNetworkLedger;

  beforeEach(async () => {
    adb = fakeAdb({ ...RADIOS_ON });
    ledger = new PhoneNetworkLedger();
    for (const entry of await ledger.list()) await ledger.forget(entry.sessionId);
  });
  afterEach(() => sinon.restore());

  describe('adbOverNetwork', () => {
    it('is true for a serial that is a network address or a wireless-debugging name', () => {
      for (const serial of [
        '192.168.1.20:5555',
        '10.0.0.7:41231',
        'phone.lan:5555',
        '[fe80::1]:5555',
        'adb-R5CT80ABCDE-Xyz12a._adb-tls-connect._tcp',
        'adb-R5CT80ABCDE-Xyz12a._adb-tls-connect._tcp.',
        'adb-R5CT80ABCDE._adb._tcp',
      ]) {
        expect(adbOverNetwork(serial), serial).to.equal(true);
      }
    });

    it('is false for a USB serial or an emulator this server drives', () => {
      for (const serial of ['R5CT80ABCDE', 'emulator-5554', '0123456789ABCDEF', '']) {
        expect(adbOverNetwork(serial), serial).to.equal(false);
      }
    });
  });

  it('leaves both radios on, writes nothing down, and says why', async () => {
    const svc = new NetworkConditioningService();
    const warned = sinon.spy((svc as any).log, 'warn');

    const outcome = await svc.setProfile('s1', phone('192.168.1.20:5555'), 'Offline');

    expect(adb.commands().filter((c) => c.startsWith('shell svc'))).to.deep.equal([]);
    expect(await ledger.list()).to.deep.equal([]);
    expect(outcome.profile).to.equal('Offline');
    expect(outcome.appTraffic).to.equal('none');
    expect(outcome.notApplied?.reason).to.equal('wireless-adb');
    expect(outcome.notApplied?.message).to.match(/wireless adb/i);
    expect(outcome.notApplied?.message).to.match(/Wi-Fi/);
    expect(svc.describe('s1')).to.deep.equal(outcome);
    expect(
      warned.args.some(
        (a) => /wireless adb/i.test(String(a[0])) && /192\.168\.1\.20:5555/.test(String(a[0])),
      ),
      warned.args.map((a) => a[0]).join('\n'),
    ).to.equal(true);
  });

  it('changes nothing at the end either', async () => {
    const svc = new NetworkConditioningService();
    await svc.setProfile('s1', phone('adb-R5CT-x._adb-tls-connect._tcp'), 'Offline');
    adb.calls.length = 0;

    await svc.reset('s1');

    expect(adb.calls).to.deep.equal([]);
    expect(await ledger.list()).to.deep.equal([]);
  });

  it('Offline then Normal: Normal is applied as usual', async () => {
    const svc = new NetworkConditioningService();
    const device = phone('192.168.1.20:5555');
    await svc.setProfile('s1', device, 'Offline');

    const outcome = await svc.setProfile('s1', device, 'Normal');

    expect(outcome.appTraffic).to.equal('radios');
    expect(outcome.notApplied).to.equal(undefined);
    expect(svc.describe('s1')?.notApplied).to.equal(undefined);
  });

  // A remote adb server reaches its phones over its own USB: the phone's
  // Wi-Fi carries nothing of adb's, and Offline goes ahead.
  it("goes offline as before on a USB phone, a remote adb server's included", async () => {
    const svc = new NetworkConditioningService();
    const outcome = await svc.setProfile(
      's1',
      phone('R5CT', { adbRemoteHost: '10.0.0.9' } as any),
      'Offline',
    );

    expect(outcome.appTraffic).to.equal('radios');
    expect(outcome.notApplied).to.equal(undefined);
    expect(adb.commands('R5CT')).to.include('shell svc wifi disable');
  });

  it('xenon: setNetworkProfile answers that Offline was not applied over wireless adb', async () => {
    const restore = saveRegistrations(NetworkConditioningService);
    try {
      Container.set(NetworkConditioningService, new NetworkConditioningService());
      sinon.stub(DeviceService, 'updateCmdExecutedTime').resolves();
      sinon.stub(OwnDeviceRow, 'findOwnDevice').resolves(phone('192.168.1.20:5555'));
      const run = (script: string) =>
        Container.get(CommandInterceptor).handle(
          async () => 'the driver ran it',
          { sessionId: 'sess-w', caps: { udid: '192.168.1.20:5555', platformName: 'Android' } },
          'execute',
          [script, [{ profile: 'Offline' }]],
          {} as any,
          false,
        );

      const out = await run('xenon: setNetworkProfile');

      expect(out.appTraffic).to.equal('none');
      expect(out.notApplied.reason).to.equal('wireless-adb');
      expect(out.notApplied.message).to.match(/wireless adb/i);
      expect(adb.commands().filter((c) => c.startsWith('shell svc'))).to.deep.equal([]);
      const read = await Container.get(CommandInterceptor).handle(
        async () => 'the driver ran it',
        { sessionId: 'sess-w', caps: { udid: '192.168.1.20:5555', platformName: 'Android' } },
        'execute',
        ['xenon: getNetworkProfile', [{}]],
        {} as any,
        false,
      );
      expect(read).to.deep.equal(out);
    } finally {
      await Container.get(NetworkConditioningService).reset('sess-w');
      restore();
    }
  });
});
