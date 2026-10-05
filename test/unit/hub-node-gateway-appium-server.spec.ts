import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import * as jose from 'jose';
import { Container } from 'typedi';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import { UNKNOWN_SESSION_BODY } from '../../src/middleware/commandAuth';
import { commandAuthDeps, registerSessionGateway } from '../../src/app/registerCommandAuth';
import { insertBeforeRoutes } from '../../src/app/insertBeforeRoutes';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SessionOwnerResolver } from '../../src/services/device-access/SessionOwnerResolver';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { RemoteSession } from '../../src/sessions/RemoteSession';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import {
  HUB_TOKEN_AUDIENCE,
  HUB_TOKEN_HEADER,
  HubSessionTokenIssuer,
} from '../../src/gateway/hubSessionToken';
import { INTERNAL_CALL_HEADER, internalCallHeaders } from '../../src/gateway/internalCall';
import {
  NodeBasePathResolver,
  WEBDRIVER_INFO_PATH,
  webdriverInfoHandler,
} from '../../src/gateway/nodeWebDriverUrl';
import { hubGatewayOptions, nodeGatewayOptions } from '../../src/gateway/defaultGateway';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { HealingOrchestrator } from '../../src/services/healing/HealingOrchestrator';
import { HealingTier } from '../../src/services/healing/types';
import { SelfHealingSwitch } from '../../src/services/settings/SelfHealingSwitch';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * A Xenon hub and a Xenon node, each in Appium 3's own server() (Express 5,
 * Appium's middleware, its WebDriver routes, the plugin updaters, then its
 * catch-all 404), with the session gateway installed by the production wiring
 * (hubGatewayOptions / nodeGatewayOptions), over a scratch SQLite database.
 *
 * Each server's driver is a fake that records the commands that reach it,
 * which is how these tests show where a command went: a remote session's
 * command must reach the node's driver and never the hub's.
 */

function appiumDir() {
  return path.dirname(require.resolve('appium/package.json'));
}

function appiumBaseDriver(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(require.resolve('@appium/base-driver', { paths: [appiumDir()] }));
}

const quiet = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const EXACT_UNKNOWN_SESSION = JSON.stringify(UNKNOWN_SESSION_BODY);

// A route only a driver defines (UiAutomator2 does): the node has it, the hub
// has no driver and does not. The gateway must not need the hub to have it.
const DRIVER_ROUTES = {
  '/session/:sessionId/appium/stop_recording_screen': {
    POST: { command: 'stopRecordingScreen', payloadParams: { optional: ['options'] } },
  },
};

interface FakeDriver {
  commands: string[];
  sessions: Set<string>;
  driver: any;
}

/**
 * The node's findElement as its plugin runs it, when a test sets it: the
 * driver's own find goes through Xenon's CommandInterceptor.
 */
let nodeFind: ((args: any[]) => Promise<unknown>) | undefined;
/** The hub's findElement as its plugin runs it, for a session the hub runs itself. */
let hubFind: ((args: any[]) => Promise<unknown>) | undefined;
/** The node's answer to an execute script, when a test sets it. */
let nodeExecute: ((args: any[]) => Promise<unknown>) | undefined;

function fakeDriver(name: string): FakeDriver {
  const { errors } = appiumBaseDriver();
  const commands: string[] = [];
  const sessions = new Set<string>();
  const driver = {
    log: quiet,
    protocol: 'W3C',
    sessionExists: (id: string) => sessions.has(id),
    proxyActive: () => false,
    canProxy: () => false,
    proxyRouteIsAvoided: () => false,
    executeCommand: async (command: string, ...args: any[]) => {
      commands.push(command);
      if (command === 'getUrl') return `https://${name}.example/`;
      if (command === 'findElement') {
        if (name === 'node' && nodeFind) return nodeFind(args);
        if (name === 'hub' && hubFind) return hubFind(args);
        if (args[1] === 'missing') throw new errors.NoSuchElementError();
        return { 'element-6066-11e4-a52e-4f735466cecf': `${name}-el` };
      }
      if (command === 'stopRecordingScreen') return 'node-video.mp4';
      if (command === 'execute') {
        if (name === 'node' && nodeExecute) return nodeExecute(args);
        return { ranOn: name, script: args[0] };
      }
      if (command === 'deleteSession') {
        sessions.delete(args[0]);
        return null;
      }
      return null;
    },
  };
  return { commands, sessions, driver };
}

describe('the session gateway between a hub and a node, in Appium 3’s own server()', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  const servers: http.Server[] = [];
  let keyDir: string;
  let hubKeys: JwtKeyService;
  let restore: () => void;
  let savedStore: unknown;
  let hub: FakeDriver;
  let node: FakeDriver;
  let hubUrl: string;
  let nodeOrigin: string;
  let nodeRequests: Array<{ url: string; headers: http.IncomingHttpHeaders }>;
  let refusals: string[];
  let stamp = 0;

  // Appium's HTTP logger writes every request to stdout; quiet it here only.
  let appiumLog: { level: string } | undefined;
  let appiumLogLevel: string | undefined;
  before(async () => {
    appiumBaseDriver();
    const support = require.resolve('@appium/support', { paths: [appiumDir()] });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const log: { level: string } = require(
      require.resolve('@appium/logger', { paths: [support] }),
    ).default;
    appiumLog = log;
    appiumLogLevel = log.level;
    log.level = 'silent';
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-gateway-keys-'));
    hubKeys = new JwtKeyService();
    await hubKeys.init(keyDir);
  });
  after(() => {
    if (appiumLog && appiumLogLevel) appiumLog.level = appiumLogLevel;
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    restore = saveRegistrations(
      JwtKeyService,
      HubSessionTokenIssuer,
      NodeBasePathResolver,
      SessionOwnerResolver,
    );
    Container.set(JwtKeyService, hubKeys);
    Container.set(HubSessionTokenIssuer, new HubSessionTokenIssuer());
    Container.set(NodeBasePathResolver, new NodeBasePathResolver());
    Container.set(SessionOwnerResolver, new SessionOwnerResolver());
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    // A dashboard-on hub logs each forwarded command against its session.
    await scratch.db.sessionLog.deleteMany({});
    await scratch.db.log.deleteMany({});
    await scratch.db.session.deleteMany({});
    await scratch.db.device.deleteMany({});
    nodeRequests = [];
    refusals = [];
    stamp++;
  });

  afterEach(async () => {
    for (const s of SESSION_MANAGER.getAllSessions()) SESSION_MANAGER.removeSession(s.getId());
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    sinon.restore();
    restore();
    for (const s of servers.splice(0)) {
      s.closeAllConnections();
      await new Promise<void>((resolve) => http.Server.prototype.close.call(s, () => resolve()));
    }
  });

  const port = (s: http.Server) => (s.address() as { port: number }).port;

  /** Credentials a client may present: alice's and bob's keys. */
  function verifier() {
    const users: Record<string, string> = { 'alice-token': 'alice', 'bob-token': 'bob' };
    return new CommandCallerVerifier({
      verifyKeyPair: async (_ak: string, token: string) =>
        users[token]
          ? ({
              row: {
                id: `key-${users[token]}`,
                userId: users[token],
                scopes: 'sessions',
                expiresAt: null,
              },
              user: { id: users[token], role: 'MEMBER', status: 'ACTIVE' },
            } as any)
          : null,
      verifyBearer: async () => null,
    });
  }
  const as = (who: 'alice' | 'bob') => ({
    'x-xenon-access-key': `ak-${who}`,
    'x-xenon-token': `${who}-token`,
  });

  async function boot(
    opts: {
      hubAuth?: boolean;
      nodeAuth?: boolean;
      nodeBase?: string;
      advertise?: boolean;
      dashboard?: boolean;
    } = {},
  ) {
    const baseDriver = appiumBaseDriver();
    const nodeBase = opts.nodeBase ?? '/node';
    const authLogger = {
      info: () => undefined,
      warn: (m: string) => refusals.push(m),
      error: () => undefined,
    };

    hub = fakeDriver('hub');
    const hubServer: http.Server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(hub.driver),
      port: 0,
      hostname: '127.0.0.1',
      basePath: '/wd/hub',
      cliArgs: { basePath: '/wd/hub' },
      serverUpdaters: [
        (app: any) => {
          app.get('/xenon/api/auth/jwks.json', (_req: any, res: any) => res.json(hubKeys.jwks()));
          registerSessionGateway(
            app,
            { basePath: '/wd/hub' },
            commandAuthDeps({
              enabled: () => !!opts.hubAuth,
              authDisabled: () => false,
              verifier: verifier(),
              logger: authLogger,
            }),
            hubGatewayOptions({
              basePath: '/wd/hub',
              isLocalHost: (host) => host === hubUrl,
              nodeId: () => 'hub-node-id',
              dashboard: () => !!opts.dashboard,
            }),
          );
        },
      ],
    });
    servers.push(hubServer);
    hubUrl = `http://127.0.0.1:${port(hubServer)}`;

    node = fakeDriver('node');
    const nodeServer: http.Server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(node.driver),
      port: 0,
      hostname: '127.0.0.1',
      basePath: nodeBase,
      extraMethodMap: DRIVER_ROUTES,
      cliArgs: { basePath: nodeBase },
      serverUpdaters: [
        (app: any) => {
          // What reaches the node, headers and all (placed first).
          insertBeforeRoutes(app, '/', (req: any, _res: any, next: any) => {
            if (!req.url.startsWith('/xenon/'))
              nodeRequests.push({ url: req.url, headers: { ...req.headers } });
            next();
          });
          if (opts.advertise !== false) {
            app.get(
              WEBDRIVER_INFO_PATH,
              webdriverInfoHandler(() => nodeBase),
            );
          }
          registerSessionGateway(
            app,
            { basePath: nodeBase },
            commandAuthDeps({
              enabled: () => !!opts.nodeAuth,
              authDisabled: () => false,
              verifier: verifier(),
              ownerOf: async () => null, // the node's own database knows no owner
              logger: authLogger,
            }),
            nodeGatewayOptions(hubUrl),
          );
        },
      ],
    });
    servers.push(nodeServer);
    nodeOrigin = `http://127.0.0.1:${port(nodeServer)}`;
    return { hub: hubServer, node: nodeServer, nodeBase };
  }

  /** A session running on the node, as the hub records it. */
  async function remoteSession(opts: { registered?: boolean; owner?: string } = {}) {
    const id = `node-session-${stamp}`;
    node.sessions.add(id);
    await scratch.db.device.create({
      data: {
        udid: `phone-${stamp}`,
        host: nodeOrigin,
        nodeId: 'node-1',
        platform: 'android',
        busy: true,
        session_id: id,
        sessionStartTime: Date.now(),
      } as any,
    });
    await scratch.db.session.create({
      data: {
        id,
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'node-1',
        has_live_video: false,
        device_udid: `phone-${stamp}`,
        device_platform: 'android',
        device_version: '14',
        user_id: opts.owner ?? 'alice',
      },
    });
    let session: RemoteSession | undefined;
    if (opts.registered !== false) {
      const resolver = Container.get(NodeBasePathResolver);
      const base = await resolver.resolve(nodeOrigin, '/wd/hub');
      session = new RemoteSession({
        sessionId: id,
        device: {
          udid: `phone-${stamp}`,
          host: nodeOrigin,
          nodeId: 'node-1',
          platform: 'android',
        } as any,
        sessionResponse: {},
        xenonOption: {},
        baseUrl: `${nodeOrigin}${base}`,
      });
      SESSION_MANAGER.addSession(id, session);
    }
    return { id, session };
  }

  describe('forwarding', () => {
    it("a remote session's command reaches the node and its answer comes back; the hub's driver never sees it", async () => {
      await boot({ nodeAuth: true });
      const { id } = await remoteSession();
      const res = await request(hubUrl).get(`/wd/hub/session/${id}/url`).set(as('alice'));
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
      expect(res.body).to.deep.equal({ value: 'https://node.example/' });
      expect(node.commands).to.deep.equal(['getUrl']);
      expect(hub.commands).to.deep.equal([]);
      // Under the node's own base path, with the hub's token and not the client's key.
      expect(nodeRequests.map((r) => r.url)).to.deep.equal([`/node/session/${id}/url`]);
      const sent = nodeRequests[0].headers;
      expect(sent['x-xenon-access-key']).to.equal(undefined);
      expect(sent['x-xenon-token']).to.equal(undefined);
      const claims = jose.decodeJwt(String(sent[HUB_TOKEN_HEADER]));
      expect(claims).to.include({ aud: HUB_TOKEN_AUDIENCE, sid: id });
    });

    it("relays a body, the node's error status and its error body unchanged", async () => {
      await boot({ nodeAuth: true });
      const { id } = await remoteSession();
      const found = await request(hubUrl)
        .post(`/wd/hub/session/${id}/element`)
        .send({ using: 'id', value: 'login' });
      expect(found.status).to.equal(200);
      expect(found.body.value).to.deep.include({
        'element-6066-11e4-a52e-4f735466cecf': 'node-el',
      });

      const missing = await request(hubUrl)
        .post(`/wd/hub/session/${id}/element`)
        .send({ using: 'id', value: 'missing' });
      expect(missing.status).to.equal(404);
      expect(missing.body.value.error).to.equal('no such element');
      expect(node.commands).to.deep.equal(['findElement', 'findElement']);
      expect(hub.commands).to.deep.equal([]);
    });

    it('forwards a driver-only route the hub has no route for', async () => {
      await boot({ nodeAuth: true });
      const { id } = await remoteSession();
      const res = await request(hubUrl)
        .post(`/wd/hub/session/${id}/appium/stop_recording_screen`)
        .send({});
      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ value: 'node-video.mp4' });
      expect(node.commands).to.deep.equal(['stopRecordingScreen']);
    });

    it('matches the path as the routes do, in any letter case', async () => {
      await boot({ nodeAuth: true });
      const { id } = await remoteSession();
      await request(hubUrl).get(`/WD/HUB/SESSION/${id}/url`).expect(200);
      expect(node.commands).to.deep.equal(['getUrl']);
      expect(nodeRequests.map((r) => r.url)).to.deep.equal([`/node/session/${id}/url`]);
    });

    it('keeps the dashboard’s command hooks for a registered remote session', async () => {
      await boot({ dashboard: true });
      const { id } = await remoteSession();
      const before = sinon.stub(DASHBORD_EVENT_MANAGER, 'beforeSessionCommand').resolves(true);
      const after = sinon.stub(DASHBORD_EVENT_MANAGER, 'afterSessionCommand').resolves();
      await request(hubUrl).get(`/wd/hub/session/${id}/url`).expect(200);
      expect(before.firstCall.args.slice(0, 2)).to.deep.equal([id, 'getUrl']);
      expect(after.firstCall.args[1]).to.equal('getUrl');
      expect(JSON.parse(after.firstCall.args[5])).to.deep.equal({ value: 'https://node.example/' });
    });

    it('answers a node that cannot be reached with a WebDriver error', async () => {
      await boot();
      const { id } = await remoteSession();
      await new Promise<void>((resolve) => {
        const s = servers[1];
        s.closeAllConnections();
        http.Server.prototype.close.call(s, () => resolve());
      });
      const res = await request(hubUrl).get(`/wd/hub/session/${id}/url`);
      expect(res.status).to.equal(500);
      expect(res.body.value.error).to.equal('unknown error');
      expect(hub.commands).to.deep.equal([]);
    });
  });

  describe('xenon: execute scripts for a node’s phone', () => {
    // With the hub's dashboard on, its before-hook used to take every
    // `xenon:`/`xe:` script as a dashboard command and answer `{ value: null }`
    // itself, so autowait, Omni-Vision and network-capture scripts for a node's
    // phone never reached the node.
    const execute = (id: string, script: string, args: unknown[] = [{}]) =>
      request(hubUrl).post(`/wd/hub/session/${id}/execute/sync`).send({ script, args });

    it('forwards Xenon’s scripts other than session details to the node, which answers them', async () => {
      await boot({ dashboard: true });
      const { id } = await remoteSession();
      const scripts = [
        'xenon: setAutowaitProperties',
        'xe: smartTap',
        'xenon: assertVisualState',
        'xenon: addMock',
        'xenon: notACommand',
      ];
      for (const script of scripts) {
        const res = await execute(id, script);
        expect(res.status, script).to.equal(200);
        expect(res.body.value, script).to.deep.equal({ ranOn: 'node', script });
      }
      expect(node.commands).to.deep.equal(scripts.map(() => 'execute'));
      expect(hub.commands).to.deep.equal([]);
    });

    it('answers a session-details command on the hub, from its own record; the node never sees it', async () => {
      await boot({ dashboard: true });
      const { id } = await remoteSession();
      const res = await execute(id, 'xenon: setSessionName', ['Checkout']);
      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ value: { recorded: true } });
      expect(node.commands).to.deep.equal([]);
      expect(hub.commands).to.deep.equal([]);
      const row = await scratch.db.session.findUnique({ where: { id } });
      expect(row?.name).to.equal('Checkout');
    });

    describe('a network-capture script', () => {
      // A captured request's headers and bodies can carry the app's sign-in
      // tokens. They are for admins only (the /interceptor routes, the Network
      // panel, the live events), but the hub's command log is read by anyone
      // who can see the session (`session_log`, bug reports).
      const SECRET = 'Bearer eyJ-app-access-token';
      const HAR = {
        log: {
          entries: [{ request: { headers: [{ name: 'authorization', value: SECRET }] } }],
        },
      };

      afterEach(() => {
        nodeExecute = undefined;
      });

      async function loggedRows(id: string, count: number) {
        const deadline = Date.now() + 5_000;
        let rows = await scratch.db.sessionLog.findMany({ where: { session_id: id } });
        while (rows.length < count && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 10));
          rows = await scratch.db.sessionLog.findMany({ where: { session_id: id } });
        }
        return rows;
      }

      it('reaches the test whole, and the hub’s command log keeps neither its arguments nor its answer', async () => {
        await boot({ dashboard: true });
        const { id } = await remoteSession();
        nodeExecute = async ([script]) =>
          /addMock/.test(script) ? { id: 'mock-1' } : script.includes('exportHar') ? HAR : [HAR];

        const har = await execute(id, 'xenon: exportHar', []);
        expect(har.status).to.equal(200);
        expect(har.body.value, 'the test gets its capture').to.deep.equal(HAR);
        await execute(id, 'xe:getRequests', []);
        await execute(id, 'getMocks', []);
        await execute(id, 'xenon: addMock', [
          { match: { url: '**/login' }, respond: { body: { token: SECRET } } },
        ]);

        const rows = await loggedRows(id, 4);
        expect(rows.map((r) => r.command_name)).to.deep.equal([
          'execute',
          'execute',
          'execute',
          'execute',
        ]);
        for (const row of rows) {
          expect(`${row.body}${row.response}`, row.body ?? '').to.not.include(
            'eyJ-app-access-token',
          );
          expect(row.is_success).to.equal(true);
        }
        // Which script ran stays on record.
        expect(rows.map((r) => JSON.parse(r.body ?? '{}').script)).to.deep.equal([
          'xenon: exportHar',
          'xe:getRequests',
          'getMocks',
          'xenon: addMock',
        ]);
      });

      it('any other script is logged whole, as before', async () => {
        await boot({ dashboard: true });
        const { id } = await remoteSession();
        nodeExecute = async () => ({ output: SECRET });
        await execute(id, 'mobile: shell', [{ command: 'echo' }]);
        const [row] = await loggedRows(id, 1);
        expect(row.response).to.include('eyJ-app-access-token');
      });
    });

    it('with the hub’s dashboard off, sends a session-details command on to the node', async () => {
      await boot({ dashboard: false });
      const { id } = await remoteSession();
      const res = await execute(id, 'xenon: setSessionName', ['Checkout']);
      expect(res.body.value).to.deep.equal({ ranOn: 'node', script: 'xenon: setSessionName' });
      expect(node.commands).to.deep.equal(['execute']);
    });
  });

  describe('DELETE of a remote session', () => {
    it('runs the session lifecycle with the forward as its driver step', async () => {
      await boot({ nodeAuth: true });
      const { id, session } = await remoteSession();
      (session as any).isVideoAvailable = true; // recording, as startVideoRecording leaves it
      const lifecycle = sinon.spy(Container.get(SessionLifecycleService), 'deleteSession');
      const stopped = sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();

      const res = await request(hubUrl).delete(`/wd/hub/session/${id}`);
      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ value: null });

      expect(lifecycle.calledOnce).to.equal(true);
      expect(lifecycle.firstCall.args[1]).to.equal(id);
      // The node's video is fetched while the session still exists, then it is deleted.
      expect(node.commands).to.deep.equal(['stopRecordingScreen', 'deleteSession']);
      expect(hub.commands).to.deep.equal([]);
      expect(stopped.calledWith(id)).to.equal(true);
      expect(SESSION_MANAGER.getSession(id)).to.equal(undefined);
      const phone = await scratch.db.device.findFirst({ where: { udid: `phone-${stamp}` } });
      expect(phone).to.include({ busy: false, session_id: null });
      const row = await scratch.db.session.findUnique({ where: { id } });
      expect(row?.video_recording).to.equal('node-video.mp4');
    });

    it('treats DELETE of a sub-resource as an ordinary command', async () => {
      await boot();
      const { id } = await remoteSession();
      const lifecycle = sinon.spy(Container.get(SessionLifecycleService), 'deleteSession');
      await request(hubUrl).delete(`/wd/hub/session/${id}/cookie`);
      expect(lifecycle.called).to.equal(false);
      expect(nodeRequests.map((r) => r.url)).to.deep.equal([`/node/session/${id}/cookie`]);
      expect(SESSION_MANAGER.getSession(id)).to.not.equal(undefined);
    });
  });

  describe('after a hub restart (the session only in the database)', () => {
    it('routes from the Session row and the phone’s row, under the node’s own base path', async () => {
      await boot({ nodeAuth: true, nodeBase: '' });
      const { id } = await remoteSession({ registered: false });
      expect(SESSION_MANAGER.getSession(id)).to.equal(undefined);
      const res = await request(hubUrl).get(`/wd/hub/session/${id}/url`);
      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ value: 'https://node.example/' });
      expect(nodeRequests.map((r) => r.url)).to.deep.equal([`/session/${id}/url`]);
      expect(hub.commands).to.deep.equal([]);
    });

    it('and its DELETE still forwards and frees the phone', async () => {
      await boot({ nodeAuth: true });
      const { id } = await remoteSession({ registered: false });
      sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
      await request(hubUrl).delete(`/wd/hub/session/${id}`).expect(200);
      expect(node.commands).to.deep.equal(['deleteSession']);
      const phone = await scratch.db.device.findFirst({ where: { udid: `phone-${stamp}` } });
      expect(phone).to.include({ busy: false, session_id: null });
    });

    it('a closed session is not routed', async () => {
      await boot();
      const { id } = await remoteSession({ registered: false });
      await scratch.db.session.update({ where: { id }, data: { endTime: new Date() } });
      const res = await request(hubUrl).get(`/wd/hub/session/${id}/url`);
      expect(res.status).to.equal(404);
      expect(res.body.value.error).to.equal('invalid session id');
      expect(nodeRequests).to.deep.equal([]);
    });
  });

  describe('base paths', () => {
    it('a node that does not say its base path is taken to share the hub’s', async () => {
      await boot({ nodeBase: '/wd/hub', advertise: false });
      const { id } = await remoteSession({ registered: false });
      await request(hubUrl).get(`/wd/hub/session/${id}/url`).expect(200);
      expect(nodeRequests.map((r) => r.url)).to.deep.equal([`/wd/hub/session/${id}/url`]);
    });
  });

  describe('/wd-internal on the hub', () => {
    it('without the secret, answers exactly as an unknown route does', async () => {
      await boot({ hubAuth: true });
      hub.sessions.add('hub-local');
      const internal = await request(hubUrl).get('/wd/hub/wd-internal/session/hub-local/timeouts');
      const unknown = await request(hubUrl).get('/wd/hub/not-a-route/session/hub-local/timeouts');
      expect(internal.status).to.equal(404);
      expect(internal.status).to.equal(unknown.status);
      expect(internal.headers['content-type']).to.equal(unknown.headers['content-type']);
      expect(internal.body).to.deep.equal(unknown.body);
      expect(internal.body.value.error).to.equal('unknown command');
      expect(hub.commands).to.deep.equal([]);
    });

    it('with the secret, reaches the route without credentials though command auth is on', async () => {
      await boot({ hubAuth: true });
      hub.sessions.add('hub-local');
      await request(hubUrl).get('/wd/hub/session/hub-local/timeouts').expect(404);
      expect(hub.commands).to.deep.equal([]);
      const res = await request(hubUrl)
        .get('/wd/hub/wd-internal/session/hub-local/timeouts')
        .set(internalCallHeaders());
      expect(res.status).to.equal(200);
      expect(hub.commands).to.deep.equal(['getTimeouts']);
    });

    it('never forwards the secret to a node', async () => {
      await boot();
      const { id } = await remoteSession();
      await request(hubUrl)
        .get(`/wd/hub/wd-internal/session/${id}/url`)
        .set(internalCallHeaders())
        .expect(200);
      expect(nodeRequests).to.have.length(1);
      expect(nodeRequests[0].headers[INTERNAL_CALL_HEADER]).to.equal(undefined);
    });
  });

  describe('per-command auth on a remote session (at the hub)', () => {
    it('lets the owner through to the node', async () => {
      await boot({ hubAuth: true, nodeAuth: true });
      const { id } = await remoteSession({ owner: 'alice' });
      await request(hubUrl).get(`/wd/hub/session/${id}/url`).set(as('alice')).expect(200);
      expect(node.commands).to.deep.equal(['getUrl']);
    });

    it('answers another user, or no credentials, with the unknown-session answer; the node sees nothing', async () => {
      await boot({ hubAuth: true, nodeAuth: true });
      const { id } = await remoteSession({ owner: 'alice' });
      const bob = await request(hubUrl).get(`/wd/hub/session/${id}/url`).set(as('bob'));
      const nobody = await request(hubUrl).get(`/wd/hub/session/${id}/url`);
      for (const res of [bob, nobody]) {
        expect(res.status).to.equal(404);
        expect(res.text).to.equal(EXACT_UNKNOWN_SESSION);
      }
      expect(nodeRequests).to.deep.equal([]);
      expect(node.commands).to.deep.equal([]);
    });
  });

  describe("the node's check of the hub's token (node command auth on)", () => {
    async function tokenFor(sessionId: string, ttlSeconds = 300, keys = hubKeys) {
      return keys.sign({ sid: sessionId }, { audience: HUB_TOKEN_AUDIENCE, ttlSeconds });
    }

    it("accepts the hub's token for the session", async () => {
      const { nodeBase } = await boot({ nodeAuth: true });
      const { id } = await remoteSession();
      await request(nodeOrigin)
        .get(`${nodeBase}/session/${id}/url`)
        .set(HUB_TOKEN_HEADER, await tokenFor(id))
        .expect(200);
      expect(node.commands).to.deep.equal(['getUrl']);
    });

    it('refuses a forged, an expired, or another session’s token, and none at all', async () => {
      const { nodeBase } = await boot({ nodeAuth: true });
      const { id } = await remoteSession();
      const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-forger-'));
      try {
        const forger = new JwtKeyService();
        await forger.init(otherDir);
        const tokens = [
          await tokenFor(id, 300, forger),
          await tokenFor(id, -3600),
          await tokenFor('another-session'),
        ];
        for (const token of tokens) {
          const res = await request(nodeOrigin)
            .get(`${nodeBase}/session/${id}/url`)
            .set(HUB_TOKEN_HEADER, token);
          expect(res.status).to.equal(404);
          expect(res.text).to.equal(EXACT_UNKNOWN_SESSION);
        }
        const bare = await request(nodeOrigin).get(`${nodeBase}/session/${id}/url`);
        expect(bare.text).to.equal(EXACT_UNKNOWN_SESSION);
      } finally {
        fs.rmSync(otherDir, { recursive: true, force: true });
      }
      expect(node.commands).to.deep.equal([]);
    });

    it("with the node's command auth off, a hub token is not needed", async () => {
      const { nodeBase } = await boot({ nodeAuth: false });
      const { id } = await remoteSession();
      await request(nodeOrigin).get(`${nodeBase}/session/${id}/url`).expect(200);
    });
  });

  /**
   * A find on a node's phone runs on the node, so the node's interceptor
   * heals it. Through 2.14 the heal was recorded nowhere: the node keeps no
   * record of a session the hub created, and the hub saw only the element the
   * node answered with, so the find was logged as found (and counted toward
   * the selector's verification as a clean find). The node now hands the heal
   * back on its answer, and the hub, which owns the session record, records
   * it as it records a local session's.
   */
  describe("a heal on a node's phone", () => {
    const W3C = 'element-6066-11e4-a52e-4f735466cecf';
    let attemptHealing: sinon.SinonStub;
    let nodeLogged: sinon.SinonStub;
    let restoreHealing: () => void;

    beforeEach(() => {
      restoreHealing = saveRegistrations(HealingOrchestrator, SelfHealingSwitch);
      Container.set(SelfHealingSwitch, new SelfHealingSwitch());
      attemptHealing = sinon.stub().resolves({
        id: 'node-healed-el',
        tier: HealingTier.TIER_2_FUZZY_XML,
        confidence: 0.82,
        originalSelector: 'broken',
        originalStrategy: 'xpath',
        recommendedSelector: "//*[@resource-id='com.example:id/login']",
        recommendedStrategy: 'xpath',
      });
      Container.set(HealingOrchestrator, { attemptHealing } as unknown as HealingOrchestrator);
      // Hub and node share this process; the node's own record of a heal is
      // the node's (on a real node it has no Session row to write it to).
      nodeLogged = sinon.stub(CommandInterceptor.prototype as any, 'logHealingEvent').resolves();
      const { errors } = appiumBaseDriver();
      nodeFind = hubFind = (args) =>
        Container.get(CommandInterceptor).handle(
          async () => {
            if (args[1] === 'broken') throw new errors.NoSuchElementError();
            return { [W3C]: 'node-el' };
          },
          { sessionId: args[2] },
          'findElement',
          args,
          { ...DefaultPluginArgs },
          false,
        );
    });

    afterEach(() => {
      nodeFind = hubFind = undefined;
      restoreHealing();
    });

    /** The session's logged finds; the hub logs a command after it has answered it. */
    async function logsOf(id: string) {
      for (let i = 0; i < 100; i++) {
        const rows = await scratch.db.sessionLog.findMany({
          where: { session_id: id, command_name: 'findElement' },
        });
        if (rows.length) return rows;
        await new Promise((r) => setTimeout(r, 20));
      }
      return [];
    }

    it('is recorded on the hub, against the session, with what it healed to', async () => {
      await boot({ dashboard: true });
      const { id } = await remoteSession();

      const res = await request(hubUrl)
        .post(`/wd/hub/session/${id}/element`)
        .send({ using: 'xpath', value: 'broken' });

      expect(res.status).to.equal(200);
      expect(res.body.value[W3C]).to.equal('node-healed-el');
      const [row] = await logsOf(id);
      expect(row, 'the find was logged').to.not.equal(undefined);
      expect(row).to.deep.include({
        is_healed: true,
        original_strategy: 'xpath',
        original_selector: 'broken',
        healed_strategy: 'xpath',
        healed_selector: "//*[@resource-id='com.example:id/login']",
        healing_confidence: 0.82,
        healing_tier: 'Fuzzy XML',
      });
      expect(nodeLogged.called, 'recorded on the node as well').to.equal(false);
    });

    it("is Xenon's own: the client's answer carries nothing about it", async () => {
      await boot({ dashboard: true });
      const { id } = await remoteSession();

      const res = await request(hubUrl)
        .post(`/wd/hub/session/${id}/element`)
        .send({ using: 'xpath', value: 'broken' });

      expect(Object.keys(res.headers).filter((h) => h.startsWith('x-xenon'))).to.deep.equal([]);
    });

    it("records the selector of a find on a node's phone that needed no heal", async () => {
      await boot({ dashboard: true });
      const { id } = await remoteSession();

      await request(hubUrl)
        .post(`/wd/hub/session/${id}/element`)
        .send({ using: 'id', value: 'login' })
        .expect(200);

      const [row] = await logsOf(id);
      expect(row).to.deep.include({
        is_healed: false,
        original_strategy: 'id',
        original_selector: 'login',
      });
    });

    it('takes a heal only from the node, never from the client', async () => {
      await boot({ dashboard: true });
      const { id } = await remoteSession();
      const forged = Buffer.from(
        JSON.stringify({ originalSelector: 'login', healedSelector: '//x', confidence: 1 }),
      ).toString('base64url');

      await request(hubUrl)
        .post(`/wd/hub/session/${id}/element`)
        .set('x-xenon-heal', forged)
        .send({ using: 'id', value: 'login' })
        .expect(200);

      const [row] = await logsOf(id);
      expect(row.is_healed).to.equal(false);
      expect(nodeRequests[0].headers['x-xenon-heal']).to.equal(undefined);
    });

    it('is recorded by the node itself when the find did not come from a hub', async () => {
      await boot();
      const { id } = await remoteSession({ registered: false });

      const res = await request(nodeOrigin)
        .post(`/node/session/${id}/element`)
        .send({ using: 'xpath', value: 'broken' });

      expect(res.status).to.equal(200);
      expect(res.headers['x-xenon-heal']).to.equal(undefined);
      expect(nodeLogged.calledOnce).to.equal(true);
    });

    it('is recorded on the hub for its own session, whatever hub token a client sends', async () => {
      await boot({ dashboard: true });
      const id = `hub-session-${stamp}`;
      hub.sessions.add(id);

      const res = await request(hubUrl)
        .post(`/wd/hub/session/${id}/element`)
        .set(HUB_TOKEN_HEADER, 'not-a-hub')
        .send({ using: 'xpath', value: 'broken' });

      expect(res.status).to.equal(200);
      expect(res.headers['x-xenon-heal']).to.equal(undefined);
      expect(nodeLogged.calledOnce, 'recorded by the server that healed it').to.equal(true);
    });

    it('is neither sent nor recorded on the node when too long for the header', async () => {
      await boot({ dashboard: true });
      const { id } = await remoteSession();
      attemptHealing.resolves({
        id: 'node-healed-el',
        tier: HealingTier.TIER_2_FUZZY_XML,
        confidence: 0.82,
        originalSelector: 'broken',
        originalStrategy: 'xpath',
        recommendedSelector: `//*[@text='${'x'.repeat(10_000)}']`,
        recommendedStrategy: 'xpath',
      });

      const res = await request(hubUrl)
        .post(`/wd/hub/session/${id}/element`)
        .send({ using: 'xpath', value: 'broken' });

      expect(res.status).to.equal(200);
      expect(res.body.value[W3C]).to.equal('node-healed-el');
      const [row] = await logsOf(id);
      expect(row.is_healed).to.equal(false);
      expect(nodeLogged.called, 'recorded on the node, which has no row for it').to.equal(false);
    });
  });
});
