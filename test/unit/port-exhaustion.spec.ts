import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { PortAllocator, PortRangeExhaustedError } from '../../src/services/PortAllocator';
import { simulatorNeedsPortNow } from '../../src/device-managers/ios/IOSDiscoveryService';
import { iOSCapabilities } from '../../src/XenonCapabilityManager';
import { Container } from 'typedi';
import { prisma } from '../../src/prisma';

/**
 * A Mac carries far more simulators than these ranges hold — 158 against 100
 * where this surfaced. Discovery leased a wda and an mjpeg port to every one
 * of them, drained both ranges, and then threw; IOSDeviceManager returned no
 * devices at all, and the physically-attached iPhone on the same Mac was
 * reaped as stale for not appearing in its own device list.
 */
describe('port exhaustion during iOS discovery', () => {
  beforeEach(() => {
    sinon.stub(prisma.portLease, 'findMany').resolves([]);
    sinon.stub(prisma.portLease, 'findFirst').resolves(null as any);
    sinon.stub(prisma.portLease, 'deleteMany').resolves({ count: 0 } as any);
    sinon.stub(prisma.portLease, 'delete').resolves({} as any);
    sinon.stub(prisma.portLease, 'update').resolves({} as any);
  });

  afterEach(() => sinon.restore());

  function exhaustedAllocator() {
    const a = new PortAllocator();
    a.configure({ wda: [8100, 8101] });
    // Every port in the range already leased to somebody else.
    (prisma.portLease.findMany as sinon.SinonStub).resolves([{ port: 8100 }, { port: 8101 }]);
    return a;
  }

  it('acquire still raises when the range is exhausted', async () => {
    // The strict form is unchanged — callers that genuinely need a port must
    // still hear about it.
    let err: any;
    await exhaustedAllocator()
      .acquire('wda', 'udid-1')
      .catch((e) => (err = e));
    expect(err).to.be.instanceOf(PortRangeExhaustedError);
  });

  it('tryAcquire reports exhaustion as undefined instead', async () => {
    expect(await exhaustedAllocator().tryAcquire('wda', 'udid-1')).to.equal(undefined);
  });

  it('tryAcquire does not swallow a failure that is not exhaustion', async () => {
    // A database or probe failure is a different problem and must not be
    // quietly turned into "no port available".
    const a = new PortAllocator();
    a.configure({ wda: [8100, 8101] });
    (prisma.portLease.findMany as sinon.SinonStub).rejects(new Error('database is locked'));
    let message = '';
    await a.tryAcquire('wda', 'udid-1').catch((e) => (message = e.message));
    expect(message).to.equal('database is locked');
  });

  it('one device exhausting the range does not stop the next from being listed', async () => {
    // The behaviour that matters: discovery maps over devices, and the pass
    // has to survive a device that cannot get a port.
    const a = exhaustedAllocator();
    const discovered = await Promise.all(
      ['sim-1', 'sim-2', 'iphone'].map(async (udid) => ({
        udid,
        wdaLocalPort: await a.tryAcquire('wda', udid),
      })),
    );
    expect(discovered.map((d) => d.udid)).to.deep.equal(['sim-1', 'sim-2', 'iphone']);
    expect(discovered.every((d) => d.wdaLocalPort === undefined)).to.equal(true);
  });
});

/**
 * The other half: not needing the ports in the first place. A shut-down
 * simulator is not running WebDriverAgent and will not until someone boots it.
 */
describe('who gets a port at discovery time', () => {
  const acquiredFor: string[] = [];
  const allocator = {
    tryAcquire: async (_purpose: string, udid: string) => {
      acquiredFor.push(udid);
      return 8100 + acquiredFor.length;
    },
  };

  // The real predicate from the discovery service, not a copy of it — a
  // restatement here would keep passing after the rule changed.
  async function portFor(sim: { udid: string; state: string; stored?: number }) {
    return (
      sim.stored ||
      (simulatorNeedsPortNow(sim.state) ? await allocator.tryAcquire('wda', sim.udid) : undefined)
    );
  }

  beforeEach(() => (acquiredFor.length = 0));

  it('leases to a booted simulator', async () => {
    expect(await portFor({ udid: 'booted-1', state: 'Booted' })).to.be.a('number');
    expect(acquiredFor).to.deep.equal(['booted-1']);
  });

  it('leases nothing to a shut-down simulator', async () => {
    expect(await portFor({ udid: 'off-1', state: 'Shutdown' })).to.equal(undefined);
    expect(acquiredFor).to.deep.equal([]);
  });

  it('keeps a port the device already has, whatever its state', async () => {
    expect(await portFor({ udid: 'off-2', state: 'Shutdown', stored: 8137 })).to.equal(8137);
    expect(acquiredFor).to.deep.equal([]);
  });

  it('does not drain the range across a machine full of idle simulators', async () => {
    const sims = Array.from({ length: 158 }, (_, i) => ({ udid: `sim-${i}`, state: 'Shutdown' }));
    await Promise.all(sims.map(portFor));
    expect(acquiredFor.length).to.equal(0);
  });
});

/**
 * Discovery no longer hands a port to every simulator, so the device chosen
 * for a session can arrive without one. This is where it gets one.
 */
describe('iOSCapabilities port acquisition', () => {
  const device = {
    udid: 'sim-1',
    name: 'iPhone 15',
    realDevice: false,
    sdk: '17.5',
    platform: 'ios',
  };

  let acquireStub: sinon.SinonStub;

  beforeEach(() => {
    acquireStub = sinon.stub(PortAllocator.prototype, 'acquire');
    acquireStub.withArgs('wda').resolves(8123);
    acquireStub.withArgs('mjpeg').resolves(9123);
  });

  afterEach(() => sinon.restore());

  it('acquires when the chosen device arrived without ports', async () => {
    const caps: any = { alwaysMatch: {}, firstMatch: [{}] };
    await iOSCapabilities(caps, device as any);
    expect(caps.firstMatch[0]['appium:wdaLocalPort']).to.equal(8123);
    expect(caps.firstMatch[0]['appium:mjpegServerPort']).to.equal(9123);
  });

  it('uses the port the device already holds rather than taking another', async () => {
    const caps: any = { alwaysMatch: {}, firstMatch: [{}] };
    await iOSCapabilities(caps, { ...device, wdaLocalPort: 8150, mjpegServerPort: 9150 } as any);
    expect(caps.firstMatch[0]['appium:wdaLocalPort']).to.equal(8150);
    expect(acquireStub.calledWith('wda')).to.equal(false);
  });

  it('leaves a caller-supplied port alone', async () => {
    const caps: any = { alwaysMatch: {}, firstMatch: [{ 'appium:wdaLocalPort': 8199 }] };
    await iOSCapabilities(caps, device as any);
    expect(caps.firstMatch[0]['appium:wdaLocalPort']).to.equal(8199);
    expect(acquireStub.calledWith('wda')).to.equal(false);
  });

  it('takes no lease at all when the session will reuse the stream service WDA', async () => {
    // That branch deletes both ports a few lines later. Acquiring first would
    // burn one out of a hundred on every session opened while the dashboard
    // has a preview up — the exact pressure this change exists to relieve.
    const { default: IOSStreamService } = await import(
      '../../src/device-managers/ios/IOSStreamService'
    );
    sinon
      .stub(Container.get(IOSStreamService), 'getStreamStatus')
      .returns({ status: 'running', wdaPort: 8100 } as any);

    const caps: any = { alwaysMatch: {}, firstMatch: [{}] };
    await iOSCapabilities(caps, device as any);

    expect(caps.firstMatch[0]['appium:webDriverAgentUrl']).to.equal('http://127.0.0.1:8100');
    expect(caps.firstMatch[0]['appium:wdaLocalPort']).to.equal(undefined);
    expect(acquireStub.called).to.equal(false);
  });
});
