import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { XenonPlugin } from '../../../src/plugin';
import NodeDevices from '../../../src/device-managers/NodeDevices';
import * as DeviceService from '../../../src/data-service/device-service';
import * as ActiveLeases from '../../../src/services/lease/activeLeases';
import { releaseBlockedDevices } from '../../../src/device-utils';
import { SessionLifecycleService } from '../../../src/services/SessionLifecycleService';
import { SessionMetricsService } from '../../../src/services/metrics/SessionMetricsService';
import { OrphanSweeper } from '../../../src/services/OrphanSweeper';
import { ShutdownCoordinator } from '../../../src/services/ShutdownCoordinator';
import { PhoneNetworkRestore } from '../../../src/services/network/PhoneNetworkRestore';
import { DASHBORD_EVENT_MANAGER } from '../../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../../src/sessions/SessionManager';
import { prisma } from '../../../src/prisma';
import { saveRegistrations } from '../../helpers/container-registration';
import { useScratchDatabase } from '../../helpers/scratch-database';

/**
 * A network profile or the interceptor changes the whole phone. Its network
 * was put back only when the test deleted a session Xenon kept in memory.
 * Every other ending (Appium's new-command timeout, Xenon's idle release, a
 * shutdown, a stale heartbeat) left an Offline phone offline and an
 * intercepted phone pointing at a proxy that no longer exists.
 *
 * Each ending now asks PhoneNetworkRestore, keyed by the session id, and
 * before the phone is released: a phone handed to the next session while its
 * network is still being put back could have that session's own profile
 * undone.
 */
describe('a session’s phone network is put back however the session ends', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  let restoreRegs: () => void;
  let order: string[];
  let restoreSession: sinon.SinonStub;
  let restoreAll: sinon.SinonStub;

  beforeEach(() => {
    restoreRegs = saveRegistrations(PhoneNetworkRestore, SessionMetricsService);
    order = [];
    restoreSession = sinon.stub().callsFake(async (id: string) => {
      order.push(`restore ${id}`);
    });
    restoreAll = sinon.stub().callsFake(async () => {
      order.push('restore all');
    });
    Container.set(PhoneNetworkRestore, { restoreSession, restoreAll } as any);
    Container.set(SessionMetricsService, { stop: sinon.stub().resolves() } as any);
    sinon.stub(DeviceService, 'releaseSessionDevices').callsFake(async (id: string) => {
      order.push(`release ${id}`);
    });
    sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
  });

  afterEach(() => {
    sinon.restore();
    restoreRegs();
  });

  it('when the test deletes a session Xenon keeps no record of', async () => {
    expect(SESSION_MANAGER.getSession('s-untracked')).to.equal(undefined);
    const next = sinon.stub().callsFake(async () => {
      order.push('driver quit');
    });

    await Container.get(SessionLifecycleService).deleteSession(next, 's-untracked');

    expect(restoreSession.callCount).to.equal(1);
    expect(order.indexOf('restore s-untracked')).to.be.lessThan(
      order.indexOf('release s-untracked'),
    );
  });

  it("when Appium ends the session itself (new-command timeout), on this server's own phone", async () => {
    const plugin = { pluginArgs: {}, xenonLog: { withSession: () => ({ info() {} }) } };
    await XenonPlugin.prototype.onUnexpectedShutdown.call(
      plugin as any,
      { sessionId: 's-timeout', caps: { udid: 'R5CT' } },
      new Error('New command timeout'),
    );

    expect(restoreSession.callCount).to.equal(1);
    expect(restoreSession.firstCall.args[0]).to.equal('s-timeout');
    expect(order).to.deep.equal(['restore s-timeout', 'release s-timeout']);
  });

  it('when Appium ends the session on a node', async () => {
    const unblock = sinon.stub(NodeDevices.prototype, 'unblockDevice').callsFake(async () => {
      order.push('hub unblock');
      return undefined as any;
    });
    const plugin = { pluginArgs: { hub: 'http://hub:4723' } };
    await XenonPlugin.prototype.onUnexpectedShutdown.call(
      plugin as any,
      { sessionId: 's-node', caps: {} },
      null,
    );

    expect(unblock.calledOnce).to.equal(true);
    expect(order).to.deep.equal(['restore s-node', 'hub unblock']);
  });

  it("when Xenon's idle check releases the phone", async () => {
    const idle = {
      udid: 'R5CT',
      host: 'http://127.0.0.1:4723',
      busy: true,
      userBlocked: false,
      session_id: 's-idle',
      claimSessionId: 's-idle',
      lastCmdExecutedAt: Date.now() - 10 * 60 * 1000,
    };
    sinon.stub(DeviceService, 'getAllDevices').resolves([idle as any]);
    sinon.stub(ActiveLeases, 'activeLeasesByDevice').resolves(new Map());
    sinon.stub(DeviceService, 'releaseSessionDevice').callsFake(async (_u, _h, id) => {
      order.push(`release ${id}`);
      return true;
    });

    await releaseBlockedDevices(60);

    expect(restoreSession.callCount).to.equal(1);
    expect(order).to.deep.equal(['restore s-idle', 'release s-idle']);
  });

  it('when a graceful shutdown drains a session', async () => {
    await Container.get(SessionLifecycleService).stopSessionForShutdown('s-down', 'shutdown');
    expect(order.slice(0, 2)).to.deep.equal(['restore s-down', 'release s-down']);
  });

  it('when a graceful shutdown ends, for sessions Xenon keeps no record of', async () => {
    sinon.stub(SESSION_MANAGER, 'getAllSessions').returns([]);
    await new ShutdownCoordinator().drain(1_000, 500);
    expect(restoreAll.calledOnce).to.equal(true);
  });

  it("when a session's heartbeat goes stale", async () => {
    await scratch.db.session.deleteMany({});
    await scratch.db.session.create({
      data: {
        id: 's-stale',
        status: 'running',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'n',
        has_live_video: false,
        device_udid: 'R5CT',
        device_platform: 'android',
        device_version: '14',
        last_heartbeat_at: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await new OrphanSweeper().sweep({ heartbeatIntervalMs: 1_000 });

    expect(order.slice(0, 2)).to.deep.equal(['restore s-stale', 'release s-stale']);
    expect((await prisma.session.findUnique({ where: { id: 's-stale' } }))?.status).to.equal(
      'failed',
    );
  });
});
