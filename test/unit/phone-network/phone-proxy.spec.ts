import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import { PhoneProxy } from '../../../src/services/network/PhoneProxy';
import { PhoneNetworkLedger } from '../../../src/services/network/PhoneNetworkLedger';
import { PhoneNetworkRestore } from '../../../src/services/network/PhoneNetworkRestore';
import { NetworkConditioningService } from '../../../src/services/NetworkConditioningService';
import { InterceptorService } from '../../../src/services/InterceptorService';
import { PortAllocator } from '../../../src/services/PortAllocator';
import { prisma } from '../../../src/prisma';
import { saveRegistrations } from '../../helpers/container-registration';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { FakeAdb, fakeAdb, useFakeAdb } from '../../helpers/fake-adb';

const phone = { udid: 'R5CT', platform: 'android', deviceType: 'real', realDevice: true } as any;

/**
 * ENH-20 part 2: one owner of a phone's global HTTP proxy per session, used by
 * network capture and by traffic shaping alike, so neither overwrites the
 * other's change and the phone's own setting is put back once.
 */
describe('PhoneProxy', function () {
  this.timeout(60_000);
  useScratchDatabase();
  let adb: FakeAdb;
  useFakeAdb(() => adb);
  let ledger: PhoneNetworkLedger;
  let restoreRegs: () => void;

  beforeEach(async () => {
    adb = fakeAdb({ 'shell settings get global http_proxy': 'proxy.corp:3128' });
    restoreRegs = saveRegistrations(PortAllocator, NetworkConditioningService, InterceptorService);
    Container.set(PortAllocator, { rangeOf: () => [11100, 11199] } as any);
    ledger = Container.get(PhoneNetworkLedger);
    for (const entry of await ledger.list()) await ledger.forget(entry.sessionId);
  });

  afterEach(() => restoreRegs());

  async function pointed(proxy: PhoneProxy, sessionId: string, port: number) {
    const route = await proxy.route(phone, port);
    await proxy.pointAt(sessionId, phone, port, route);
    return route;
  }

  it("records the phone's own proxy before the first change, then points it", async () => {
    const proxy = new PhoneProxy();
    const route = await pointed(proxy, 's1', 11100);

    expect(route).to.deep.equal({
      deviceHost: '127.0.0.1',
      reverse: true,
      transport: 'adb-reverse',
    });
    const cmds = adb.commands('R5CT');
    expect(cmds.indexOf('shell settings get global http_proxy')).to.be.lessThan(
      cmds.indexOf('shell settings put global http_proxy 127.0.0.1:11100'),
    );
    const [entry] = await ledger.list();
    expect(entry.proxy).to.deep.equal({
      set: '127.0.0.1:11100',
      previous: 'proxy.corp:3128',
      reversePorts: [11100],
    });
    expect(proxy.owns('s1')).to.equal(true);
  });

  it('a second pointAt changes set only, keeps previous, adds its reverse port', async () => {
    const proxy = new PhoneProxy();
    await pointed(proxy, 's1', 11100);
    adb.answers['shell settings get global http_proxy'] = '127.0.0.1:11100';
    await pointed(proxy, 's1', 11101);

    const [entry] = await ledger.list();
    expect(entry.proxy).to.deep.equal({
      set: '127.0.0.1:11101',
      previous: 'proxy.corp:3128',
      reversePorts: [11100, 11101],
    });
    expect(adb.commands('R5CT')).to.include('shell settings put global http_proxy 127.0.0.1:11101');
  });

  it('release removes every reverse port and puts previous back, once', async () => {
    const proxy = new PhoneProxy();
    await pointed(proxy, 's1', 11100);
    await pointed(proxy, 's1', 11101);
    adb.calls.length = 0;

    await proxy.release('s1');
    await proxy.release('s1');

    expect(adb.commands('R5CT')).to.deep.equal([
      'shell settings put global http_proxy proxy.corp:3128',
      'reverse --remove tcp:11100',
      'reverse --remove tcp:11101',
    ]);
    expect(await ledger.list()).to.deep.equal([]);
    expect(proxy.owns('s1')).to.equal(false);
  });

  it('release of a session it never pointed does nothing', async () => {
    await new PhoneProxy().release('nobody');
    expect(adb.calls).to.deep.equal([]);
  });

  it('keeps the record when the phone could not be put back', async () => {
    const proxy = new PhoneProxy();
    await pointed(proxy, 's1', 11100);
    adb.answers['shell settings put global http_proxy proxy.corp:3128'] = new Error(
      'device offline',
    );

    await proxy.release('s1');

    expect((await ledger.list()).map((e) => e.sessionId)).to.deep.equal(['s1']);
  });

  describe('a crash: what a restart finds', () => {
    beforeEach(() => {
      adb.answers['P1 shell settings get global http_proxy'] = '127.0.0.1:11150';
      const live = { has: () => false, sessionIds: () => [], isActive: () => false };
      Container.set(NetworkConditioningService, live as any);
      Container.set(InterceptorService, live as any);
    });

    it('removes every recorded reverse port', async () => {
      await ledger.note('old', 'P1', {
        proxy: { set: '127.0.0.1:11150', previous: null, reversePorts: [11150, 11151] },
      });

      await new PhoneNetworkRestore().restoreLeftovers({});

      expect(adb.commands('P1')).to.include.members([
        'reverse --remove tcp:11150',
        'reverse --remove tcp:11151',
      ]);
      expect(await ledger.list()).to.deep.equal([]);
    });

    it('reads a row written by 2.31, with one reversePort', async () => {
      await prisma.webConfig.create({
        data: {
          id: 'phone-network:old231',
          name: 'phone-network:old231',
          value: JSON.stringify({
            sessionId: 'old231',
            udid: 'P1',
            at: Date.now(),
            proxy: { set: '127.0.0.1:11150', previous: null, reversePort: 11150 },
          }),
        },
      });

      const [entry] = await ledger.list();
      expect(entry.proxy).to.deep.equal({
        set: '127.0.0.1:11150',
        previous: null,
        reversePorts: [11150],
      });
      await new PhoneNetworkRestore().restoreLeftovers({});
      expect(adb.commands('P1')).to.include('reverse --remove tcp:11150');
    });
  });
});
