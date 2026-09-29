import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import request from 'supertest';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import { commandAuthDeps, registerSessionGateway } from '../../src/app/registerCommandAuth';
import { nodeGatewayOptions } from '../../src/gateway/defaultGateway';
import { HUB_TOKEN_HEADER, HubSessionTokenIssuer } from '../../src/gateway/hubSessionToken';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { XenonManager } from '../../src/device-managers';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore, PrismaPendingSessionStore } from '../../src/data-service/prisma-store';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionOwnerResolver } from '../../src/services/device-access/SessionOwnerResolver';
import { LiveSessionOwners } from '../../src/services/device-access/LiveSessionOwners';
import { deviceAccessGuard } from '../../src/middleware/deviceAccessGuard';
import { config } from '../../src/config';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  FAKE_AUTOMATION,
  appiumBaseDriver,
  quietAppiumLogs,
  umbrellaWith,
} from '../helpers/appium-umbrella';

/**
 * Who owns a session the hub created on a node, as the node's own checks see
 * it: SessionOwnerResolver, behind the /control ownership guard, the logcat
 * WebSocket and the session listing.
 *
 * The node writes no Session row for a hub's session (the hub keeps the
 * record), so the resolver, which read only rows, found no owner, and the
 * fail-closed rule refused the device to everyone but admins, its owner
 * included. The owner the hub's create token named is now known for as long
 * as the session lives.
 */

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const NODE_ID = 'node-1';

describe('the owner of a hub’s session, on the node', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  const servers: http.Server[] = [];
  let dirs: string[];
  let hubKeys: JwtKeyService;
  let appiumLogs: { restore(): void };
  let restore: () => void;
  let saved: { store: unknown; pending: unknown; context: Partial<PluginContext> };
  let authDisabledBefore: boolean;
  let nodeOrigin: string;

  before(async () => {
    appiumLogs = quietAppiumLogs();
    dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-node-owner-keys-'))];
    hubKeys = new JwtKeyService();
    await hubKeys.init(dirs[0]);
  });
  after(() => {
    appiumLogs.restore();
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    restore = saveRegistrations(
      JwtKeyService,
      HubSessionTokenIssuer,
      XenonManager,
      SessionOwnerResolver,
      LiveSessionOwners,
    );
    Container.set(JwtKeyService, hubKeys);
    Container.set(HubSessionTokenIssuer, new HubSessionTokenIssuer());
    Container.set(SessionOwnerResolver, new SessionOwnerResolver());
    Container.set(LiveSessionOwners, new LiveSessionOwners());
    Container.set(XenonManager, {
      getMaxSessionCount: () => undefined,
      deviceInstances: async () => [],
    } as any);
    const context = Container.get(PluginContext);
    saved = {
      store: (DeviceStoreFactory as any)._deviceStore,
      pending: (DeviceStoreFactory as any)._pendingSessionStore,
      context: { ...context },
    };
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    (DeviceStoreFactory as any)._pendingSessionStore = new PrismaPendingSessionStore();
    authDisabledBefore = config.authDisabled;
    config.authDisabled = false;
    await scratch.db.pendingSession.deleteMany({});
    await scratch.db.session.deleteMany({});
    await scratch.db.device.deleteMany({});
    await boot();
  });

  afterEach(async () => {
    for (const s of SESSION_MANAGER.getAllSessions()) SESSION_MANAGER.removeSession(s.getId());
    (DeviceStoreFactory as any)._deviceStore = saved.store;
    (DeviceStoreFactory as any)._pendingSessionStore = saved.pending;
    Object.assign(Container.get(PluginContext), saved.context);
    config.authDisabled = authDisabledBefore;
    sinon.restore();
    restore();
    for (const s of servers.splice(0)) {
      s.closeAllConnections();
      await new Promise<void>((resolve) => http.Server.prototype.close.call(s, () => resolve()));
    }
  });

  const port = (s: http.Server) => (s.address() as { port: number }).port;

  async function boot() {
    const baseDriver = appiumBaseDriver();
    const hubServer: http.Server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(umbrellaWith([])),
      port: 0,
      hostname: '127.0.0.1',
      basePath: '/wd/hub',
      cliArgs: { basePath: '/wd/hub' },
      serverUpdaters: [
        (app: any) => {
          app.get('/xenon/api/auth/jwks.json', (_req: any, res: any) => res.json(hubKeys.jwks()));
        },
      ],
    });
    servers.push(hubServer);
    const hubUrl = `http://127.0.0.1:${port(hubServer)}`;

    const nodeServer: http.Server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(
        umbrellaWith([[XenonPlugin, 'xenon']]),
      ),
      port: 0,
      hostname: '127.0.0.1',
      basePath: '/node',
      cliArgs: { basePath: '/node' },
      serverUpdaters: [
        (app: any) => {
          registerSessionGateway(
            app,
            { basePath: '/node' },
            commandAuthDeps({ enabled: () => false, authDisabled: () => false, logger: quiet }),
            nodeGatewayOptions(hubUrl),
          );
          // The node's /control ownership guard, with a caller named by a header.
          const control = express.Router();
          control.use(deviceAccessGuard());
          control.post('/:udid/tap', (_req, res) => res.json({ success: true }));
          app.use(
            '/control',
            (req: any, _res: any, next: any) => {
              req.auth = { userId: req.headers['x-test-user'], role: 'MEMBER', scopes: 'devices' };
              next();
            },
            control,
          );
        },
      ],
    });
    servers.push(nodeServer);
    nodeOrigin = `http://127.0.0.1:${port(nodeServer)}`;
    // The node's dashboard is off, as it usually is.
    Container.get(PluginContext).setContext(
      {
        ...DefaultPluginArgs,
        hub: hubUrl,
        bindHostOrIp: '127.0.0.1',
        enableDashboard: false,
        deviceAvailabilityTimeoutMs: 1_000,
        deviceAvailabilityQueryIntervalMs: 100,
      } as any,
      port(nodeServer),
      NODE_ID,
      '/node',
    );
    await scratch.db.device.create({
      data: {
        udid: 'phone-1',
        host: nodeOrigin,
        nodeId: NODE_ID,
        platform: 'android',
        name: 'phone-1',
        sdk: '14',
        busy: false,
        userBlocked: false,
        offline: false,
      } as any,
    });
  }

  /** alice's session on phone-1, created as the hub creates it. */
  async function hubSession(): Promise<string> {
    const token = await Container.get(HubSessionTokenIssuer).createTokenFor({
      userId: 'alice',
      udid: 'phone-1',
      host: nodeOrigin,
    });
    const res = await request(nodeOrigin)
      .post('/node/session')
      .set(HUB_TOKEN_HEADER, token as string)
      .send({
        capabilities: {
          alwaysMatch: {
            platformName: 'Android',
            'appium:automationName': FAKE_AUTOMATION,
            'appium:newCommandTimeout': 0,
            'appium:udid': 'phone-1',
            'xe:options': { recordVideo: false },
          },
          firstMatch: [{}],
        },
      });
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    return res.body.value.sessionId;
  }

  const tap = (user: string) =>
    request(nodeOrigin).post('/control/phone-1/tap').set('x-test-user', user).send({ x: 1, y: 1 });

  it('is the owner the hub’s create token named, while the session lives', async () => {
    const sessionId = await hubSession();
    expect(await scratch.db.session.count(), 'Session rows on the node').to.equal(0);
    const owners = Container.get(SessionOwnerResolver);
    expect(await owners.ownerOf(sessionId)).to.equal('alice');
    expect((await owners.ownersOf([sessionId])).get(sessionId)).to.equal('alice');
  });

  it('lets its owner use the phone on the node, and nobody else', async () => {
    await hubSession();
    const alice = await tap('alice');
    expect(alice.status, JSON.stringify(alice.body)).to.equal(200);
    const bob = await tap('bob');
    expect(bob.status).to.equal(409);
    expect(bob.body.error).to.equal('device_in_use_by_session');
  });

  it('is forgotten when the session ends', async () => {
    const sessionId = await hubSession();
    expect(Container.get(LiveSessionOwners).ownerOf(sessionId)).to.equal('alice');
    await request(nodeOrigin).delete(`/node/session/${sessionId}`).expect(200);
    expect(Container.get(LiveSessionOwners).ownerOf(sessionId)).to.equal(undefined);
  });
});
