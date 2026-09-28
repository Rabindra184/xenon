import { expect } from 'chai';
import http from 'http';
import net from 'net';
import path from 'path';
import sinon from 'sinon';
import WebSocket, { WebSocketServer } from 'ws';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import { sessionIdsOfUpgrade } from '../../src/middleware/sessionUpgradeGuard';
import { registerSessionUpgradeGuard } from '../../src/app/registerCommandAuth';

/**
 * Session WebSockets under XENON_REQUIRE_COMMAND_AUTH.
 *
 * WebDriver BiDi (`<basePath>/bidi/<sessionId>`) and the endpoints drivers
 * register (`/ws/session/<sessionId>/...`) are WebSocket upgrades, which never
 * pass through the Express routes the per-command check guards. Without the
 * guard, anyone with a session id can attach.
 *
 * Appium dispatches upgrades one of two ways (base-driver `server()`):
 * - Node >= 22.21 / 24.9 (`shouldUpgradeCallback`): an `upgrade` listener on the
 *   http.Server, added before any plugin's updateServer runs.
 * - older Node: an Express middleware (`handleUpgrade`), reached only while the
 *   server has no `upgrade` listener at all.
 * These tests use Appium's own dispatch functions for both, on a real
 * http.Server with a real WebSocket client.
 */

function appiumDir(): string {
  return path.dirname(require.resolve('appium/package.json'));
}

function appiumExpress(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(require.resolve('express', { paths: [appiumDir()] }));
}

/** base-driver's upgrade dispatch: tryHandleWebSocketUpgrade and handleUpgrade. */
function appiumUpgradeDispatch(): any {
  const baseDriverDir = path.dirname(
    require.resolve('@appium/base-driver/package.json', { paths: [appiumDir()] }),
  );
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(baseDriverDir, 'build/lib/express/middleware'));
}

const USERS: Record<string, { id: string; role: string; status: string }> = {
  alice: { id: 'alice', role: 'MEMBER', status: 'ACTIVE' },
  bob: { id: 'bob', role: 'MEMBER', status: 'ACTIVE' },
  carol: { id: 'carol', role: 'ADMIN', status: 'ACTIVE' },
  root: { id: 'root', role: 'SUPER_ADMIN', status: 'ACTIVE' },
};
const KEYS: Record<string, [string, string]> = {
  'alice-token': ['alice', 'devices,sessions,read'],
  'bob-token': ['bob', 'devices,sessions,read'],
  'carol-ordinary': ['carol', 'devices,sessions,read'],
  'carol-admin': ['carol', 'admin,devices,sessions,read'],
};
const JWTS: Record<string, [string, string]> = {
  'alice-jwt': ['alice', 'devices,sessions,read'],
  'root-jwt': ['root', 'sessions'],
};
const OWNERS: Record<string, string | null> = {
  's-alice': 'alice',
  's-bob': 'bob',
  's-anon': null,
};

const as = (token: string) => ({
  'x-xenon-access-key': `ak-${KEYS[token][0]}`,
  'x-xenon-token': token,
});
const bearer = (jwt: string) => ({ authorization: `Bearer ${jwt}` });

type Outcome =
  | { kind: 'open' }
  | { kind: 'http'; status: number }
  | { kind: 'error'; message: string };

/** Open a WebSocket and report how the server answered the upgrade. */
function connect(port: number, urlPath: string, headers: Record<string, string> = {}) {
  return new Promise<Outcome>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${urlPath}`, { headers });
    ws.on('open', () => {
      resolve({ kind: 'open' });
      ws.terminate();
    });
    ws.on('unexpected-response', (req, res) => {
      resolve({ kind: 'http', status: res.statusCode ?? 0 });
      req.destroy();
    });
    ws.on('error', (err) => resolve({ kind: 'error', message: err.message }));
  });
}

/** Send a raw upgrade request and collect everything until the server closes. */
function rawUpgrade(port: number, urlPath: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        `GET ${urlPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n` +
          'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n',
      );
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString('latin1')));
    socket.on('close', () => resolve(data));
    socket.on('error', reject);
    socket.setTimeout(5000, () => reject(new Error(`no close after: ${JSON.stringify(data)}`)));
  });
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const openSockets = new WeakMap<http.Server, Set<net.Socket>>();

/** Listen on 127.0.0.1, remembering every connection so shut() can end it. */
async function listen(server: http.Server): Promise<number> {
  const sockets = new Set<net.Socket>();
  openSockets.set(server, sockets);
  server.on('connection', (socket: net.Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as net.AddressInfo).port;
}

/**
 * Close the server and every connection. An upgraded socket leaves the HTTP
 * server's own bookkeeping (closeAllConnections misses it), and one that no
 * listener reads never sees the client's FIN, so it is destroyed here.
 */
async function shut(server: http.Server | undefined): Promise<void> {
  if (!server) return;
  for (const socket of openSockets.get(server) ?? []) socket.destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('session WebSockets under per-command auth', () => {
  describe('which upgrades belong to a session', () => {
    const cases: Array<[string, string, string[]]> = [
      // WebDriver BiDi, as Appium's main registers it under the base path.
      ['/wd/hub/bidi/abc', '/wd/hub', ['abc']],
      ['/wd/hub/bidi/abc/', '/wd/hub', ['abc']],
      ['/WD/HUB/BIDI/abc', '/wd/hub', ['abc']],
      ['/wd/hub/x/../bidi/abc', '/wd/hub', ['abc']],
      ['/wd/hub/bidi/%2e%2e/bidi/abc', '/wd/hub', ['abc']],
      ['http://elsewhere/wd/hub/bidi/abc', '/wd/hub', ['abc']],
      // Appium reads the bidi session id from the raw URL, query and all; both count.
      ['/wd/hub/bidi/abc?x=1', '/wd/hub', ['abc', 'abc?x=1']],
      ['/wd/hub/bidi/ab%2Fc', '/wd/hub', ['ab%2Fc', 'ab/c']],
      ['/bidi/abc', '', ['abc']],
      // The umbrella bidi socket belongs to no session.
      ['/wd/hub/bidi', '/wd/hub', []],
      ['/wd/hub/bidi/', '/wd/hub', []],
      // Outside the base path Appium routes nothing to bidi.
      ['/bidi/abc', '/wd/hub', []],
      // Driver endpoints (base-driver's DEFAULT_WS_PATHNAME_PREFIX), with or without the base path.
      ['/ws/session/abc/appium/device/logcat', '/wd/hub', ['abc']],
      ['/wd/hub/ws/session/abc/appium/device/syslog', '/wd/hub', ['abc']],
      ['/WS/SESSION/abc/appium/device/logcat/', '/wd/hub', ['abc']],
      ['/ws/session/abc', '', ['abc']],
      // Not session WebSockets.
      ['/xenon/api/control/udid-1/logcat?ticket=t', '/wd/hub', []],
      ['/xenon/api/control/udid-1/stream/h264?ticket=t', '/wd/hub', []],
      ['/socket.io/?EIO=4&transport=websocket', '/wd/hub', []],
      ['/wd/hub/session/abc/url', '/wd/hub', []],
      ['/ws/other/abc', '/wd/hub', []],
    ];
    for (const [url, basePath, ids] of cases) {
      it(`${url} (base path ${JSON.stringify(basePath)}) -> ${JSON.stringify(ids)}`, () => {
        expect(sessionIdsOfUpgrade(url, basePath)).to.deep.equal(ids);
      });
    }

    it("normalises the base path the way Appium does ('wd/hub/' -> '/wd/hub')", () => {
      expect(sessionIdsOfUpgrade('/wd/hub/bidi/abc', 'wd/hub/')).to.deep.equal(['abc']);
      expect(sessionIdsOfUpgrade('/wd/hub/bidi/abc', undefined)).to.deep.equal([]);
    });
  });

  describe('registration', () => {
    const quiet = (errors: string[]) => ({
      info: () => undefined,
      warn: () => undefined,
      error: (m: string) => errors.push(m),
    });

    it('refuses to start when the setting is on and there is no HTTP server to guard', () => {
      const errors: string[] = [];
      expect(() =>
        registerSessionUpgradeGuard(
          undefined,
          appiumExpress()(),
          { basePath: '/wd/hub' },
          {
            enabled: () => true,
            authDisabled: () => false,
            logger: quiet(errors),
          },
        ),
      ).to.throw(/XENON_REQUIRE_COMMAND_AUTH/);
      expect(errors).to.have.length(1);
    });

    it('refuses to start when the setting is on and the Express guard cannot be placed', () => {
      const errors: string[] = [];
      expect(() =>
        registerSessionUpgradeGuard(
          http.createServer(),
          { use: () => undefined },
          { basePath: '/wd/hub' },
          { enabled: () => true, authDisabled: () => false, logger: quiet(errors) },
        ),
      ).to.throw(/XENON_REQUIRE_COMMAND_AUTH/);
    });

    it('logs an error but starts when the setting is off', () => {
      const errors: string[] = [];
      const result = registerSessionUpgradeGuard(
        undefined,
        appiumExpress()(),
        {},
        {
          enabled: () => false,
          authDisabled: () => false,
          logger: quiet(errors),
        },
      );
      expect(result.placed).to.equal(false);
      expect(errors).to.have.length(1);
    });
  });

  // 'listener': Appium on Node >= 22.21 / 24.9, its upgrade listener added before plugins.
  // 'express': Appium on older Node, its Express upgrade middleware, no upgrade listener.
  for (const mode of ['listener', 'express'] as const) {
    describe(`Appium dispatching upgrades with its ${mode}`, () => {
      let enabled: boolean;
      let authDisabled: boolean;
      let ownerOf: sinon.SinonStub;
      let verifyKeyPair: sinon.SinonStub;
      let verifyBearer: sinon.SinonStub;
      let warnings: string[];
      let errors: string[];
      let server: http.Server | undefined;
      let port: number;
      /** URLs Appium's WebSocket servers accepted. */
      let accepted: string[];
      /** Calls into Appium's WebSocket servers' handleUpgrade, accepted or not. */
      let appiumHandled: sinon.SinonSpy[];

      beforeEach(async () => {
        enabled = true;
        authDisabled = false;
        warnings = [];
        errors = [];
        accepted = [];
        verifyKeyPair = sinon.stub().callsFake(async (accessKey: string, token: string) => {
          const key = KEYS[token];
          if (!key || accessKey !== `ak-${key[0]}`) return null;
          return {
            row: { id: `key-${token}`, userId: key[0], scopes: key[1], expiresAt: null },
            user: USERS[key[0]],
          };
        });
        verifyBearer = sinon.stub().callsFake(async (jwt: string) => {
          const t = JWTS[jwt];
          if (!t) return null;
          return { payload: { sub: t[0], scopes: t[1] }, user: USERS[t[0]] };
        });
        ownerOf = sinon.stub().callsFake(async (id: string) => (id in OWNERS ? OWNERS[id] : null));

        const dispatch = appiumUpgradeDispatch();
        const bidi = new WebSocketServer({ noServer: true });
        const driverLogcat = new WebSocketServer({ noServer: true });
        for (const wss of [bidi, driverLogcat]) {
          wss.on('connection', (ws, req) => {
            accepted.push(String(req.url));
            ws.on('error', () => undefined);
          });
        }
        appiumHandled = [
          sinon.spy(bidi, 'handleUpgrade'),
          sinon.spy(driverLogcat, 'handleUpgrade'),
        ];
        // What Appium's main and a driver register.
        const mapping: Record<string, WebSocketServer> = {
          '/wd/hub/bidi': bidi,
          '/wd/hub/bidi/:sessionId': bidi,
          '/ws/session/s-alice/appium/device/logcat': driverLogcat,
        };

        const app = appiumExpress()();
        if (mode === 'express') app.use(dispatch.handleUpgrade(mapping));
        app.use((_req: any, res: any) => res.status(404).json({ value: null }));
        const httpServer = http.createServer(app);
        if (mode === 'listener') {
          // Appium's configureHttp, verbatim in effect.
          httpServer.on('upgrade', (req, socket, head) => {
            if (!dispatch.tryHandleWebSocketUpgrade(req, socket, head, mapping)) socket.destroy();
          });
        }

        const result = registerSessionUpgradeGuard(
          httpServer,
          app,
          { basePath: 'wd/hub/' },
          {
            enabled: () => enabled,
            authDisabled: () => authDisabled,
            verifier: new CommandCallerVerifier({ verifyKeyPair, verifyBearer }),
            ownerOf,
            logger: {
              info: () => undefined,
              warn: (m: string) => warnings.push(m),
              error: (m: string) => errors.push(m),
            },
          },
        );
        expect(result.placed).to.equal(true);

        server = httpServer;
        port = await listen(httpServer);
      });

      afterEach(async () => {
        const s = server;
        server = undefined;
        await shut(s);
      });

      const appiumSawAnything = () => appiumHandled.some((spy) => spy.called);

      describe('who may attach', () => {
        it("refuses a session upgrade without credentials with 404, before Appium's handler runs", async () => {
          expect(await connect(port, '/wd/hub/bidi/s-alice')).to.deep.equal({
            kind: 'http',
            status: 404,
          });
          expect(appiumSawAnything()).to.equal(false);
          expect(accepted).to.deep.equal([]);
          expect(verifyKeyPair.called || verifyBearer.called || ownerOf.called).to.equal(false);
          expect(warnings).to.have.length(1);
          expect(warnings[0]).to.include('s-alice');
          expect(warnings[0]).to.include('no credentials');
        });

        it('answers the refusal with an HTTP 404 on the raw socket, then closes it', async () => {
          const reply = await rawUpgrade(port, '/wd/hub/bidi/s-alice');
          expect(reply).to.match(/^HTTP\/1\.1 404 Not Found\r\n/);
          expect(reply).not.to.include('101');
          expect(appiumSawAnything()).to.equal(false);
        });

        it("lets the owner through to Appium's handler", async () => {
          expect(await connect(port, '/wd/hub/bidi/s-alice', as('alice-token'))).to.deep.equal({
            kind: 'open',
          });
          expect(accepted).to.deep.equal(['/wd/hub/bidi/s-alice']);
          expect(warnings).to.deep.equal([]);
        });

        it("lets the owner's Bearer token through", async () => {
          expect((await connect(port, '/wd/hub/bidi/s-alice', bearer('alice-jwt'))).kind).to.equal(
            'open',
          );
        });

        it('lets an override admin attach to a session they do not own', async () => {
          expect((await connect(port, '/wd/hub/bidi/s-alice', as('carol-admin'))).kind).to.equal(
            'open',
          );
          expect((await connect(port, '/wd/hub/bidi/s-anon', bearer('root-jwt'))).kind).to.equal(
            'open',
          );
        });

        it("refuses another user, and an ADMIN's ordinary key, with 404", async () => {
          for (const who of ['bob-token', 'carol-ordinary']) {
            expect(await connect(port, '/wd/hub/bidi/s-alice', as(who)), who).to.deep.equal({
              kind: 'http',
              status: 404,
            });
          }
          expect(appiumSawAnything()).to.equal(false);
          expect(warnings.join('\n')).not.to.include('bob-token');
        });

        it('refuses everyone but override admins on a session nobody owns', async () => {
          expect(await connect(port, '/wd/hub/bidi/s-anon', as('alice-token'))).to.deep.equal({
            kind: 'http',
            status: 404,
          });
        });

        it('refuses credentials that do not verify', async () => {
          const res = await connect(port, '/wd/hub/bidi/s-alice', {
            'x-xenon-access-key': 'ak-alice',
            'x-xenon-token': 'guessed',
          });
          expect(res).to.deep.equal({ kind: 'http', status: 404 });
          expect(ownerOf.called).to.equal(false);
        });

        it("guards a driver's /ws/session/<id>/... endpoint the same way", async () => {
          const url = '/ws/session/s-alice/appium/device/logcat';
          expect(await connect(port, url, as('bob-token'))).to.deep.equal({
            kind: 'http',
            status: 404,
          });
          expect(appiumSawAnything()).to.equal(false);
          expect((await connect(port, url, as('alice-token'))).kind).to.equal('open');
          expect(accepted).to.deep.equal([url]);
        });

        it('answers a session the caller may not use exactly as one that does not exist', async () => {
          const refused = await rawUpgrade(port, '/wd/hub/bidi/s-alice');
          const missing = await rawUpgrade(port, '/wd/hub/bidi/no-such-session');
          expect(refused).to.equal(missing);
        });
      });

      describe('what it leaves alone', () => {
        it('lets the umbrella /bidi socket, which belongs to no session, through untouched', async () => {
          expect((await connect(port, '/wd/hub/bidi')).kind).to.equal('open');
          expect(verifyKeyPair.called || ownerOf.called).to.equal(false);
          expect(warnings).to.deep.equal([]);
        });

        it('does nothing at all when the setting is off (the default)', async () => {
          enabled = false;
          expect((await connect(port, '/wd/hub/bidi/s-alice')).kind).to.equal('open');
          expect(verifyKeyPair.called || verifyBearer.called || ownerOf.called).to.equal(false);
          expect(warnings.concat(errors)).to.deep.equal([]);
        });

        it('does nothing when auth is disabled, even with the setting on', async () => {
          authDisabled = true;
          expect((await connect(port, '/wd/hub/bidi/s-alice')).kind).to.equal('open');
          expect(ownerOf.called).to.equal(false);
        });

        it('leaves ordinary HTTP requests to the same paths alone', async () => {
          const res = await new Promise<number>((resolve) =>
            http.get(`http://127.0.0.1:${port}/wd/hub/bidi/s-alice`, (r) => {
              r.resume();
              resolve(r.statusCode ?? 0);
            }),
          );
          expect(res).to.equal(404);
          expect(warnings).to.deep.equal([]);
          expect(ownerOf.called).to.equal(false);
        });
      });

      describe('failing closed', () => {
        it('answers 503 when the owner lookup fails, and never hands the socket on', async () => {
          ownerOf.rejects(new Error('database is locked\nSELECT secret'));
          expect(await connect(port, '/wd/hub/bidi/s-alice', as('alice-token'))).to.deep.equal({
            kind: 'http',
            status: 503,
          });
          expect(appiumSawAnything()).to.equal(false);
          expect(errors).to.have.length(1);
          expect(errors[0]).to.include('database is locked');
          expect(errors[0]).not.to.include('SELECT');
        });

        it('answers 503 when the credential check fails', async () => {
          verifyKeyPair.rejects(new Error('database is locked'));
          expect(await connect(port, '/wd/hub/bidi/s-alice', as('alice-token'))).to.deep.equal({
            kind: 'http',
            status: 503,
          });
          expect(appiumSawAnything()).to.equal(false);
        });

        it("drops a client that leaves during the check without reaching Appium's handler or crashing", async () => {
          let release: (owner: string) => void = () => undefined;
          ownerOf.callsFake(() => new Promise<string>((resolve) => (release = resolve)));
          const socket = net.connect(port, '127.0.0.1');
          await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
          socket.on('error', () => undefined);
          socket.write(
            'GET /wd/hub/bidi/s-alice HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n' +
              'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
              'Sec-WebSocket-Version: 13\r\nx-xenon-access-key: ak-alice\r\n' +
              'x-xenon-token: alice-token\r\n\r\n',
          );
          await tick(50);
          expect(ownerOf.called, 'the check is under way').to.equal(true);
          // A reset, not a clean close: the server side sees ECONNRESET, which
          // would crash the process if nothing were listening for it.
          socket.resetAndDestroy();
          await tick(50);
          release('alice');
          await tick(50);
          expect(appiumSawAnything()).to.equal(false);
          expect(accepted).to.deep.equal([]);
        });
      });
    });
  }

  describe("next to Xenon's own upgrade listeners (Appium's Express middleware unreachable)", () => {
    // What the lab ran on Node < 22.21 before the upgrade router: Appium's
    // upgrade middleware plus Xenon's h264 and logcat listeners. With any
    // `upgrade` listener present, Node never hands an upgrade to Express, so
    // Appium's handler is not reached at all; the guard's job here is only to
    // refuse. The router's own wiring is in upgrade-router.spec.ts and
    // ws-upgrade-routing-appium-server.spec.ts.
    let server: http.Server | undefined;
    let port: number;
    let seenByListeners: Array<{ url: string; alive: boolean }>;
    let xenonAccepted: string[];
    let ownerOf: sinon.SinonStub;

    beforeEach(async () => {
      seenByListeners = [];
      xenonAccepted = [];
      ownerOf = sinon.stub().callsFake(async (id: string) => (id in OWNERS ? OWNERS[id] : null));
      const dispatch = appiumUpgradeDispatch();
      const bidi = new WebSocketServer({ noServer: true });
      const app = appiumExpress()();
      app.use(dispatch.handleUpgrade({ '/wd/hub/bidi/:sessionId': bidi }));
      const httpServer = http.createServer(app);
      registerSessionUpgradeGuard(
        httpServer,
        app,
        { basePath: '/wd/hub' },
        {
          enabled: () => true,
          authDisabled: () => false,
          verifier: new CommandCallerVerifier({
            verifyKeyPair: sinon.stub().callsFake(async (_ak: string, token: string) =>
              KEYS[token]
                ? {
                    row: {
                      id: 'k',
                      userId: KEYS[token][0],
                      scopes: KEYS[token][1],
                      expiresAt: null,
                    },
                    user: USERS[KEYS[token][0]],
                  }
                : null,
            ),
            verifyBearer: sinon.stub().resolves(null),
          }),
          ownerOf,
          logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        },
      );
      // Xenon's attachLogcatWs / attachH264Ws shape: claim their own path, ignore the rest.
      const xenonWss = new WebSocketServer({ noServer: true });
      httpServer.on('upgrade', (req, socket, head) => {
        seenByListeners.push({ url: String(req.url), alive: !socket.destroyed });
        if (!/^\/xenon\/api\/control\/[^/]+\/(logcat|stream\/h264)\?/.test(String(req.url))) return;
        xenonWss.handleUpgrade(req, socket, head, (ws) => {
          xenonAccepted.push(String(req.url));
          ws.on('error', () => undefined);
        });
      });
      server = httpServer;
      port = await listen(httpServer);
    });

    afterEach(async () => {
      const s = server;
      server = undefined;
      await shut(s);
    });

    it("leaves Xenon's ticketed WebSockets alone, with no credentials and no lookups", async () => {
      for (const url of [
        '/xenon/api/control/u1/logcat?ticket=t',
        '/xenon/api/control/u1/stream/h264?ticket=t',
      ]) {
        expect((await connect(port, url)).kind, url).to.equal('open');
      }
      expect(xenonAccepted).to.have.length(2);
      expect(ownerOf.called).to.equal(false);
    });

    it('refuses a session upgrade with 404 before any listener sees it', async () => {
      expect(await connect(port, '/wd/hub/bidi/s-alice', as('bob-token'))).to.deep.equal({
        kind: 'http',
        status: 404,
      });
      expect(seenByListeners).to.deep.equal([]);
    });

    it("hands the owner's upgrade on to the listeners, exactly as without the guard", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/wd/hub/bidi/s-alice`, {
        headers: as('alice-token'),
      });
      ws.on('error', () => undefined);
      for (let i = 0; i < 50 && seenByListeners.length === 0; i++) await tick(10);
      ws.terminate();
      expect(seenByListeners).to.deep.equal([{ url: '/wd/hub/bidi/s-alice', alive: true }]);
    });
  });
});
