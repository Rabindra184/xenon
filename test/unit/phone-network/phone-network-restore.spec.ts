import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import net from 'net';
import { Container } from 'typedi';
import { PhoneNetworkRestore } from '../../../src/services/network/PhoneNetworkRestore';
import { PhoneNetworkLedger } from '../../../src/services/network/PhoneNetworkLedger';
import { NetworkConditioningService } from '../../../src/services/NetworkConditioningService';
import { InterceptorService } from '../../../src/services/InterceptorService';
import { PortAllocator } from '../../../src/services/PortAllocator';
import { prisma } from '../../../src/prisma';
import { saveRegistrations } from '../../helpers/container-registration';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { FakeAdb, fakeAdb, useFakeAdb } from '../../helpers/fake-adb';

const DAY = 24 * 60 * 60 * 1000;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Stand-ins for the two services that change a phone's network for a session. */
function fakeServices(live: { net: Set<string>; icp: Set<string> }) {
  const net = {
    has: (id: string) => live.net.has(id),
    sessionIds: () => [...live.net],
    reset: sinon.stub().callsFake(async (id: string) => void live.net.delete(id)),
  };
  const icp = {
    isActive: (id: string) => live.icp.has(id),
    sessionIds: () => [...live.icp],
    stop: sinon.stub().callsFake(async (id: string) => void live.icp.delete(id)),
  };
  return { net, icp };
}

describe('PhoneNetworkRestore', function () {
  this.timeout(60_000);
  useScratchDatabase();
  let adb: FakeAdb;
  useFakeAdb(() => adb);
  let restoreRegs: () => void;
  let live: { net: Set<string>; icp: Set<string> };
  let fakes: ReturnType<typeof fakeServices>;
  let ledger: PhoneNetworkLedger;
  let range: [number, number];

  beforeEach(async () => {
    adb = fakeAdb();
    restoreRegs = saveRegistrations(
      NetworkConditioningService,
      InterceptorService,
      PortAllocator,
      PhoneNetworkLedger,
    );
    live = { net: new Set(), icp: new Set() };
    fakes = fakeServices(live);
    Container.set(NetworkConditioningService, fakes.net as any);
    Container.set(InterceptorService, fakes.icp as any);
    range = [11100, 11199];
    Container.set(PortAllocator, { rangeOf: () => range } as any);
    ledger = new PhoneNetworkLedger();
    Container.set(PhoneNetworkLedger, ledger);
    for (const entry of await ledger.list()) await ledger.forget(entry.sessionId);
  });

  afterEach(() => {
    sinon.restore();
    restoreRegs();
  });

  describe('restoreSession', () => {
    it('resets the profile and stops the interceptor of a session', async () => {
      live.net.add('s1');
      live.icp.add('s1');
      await new PhoneNetworkRestore().restoreSession('s1', 'test');
      expect(fakes.net.reset.calledOnceWith('s1')).to.equal(true);
      expect(fakes.icp.stop.calledOnceWith('s1')).to.equal(true);
    });

    it('does nothing for a session that changed nothing, or no session', async () => {
      const restore = new PhoneNetworkRestore();
      await restore.restoreSession('s-plain', 'test');
      await restore.restoreSession(undefined, 'test');
      await restore.restoreSession(null, 'test');
      expect(fakes.net.reset.called).to.equal(false);
      expect(fakes.icp.stop.called).to.equal(false);
    });

    it('runs once when two endings race, and both wait until it is done', async () => {
      live.net.add('s1');
      const gate = deferred();
      fakes.net.reset.callsFake(async (id: string) => {
        await gate.promise;
        live.net.delete(id);
      });
      const restore = new PhoneNetworkRestore();
      let firstDone = false;
      let secondDone = false;
      const first = restore.restoreSession('s1', 'deleted').then(() => (firstDone = true));
      const second = restore.restoreSession('s1', 'idle').then(() => (secondDone = true));
      await new Promise((r) => setImmediate(r));
      expect(firstDone || secondDone, 'nobody may go on before the network is back').to.equal(
        false,
      );

      gate.resolve();
      await Promise.all([first, second]);
      await restore.restoreSession('s1', 'later');

      expect(fakes.net.reset.callCount).to.equal(1);
    });

    it("never throws: one service's failure doesn't stop the other's restore", async () => {
      live.net.add('s1');
      live.icp.add('s1');
      fakes.net.reset.rejects(new Error('boom'));
      await new PhoneNetworkRestore().restoreSession('s1', 'test');
      expect(fakes.icp.stop.calledOnceWith('s1')).to.equal(true);
    });
  });

  it('restoreAll restores every session either service still has', async () => {
    live.net.add('a');
    live.icp.add('a');
    live.icp.add('b');
    await new PhoneNetworkRestore().restoreAll('shutdown');
    expect(fakes.net.reset.args.map((a) => a[0])).to.deep.equal(['a']);
    expect(fakes.icp.stop.args.map((a) => a[0]).sort()).to.deep.equal(['a', 'b']);
  });

  describe('restoreLeftovers: what an ended run wrote down', () => {
    beforeEach(() => {
      adb.answers['P1 shell settings get global http_proxy'] = '127.0.0.1:11150';
    });

    it('turns back on what was on, and puts back the proxy it set', async () => {
      await ledger.note('old', 'P1', { offline: { wifiOn: true, dataOn: false } });
      await ledger.note('old', 'P1', {
        proxy: { set: '127.0.0.1:11150', previous: null, reversePort: 11150 },
      });

      const done = await new PhoneNetworkRestore().restoreLeftovers({});

      expect(done).to.equal(1);
      expect(adb.commands('P1')).to.deep.equal([
        'shell svc wifi enable',
        'shell settings get global http_proxy',
        'shell settings put global http_proxy :0',
        'reverse --remove tcp:11150',
      ]);
      expect(await ledger.list()).to.deep.equal([]);
    });

    it("puts back the phone's own proxy when it had one", async () => {
      await ledger.note('old', 'P1', {
        proxy: { set: '127.0.0.1:11150', previous: 'proxy.corp:3128' },
      });
      await new PhoneNetworkRestore().restoreLeftovers({});
      expect(adb.commands('P1')).to.include('shell settings put global http_proxy proxy.corp:3128');
    });

    it('leaves a proxy alone that someone changed since, and forgets it', async () => {
      adb.answers['P1 shell settings get global http_proxy'] = 'proxy.corp:3128';
      await ledger.note('old', 'P1', { proxy: { set: '127.0.0.1:11150', previous: null } });

      await new PhoneNetworkRestore().restoreLeftovers({});

      expect(adb.commands('P1')).to.deep.equal(['shell settings get global http_proxy']);
      expect(await ledger.list()).to.deep.equal([]);
    });

    it('skips a session this server still runs', async () => {
      live.net.add('running');
      await ledger.note('running', 'P1', { offline: { wifiOn: true, dataOn: true } });

      expect(await new PhoneNetworkRestore().restoreLeftovers({})).to.equal(0);
      expect(adb.calls).to.deep.equal([]);
      expect((await ledger.list()).map((e) => e.sessionId)).to.deep.equal(['running']);
    });

    it('touches only the phone it is asked about', async () => {
      await ledger.note('old-1', 'P1', { offline: { wifiOn: true, dataOn: true } });
      await ledger.note('old-2', 'P2', { offline: { wifiOn: true, dataOn: true } });

      await new PhoneNetworkRestore().restoreLeftovers({ udid: 'P2' });

      expect(adb.commands('P1')).to.deep.equal([]);
      expect(adb.commands('P2')).to.deep.equal(['shell svc data enable', 'shell svc wifi enable']);
      expect((await ledger.list()).map((e) => e.sessionId)).to.deep.equal(['old-1']);
    });

    it('keeps what it could not undo for next time, and gives up after a week', async () => {
      adb.answers['P1 shell svc data enable'] = new Error("device 'P1' not found");
      adb.answers['P9 shell svc data enable'] = new Error("device 'P9' not found");
      await ledger.note('recent', 'P1', { offline: { wifiOn: true, dataOn: true } });
      await ledger.note('ancient', 'P9', { offline: { wifiOn: true, dataOn: true } });
      const row = await prisma.webConfig.findUnique({ where: { name: 'phone-network:ancient' } });
      expect(row, 'the record').to.not.equal(null);
      const value = JSON.parse(row?.value ?? '{}');
      await prisma.webConfig.update({
        where: { name: 'phone-network:ancient' },
        data: { value: JSON.stringify({ ...value, at: Date.now() - 8 * DAY }) },
      });

      await new PhoneNetworkRestore().restoreLeftovers({});

      expect((await ledger.list()).map((e) => e.sessionId)).to.deep.equal(['recent']);
    });
  });

  describe('cleanUpAtBoot: a proxy left pointing at a dead capture port', () => {
    let server: net.Server;
    let livePort: number;
    let deadPort: number;

    beforeEach(async () => {
      server = net.createServer((s) => s.destroy());
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      livePort = (server.address() as net.AddressInfo).port;
      const closed = net.createServer();
      await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
      deadPort = (closed.address() as net.AddressInfo).port;
      await new Promise<void>((r) => closed.close(() => r()));
      range = [Math.min(livePort, deadPort), Math.max(livePort, deadPort)];
    });
    afterEach(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("clears only a proxy that points at this machine's capture ports where nothing answers", async () => {
      adb.answers['DEAD shell settings get global http_proxy'] = `127.0.0.1:${deadPort}`;
      adb.answers['EMU shell settings get global http_proxy'] = `10.0.2.2:${deadPort}`;
      adb.answers['LIVE shell settings get global http_proxy'] = `127.0.0.1:${livePort}`;
      adb.answers['CORP shell settings get global http_proxy'] = 'proxy.corp:3128';
      adb.answers['NONE shell settings get global http_proxy'] = ':0';
      adb.answers['FAR shell settings get global http_proxy'] = '127.0.0.1:1';

      await new PhoneNetworkRestore().cleanUpAtBoot(['DEAD', 'EMU', 'LIVE', 'CORP', 'NONE', 'FAR']);

      expect(adb.commands('DEAD')).to.deep.equal([
        'shell settings get global http_proxy',
        'shell settings put global http_proxy :0',
        `reverse --remove tcp:${deadPort}`,
      ]);
      expect(adb.commands('EMU')).to.deep.equal([
        'shell settings get global http_proxy',
        'shell settings put global http_proxy :0',
      ]);
      for (const kept of ['LIVE', 'CORP', 'NONE', 'FAR']) {
        expect(adb.commands(kept), kept).to.deep.equal(['shell settings get global http_proxy']);
      }
    });

    it('undoes what the ledger holds first, then checks the phones', async () => {
      await ledger.note('old', 'P1', { offline: { wifiOn: true, dataOn: true } });
      await new PhoneNetworkRestore().cleanUpAtBoot([]);
      expect(adb.commands('P1')).to.deep.equal(['shell svc data enable', 'shell svc wifi enable']);
    });

    it('never throws, even when a phone cannot be read', async () => {
      adb.answers['shell settings get global http_proxy'] = new Error('unauthorized');
      await new PhoneNetworkRestore().cleanUpAtBoot(['X']);
    });
  });

  it('can be built by the container', () => {
    restoreRegs();
    restoreRegs = saveRegistrations(PhoneNetworkRestore);
    expect(() => Container.get(PhoneNetworkRestore)).not.to.throw();
  });
});
