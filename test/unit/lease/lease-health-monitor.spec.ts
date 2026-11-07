import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { HealthMonitorService } from '../../../src/device-managers/HealthMonitorService';
import { XenonManager } from '../../../src/device-managers';
import IOSDeviceManager from '../../../src/device-managers/IOSDeviceManager';
import { WDAClient } from '../../../src/device-managers/ios/WDAClient';
import IOSStreamService from '../../../src/device-managers/ios/IOSStreamService';
import AndroidStreamService from '../../../src/device-managers/android/AndroidStreamService';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { LeaseOrphanSweeper } from '../../../src/services/lease/LeaseOrphanSweeper';
import { LeaseQueue } from '../../../src/services/lease/LeaseQueue';
import { PluginContext } from '../../../src/PluginContext';
import { SESSION_MANAGER } from '../../../src/sessions/SessionManager';
import { prisma } from '../../../src/prisma';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { usePrismaStores } from '../../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../../helpers/own-node-id';

// A phone a live lease holds or leases is locked with `busy` and runs no
// session until the client starts one. The health monitor used to take such
// a phone for a "zombie" (busy, no session in memory, no stream): it cleared
// `busy` and checked it as a busy phone. An iPhone whose WDA isn't running,
// which is how an idle one is, then read Unhealthy, and the sweeper ended
// its group at once.

const HOST = 'http://127.0.0.1:4723';
const HOUR = 60 * 60 * 1000;

// Named like the real manager: the monitor picks one by constructor.name.
class AndroidDeviceManager {
  checkHealth = async () => ({ healthStatus: 'Healthy' });
}

describe('the health monitor and lease phones', () => {
  useScratchDatabase({ wholeSuite: true });
  usePrismaStores();
  useOwnNodeId();

  const auth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
  let ios: IOSDeviceManager;
  let monitor: any;
  let queue: LeaseQueue;
  let sweeper: LeaseOrphanSweeper;
  let iosChecked: sinon.SinonSpy;

  const phone = (udid: string, platform: 'ios' | 'android', over: Record<string, unknown> = {}) =>
    prisma.device.create({
      data: {
        udid,
        host: HOST,
        nodeId: OWN_NODE_ID,
        name: `Phone ${udid}`,
        platform,
        sdk: platform === 'ios' ? '18.0' : '13',
        busy: true,
        offline: false,
        userBlocked: false,
        deviceType: 'real',
        realDevice: true,
        healthStatus: 'Healthy',
        ...over,
      } as any,
    });

  const lease = async (id: string, status: 'active' | 'waiting', udids: string[]) => {
    const now = Date.now();
    await prisma.lease.create({
      data: {
        id,
        tokenHash: 'h',
        deviceUdid: status === 'active' ? udids[0] : '',
        deviceHost: status === 'active' ? HOST : '',
        actorId: 'key_owner',
        status,
        expiresAt: status === 'active' ? now + HOUR : 0,
        waitUntil: status === 'waiting' ? now + HOUR : null,
        heartbeatSeconds: 30,
        lastHeartbeatAt: now,
        allocatedPorts: '{}',
        capabilityBag: '',
        requestedMembers: JSON.stringify(udids.map((udid) => ({ platform: 'ios', udid }))),
        durationMs: 600_000,
        members: {
          create: udids.map((udid, index) => ({ index, udid, host: HOST, heldAt: now })),
        },
      } as any,
    });
  };

  const row = (udid: string) =>
    prisma.device.findUnique({ where: { udid_host: { udid, host: HOST } } });
  const leaseStatus = async (id: string) =>
    (await prisma.lease.findUnique({ where: { id } }))?.status;

  beforeEach(async () => {
    sinon.stub(process, 'kill');
    await prisma.lease.deleteMany({});
    await prisma.device.deleteMany({});

    const wda = { verifyWDAStatus: async () => false, checkRequirements: async () => undefined };
    const noStream = { getStreamStatus: () => undefined };
    const real = Container.get.bind(Container);
    ios = new IOSDeviceManager(Container.get(PluginContext));
    // An idle iPhone: WDA isn't running, the battery reads.
    sinon.stub(ios as any, 'collectBatteryLevel').resolves(80);
    sinon.stub(ios, 'recoverHealth').resolves(false);
    iosChecked = sinon.spy(ios, 'checkHealth');
    const android = new AndroidDeviceManager();
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === XenonManager) return { deviceInstances: async () => [ios, android] } as any;
      if (token === WDAClient) return wda as any;
      if (token === IOSStreamService) return noStream as any;
      if (token === AndroidStreamService) return noStream as any;
      return real(token);
    });
    sinon.stub(SESSION_MANAGER, 'isValidSession').returns(false);

    monitor = new HealthMonitorService({} as any);
    const store = DeviceStoreFactory.getStore();
    const portClient = {
      allocate: sinon.stub().rejects(new Error('no grant in these tests')),
      release: sinon.stub().resolves({ released: 0 }),
    };
    queue = new LeaseQueue(prisma, store, portClient, auth);
    sweeper = new LeaseOrphanSweeper(prisma, store, portClient, auth, queue);
  });

  afterEach(async () => {
    await queue.idle();
    queue.stop();
    await sweeper.phoneServerCallsSettled();
    sinon.restore();
  });

  it('a group with an idle iPhone survives a health check and the sweeps after it', async () => {
    await phone('iphone-1', 'ios');
    await phone('android-2', 'android');
    await lease('lse_group', 'active', ['iphone-1', 'android-2']);

    await monitor.checkAllDevices();

    const iphone = await row('iphone-1');
    expect(iphone?.busy, 'still locked for its lease').to.equal(true);
    expect(iphone?.healthStatus).to.equal('Healthy');
    expect(iphone?.healthCheckError).to.equal('Idle (WDA Stopped)');
    expect(iosChecked.firstCall.args[0].busy, 'judged as an idle phone').to.equal(false);
    expect((await row('android-2'))?.busy).to.equal(true);

    await sweeper.sweep();
    await sweeper.sweep();
    expect(await leaseStatus('lse_group')).to.equal('active');
  });

  it('a phone held for a waiting lease is idle too', async () => {
    await phone('iphone-1', 'ios');
    await lease('lse_wait', 'waiting', ['iphone-1', 'nobody']);

    await monitor.checkAllDevices();

    const iphone = await row('iphone-1');
    expect(iphone?.busy).to.equal(true);
    expect(iphone?.healthStatus).to.equal('Healthy');

    await sweeper.sweep();
    await sweeper.sweep();
    const held = await prisma.leaseMember.findMany({ where: { leaseId: 'lse_wait' } });
    expect(held.map((m) => m.udid)).to.deep.equal(['iphone-1']);
  });

  it('reads the leases once a run', async () => {
    await phone('iphone-1', 'ios');
    await phone('android-2', 'android');
    await phone('android-3', 'android', { busy: false });
    await lease('lse_group', 'active', ['iphone-1', 'android-2']);
    const reads = sinon.spy(monitor, 'readLeasedPhones');

    await monitor.checkAllDevices();

    expect(reads.callCount).to.equal(1);
  });

  it('a phone a session holds is judged as before: left alone', async () => {
    await phone('iphone-1', 'ios', { session_id: 'live-session' });
    await lease('lse_group', 'active', ['iphone-1']);
    (SESSION_MANAGER.isValidSession as sinon.SinonStub).withArgs('live-session').returns(true);

    await monitor.checkAllDevices();

    expect(iosChecked.called).to.equal(false);
    expect((await row('iphone-1'))?.busy).to.equal(true);
  });

  it('a busy phone no lease holds, with no session, is still reclaimed', async () => {
    await phone('iphone-1', 'ios', { session_id: 'gone-session' });

    await monitor.checkAllDevices();

    expect((await row('iphone-1'))?.busy).to.equal(false);
  });

  it("leaves busy phones alone for a run whose leases can't be read", async () => {
    await phone('iphone-1', 'ios', { session_id: 'gone-session' });
    await phone('android-2', 'android', { busy: false });
    monitor.readLeasedPhones = async () => {
      throw new Error('database is locked');
    };

    await monitor.checkAllDevices();

    expect(iosChecked.called).to.equal(false);
    expect((await row('iphone-1'))?.busy).to.equal(true);
    expect(
      (await row('android-2'))?.lastHealthCheckAt,
      'an idle phone is still checked',
    ).to.not.equal(null);
  });
});
