import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SessionManager, SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * After a hub restart, a node session whose figures the hub was collecting
 * goes on being collected, from the newest sample the hub stored: the node's
 * memory fills the gap.
 */
describe('a hub restart resumes collecting a node session’s figures', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  let restore: () => void;
  let start: sinon.SinonStub;
  let savedStore: unknown;

  beforeEach(async () => {
    restore = saveRegistrations(SessionMetricsService);
    start = sinon.stub();
    Container.set(SessionMetricsService, { start } as any);
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    await scratch.db.sessionMetric.deleteMany({});
    await scratch.db.session.deleteMany({});
    await scratch.db.device.deleteMany({});
    await scratch.db.device.create({
      data: {
        udid: 'node-phone',
        host: 'http://127.0.0.1:1',
        nodeId: 'node-2',
        platform: 'android',
        name: 'S9',
        sdk: '10',
        busy: true,
        userBlocked: false,
        offline: false,
      } as any,
    });
    const row = (id: string, profiled: boolean) =>
      scratch.db.session.create({
        data: {
          id,
          device_udid: 'node-phone',
          device_platform: 'android',
          device_version: '10',
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'node-2',
          has_live_video: false,
          status: 'running',
          is_profiling_available: profiled,
        },
      });
    await row('collected', true);
    await row('fresh', true);
    await row('never', false);
    await scratch.db.sessionMetric.createMany({
      data: [100, 200].map((at) => ({ session_id: 'collected', at })),
    });
  });

  afterEach(() => {
    for (const s of SESSION_MANAGER.getAllSessions()) SESSION_MANAGER.removeSession(s.getId());
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    sinon.restore();
    restore();
  });

  it('resumes each from its newest stored sample, and never one the hub did not collect', async () => {
    await new SessionManager().recoverActiveSessions('hub-1', '/wd/hub');

    const byId = new Map(start.getCalls().map((c) => [c.args[0].sessionId, c.args[0]]));
    expect(Array.from(byId.keys()).sort()).to.deep.equal(['collected', 'fresh']);
    expect(byId.get('collected').after).to.equal(200);
    expect(byId.get('fresh').after).to.equal(null);
    expect(typeof byId.get('collected').source.nodeMetrics).to.equal('function');
  });
});
