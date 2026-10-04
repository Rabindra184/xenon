import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { NetworkConditioningService } from '../../../src/services/NetworkConditioningService';
import { PhoneNetworkLedger } from '../../../src/services/network/PhoneNetworkLedger';
import { IDevice } from '../../../src/interfaces/IDevice';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { FakeAdb, fakeAdb, useFakeAdb } from '../../helpers/fake-adb';

// The live module object, so a spy sees a call made through any import of it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const childProcess = require('child_process');

const phone = (udid: string, extra: Partial<IDevice> = {}): IDevice =>
  ({
    udid,
    platform: 'android',
    deviceType: 'real',
    host: 'http://127.0.0.1:4723',
    ...extra,
  }) as any;

const RADIOS_ON = {
  'shell settings get global wifi_on': '1',
  'shell settings get global mobile_data': '1',
};

describe('NetworkConditioningService', function () {
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

  describe('Offline on an Android phone', () => {
    it('turns mobile data and Wi-Fi off through the resolved adb, never a shell', async () => {
      const exec = sinon.spy(childProcess, 'exec');
      const execFile = sinon.spy(childProcess, 'execFile');
      const svc = new NetworkConditioningService();

      await svc.applyProfile('s1', phone('R5CT'), 'Offline');

      expect(adb.commands('R5CT')).to.deep.equal([
        'shell settings get global wifi_on',
        'shell settings get global mobile_data',
        'shell svc data disable',
        'shell svc wifi disable',
      ]);
      expect(adb.calls.every((args) => args[0] === '-s' && args[1] === 'R5CT')).to.equal(true);
      expect(exec.called, 'child_process.exec').to.equal(false);
      expect(execFile.called, 'child_process.execFile').to.equal(false);
    });

    it('writes down what it changed before changing it, so a restart can undo it', async () => {
      adb.answers['shell settings get global mobile_data'] = '0';
      await new NetworkConditioningService().applyProfile('s1', phone('R5CT'), 'Offline');

      const entries = await ledger.list();
      expect(entries).to.have.length(1);
      expect(entries[0]).to.include({ sessionId: 's1', udid: 'R5CT' });
      expect(entries[0].offline).to.deep.equal({ wifiOn: true, dataOn: false });
    });

    it('puts back what was on, and leaves off what was off', async () => {
      adb.answers['shell settings get global mobile_data'] = '0';
      const svc = new NetworkConditioningService();
      await svc.applyProfile('s1', phone('R5CT'), 'Offline');
      adb.calls.length = 0;

      await svc.reset('s1');

      expect(adb.commands('R5CT')).to.deep.equal(['shell svc wifi enable']);
      expect(await ledger.list()).to.deep.equal([]);
      expect(svc.has('s1')).to.equal(false);
    });

    it('turns both back on when it could not read what they were', async () => {
      adb.answers['shell settings get global wifi_on'] = new Error('device offline');
      adb.answers['shell settings get global mobile_data'] = 'null';
      const svc = new NetworkConditioningService();
      await svc.applyProfile('s1', phone('R5CT'), 'Offline');
      adb.calls.length = 0;

      await svc.reset('s1');

      expect(adb.commands('R5CT')).to.deep.equal([
        'shell svc data enable',
        'shell svc wifi enable',
      ]);
    });

    it('keeps the record when the phone cannot be reached at the end', async () => {
      const svc = new NetworkConditioningService();
      await svc.applyProfile('s1', phone('R5CT'), 'Offline');
      adb.answers['shell svc data enable'] = new Error("device 'R5CT' not found");

      await svc.reset('s1');

      const entries = await ledger.list();
      expect(entries.map((e) => e.sessionId)).to.deep.equal(['s1']);
      expect(svc.has('s1')).to.equal(false);
    });

    it('undoes a session once, however many times it is asked', async () => {
      const svc = new NetworkConditioningService();
      await svc.applyProfile('s1', phone('R5CT'), 'Offline');
      adb.calls.length = 0;

      await Promise.all([svc.reset('s1'), svc.reset('s1')]);
      await svc.reset('s1');

      expect(adb.commands('R5CT')).to.deep.equal([
        'shell svc data enable',
        'shell svc wifi enable',
      ]);
    });
  });

  it("changes nothing on the phone for 3G, at the start or the end; it's a delay", async () => {
    const svc = new NetworkConditioningService();
    await svc.applyProfile('s1', phone('R5CT'), '3G');
    expect(svc.getLatency('s1')).to.equal(100);

    await svc.reset('s1');

    expect(adb.calls).to.deep.equal([]);
    expect(svc.getLatency('s1')).to.equal(0);
    expect(await ledger.list()).to.deep.equal([]);
  });

  it('turns the network on for Normal, and has nothing to undo at the end', async () => {
    const svc = new NetworkConditioningService();
    await svc.applyProfile('s1', phone('R5CT'), 'Normal');
    expect(adb.commands('R5CT')).to.deep.equal(['shell svc data enable', 'shell svc wifi enable']);
    adb.calls.length = 0;

    await svc.reset('s1');

    expect(adb.calls).to.deep.equal([]);
    expect(await ledger.list()).to.deep.equal([]);
  });

  it("doesn't run xcrun for an iOS simulator, and says once that only the delay applies", async () => {
    const exec = sinon.spy(childProcess, 'exec');
    const execFile = sinon.spy(childProcess, 'execFile');
    const svc = new NetworkConditioningService();
    const said = sinon.spy((svc as any).log, 'info');
    const sim = { udid: 'SIM-1', platform: 'ios', deviceType: 'simulator' } as any;

    await svc.applyProfile('s1', sim, 'Offline');
    await svc.applyProfile('s2', { ...sim, udid: 'SIM-2' }, 'Edge');
    await svc.reset('s1');
    await svc.reset('s2');

    expect(exec.called).to.equal(false);
    expect(execFile.called).to.equal(false);
    expect(adb.calls).to.deep.equal([]);
    const notes = said.args.filter((a) => /only .*delay/i.test(String(a[0])));
    expect(notes, said.args.map((a) => a[0]).join('\n')).to.have.length(1);
    expect(await ledger.list()).to.deep.equal([]);
  });
});
