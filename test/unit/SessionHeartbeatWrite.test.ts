import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { getPrismaClient } from '../../src/prisma';
import { setupTestContainer, resetTestContainer } from '../helpers/test-container';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionHeartbeatService } from '../../src/services/SessionHeartbeatService';

describe('SessionHeartbeatService write path', () => {
  const TEST_SESSION_ID = 'test-heartbeat-sess-001';
  let prismaClient: ReturnType<typeof getPrismaClient>;

  before(async () => {
    setupTestContainer();
    prismaClient = getPrismaClient();

    // Create a minimal session row for the test
    await prismaClient.session.upsert({
      where: { id: TEST_SESSION_ID },
      create: {
        id: TEST_SESSION_ID,
        status: 'running',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'test-node',
        has_live_video: false,
        device_udid: 'test-udid',
        device_platform: 'android',
        device_version: '13',
        last_heartbeat_at: null,
        heartbeat_pid: null,
        heartbeat_host: null,
      },
      update: {
        last_heartbeat_at: null,
        heartbeat_pid: null,
        heartbeat_host: null,
      },
    });
  });

  after(async () => {
    // Cleanup test session
    await prismaClient.session.deleteMany({ where: { id: TEST_SESSION_ID } });
    await resetTestContainer();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('writes last_heartbeat_at, heartbeat_pid, heartbeat_host for each active session', async () => {
    const fakeSession: any = {
      getId: () => TEST_SESSION_ID,
      isStopping: false,
      stoppedAt: undefined,
      checkHealth: async () => ({ isHealthy: true }),
      healthState: 'HEALTHY',
    };

    // Stub directly on the module-level SESSION_MANAGER singleton
    sinon.stub(SESSION_MANAGER, 'getAllSessions').returns([fakeSession]);

    // Also stub findMany to avoid the global zombie check hitting the DB
    // (the Proxy issue means this won't intercept but it will fail gracefully in try/catch)
    const svc = new SessionHeartbeatService();
    await (svc as any).checkAllSessions();

    // Verify the session was updated with heartbeat fields in the DB
    const updated = await prismaClient.session.findUnique({
      where: { id: TEST_SESSION_ID },
      select: { last_heartbeat_at: true, heartbeat_pid: true, heartbeat_host: true },
    });

    expect(updated, 'session should exist in DB').to.exist;
    expect(updated!.last_heartbeat_at, 'last_heartbeat_at should be set').to.be.instanceOf(Date);
    expect(updated!.heartbeat_pid, 'heartbeat_pid should match process.pid').to.equal(process.pid);
    expect(updated!.heartbeat_host, 'heartbeat_host should be a string').to.be.a('string');
  });
});
