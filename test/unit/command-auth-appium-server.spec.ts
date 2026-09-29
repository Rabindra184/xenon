import { expect } from 'chai';
import http from 'http';
import path from 'path';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import WebSocket, { WebSocketServer } from 'ws';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import { UNKNOWN_SESSION_BODY } from '../../src/middleware/commandAuth';
import {
  registerCommandAuth,
  registerSessionUpgradeGuard,
} from '../../src/app/registerCommandAuth';

/**
 * Per-command auth inside Appium 3's own server.
 *
 * This boots base-driver's `server()`, the function Appium's main uses, with
 * Appium's own WebDriver routes (`routeConfiguringFunction`) around a small
 * fake driver, and registerCommandAuth as a server updater. So the app is
 * Express 5 as Appium builds it: its middleware, then every WebDriver route,
 * then the plugin updaters, then its catch-all 404. The fake driver records
 * each command that reaches it, which shows whether the check ran first.
 *
 * The session listing and the BiDi WebSocket go through the same server:
 * registerSessionUpgradeGuard is a server updater too, and the BiDi handler is
 * added after boot with addWebSocketHandler, as Appium's main adds it.
 */

const EXACT_UNKNOWN_SESSION = JSON.stringify(UNKNOWN_SESSION_BODY);
const LIVE_SESSION = 'live-session';
const BOBS_SESSION = 'bobs-session';
const LISTING = [
  { id: LIVE_SESSION, created: 1, capabilities: { platformName: 'Fake' } },
  { id: BOBS_SESSION, created: 2, capabilities: { platformName: 'Fake' } },
];
const OWNERS: Record<string, string> = { [LIVE_SESSION]: 'alice', [BOBS_SESSION]: 'bob' };

/**
 * How Appium dispatches WebSocket upgrades. 'native' is whatever this Node
 * makes it choose. 'listener' forces the path Node >= 22.21 / 24.9 takes (an
 * `upgrade` listener on the http.Server) by giving the server a
 * `shouldUpgradeCallback` before Appium looks for one; on an older Node the
 * listener still receives every upgrade, since any `upgrade` listener makes
 * Node emit the event.
 */
type UpgradeMode = 'native' | 'listener';

function nativelyUsesUpgradeListener(): boolean {
  return typeof (http.createServer() as any).shouldUpgradeCallback !== 'undefined';
}

function appiumBaseDriver(): any {
  const appiumDir = path.dirname(require.resolve('appium/package.json'));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(require.resolve('@appium/base-driver', { paths: [appiumDir] }));
}

describe("per-command auth in Appium 3's own server()", () => {
  const quiet = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  let server: http.Server | undefined;
  let commands: string[];
  let enabled: boolean;
  let infos: string[];
  let warnings: string[];
  let bidiConnections: string[];

  async function boot(opts: { upgrades?: UpgradeMode } = {}) {
    const baseDriver = appiumBaseDriver();
    commands = [];
    bidiConnections = [];
    const driver = {
      log: quiet,
      protocol: 'W3C',
      sessionExists: (id: string) => id === LIVE_SESSION,
      proxyActive: () => false,
      canProxy: () => false,
      proxyRouteIsAvoided: () => false,
      executeCommand: async (command: string) => {
        commands.push(command);
        if (command === 'createSession') return [LIVE_SESSION, {}];
        if (command === 'getAppiumSessions') return LISTING;
        return 'about:blank';
      },
    };
    const credentials: Record<string, string> = { 'alice-token': 'alice', 'bob-token': 'bob' };
    const verifier = new CommandCallerVerifier({
      verifyKeyPair: sinon.stub().callsFake(async (_ak: string, token: string) =>
        credentials[token]
          ? {
              row: { id: 'k', userId: credentials[token], scopes: 'sessions', expiresAt: null },
              user: { id: credentials[token], role: 'MEMBER', status: 'ACTIVE' },
            }
          : null,
      ),
      verifyBearer: sinon.stub().resolves(null),
    });
    const deps = {
      enabled: () => enabled,
      authDisabled: () => false,
      verifier,
      ownerOf: async (id: string) => OWNERS[id] ?? null,
      ownersOf: async (ids: string[]) => new Map(ids.map((id) => [id, OWNERS[id] ?? null])),
      logger: {
        info: (m: string) => infos.push(m),
        warn: (m: string) => warnings.push(m),
        error: () => undefined,
      },
    };

    const createServer = http.createServer;
    const forced = opts.upgrades === 'listener' ? sinon.stub(http, 'createServer') : undefined;
    forced?.callsFake(((app: any) => {
      const s = createServer(app);
      if (typeof (s as any).shouldUpgradeCallback === 'undefined') {
        (s as any).shouldUpgradeCallback = () => true;
      }
      return s;
    }) as any);
    try {
      server = await baseDriver.server({
        routeConfiguringFunction: baseDriver.routeConfiguringFunction(driver),
        port: 0,
        hostname: '127.0.0.1',
        basePath: '/wd/hub',
        // Appium hands plugins the raw CLI args; the base path here is normalised
        // by registerCommandAuth itself.
        cliArgs: { basePath: 'wd/hub/' },
        serverUpdaters: [
          (app: any, httpServer: any, cliArgs: any) => {
            registerCommandAuth(app, cliArgs, deps);
            registerSessionUpgradeGuard(httpServer, app, cliArgs, deps);
          },
        ],
      });
    } finally {
      forced?.restore();
    }

    // Appium's main adds its BiDi handler right after server() resolves.
    const bidi = new WebSocketServer({ noServer: true });
    bidi.on('connection', (ws, req) => {
      bidiConnections.push(String(req.url));
      ws.on('error', () => undefined);
    });
    await (booted() as any).addWebSocketHandler('/wd/hub/bidi', bidi);
    await (booted() as any).addWebSocketHandler('/wd/hub/bidi/:sessionId', bidi);
  }

  function upgrade(urlPath: string, headers: Record<string, string> = {}) {
    const { port } = booted().address() as { port: number };
    return new Promise<'open' | number | string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${urlPath}`, { headers });
      ws.on('open', () => {
        resolve('open');
        ws.terminate();
      });
      ws.on('unexpected-response', (req, res) => {
        resolve(res.statusCode ?? 0);
        req.destroy();
      });
      ws.on('error', (err) => resolve(err.message));
    });
  }

  // Appium's HTTP logger writes every request to stdout; quiet it here only.
  let appiumLog: { level: string } | undefined;
  let appiumLogLevel: string | undefined;
  before(() => {
    // Loading base-driver creates its loggers, which resets the level, so load
    // it before quieting.
    appiumBaseDriver();
    const support = require.resolve('@appium/support', {
      paths: [path.dirname(require.resolve('appium/package.json'))],
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const log: { level: string } = require(
      require.resolve('@appium/logger', { paths: [support] }),
    ).default;
    appiumLog = log;
    appiumLogLevel = log.level;
    log.level = 'silent';
  });
  after(() => {
    if (appiumLog && appiumLogLevel) appiumLog.level = appiumLogLevel;
  });

  function booted(): http.Server {
    if (!server) throw new Error('boot() first');
    return server;
  }

  beforeEach(() => {
    enabled = true;
    infos = [];
    warnings = [];
  });

  afterEach(async () => {
    if (!server) return;
    const s = server;
    server = undefined;
    // Appium replaces close() with a graceful one that calls process.exit()
    // if connections outlive its shutdown timeout. Use http.Server's own.
    s.closeAllConnections();
    await new Promise<void>((resolve) => http.Server.prototype.close.call(s, () => resolve()));
  });

  it("refuses a session command before Appium's route runs", async () => {
    await boot();
    const res = await request(booted()).get(`/wd/hub/session/${LIVE_SESSION}/url`);
    expect(res.status).to.equal(404);
    expect(res.text).to.equal(EXACT_UNKNOWN_SESSION);
    expect(commands).to.deep.equal([]);
    expect(warnings).to.have.length(1);
  });

  it("lets the owner through to Appium's route and the driver", async () => {
    await boot();
    const res = await request(booted())
      .get(`/wd/hub/session/${LIVE_SESSION}/url`)
      .set({ 'x-xenon-access-key': 'ak', 'x-xenon-token': 'alice-token' });
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ value: 'about:blank' });
    expect(commands).to.deep.equal(['getUrl']);
  });

  it('lets createSession reach the driver without credentials', async () => {
    await boot();
    await request(booted())
      .post('/wd/hub/session')
      .send({ capabilities: { alwaysMatch: { platformName: 'Fake' } } })
      .expect(200);
    expect(commands).to.deep.equal(['createSession']);
  });

  it("with the setting off, Appium gives its own unknown-session answer, which the refusal matches but for Appium's stack trace", async () => {
    enabled = false;
    await boot();
    const res = await request(booted()).get('/wd/hub/session/no-such-session/url');
    expect(res.status).to.equal(404);
    expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
    expect(res.body.value.error).to.equal(UNKNOWN_SESSION_BODY.value.error);
    expect(res.body.value.message).to.equal(UNKNOWN_SESSION_BODY.value.message);
    expect(Object.keys(res.body.value)).to.deep.equal(Object.keys(UNKNOWN_SESSION_BODY.value));
    // Appium fills `stacktrace` with its own server-side stack. The refusal
    // leaves it empty; that is the only difference.
    expect(res.body.value.stacktrace).to.match(
      /^NoSuchDriverError: A session is either terminated or not started/,
    );
    expect(warnings).to.deep.equal([]);
  });

  describe("Appium's session listing (GET /appium/sessions)", () => {
    it('answers a caller without credentials an empty list, though Appium produced the full one', async () => {
      await boot();
      const res = await request(booted()).get('/wd/hub/appium/sessions');
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
      expect(res.text).to.equal('{"value":[]}');
      expect(commands).to.deep.equal(['getAppiumSessions']);
      expect(warnings).to.have.length(1);
    });

    it('shows the owner only their own session', async () => {
      await boot();
      const res = await request(booted())
        .get('/wd/hub/appium/sessions')
        .set({ 'x-xenon-access-key': 'ak', 'x-xenon-token': 'alice-token' });
      expect(res.body).to.deep.equal({ value: [LISTING[0]] });
      expect(infos.some((m) => m.includes('1 of 2'))).to.equal(true);
    });

    it("with the setting off, answers Appium's listing untouched", async () => {
      enabled = false;
      await boot();
      const res = await request(booted()).get('/wd/hub/appium/sessions');
      expect(res.body).to.deep.equal({ value: LISTING });
    });
  });

  for (const upgrades of ['native', 'listener'] as const) {
    const how =
      upgrades === 'listener' || nativelyUsesUpgradeListener()
        ? 'with its upgrade listener'
        : 'with its Express upgrade middleware';
    describe(`the BiDi WebSocket, Appium dispatching upgrades ${how} (${upgrades})`, () => {
      it('refuses a session upgrade without credentials with 404, before Appium attaches it', async () => {
        await boot({ upgrades });
        expect(await upgrade(`/wd/hub/bidi/${LIVE_SESSION}`)).to.equal(404);
        expect(bidiConnections).to.deep.equal([]);
        expect(warnings).to.have.length(1);
      });

      it('refuses another user with 404', async () => {
        await boot({ upgrades });
        expect(
          await upgrade(`/wd/hub/bidi/${LIVE_SESSION}`, {
            'x-xenon-access-key': 'ak',
            'x-xenon-token': 'bob-token',
          }),
        ).to.equal(404);
        expect(bidiConnections).to.deep.equal([]);
      });

      it("lets the owner attach through Appium's own handler", async () => {
        await boot({ upgrades });
        expect(
          await upgrade(`/wd/hub/bidi/${LIVE_SESSION}`, {
            'x-xenon-access-key': 'ak',
            'x-xenon-token': 'alice-token',
          }),
        ).to.equal('open');
        expect(bidiConnections).to.deep.equal([`/wd/hub/bidi/${LIVE_SESSION}`]);
      });

      it('with the setting off, lets anyone attach, as Appium does', async () => {
        enabled = false;
        await boot({ upgrades });
        expect(await upgrade(`/wd/hub/bidi/${LIVE_SESSION}`)).to.equal('open');
        expect(warnings).to.deep.equal([]);
      });
    });
  }
});
