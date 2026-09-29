import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore, PrismaPendingSessionStore } from '../../src/data-service/prisma-store';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { NodeBasePathResolver, webdriverInfoHandler } from '../../src/gateway/nodeWebDriverUrl';
import { SessionLocator, sessionRowsFrom } from '../../src/gateway/sessionLocator';
import { prisma } from '../../src/prisma';
import SessionType from '../../src/enums/SessionType';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * A hub finds where a session runs after a restart from the session's row
 * (SessionLocator, SessionManager.recoverActiveSessions). The row used to be
 * written only with the dashboard on, and never for a cloud session, so a
 * hub with the dashboard off lost every node session on restart: its
 * commands went to the hub's own Appium, which had no such session, while the
 * node kept it and the phone.
 *
 * A session the hub routes to a node or a cloud now always has its row. A
 * local session's row is still the dashboard's to write.
 */
describe('a session the hub routes elsewhere survives a restart, dashboard on or off', () => {
  const scratch = useScratchDatabase();
  const loopback = loopbackServers();
  const HUB_NODE_ID = 'hub-node-id';
  let context: PluginContext;
  let saved: { context: Partial<PluginContext>; store: unknown; pending: unknown };
  let restore: () => void;
  let nodeOrigin: string;

  beforeEach(async () => {
    const node = express();
    node.get(
      '/xenon/api/webdriver',
      webdriverInfoHandler(() => '/node'),
    );
    const server = await loopback.serve(node);
    nodeOrigin = `http://127.0.0.1:${(server.address() as any).port}`;

    restore = saveRegistrations(NodeBasePathResolver);
    Container.set(NodeBasePathResolver, new NodeBasePathResolver());
    context = Container.get(PluginContext);
    saved = {
      context: { ...context },
      store: (DeviceStoreFactory as any)._deviceStore,
      pending: (DeviceStoreFactory as any)._pendingSessionStore,
    };
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    (DeviceStoreFactory as any)._pendingSessionStore = new PrismaPendingSessionStore();
    context.pluginArgs = { ...DefaultPluginArgs, enableDashboard: false } as any;
    context.nodeId = HUB_NODE_ID;
    context.nodeBasePath = '/wd/hub';
    await scratch.db.session.deleteMany({});
    await scratch.db.device.deleteMany({});
  });

  afterEach(async () => {
    for (const s of SESSION_MANAGER.getAllSessions()) SESSION_MANAGER.removeSession(s.getId());
    Object.assign(context, saved.context);
    (DeviceStoreFactory as any)._deviceStore = saved.store;
    (DeviceStoreFactory as any)._pendingSessionStore = saved.pending;
    sinon.restore();
    restore();
    await loopback.closeAll();
  });

  async function phone(udid: string, fields: Record<string, unknown>) {
    const row = await scratch.db.device.create({
      data: {
        udid,
        platform: 'android',
        name: udid,
        sdk: '14',
        busy: true,
        claimedAt: Date.now(),
        userBlocked: false,
        offline: false,
        ...fields,
      } as any,
    });
    return row as any;
  }

  const caps = {
    alwaysMatch: { platformName: 'Android', 'xe:options': { recordVideo: false } },
    firstMatch: [{}],
  } as any;

  /** The session is created on its phone as finalizeSession records it. */
  async function created(sessionId: string, device: any, remote: boolean) {
    await (new SessionLifecycleService() as any).finalizeSession(
      { protocol: 'W3C', value: [sessionId, { platformName: 'Android' }, 'W3C'] },
      device,
      caps,
      {},
      remote,
      'key-1',
      'alice',
    );
  }

  /** The hub restarts: nothing in memory survives. */
  const restart = () => {
    for (const s of SESSION_MANAGER.getAllSessions()) SESSION_MANAGER.removeSession(s.getId());
  };

  const locator = () =>
    new SessionLocator({
      getSession: (id) => SESSION_MANAGER.getSession(id),
      ...sessionRowsFrom(prisma),
      isLocalDevice: (d) => !d.cloud && d.nodeId === HUB_NODE_ID,
      webDriverUrlOf: async (d) => `${d.host}/node`,
    });

  it('a node’s session is routed to the node again, with the dashboard off', async () => {
    const device = await phone('node-phone', { host: nodeOrigin, nodeId: 'node-peer' });
    await created('remote-1', device, true);
    restart();

    expect(await locator().locate('remote-1')).to.deep.include({
      kind: 'remote',
      url: `${nodeOrigin}/node`,
      cloud: false,
    });
  });

  it('is rebuilt at boot with its owner, with the dashboard off', async () => {
    const device = await phone('node-phone', { host: nodeOrigin, nodeId: 'node-peer' });
    await created('remote-1', device, true);
    restart();

    // SESSION_MANAGER itself: another spec may have replaced the container's
    // SessionManager, and the gateway reads this one.
    const recovered = await SESSION_MANAGER.recoverActiveSessions('hub-after-restart', '/wd/hub');
    expect(recovered).to.equal(1);
    const session = SESSION_MANAGER.getSession('remote-1') as any;
    expect(session.getType()).to.equal(SessionType.REMOTE);
    expect(session.getWebDriverUrl()).to.equal(`${nodeOrigin}/node`);
    expect(session.userId).to.equal('alice');
    expect(session.apiKeyId).to.equal('key-1');
    const row = await scratch.db.session.findUnique({ where: { id: 'remote-1' } });
    expect(row).to.include({ user_id: 'alice', api_key_id: 'key-1', status: 'running' });
  });

  it('a cloud session is routed to the cloud again', async () => {
    const device = await phone('cloud-phone', {
      host: 'https://hub.cloud.example/wd/hub',
      // The store keeps the column as JSON (prisma-store.ts).
      cloud: JSON.stringify('browserstack'),
    });
    await created('cloud-1', { ...device, cloud: 'browserstack' }, true);
    restart();

    expect(await locator().locate('cloud-1')).to.deep.include({ kind: 'remote', cloud: true });
  });

  it('a local session with the dashboard off still writes no row', async () => {
    const device = await phone('hub-phone', {
      host: 'http://127.0.0.1:4799',
      nodeId: HUB_NODE_ID,
    });
    await created('local-1', device, false);
    expect(await scratch.db.session.count()).to.equal(0);
  });
});
