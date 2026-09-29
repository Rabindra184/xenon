import 'reflect-metadata';
import { expect } from 'chai';
import os from 'os';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { OrphanSweeper } from '../../src/services/OrphanSweeper';
import { SessionHeartbeatService } from '../../src/services/SessionHeartbeatService';
import { NodeBasePathResolver, webdriverInfoHandler } from '../../src/gateway/nodeWebDriverUrl';
import {
  NODE_SESSION_STATUS_HEADER,
  NodeSessionProbeSupport,
} from '../../src/gateway/nodeSessionStatus';
import { HubSessionTokenIssuer } from '../../src/gateway/hubSessionToken';
import { SocketServer } from '../../src/services/SocketServer';
import { NotificationService } from '../../src/services/NotificationService';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * A hub restart must not undo the recovery of its nodes' sessions.
 *
 * At boot a hub rebuilds the sessions its nodes still run from their rows
 * (recoverActiveSessions), then sweeps orphans: rows whose last heartbeat is
 * older than 3 heartbeat intervals and was written by another process on
 * this host (OrphanSweeper, at boot and on every interval). A recovered row
 * still carries the old process's heartbeat, so a restart longer than ~90 s
 * failed every node session recovery had just rebuilt and freed its phone,
 * while the node kept the session.
 *
 * A recovered session is this process's from then on, so recovery stamps its
 * heartbeat. A session the node no longer has still ends: the heartbeat asks
 * the node and ends it.
 */
describe('a hub restart: the orphan sweep and the sessions recovery rebuilt', () => {
  const scratch = useScratchDatabase();
  const loopback = loopbackServers();
  const INTERVAL_MS = 30_000;
  const OLD_PID = 999_999;
  const TEN_MINUTES_AGO = () => new Date(Date.now() - 10 * 60_000);
  let context: PluginContext;
  let saved: { context: Partial<PluginContext>; store: unknown };
  let restore: () => void;
  let nodeOrigin: string;
  let nodeHas: Set<string>;

  beforeEach(async () => {
    nodeHas = new Set();
    const node = express();
    node.get(
      '/xenon/api/webdriver',
      webdriverInfoHandler(() => ''),
    );
    node.get('/xenon/api/node/sessions/:sessionId', (req, res) => {
      res.setHeader(NODE_SESSION_STATUS_HEADER, '1');
      const { sessionId } = req.params;
      res.json({ value: { sessionId, exists: nodeHas.has(sessionId) } });
    });
    const server = await loopback.serve(node);
    nodeOrigin = `http://127.0.0.1:${(server.address() as any).port}`;

    restore = saveRegistrations(
      NodeBasePathResolver,
      NodeSessionProbeSupport,
      HubSessionTokenIssuer,
      SocketServer,
      NotificationService,
    );
    Container.set(NodeBasePathResolver, new NodeBasePathResolver());
    Container.set(NodeSessionProbeSupport, new NodeSessionProbeSupport());
    const issuer = new HubSessionTokenIssuer();
    issuer.useSigner({ sign: async () => 'hub-token' });
    Container.set(HubSessionTokenIssuer, issuer);
    Container.set({
      id: SocketServer,
      value: {
        emitToDashboard: () => undefined,
        emitToDashboardForDevices: async () => undefined,
        hasScopedDashboard: () => false,
      },
    });
    Container.set({ id: NotificationService, value: { dispatchEvent: async () => undefined } });
    context = Container.get(PluginContext);
    saved = { context: { ...context }, store: (DeviceStoreFactory as any)._deviceStore };
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    context.setContext({ ...DefaultPluginArgs } as any, 4799, 'hub-after-restart', '');
    await scratch.db.session.deleteMany({});
    await scratch.db.device.deleteMany({});
  });

  afterEach(async () => {
    for (const s of SESSION_MANAGER.getAllSessions()) SESSION_MANAGER.removeSession(s.getId());
    Object.assign(context, saved.context);
    (DeviceStoreFactory as any)._deviceStore = saved.store;
    sinon.restore();
    restore();
    await loopback.closeAll();
  });

  /** A node session the hub ran before it went down, last heartbeat 10 minutes ago. */
  async function nodeSessionFromBeforeTheRestart(sessionId: string, udid: string) {
    await scratch.db.device.create({
      data: {
        udid,
        host: nodeOrigin,
        nodeId: 'node-peer',
        platform: 'android',
        name: udid,
        busy: true,
        session_id: sessionId,
        claimSessionId: sessionId,
        claimedAt: Date.now() - 11 * 60_000,
      } as any,
    });
    await staleRow(sessionId, udid, 'node-peer');
  }

  async function staleRow(sessionId: string, udid: string, nodeId: string) {
    await scratch.db.session.create({
      data: {
        id: sessionId,
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: nodeId,
        has_live_video: false,
        device_udid: udid,
        device_platform: 'android',
        device_version: '14',
        status: 'running',
        user_id: 'alice',
        heartbeat_host: os.hostname(),
        heartbeat_pid: OLD_PID,
        last_heartbeat_at: TEN_MINUTES_AGO(),
        updatedAt: TEN_MINUTES_AGO(),
      } as any,
    });
  }

  const status = async (id: string) =>
    (await scratch.db.session.findUnique({ where: { id } }))?.status;
  const phone = (udid: string) => scratch.db.device.findFirst({ where: { udid } });

  const bootSweep = () =>
    Container.get(OrphanSweeper).sweep({
      heartbeatIntervalMs: INTERVAL_MS,
      hostScope: { host: os.hostname(), excludePid: process.pid },
    });
  const periodicSweep = () =>
    Container.get(OrphanSweeper).sweep({ heartbeatIntervalMs: INTERVAL_MS });

  it('a recovered session with a 10-minute-old heartbeat survives the boot sweep', async () => {
    await nodeSessionFromBeforeTheRestart('node-session', 'node-phone');
    nodeHas.add('node-session');

    expect(await SESSION_MANAGER.recoverActiveSessions('hub-after-restart', '')).to.equal(1);
    await bootSweep();

    expect(await status('node-session')).to.equal('running');
    expect(SESSION_MANAGER.getSession('node-session'), 'still routed').to.not.equal(undefined);
    expect(await phone('node-phone')).to.include({ busy: true, claimSessionId: 'node-session' });
  });

  it('and the periodic sweep that follows', async () => {
    await nodeSessionFromBeforeTheRestart('node-session', 'node-phone');
    nodeHas.add('node-session');
    await SESSION_MANAGER.recoverActiveSessions('hub-after-restart', '');
    await bootSweep();
    await periodicSweep();
    expect(await status('node-session')).to.equal('running');
  });

  it('a stale session on this host that recovery did not rebuild is still swept', async () => {
    await nodeSessionFromBeforeTheRestart('node-session', 'node-phone');
    nodeHas.add('node-session');
    await SESSION_MANAGER.recoverActiveSessions('hub-after-restart', '');
    // Not in the table recovery read: nothing rebuilt it, nothing heartbeats it.
    await staleRow('orphan-session', 'gone-phone', 'node-peer');

    await bootSweep();

    expect(await status('orphan-session')).to.equal('failed');
    expect(await status('node-session')).to.equal('running');
  });

  it('a recovered session the node no longer has is ended by the heartbeat', async () => {
    await nodeSessionFromBeforeTheRestart('node-session', 'node-phone');
    await SESSION_MANAGER.recoverActiveSessions('hub-after-restart', '');
    await bootSweep();
    expect(await status('node-session')).to.equal('running');

    // The node says it has no such session (nodeHas is empty).
    const heartbeat = new SessionHeartbeatService() as any;
    for (let i = 0; i < 6; i++) await heartbeat.checkAllSessions();

    expect(await status('node-session')).to.equal('failed');
    expect(SESSION_MANAGER.getSession('node-session')).to.equal(undefined);
    expect(await phone('node-phone')).to.include({ busy: false, claimSessionId: null });
  });
});
