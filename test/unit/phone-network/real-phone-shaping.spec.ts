import 'reflect-metadata';
import { expect } from 'chai';
import net from 'net';
import sinon from 'sinon';
import { Container } from 'typedi';
import {
  NetworkConditioningService,
  limitsFor,
} from '../../../src/services/NetworkConditioningService';
import { SessionLifecycleService } from '../../../src/services/SessionLifecycleService';
import { InterceptorService } from '../../../src/services/InterceptorService';
import { PortAllocator } from '../../../src/services/PortAllocator';
import { PhoneNetworkLedger } from '../../../src/services/network/PhoneNetworkLedger';
import { PhoneNetworkRestore } from '../../../src/services/network/PhoneNetworkRestore';
import { PhoneProxy } from '../../../src/services/network/PhoneProxy';
import { ShapingRelay, ShapingRelayOptions } from '../../../src/services/network/ShapingRelay';
import { UNLIMITED } from '../../../src/services/network/LinkShaper';
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
const PIXEL = { ...S9, udid: 'PIXEL8' };

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
 * ENH-20 part 2: on a real Android phone, 4G, 3G and Edge shape the app's own
 * proxy-aware traffic through a relay on this machine, and the session's end
 * puts the phone's proxy back.
 */
describe('Shaping a real phone (ENH-20 part 2)', function () {
  this.timeout(60_000);
  useScratchDatabase();
  let adb: FakeAdb;
  useFakeAdb(() => adb);
  let restoreRegs: () => void;
  let svc: NetworkConditioningService;
  let relays: Array<{ opts: ShapingRelayOptions; relay: ShapingRelay }>;
  let capturePort: number | undefined;
  let released: Array<[number, string]>;

  beforeEach(async () => {
    adb = fakeAdb({ 'shell settings get global http_proxy': ':0' });
    restoreRegs = saveRegistrations(PortAllocator, InterceptorService, PhoneProxy);
    released = [];
    Container.set(PortAllocator, {
      acquire: async () => freePort(),
      release: async (port: number, key: string) => void released.push([port, key]),
      releaseForUdid: async () => undefined,
      rangeOf: () => [11100, 11199],
    } as any);
    capturePort = undefined;
    Container.set(InterceptorService, { proxyPortOf: () => capturePort } as any);
    Container.set(PhoneProxy, new PhoneProxy());
    const ledger = Container.get(PhoneNetworkLedger);
    for (const entry of await ledger.list()) await ledger.forget(entry.sessionId);

    svc = new NetworkConditioningService();
    relays = [];
    const real = svc.relayFor;
    svc.relayFor = (opts) => {
      const relay = real(opts);
      relays.push({ opts, relay });
      return relay;
    };
  });

  afterEach(async () => {
    for (const id of svc.sessionIds()) await svc.reset(id);
    sinon.restore();
    restoreRegs();
  });

  const proxyWrites = (udid = S9.udid) =>
    adb.commands(udid).filter((c) => c.startsWith('shell settings put global http_proxy'));

  it('limitsFor gives the profile figures', () => {
    expect(limitsFor('3G')).to.deep.equal({ downKbps: 2000, upKbps: 1000, latencyMs: 100 });
    expect(limitsFor('Normal')).to.deep.equal(UNLIMITED);
    expect(limitsFor('Offline')).to.deep.equal(UNLIMITED);
  });

  it('3G at start: one relay, proxy pointed, ledger first, answer shaped', async () => {
    const outcome = await svc.applyProfile('s1', S9, '3G');

    expect(outcome).to.deep.equal({ profile: '3G', appTraffic: 'shaped', commandDelayMs: 100 });
    expect(relays).to.have.length(1);
    const port = relays[0].opts.port;
    expect(await answers(port)).to.equal(true);
    expect(relays[0].opts.bindHost).to.equal('127.0.0.1');
    expect(relays[0].opts.shaper.limits()).to.deep.equal(limitsFor('3G'));
    const cmds = adb.commands(S9.udid);
    expect(cmds).to.include(`reverse tcp:${port} tcp:${port}`);
    expect(proxyWrites()).to.deep.equal([`shell settings put global http_proxy 127.0.0.1:${port}`]);
    const [entry] = await Container.get(PhoneNetworkLedger).list();
    expect(entry.proxy).to.deep.include({ set: `127.0.0.1:${port}`, previous: null });
  });

  it('3G, Normal, Edge: one relay and one proxy change, limits swapped', async () => {
    await svc.setProfile('s1', S9, '3G');
    const normal = await svc.setProfile('s1', S9, 'Normal');
    expect(relays[0].opts.shaper.limits()).to.deep.equal(UNLIMITED);
    expect(normal.appTraffic).to.equal('radios');
    const edge = await svc.setProfile('s1', S9, 'Edge');

    expect(edge.appTraffic).to.equal('shaped');
    expect(relays).to.have.length(1);
    expect(relays[0].opts.shaper.limits()).to.deep.equal(limitsFor('Edge'));
    expect(proxyWrites()).to.have.length(1);
  });

  it('Normal before any shaping: no relay, no proxy change, answer radios', async () => {
    const outcome = await svc.setProfile('s1', S9, 'Normal');
    expect(outcome.appTraffic).to.equal('radios');
    expect(relays).to.have.length(0);
    expect(proxyWrites()).to.deep.equal([]);
  });

  it('Offline keeps the relay; leaving it keeps the limits', async () => {
    await svc.setProfile('s1', S9, 'Edge');
    const offline = await svc.setProfile('s1', S9, 'Offline');
    expect(offline.appTraffic).to.equal('radios');
    expect(await answers(relays[0].opts.port)).to.equal(true);
    expect(relays[0].opts.shaper.limits()).to.deep.equal(limitsFor('Edge'));
  });

  it('with capture on, the relay targets the capture port', async () => {
    capturePort = 11150;
    await svc.setProfile('s1', S9, '3G');
    expect(relays[0].opts.target()).to.deep.equal({ host: '127.0.0.1', port: 11150 });
  });

  it('without capture, the relay targets the shared forward proxy', async () => {
    const forward = await sharedForwardProxy.acquire();
    await svc.setProfile('s1', S9, '3G');
    expect(relays[0].opts.target()).to.deep.equal({ host: '127.0.0.1', port: forward });
    await sharedForwardProxy.release();
  });

  it("the session's end stops the relay, releases its port and the proxy, once", async () => {
    await svc.setProfile('s1', S9, '3G');
    const port = relays[0].opts.port;
    adb.calls.length = 0;

    await svc.reset('s1');
    await svc.reset('s1');

    expect(await answers(port)).to.equal(false);
    expect(released).to.deep.equal([[port, `${S9.udid}:shaping`]]);
    expect(proxyWrites()).to.deep.equal(['shell settings put global http_proxy :0']);
    expect(adb.commands(S9.udid)).to.include(`reverse --remove tcp:${port}`);
    expect(await Container.get(PhoneNetworkLedger).list()).to.deep.equal([]);
  });

  it('a reset during a profile change leaves no relay running', async () => {
    const changing = svc.setProfile('s1', S9, '3G');
    const ending = svc.reset('s1');
    await Promise.all([changing, ending]);
    await svc.reset('s1');

    for (const { opts } of relays) expect(await answers(opts.port)).to.equal(false);
    expect(proxyWrites().at(-1) ?? 'none').to.match(/:0$|none/);
  });

  it('without adb reverse: none, no relay on the LAN, the proxy untouched', async () => {
    // The LAN fallback would open a proxy to the LAN and, on a USB-only lab,
    // point the phone at an address it can't reach: shaping refuses it.
    (Container.get(PortAllocator) as any).acquire = async () => 11177;
    adb.answers[`${S9.udid} reverse tcp:11177 tcp:11177`] = new Error('more than one device');
    const outcome = await svc.setProfile('s1', { ...S9 }, '3G');

    expect(outcome.appTraffic).to.equal('none');
    expect(relays).to.have.length(0);
    expect(proxyWrites()).to.deep.equal([]);
  });

  it('a profile change after the session ended starts nothing', async () => {
    await svc.setProfile('s1', S9, 'Normal');
    await svc.reset('s1');

    const late = await svc.setProfile('s1', S9, '3G');

    expect(late.appTraffic).to.equal('none');
    expect(relays).to.have.length(0);
    expect(proxyWrites()).to.deep.equal([]);
    expect(svc.has('s1')).to.equal(false);
  });

  it('a profile change for a session that ended with no profile starts nothing either', async () => {
    await svc.reset('s9');
    const late = await svc.setProfile('s9', S9, 'Edge');
    expect(late.appTraffic).to.equal('none');
    expect(relays).to.have.length(0);
    expect(svc.has('s9')).to.equal(false);
  });

  it('a phone on a remote adb server answers none and starts nothing', async () => {
    const outcome = await svc.setProfile('s1', { ...S9, adbRemoteHost: '10.0.0.5' }, '3G');
    expect(outcome.appTraffic).to.equal('none');
    expect(relays).to.have.length(0);
    expect(proxyWrites()).to.deep.equal([]);
  });

  it('a relay that cannot start answers none, logged once per phone', async () => {
    svc.relayFor = (opts) => {
      const relay = new ShapingRelay(opts);
      relay.start = async () => {
        throw new Error('EADDRINUSE');
      };
      relays.push({ opts, relay });
      return relay;
    };
    const warn = sinon.spy((svc as any).log, 'warn');

    const first = await svc.setProfile('s1', S9, '3G');
    const second = await svc.setProfile('s1', S9, 'Edge');

    expect(first.appTraffic).to.equal('none');
    expect(second.appTraffic).to.equal('none');
    expect(proxyWrites()).to.deep.equal([]);
    expect(adb.commands(S9.udid).filter((c) => c.startsWith('reverse --remove'))).to.have.length(2);
    expect(warn.getCalls().filter((c) => String(c.args[0]).includes('relay'))).to.have.length(1);
  });

  it('describe says shaped for a real phone with a shaping profile', async () => {
    await svc.setProfile('s1', S9, '4G');
    expect(svc.describe('s1')).to.deep.equal({
      profile: '4G',
      appTraffic: 'shaped',
      commandDelayMs: 20,
    });
    await svc.setProfile('s1', S9, 'Normal');
    expect(svc.describe('s1')?.appTraffic).to.equal('radios');
  });

  it('two phones get two relays and share one forward proxy', async () => {
    await svc.setProfile('s1', S9, '3G');
    await svc.setProfile('s2', PIXEL, 'Edge');
    expect(relays).to.have.length(2);
    expect(relays[0].opts.port).to.not.equal(relays[1].opts.port);
    const forward = relays[0].opts.target().port;
    expect(relays[1].opts.target().port).to.equal(forward);

    await svc.reset('s1');
    expect(await answers(forward)).to.equal(true);
    await svc.reset('s2');
    expect(await answers(forward)).to.equal(false);
  });

  it('session start applies capture before the profile', async () => {
    const order: string[] = [];
    sinon.stub(PhoneNetworkRestore.prototype, 'restoreLeftovers').resolves(0);
    Container.set(InterceptorService, {
      start: async () => void order.push('capture'),
      proxyPortOf: () => undefined,
    } as any);
    sinon.stub(NetworkConditioningService.prototype, 'applyProfile').callsFake(async () => {
      order.push('profile');
      return undefined as any;
    });

    await (Container.get(SessionLifecycleService) as any).applySessionNetwork(
      's1',
      { network_profile: '3G', interceptorEnabled: true },
      S9,
      { interceptor: { enabled: true } },
    );

    expect(order).to.deep.equal(['capture', 'profile']);
  });
});
