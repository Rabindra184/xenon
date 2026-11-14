import 'reflect-metadata';
import { expect } from 'chai';
import net from 'net';
import sinon from 'sinon';
import { Container } from 'typedi';
import { NetworkConditioningService } from '../../../src/services/NetworkConditioningService';
import { InterceptorService } from '../../../src/services/InterceptorService';
import { PortAllocator } from '../../../src/services/PortAllocator';
import { PhoneNetworkLedger } from '../../../src/services/network/PhoneNetworkLedger';
import { PhoneProxy } from '../../../src/services/network/PhoneProxy';
import { sharedForwardProxy } from '../../../src/services/network/ForwardProxy';
import { saveRegistrations } from '../../helpers/container-registration';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { FakeAdb, fakeAdb, useFakeAdb } from '../../helpers/fake-adb';

const S9 = {
  udid: 'R58M123',
  platform: 'android',
  realDevice: true,
  deviceType: 'real',
  host: 'h',
} as any;

async function freePort(): Promise<number> {
  const probe = net.createServer();
  const port = await new Promise<number>((resolve) =>
    probe.listen(0, '127.0.0.1', () => resolve((probe.address() as net.AddressInfo).port)),
  );
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const answers = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
  });

/**
 * A shaping relay whose start fails part way leaves nothing behind. Through
 * 2.36, when pointing the phone's proxy at the relay failed (the adb call
 * that sets it, after the ledger had the change), the relay, its port lease,
 * the shared forward proxy and the `adb reverse` were undone, but the
 * PhoneProxy entry and its ledger record were not: the record named a
 * session with nothing to put back, and the session's end never released it.
 */
describe('Shaping relay: a start that fails part way', function () {
  this.timeout(60_000);
  useScratchDatabase();
  let adb: FakeAdb;
  useFakeAdb(() => adb);
  let restoreRegs: () => void;
  let svc: NetworkConditioningService;
  let port: number;
  let released: Array<[number, string]>;
  let capturePort: number | undefined;
  let ledger: PhoneNetworkLedger;

  beforeEach(async () => {
    adb = fakeAdb({ 'shell settings get global http_proxy': 'proxy.corp:3128' });
    restoreRegs = saveRegistrations(PortAllocator, InterceptorService, PhoneProxy);
    port = await freePort();
    released = [];
    Container.set(PortAllocator, {
      acquire: async () => port,
      release: async (p: number, key: string) => void released.push([p, key]),
      releaseForUdid: async () => undefined,
      rangeOf: () => [11100, 11199],
    } as any);
    capturePort = undefined;
    Container.set(InterceptorService, { proxyPortOf: () => capturePort } as any);
    Container.set(PhoneProxy, new PhoneProxy());
    ledger = Container.get(PhoneNetworkLedger);
    for (const entry of await ledger.list()) await ledger.forget(entry.sessionId);
    svc = new NetworkConditioningService();
  });

  afterEach(async () => {
    for (const id of svc.sessionIds()) await svc.reset(id);
    sinon.restore();
    restoreRegs();
  });

  const failSettingRelayProxy = () => {
    adb.answers[`shell settings put global http_proxy 127.0.0.1:${port}`] = new Error(
      "device 'R58M123' not found",
    );
  };

  it("when the phone's proxy can't be set: everything undone, its own proxy back", async () => {
    failSettingRelayProxy();
    const fwdRelease = sinon.spy(sharedForwardProxy, 'release');

    const outcome = await svc.setProfile('s1', S9, '3G');

    expect(outcome.appTraffic).to.equal('none');
    expect(await answers(port), 'the relay is stopped').to.equal(false);
    expect(released).to.deep.equal([[port, 'R58M123:shaping']]);
    expect(fwdRelease.calledOnce, 'the forward proxy is let go').to.equal(true);
    const cmds = adb.commands(S9.udid);
    expect(cmds.filter((c) => c === `reverse --remove tcp:${port}`)).to.have.length(1);
    expect(Container.get(PhoneProxy).owns('s1'), 'no PhoneProxy entry left').to.equal(false);
    expect(cmds).to.include('shell settings put global http_proxy proxy.corp:3128');
    expect(await ledger.list(), 'no record left').to.deep.equal([]);

    // The session's end has nothing left to undo.
    adb.calls.length = 0;
    await svc.reset('s1');
    expect(adb.calls).to.deep.equal([]);
  });

  it("leaves capture's own proxy entry alone, and still removes the relay's reverse", async () => {
    const phoneProxy = Container.get(PhoneProxy);
    capturePort = await freePort();
    const route = await phoneProxy.route(S9, capturePort);
    await phoneProxy.pointAt('s1', S9, capturePort, route);
    failSettingRelayProxy();
    adb.calls.length = 0;

    const outcome = await svc.setProfile('s1', S9, '3G');

    expect(outcome.appTraffic).to.equal('none');
    expect(await answers(port)).to.equal(false);
    expect(released).to.deep.equal([[port, 'R58M123:shaping']]);
    expect(adb.commands(S9.udid)).to.include(`reverse --remove tcp:${port}`);
    expect(phoneProxy.owns('s1'), "capture's entry stays").to.equal(true);
    const [entry] = await ledger.list();
    expect(entry.proxy?.set).to.equal(`127.0.0.1:${capturePort}`);
    expect(entry.proxy?.reversePorts).to.deep.equal([capturePort]);
    expect(adb.commands(S9.udid)).not.to.include(
      'shell settings put global http_proxy proxy.corp:3128',
    );

    await phoneProxy.release('s1');
    expect(await ledger.list()).to.deep.equal([]);
  });
});
