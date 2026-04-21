import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { getPrismaClient } from '../../src/prisma';
import { setupTestContainer, resetTestContainer } from '../helpers/test-container';

describe('OrphanSweeper', () => {
  let prismaClient: ReturnType<typeof getPrismaClient>;

  const STALE_SESSION_ID = 'orphan-stale-sess-001';
  const STALE_UDID = 'udid-orphan-1';
  const NODE_ID = 'node-a';
  const FRESH_SESSION_ID = 'orphan-fresh-sess-002';

  before(async () => {
    setupTestContainer();
    prismaClient = getPrismaClient();

    // Create a stale session (last_heartbeat_at is old / null with old updatedAt)
    const oldDate = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    await prismaClient.session.upsert({
      where: { id: STALE_SESSION_ID },
      create: {
        id: STALE_SESSION_ID,
        status: 'running',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: NODE_ID,
        has_live_video: false,
        device_udid: STALE_UDID,
        device_platform: 'android',
        device_version: '13',
        last_heartbeat_at: oldDate,
        heartbeat_pid: null,
        heartbeat_host: null,
      },
      update: {
        status: 'running',
        last_heartbeat_at: oldDate,
        endTime: null,
        failure_reason: null,
      },
    });

    // Create a device for the stale session
    await prismaClient.device.upsert({
      where: { udid_host: { udid: STALE_UDID, host: 'http://localhost:4723' } },
      create: {
        udid: STALE_UDID,
        host: 'http://localhost:4723',
        busy: true,
        session_id: STALE_SESSION_ID,
        owningSessionId: STALE_SESSION_ID,
        platform: 'android',
      },
      update: {
        busy: true,
        session_id: STALE_SESSION_ID,
        owningSessionId: STALE_SESSION_ID,
      },
    });
  });

  after(async () => {
    await prismaClient.session.deleteMany({
      where: { id: { in: [STALE_SESSION_ID, FRESH_SESSION_ID] } },
    });
    await prismaClient.device.deleteMany({ where: { udid: STALE_UDID } });
    await resetTestContainer();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('marks sessions stale beyond threshold as failed and releases their devices', async () => {
    // heartbeatIntervalMs = 30_000, staleMultiplier = 3 (default)
    // cutoff = now - 3 * 30000 = now - 90000ms = 90 seconds ago
    // Our stale session has last_heartbeat_at = 5 minutes ago → should be swept
    const { OrphanSweeper } = await import('../../src/services/OrphanSweeper');
    const sweeper = new OrphanSweeper();
    await sweeper.sweep({ heartbeatIntervalMs: 30_000 });

    const session = await prismaClient.session.findUnique({
      where: { id: STALE_SESSION_ID },
      select: { status: true, failure_reason: true },
    });
    expect(session!.status).to.equal('failed');
    expect(session!.failure_reason).to.match(/heartbeat timeout/i);

    const device = await prismaClient.device.findFirst({
      where: { udid: STALE_UDID },
      select: { busy: true, owningSessionId: true },
    });
    expect(device!.busy).to.equal(false);
    expect(device!.owningSessionId).to.equal(null);
  });

  it('leaves fresh sessions alone', async () => {
    // Create a fresh session (heartbeat just now)
    await prismaClient.session.upsert({
      where: { id: FRESH_SESSION_ID },
      create: {
        id: FRESH_SESSION_ID,
        status: 'running',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: NODE_ID,
        has_live_video: false,
        device_udid: 'udid-fresh',
        device_platform: 'android',
        device_version: '13',
        last_heartbeat_at: new Date(), // fresh
        heartbeat_pid: null,
        heartbeat_host: null,
      },
      update: {
        status: 'running',
        last_heartbeat_at: new Date(),
        endTime: null,
        failure_reason: null,
      },
    });

    const { OrphanSweeper } = await import('../../src/services/OrphanSweeper');
    const sweeper = new OrphanSweeper();
    await sweeper.sweep({ heartbeatIntervalMs: 30_000 });

    const session = await prismaClient.session.findUnique({
      where: { id: FRESH_SESSION_ID },
      select: { status: true },
    });
    expect(session!.status).to.equal('running');
  });
});
