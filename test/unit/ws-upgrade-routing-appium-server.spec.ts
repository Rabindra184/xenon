import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import net from 'net';
import path from 'path';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import WebSocket, { WebSocketServer } from 'ws';
import { io as connectClient, Socket as ClientSocket } from 'socket.io-client';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import {
  registerCommandAuth,
  registerSessionUpgradeGuard,
} from '../../src/app/registerCommandAuth';
import { attachH264Ws } from '../../src/app/ws/h264StreamWs';
import { attachLogcatWs } from '../../src/app/ws/logcatWs';
import { H264Multiplexer } from '../../src/device-managers/android/H264Multiplexer';
import { LogcatMultiplexer } from '../../src/device-managers/android/LogcatMultiplexer';
import { SocketServer } from '../../src/services/SocketServer';
import { config as xenonConfig } from '../../src/config';

/**
 * Xenon's WebSockets and Appium's, on one server.
 *
 * This boots base-driver's `server()`, the function Appium's main uses, and
 * wires Xenon onto it the way ServerManager.updateServer does: per-command
 * auth and the session WebSocket guard (registerRoutes), socket.io on a hub
 * (setupHubOrNode), then the H.264 and logcat WebSockets. Appium's BiDi
 * handler is added after boot, as Appium's main adds it, and a fake driver
 * adds a per-session socket in createSession, as UiAutomator2 does for
 * `mobile: startLogsBroadcast`.
 *
 * Every upgrade must reach exactly the handler that owns its path:
 * - `/xenon/api/control/:udid/stream/h264` and `/logcat` (with a ticket) and
 *   socket.io's `/socket.io/` go to Xenon;
 * - everything else goes to Appium, behind the session guard.
 *
 * How Appium takes upgrades depends on the Node version, and so did what went
 * wrong. 'native' is whatever this Node makes Appium choose; 'listener' forces
 * the Node >= 22.21 / 24.9 shape (an `upgrade` listener on the http.Server,
 * added before any plugin) on an older Node, by giving the server a
 * `shouldUpgradeCallback` before Appium looks for one. An older Node emits
 * every upgrade to that listener, since any `upgrade` listener makes it emit.
 */

type UpgradeMode = 'native' | 'listener';
type Role = 'hub' | 'node';

const LIVE_SESSION = 'live-session';
const OWNERS: Record<string, string> = { [LIVE_SESSION]: 'alice' };
const DRIVER_LOGCAT = `/ws/session/${LIVE_SESSION}/appium/device/logcat`;
const H264_URL = '/xenon/api/control/DEV-1/stream/h264?ticket=t-h264';
const LOGCAT_URL = '/xenon/api/control/DEV-1/logcat?ticket=t-logcat';

/** Longer than engine.io's 1 s destroyUpgradeTimeout, so a hang is told apart from it. */
const HANG_MS = 2500;

function nativelyUsesUpgradeListener(): boolean {
  return typeof (http.createServer() as any).shouldUpgradeCallback !== 'undefined';
}

function appiumBaseDriver(): any {
  const appiumDir = path.dirname(require.resolve('appium/package.json'));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(require.resolve('@appium/base-driver', { paths: [appiumDir] }));
}

type Outcome =
  | { kind: 'open'; firstMessage?: Buffer }
  | { kind: 'http'; status: number }
  | { kind: 'closed'; message: string; ms: number }
  | { kind: 'hang' };

/**
 * Open a WebSocket and report how the server answered: open (with the first
 * message, if one arrives promptly), an HTTP answer, a close without one (and
 * how long it took), or nothing at all.
 */
function connect(port: number, urlPath: string, headers: Record<string, string> = {}) {
  return new Promise<Outcome>((resolve) => {
    const started = Date.now();
    const ws = new WebSocket(`ws://127.0.0.1:${port}${urlPath}`, { headers });
    let settled = false;
    const settle = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(hang);
      resolve(outcome);
      ws.terminate();
    };
    const hang = setTimeout(() => settle({ kind: 'hang' }), HANG_MS);
    ws.on('open', () => {
      const wait = setTimeout(() => settle({ kind: 'open' }), 300);
      ws.once('message', (data: Buffer) => {
        clearTimeout(wait);
        settle({ kind: 'open', firstMessage: data });
      });
    });
    ws.on('unexpected-response', (req, res) => {
      settle({ kind: 'http', status: res.statusCode ?? 0 });
      req.destroy();
    });
    ws.on('error', (err) =>
      settle({ kind: 'closed', message: err.message, ms: Date.now() - started }),
    );
  });
}

describe("Xenon's and Appium's WebSockets on Appium 3's own server()", () => {
  const quiet = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };

  let server: http.Server | undefined;
  let socketServer: SocketServer | undefined;
  let sockets: Set<net.Socket>;
  let clients: ClientSocket[];
  let enabled: boolean;
  let warnings: string[];
  /** URL of every upgrade each WebSocket server was asked to take, in order. */
  let taken: Array<{ by: string; url: string }>;
  let bidiConnections: string[];
  let driverConnections: string[];
  let h264Redeemed: string[];
  let logcatRedeemed: string[];
  let wssNames: Map<WebSocketServer, string>;

  function booted(): http.Server {
    if (!server) throw new Error('boot() first');
    return server;
  }

  function port(): number {
    return (booted().address() as net.AddressInfo).port;
  }

  async function boot(opts: { upgrades: UpgradeMode; role: Role }) {
    const baseDriver = appiumBaseDriver();
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
        info: () => undefined,
        warn: (m: string) => warnings.push(m),
        error: () => undefined,
      },
    };

    // A fake driver that, like UiAutomator2, registers a per-session WebSocket
    // with the server when its session starts.
    const driverWss = new WebSocketServer({ noServer: true });
    wssNames.set(driverWss, 'driver');
    driverWss.on('connection', (ws, req) => {
      driverConnections.push(String(req.url));
      ws.on('error', () => undefined);
    });
    const driver = {
      log: quiet,
      protocol: 'W3C',
      sessionExists: (id: string) => id === LIVE_SESSION,
      proxyActive: () => false,
      canProxy: () => false,
      proxyRouteIsAvoided: () => false,
      executeCommand: async (command: string) => {
        if (command === 'createSession') {
          await (booted() as any).addWebSocketHandler(DRIVER_LOGCAT, driverWss);
          return [LIVE_SESSION, {}];
        }
        return null;
      },
    };

    const h264Mux = new H264Multiplexer();
    h264Mux.setConfig({ type: 'config', data: Buffer.from([0, 0, 0, 1, 0x67]), ptsMs: 0 });
    const logcatMux = new LogcatMultiplexer();
    logcatMux.push({ ts: 1, pid: 1, tid: 1, level: 'I', tag: 'T', message: 'hello' });

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
        cliArgs: { basePath: '/wd/hub' },
        serverUpdaters: [
          (app: any, httpServer: any, cliArgs: any) => {
            // ServerManager.updateServer, in its order.
            registerCommandAuth(app, cliArgs, deps);
            registerSessionUpgradeGuard(httpServer, app, cliArgs, deps);
            if (opts.role === 'hub') {
              socketServer = new SocketServer();
              socketServer.initialize(httpServer);
            }
            attachH264Ws(httpServer, {
              redeem: async (ticket, udid) => {
                h264Redeemed.push(`${udid}:${ticket}`);
                return { actorId: 'alice' };
              },
              startStream: async () => h264Mux,
            });
            attachLogcatWs(httpServer, {
              redeem: async (ticket, udid) => {
                logcatRedeemed.push(`${udid}:${ticket}`);
                return { actorId: 'alice' };
              },
              authorize: async () => true,
              startStream: async () => ({ mux: logcatMux }),
            });
          },
        ],
      });
    } finally {
      forced?.restore();
    }
    booted().on('connection', (socket: net.Socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    // Appium's main adds its BiDi handler right after server() resolves.
    const bidi = new WebSocketServer({ noServer: true });
    wssNames.set(bidi, 'bidi');
    bidi.on('connection', (ws, req) => {
      bidiConnections.push(String(req.url));
      ws.on('error', () => undefined);
    });
    await (booted() as any).addWebSocketHandler('/wd/hub/bidi', bidi);
    await (booted() as any).addWebSocketHandler('/wd/hub/bidi/:sessionId', bidi);

    if (socketServer) {
      const engine = (socketServer as any).io.engine;
      const handleUpgrade = engine.handleUpgrade;
      sinon.stub(engine, 'handleUpgrade').callsFake(function (this: any, ...args: any[]) {
        taken.push({ by: 'socket.io', url: String(args[0]?.url) });
        return handleUpgrade.apply(this, args);
      });
    }
  }

  async function createSession() {
    await request(booted())
      .post('/wd/hub/session')
      .send({ capabilities: { alwaysMatch: { platformName: 'Fake' } } })
      .expect(200);
  }

  function connectSocketIo(transports: string[]) {
    const client = connectClient(`http://127.0.0.1:${port()}`, {
      path: '/socket.io',
      transports,
      reconnection: false,
      forceNew: true,
    });
    clients.push(client);
    return client;
  }

  // Appium's HTTP logger writes every request to stdout; quiet it here only.
  let appiumLog: { level: string } | undefined;
  let appiumLogLevel: string | undefined;
  let authDisabled = false;
  before(() => {
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
    // socket.io's handshake: an auth-disabled hub admits every dashboard.
    authDisabled = xenonConfig.authDisabled;
    xenonConfig.authDisabled = true;
  });
  after(() => {
    if (appiumLog && appiumLogLevel) appiumLog.level = appiumLogLevel;
    xenonConfig.authDisabled = authDisabled;
  });

  beforeEach(() => {
    enabled = false;
    warnings = [];
    taken = [];
    bidiConnections = [];
    driverConnections = [];
    h264Redeemed = [];
    logcatRedeemed = [];
    sockets = new Set();
    clients = [];
    wssNames = new Map();
    // Record which WebSocket server each upgrade is handed to. The h264 and
    // logcat servers are created inside attach*Ws, so they are named by the
    // path they are asked to take.
    const handleUpgrade = WebSocketServer.prototype.handleUpgrade;
    sinon.stub(WebSocketServer.prototype, 'handleUpgrade').callsFake(function (
      this: WebSocketServer,
      ...args: any[]
    ) {
      const url = String(args[0]?.url);
      const by =
        wssNames.get(this) ??
        (/\/stream\/h264/.test(url) ? 'h264' : /\/logcat\?/.test(url) ? 'logcat' : 'unknown');
      taken.push({ by, url });
      return (handleUpgrade as any).apply(this, args);
    } as any);
  });

  afterEach(async () => {
    for (const c of clients) c.close();
    sinon.restore();
    const s = server;
    server = undefined;
    const io = (socketServer as any)?.io;
    socketServer = undefined;
    if (!s) return;
    for (const socket of sockets) socket.destroy();
    s.closeAllConnections();
    if (io) {
      // socket.io's close() also closes the http.Server, and Appium's close()
      // calls process.exit() when its shutdown timer runs out. Close only
      // socket.io's own side here.
      io.httpServer = undefined;
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
    // Appium replaces close() with a graceful one that calls process.exit()
    // if connections outlive its shutdown timeout. Use http.Server's own.
    await new Promise<void>((resolve) => http.Server.prototype.close.call(s, () => resolve()));
  });

  for (const upgrades of ['native', 'listener'] as const) {
    const how =
      upgrades === 'listener' || nativelyUsesUpgradeListener()
        ? 'its upgrade listener (Node >= 22.21 / 24.9)'
        : 'its Express upgrade middleware (Node < 22.21)';

    describe(`Appium taking upgrades with ${how} [${upgrades}]`, () => {
      describe('on a hub (socket.io attached)', () => {
        beforeEach(async () => {
          await boot({ upgrades, role: 'hub' });
        });

        it("hands an H.264 upgrade with a ticket to Xenon's H.264 handler, which streams", async () => {
          const outcome = await connect(port(), H264_URL);
          expect(outcome.kind).to.equal('open');
          expect((outcome as any).firstMessage?.[0], 'the config frame').to.equal(0);
          expect(h264Redeemed).to.deep.equal(['DEV-1:t-h264']);
          expect(taken).to.deep.equal([{ by: 'h264', url: H264_URL }]);
        });

        it("hands a logcat upgrade with a ticket to Xenon's logcat handler, which streams", async () => {
          const outcome = await connect(port(), LOGCAT_URL);
          expect(outcome.kind).to.equal('open');
          expect(JSON.parse(String((outcome as any).firstMessage)).message).to.equal('hello');
          expect(logcatRedeemed).to.deep.equal(['DEV-1:t-logcat']);
          expect(taken).to.deep.equal([{ by: 'logcat', url: LOGCAT_URL }]);
        });

        it('connects socket.io over the websocket transport, with no polling fallback', async () => {
          const client = connectSocketIo(['websocket']);
          await new Promise<void>((resolve, reject) => {
            client.once('connect', () => resolve());
            client.once('connect_error', (err) => reject(err));
          });
          expect(client.io.engine.transport.name).to.equal('websocket');
          expect(taken.map((t) => t.by)).to.deep.equal(['socket.io']);
        });

        it("upgrades the dashboard's default socket.io client from polling to websocket", async () => {
          const client = connectSocketIo(['polling', 'websocket']);
          await new Promise<void>((resolve, reject) => {
            client.once('connect_error', (err) => reject(err));
            client.io.engine.once('upgrade', () => resolve());
            setTimeout(
              () => reject(new Error(`still on ${client.io.engine?.transport?.name}`)),
              HANG_MS,
            );
          });
          expect(client.io.engine.transport.name).to.equal('websocket');
          expect(taken.map((t) => t.by)).to.deep.equal(['socket.io']);
        });

        it("hands a BiDi upgrade to Appium's BiDi handler", async () => {
          expect((await connect(port(), `/wd/hub/bidi/${LIVE_SESSION}`)).kind).to.equal('open');
          expect(bidiConnections).to.deep.equal([`/wd/hub/bidi/${LIVE_SESSION}`]);
          expect(taken).to.deep.equal([{ by: 'bidi', url: `/wd/hub/bidi/${LIVE_SESSION}` }]);
        });

        it("hands a driver's session socket, added in createSession, to the driver", async () => {
          await createSession();
          expect((await connect(port(), DRIVER_LOGCAT)).kind).to.equal('open');
          expect(driverConnections).to.deep.equal([DRIVER_LOGCAT]);
          expect(taken).to.deep.equal([{ by: 'driver', url: DRIVER_LOGCAT }]);
        });

        it('gives an unknown session socket to Appium, which closes it at once', async () => {
          const outcome = await connect(port(), '/wd/hub/ws/session/x/appium/device/logcat');
          expect(outcome.kind).to.equal('closed');
          // At once, not after engine.io's 1 s timer for upgrades it doesn't own.
          expect((outcome as any).ms).to.be.below(800);
          expect(taken).to.deep.equal([]);
        });

        it('gives exactly one handler each socket, all on one server', async () => {
          await createSession();
          const client = connectSocketIo(['websocket']);
          await new Promise<void>((resolve, reject) => {
            client.once('connect', () => resolve());
            client.once('connect_error', (err) => reject(err));
          });
          for (const url of [H264_URL, LOGCAT_URL, `/wd/hub/bidi/${LIVE_SESSION}`, DRIVER_LOGCAT]) {
            expect((await connect(port(), url)).kind, url).to.equal('open');
          }
          expect(taken.map((t) => t.by)).to.deep.equal([
            'socket.io',
            'h264',
            'logcat',
            'bidi',
            'driver',
          ]);
        });

        describe('with XENON_REQUIRE_COMMAND_AUTH on', () => {
          beforeEach(() => {
            enabled = true;
          });

          it('refuses a BiDi upgrade without credentials with 404, before Appium sees it', async () => {
            expect(await connect(port(), `/wd/hub/bidi/${LIVE_SESSION}`)).to.deep.equal({
              kind: 'http',
              status: 404,
            });
            expect(taken).to.deep.equal([]);
            expect(warnings).to.have.length(1);
          });

          it("lets the owner's BiDi and driver sockets through to Appium", async () => {
            await createSession();
            const alice = { 'x-xenon-access-key': 'ak', 'x-xenon-token': 'alice-token' };
            expect((await connect(port(), `/wd/hub/bidi/${LIVE_SESSION}`, alice)).kind).to.equal(
              'open',
            );
            expect((await connect(port(), DRIVER_LOGCAT, alice)).kind).to.equal('open');
            expect(taken.map((t) => t.by)).to.deep.equal(['bidi', 'driver']);
          });

          it("refuses another user's driver socket with 404", async () => {
            await createSession();
            const bob = { 'x-xenon-access-key': 'ak', 'x-xenon-token': 'bob-token' };
            expect(await connect(port(), DRIVER_LOGCAT, bob)).to.deep.equal({
              kind: 'http',
              status: 404,
            });
            expect(driverConnections).to.deep.equal([]);
          });

          it('answers an unknown session socket 404, as for any session the caller does not own', async () => {
            expect(
              await connect(port(), '/wd/hub/ws/session/x/appium/device/logcat'),
            ).to.deep.equal({ kind: 'http', status: 404 });
          });

          it("leaves Xenon's ticketed sockets and socket.io alone", async () => {
            expect((await connect(port(), H264_URL)).kind).to.equal('open');
            expect((await connect(port(), LOGCAT_URL)).kind).to.equal('open');
            const client = connectSocketIo(['websocket']);
            await new Promise<void>((resolve, reject) => {
              client.once('connect', () => resolve());
              client.once('connect_error', (err) => reject(err));
            });
            expect(taken.map((t) => t.by)).to.deep.equal(['h264', 'logcat', 'socket.io']);
            expect(warnings).to.deep.equal([]);
          });
        });
      });

      describe('on a node (no socket.io)', () => {
        beforeEach(async () => {
          await boot({ upgrades, role: 'node' });
        });

        it("hands H.264 and logcat upgrades to Xenon's handlers", async () => {
          expect((await connect(port(), H264_URL)).kind).to.equal('open');
          expect((await connect(port(), LOGCAT_URL)).kind).to.equal('open');
          expect(taken.map((t) => t.by)).to.deep.equal(['h264', 'logcat']);
        });

        it("hands BiDi and a driver's session socket to Appium", async () => {
          await createSession();
          expect((await connect(port(), `/wd/hub/bidi/${LIVE_SESSION}`)).kind).to.equal('open');
          expect((await connect(port(), DRIVER_LOGCAT)).kind).to.equal('open');
          expect(taken.map((t) => t.by)).to.deep.equal(['bidi', 'driver']);
        });

        it('gives an unknown upgrade to Appium, which closes it at once', async () => {
          const outcome = await connect(port(), '/nowhere');
          expect(outcome.kind).to.equal('closed');
          expect((outcome as any).ms).to.be.below(800);
        });
      });
    });
  }
});
