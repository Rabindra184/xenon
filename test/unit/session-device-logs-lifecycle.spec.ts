import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import NodeDevices from '../../src/device-managers/NodeDevices';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SessionManager, SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * A session's device log stops however the session ends on this server, its
 * dashboard on or off: on a node that ends the lines it holds for the hub.
 */
describe('a session’s device log stops however the session ends', function () {
  this.timeout(30_000);
  useScratchDatabase();
  let restore: () => void;
  let stop: sinon.SinonStub;

  beforeEach(() => {
    restore = saveRegistrations(SessionMetricsService, SessionDeviceLogs);
    stop = sinon.stub().resolves();
    Container.set(SessionMetricsService, { stop: sinon.stub().resolves() } as any);
    Container.set(SessionDeviceLogs, { stop } as any);
  });
  afterEach(() => {
    sinon.restore();
    restore();
  });

  it('at shutdown', async () => {
    sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
    await Container.get(SessionLifecycleService).stopSessionForShutdown('s-down', 'shutdown');
    expect(stop.calledWith('s-down')).to.equal(true);
  });

  it('when the driver shuts down unexpectedly on a node', async () => {
    sinon.stub(NodeDevices.prototype, 'unblockDevice').resolves();
    const plugin = { pluginArgs: { hub: 'http://hub:4723' } };
    await XenonPlugin.prototype.onUnexpectedShutdown.call(
      plugin as any,
      { sessionId: 's-crash', caps: {} },
      null,
    );
    expect(stop.calledWith('s-crash')).to.equal(true);
  });
});

/**
 * After a hub restart, a node session's device log goes on being collected
 * where the hub records sessions: after the newest line it stored.
 */
describe('a hub restart resumes collecting a node session’s device log', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  let restore: () => void;
  let start: sinon.SinonStub;
  let savedStore: unknown;
  let savedArgs: PluginContext['pluginArgs'];

  beforeEach(async () => {
    restore = saveRegistrations(SessionMetricsService, SessionDeviceLogs);
    start = sinon.stub().resolves();
    Container.set(SessionMetricsService, { start: sinon.stub() } as any);
    Container.set(SessionDeviceLogs, { start } as any);
    savedArgs = Container.get(PluginContext).pluginArgs;
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    await scratch.db.session.deleteMany({});
    await scratch.db.device.deleteMany({});
    const phone = (udid: string, extra: Record<string, unknown>) =>
      scratch.db.device.create({
        data: {
          udid,
          host: 'http://127.0.0.1:1',
          nodeId: 'node-2',
          platform: 'android',
          name: udid,
          sdk: '10',
          busy: true,
          userBlocked: false,
          offline: false,
          ...extra,
        } as any,
      });
    await phone('node-phone', {});
    await phone('cloud-phone', {
      cloud: JSON.stringify('browserstack'),
      host: 'https://hub.example.com',
    });
    for (const [id, udid] of [
      ['on-node', 'node-phone'],
      ['in-cloud', 'cloud-phone'],
    ]) {
      await scratch.db.session.create({
        data: {
          id,
          device_udid: udid,
          device_platform: 'android',
          device_version: '10',
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'node-2',
          has_live_video: false,
          status: 'running',
        },
      });
    }
  });

  afterEach(() => {
    for (const s of SESSION_MANAGER.getAllSessions()) SESSION_MANAGER.removeSession(s.getId());
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    Container.get(PluginContext).pluginArgs = savedArgs;
    sinon.restore();
    restore();
  });

  const recover = async (enableDashboard: boolean) => {
    Container.get(PluginContext).pluginArgs = { ...DefaultPluginArgs, enableDashboard } as any;
    await new SessionManager().recoverActiveSessions('hub-1', '/wd/hub');
    // The device log is resumed without waiting on it.
    await new Promise((r) => setImmediate(r));
  };

  it('resumes a node session’s, through the node, never a cloud provider’s', async () => {
    await recover(true);
    expect(start.getCalls().map((c) => c.args[0].sessionId)).to.deep.equal(['on-node']);
    const args = start.firstCall.args[0];
    expect(args.resume).to.equal(true);
    expect(typeof args.source.nodeDeviceLogs).to.equal('function');
  });

  it('resumes none on a hub with its dashboard off, which records no device logs', async () => {
    await recover(false);
    expect(start.called).to.equal(false);
  });
});
