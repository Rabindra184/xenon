import { expect } from 'chai';
import { EventEmitter } from 'events';
import http from 'http';
import net from 'net';
import path from 'path';
import sinon from 'sinon';
import WebSocket, { WebSocketServer } from 'ws';
import {
  UpgradeRouter,
  appiumPatternMatcher,
  dispatchToAppiumHandlers,
  upgradeRouterFor,
} from '../../src/app/ws/upgradeRouter';
import { attachH264Ws } from '../../src/app/ws/h264StreamWs';
import { H264Multiplexer } from '../../src/device-managers/android/H264Multiplexer';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import {
  createSessionUpgradeGuard,
  guardUpgradeEvents,
} from '../../src/middleware/sessionUpgradeGuard';

/**
 * The upgrade router (src/app/ws/upgradeRouter.ts) on its own: which handler
 * each upgrade reaches, what it adds to a server, and its copy of Appium's
 * upgrade listener for Node < 22.21, checked against Appium's own dispatch.
 * ws-upgrade-routing-appium-server.spec.ts runs it inside Appium's server().
 */

/** base-driver's own upgrade dispatch (tryHandleWebSocketUpgrade), from Appium's install. */
function appiumDispatch(): any {
  const appiumDir = path.dirname(require.resolve('appium/package.json'));
  const baseDriverDir = path.dirname(
    require.resolve('@appium/base-driver/package.json', { paths: [appiumDir] }),
  );
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(baseDriverDir, 'build/lib/express/middleware'));
}

function silentAppiumLog(): () => void {
  appiumDispatch();
  const support = require.resolve('@appium/support', {
    paths: [path.dirname(require.resolve('appium/package.json'))],
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const log: { level: string } = require(
    require.resolve('@appium/logger', { paths: [support] }),
  ).default;
  const level = log.level;
  log.level = 'silent';
  return () => {
    log.level = level;
  };
}

const quiet = () => ({
  infos: [] as string[],
  warns: [] as string[],
  errors: [] as string[],
  info(m: string) {
    this.infos.push(m);
  },
  warn(m: string) {
    this.warns.push(m);
  },
  error(m: string) {
    this.errors.push(m);
  },
});

type Outcome = { kind: 'open' } | { kind: 'http'; status: number } | { kind: 'closed' };

function connect(port: number, urlPath: string) {
  return new Promise<Outcome>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${urlPath}`);
    ws.on('open', () => {
      resolve({ kind: 'open' });
      ws.terminate();
    });
    ws.on('unexpected-response', (req, res) => {
      resolve({ kind: 'http', status: res.statusCode ?? 0 });
      req.destroy();
    });
    ws.on('error', () => resolve({ kind: 'closed' }));
  });
}

async function listen(server: http.Server): Promise<{ port: number; shut: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  server.on('connection', (s: net.Socket) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    shut: async () => {
      for (const s of sockets) s.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('upgrade router', () => {
  describe("its copy of Appium's upgrade dispatch, against Appium's own", () => {
    let restoreLog: () => void;
    before(() => {
      restoreLog = silentAppiumLog();
    });
    after(() => restoreLog());

    /** Which handler each dispatch picks, or whether it threw. */
    function outcome(
      dispatch: (req: any, mapping: Record<string, any>) => boolean,
      url: string,
      upgrade: string | undefined,
      patterns: string[],
    ): string {
      const mapping: Record<string, any> = {};
      for (const p of patterns) {
        mapping[p] = { handleUpgrade: sinon.stub(), emit: sinon.stub(), name: p };
      }
      const req = { url, headers: upgrade === undefined ? {} : { upgrade } };
      try {
        const handled = dispatch(req, mapping);
        const by = patterns.filter((p) => mapping[p].handleUpgrade.called);
        return `${handled}:${by.join(',')}`;
      } catch (error: any) {
        return `threw ${error.name}`;
      }
    }

    const PATTERNS = [
      '/wd/hub/bidi',
      '/wd/hub/bidi/:sessionId',
      '/ws/session/abc-123/appium/device/logcat',
      '/ws/session/abc-123/appium/device/syslog',
    ];
    const CASES: Array<[string, string | undefined]> = [
      ['/wd/hub/bidi', 'websocket'],
      ['/wd/hub/bidi/', 'websocket'],
      ['/wd/hub/bidi/abc-123', 'websocket'],
      ['/wd/hub/bidi/abc-123/', 'websocket'],
      ['/WD/HUB/BIDI/abc-123', 'websocket'],
      ['/wd/hub/bidi/abc-123?x=1', 'websocket'],
      ['/wd/hub/bidi/abc-123/extra', 'websocket'],
      ['/wd/hub/bidi//', 'websocket'],
      ['/wd/hub/./bidi/abc-123', 'websocket'],
      ['/wd/hub/x/../bidi/abc-123', 'websocket'],
      ['/wd/hub/%2e%2e/wd/hub/bidi/abc', 'websocket'],
      ['/wd/hub/bidi/a%20b', 'websocket'],
      ['/wd/hub/bidi/%E0%A4%A', 'websocket'],
      ['/wd/hub/bidi/abc-123', 'WebSocket'],
      ['/wd/hub/bidi/abc-123', 'h2c'],
      ['/wd/hub/bidi/abc-123', undefined],
      ['http://example.com/wd/hub/bidi/abc-123', 'websocket'],
      ['/ws/session/abc-123/appium/device/logcat', 'websocket'],
      ['/ws/session/ABC-123/appium/device/logcat', 'websocket'],
      ['/ws/session/abc-123/appium/device/logcat/', 'websocket'],
      ['/ws/session/abc-123/appium/device/syslog', 'websocket'],
      ['/ws/session/other/appium/device/logcat', 'websocket'],
      ['/xenon/api/control/u1/stream/h264?ticket=t', 'websocket'],
      ['/socket.io/?EIO=4&transport=websocket', 'websocket'],
      ['', 'websocket'],
    ];

    for (const [url, upgrade] of CASES) {
      it(`picks the same handler for ${JSON.stringify(url)} (Upgrade: ${upgrade})`, () => {
        const logger = quiet();
        const theirs = outcome(
          (req, mapping) =>
            appiumDispatch().tryHandleWebSocketUpgrade(req, {}, Buffer.alloc(0), mapping),
          url,
          upgrade,
          PATTERNS,
        );
        const ours = outcome(
          (req, mapping) =>
            dispatchToAppiumHandlers(req, {} as any, Buffer.alloc(0), mapping, logger),
          url,
          upgrade,
          PATTERNS,
        );
        expect(ours).to.equal(theirs);
      });
    }

    it('takes the first matching handler, in registration order, as Appium does', () => {
      const first = { handleUpgrade: sinon.stub(), emit: sinon.stub() };
      const second = { handleUpgrade: sinon.stub(), emit: sinon.stub() };
      const handled = dispatchToAppiumHandlers(
        { url: '/wd/hub/bidi/s1', headers: { upgrade: 'websocket' } } as any,
        {} as any,
        Buffer.alloc(0),
        { '/wd/hub/bidi/:id': first as any, '/wd/hub/bidi/s1': second as any },
        quiet(),
      );
      expect(handled).to.equal(true);
      expect(first.handleUpgrade.calledOnce).to.equal(true);
      expect(second.handleUpgrade.called).to.equal(false);
    });

    it('emits connection on the handler, with the request, as Appium does', () => {
      const ws = {};
      const wss = {
        handleUpgrade: sinon.stub().callsFake((_r, _s, _h, cb) => cb(ws)),
        emit: sinon.stub(),
      };
      const req = { url: '/wd/hub/bidi', headers: { upgrade: 'websocket' } } as any;
      dispatchToAppiumHandlers(
        req,
        {} as any,
        Buffer.alloc(0),
        { '/wd/hub/bidi': wss as any },
        quiet(),
      );
      expect(wss.emit.calledOnceWithExactly('connection', ws, req)).to.equal(true);
    });

    it('skips a pattern in syntax it does not speak, and says so once', () => {
      expect(appiumPatternMatcher('/ws/{:optional}')).to.equal(null);
      expect(appiumPatternMatcher('/ws/*rest')).to.equal(null);
      const logger = quiet();
      const wss = { handleUpgrade: sinon.stub(), emit: sinon.stub() };
      for (let i = 0; i < 2; i++) {
        dispatchToAppiumHandlers(
          { url: '/ws/x', headers: { upgrade: 'websocket' } } as any,
          {} as any,
          Buffer.alloc(0),
          { '/ws/*rest': wss as any },
          logger,
        );
      }
      expect(wss.handleUpgrade.called).to.equal(false);
      expect(logger.warns).to.have.length(1);
    });

    it('matches literal text literally, regex characters included', () => {
      const matches = appiumPatternMatcher('/base.path/bidi/:id');
      expect(matches?.('/base.path/bidi/s1')).to.equal(true);
      expect(matches?.('/basexpath/bidi/s1')).to.equal(false);
    });
  });

  describe('what it adds to a server', () => {
    function fakeServer(opts: { callback: boolean; listeners: number }) {
      const server = new EventEmitter() as any;
      if (opts.callback) server.shouldUpgradeCallback = () => true;
      for (let i = 0; i < opts.listeners; i++) server.on('upgrade', () => undefined);
      return server;
    }

    it('adds nothing when Appium already listens (Node >= 22.21 / 24.9)', () => {
      const server = fakeServer({ callback: true, listeners: 1 });
      const router = new UpgradeRouter(server, quiet());
      expect(router.appiumPath).to.equal('appium-listener');
      expect(server.listenerCount('upgrade')).to.equal(1);
    });

    it("adds Appium's listener when this Node has no shouldUpgradeCallback (Node < 22.21)", () => {
      const server = fakeServer({ callback: false, listeners: 0 });
      const router = new UpgradeRouter(server, quiet());
      expect(router.appiumPath).to.equal('router-listener');
      expect(server.listenerCount('upgrade')).to.equal(1);
    });

    it('adds it on Node < 22.21 even when another listener is already there', () => {
      // Node hands no upgrade to Appium's Express middleware once any listener exists.
      const server = fakeServer({ callback: false, listeners: 1 });
      expect(new UpgradeRouter(server, quiet()).appiumPath).to.equal('router-listener');
      expect(server.listenerCount('upgrade')).to.equal(2);
    });

    it('adds a listener to a server with none, or no Node would emit upgrade at all', () => {
      const server = fakeServer({ callback: true, listeners: 0 });
      expect(new UpgradeRouter(server, quiet()).appiumPath).to.equal('router-listener');
      expect(server.listenerCount('upgrade')).to.equal(1);
    });

    it('installs once per server', () => {
      const server = http.createServer();
      const router = upgradeRouterFor(server);
      const emit = server.emit;
      const listeners = server.listenerCount('upgrade');
      expect(upgradeRouterFor(server)).to.equal(router);
      expect(server.emit).to.equal(emit);
      expect(server.listenerCount('upgrade')).to.equal(listeners);
    });

    it('leaves every other event alone', () => {
      const server = fakeServer({ callback: true, listeners: 1 });
      new UpgradeRouter(server, quiet());
      const seen: unknown[] = [];
      server.on('request', (a: unknown) => seen.push(a));
      expect(server.emit('request', 'r')).to.equal(true);
      expect(seen).to.deep.equal(['r']);
    });
  });

  describe('on a real server', () => {
    let shut: (() => Promise<void>) | undefined;
    afterEach(async () => {
      sinon.restore();
      await shut?.();
      shut = undefined;
    });

    /** A server shaped like Appium's on Node >= 22.21: its listener, destroying what it can't place. */
    function appiumLikeServer(mapping: Record<string, WebSocketServer>) {
      const server = http.createServer() as any;
      if (typeof server.shouldUpgradeCallback === 'undefined')
        server.shouldUpgradeCallback = () => true;
      server.webSocketsMapping = mapping;
      const appiumSaw: string[] = [];
      server.on('upgrade', (req: http.IncomingMessage, socket: any, head: Buffer) => {
        appiumSaw.push(String(req.url));
        if (!dispatchToAppiumHandlers(req, socket, head, server.webSocketsMapping, quiet())) {
          socket.destroy();
        }
      });
      return { server: server as http.Server, appiumSaw };
    }

    it("gives a route's upgrades to the route alone, and every other upgrade to the listeners", async () => {
      const bidi = new WebSocketServer({ noServer: true });
      const { server, appiumSaw } = appiumLikeServer({ '/bidi/:id': bidi });
      const xenon = new WebSocketServer({ noServer: true });
      const routed: string[] = [];
      upgradeRouterFor(server).add({
        name: 'test',
        matches: (req) => String(req.url).startsWith('/xenon/'),
        handle: (req, socket, head) => {
          routed.push(String(req.url));
          xenon.handleUpgrade(req, socket, head, () => undefined);
        },
      });
      const listening = await listen(server);
      shut = listening.shut;

      expect(await connect(listening.port, '/xenon/x')).to.deep.equal({ kind: 'open' });
      expect(await connect(listening.port, '/bidi/s1')).to.deep.equal({ kind: 'open' });
      expect(routed).to.deep.equal(['/xenon/x']);
      expect(appiumSaw).to.deep.equal(['/bidi/s1']);
    });

    it('adopts the upgrade listener an attach adds, and calls it only for its own path', async () => {
      const { server, appiumSaw } = appiumLikeServer({});
      const adoptedSaw: string[] = [];
      const wss = new WebSocketServer({ noServer: true });
      const result = upgradeRouterFor(server).adopt(
        'adopted',
        (req) => String(req.url).startsWith('/mine/'),
        () => {
          server.on('upgrade', (req, socket, head) => {
            adoptedSaw.push(String(req.url));
            // Like engine.io: anything not its own is ended.
            if (!String(req.url).startsWith('/mine/')) return socket.end();
            wss.handleUpgrade(req, socket as any, head, () => undefined);
          });
          return 'attached';
        },
      );
      expect(result).to.equal('attached');
      expect(server.listenerCount('upgrade')).to.equal(1); // Appium's, not the adopted one
      const listening = await listen(server);
      shut = listening.shut;

      expect(await connect(listening.port, '/mine/x')).to.deep.equal({ kind: 'open' });
      expect(await connect(listening.port, '/other')).to.deep.equal({ kind: 'closed' });
      expect(adoptedSaw).to.deep.equal(['/mine/x']);
      expect(appiumSaw).to.deep.equal(['/other']);
    });

    it('adds no route when the attach adds no listener', () => {
      const { server } = appiumLikeServer({});
      const router = upgradeRouterFor(server);
      router.adopt(
        'nothing',
        () => true,
        () => undefined,
      );
      expect(router.routeFor({ url: '/anything' } as any)).to.equal(undefined);
    });

    it("closes the socket and keeps the process up when a route's handler throws", async () => {
      const { server } = appiumLikeServer({});
      const router = upgradeRouterFor(server);
      const errors = sinon.stub((router as any).logger, 'error');
      router.add({
        name: 'broken',
        matches: () => true,
        handle: () => {
          throw new Error('boom');
        },
      });
      const listening = await listen(server);
      shut = listening.shut;
      expect(await connect(listening.port, '/x')).to.deep.equal({ kind: 'closed' });
      expect(errors.calledOnce).to.equal(true);
      expect(String(errors.firstCall.args[0])).to.match(/broken.*boom/);
    });

    it('closes the socket and keeps the process up on a malformed udid in a Xenon path', async () => {
      // parseH264WsPath decodes the udid, and decodeURIComponent throws on a
      // malformed escape. Out of a plain `upgrade` listener that ended the process.
      const { server } = appiumLikeServer({});
      const redeem = sinon.stub().resolves({ actorId: 'a' });
      attachH264Ws(server, { redeem, startStream: async () => new H264Multiplexer() });
      sinon.stub((upgradeRouterFor(server) as any).logger, 'error');
      const listening = await listen(server);
      shut = listening.shut;
      expect(
        await connect(listening.port, '/xenon/api/control/%E0%A4%A/stream/h264?ticket=t'),
      ).to.deep.equal({ kind: 'closed' });
      expect(
        await connect(listening.port, '/xenon/api/control/ok/stream/h264?ticket=t'),
      ).to.deep.equal({ kind: 'open' });
      expect(redeem.callCount).to.equal(1);
    });

    it("closes the socket and keeps the process up when Appium's own dispatch throws", async () => {
      // path-to-regexp decodes a matched parameter; a malformed escape throws
      // out of Appium's listener on Node >= 22.21.
      const restoreLog = silentAppiumLog();
      try {
        const server = http.createServer() as any;
        if (typeof server.shouldUpgradeCallback === 'undefined')
          server.shouldUpgradeCallback = () => true;
        const mapping = { '/bidi/:id': new WebSocketServer({ noServer: true }) };
        server.on('upgrade', (req: any, socket: any, head: Buffer) => {
          if (!appiumDispatch().tryHandleWebSocketUpgrade(req, socket, head, mapping))
            socket.destroy();
        });
        sinon.stub((upgradeRouterFor(server) as any).logger, 'error');
        const listening = await listen(server);
        shut = listening.shut;
        expect(await connect(listening.port, '/bidi/%E0%A4%A')).to.deep.equal({ kind: 'closed' });
        expect(await connect(listening.port, '/bidi/s1')).to.deep.equal({ kind: 'open' });
      } finally {
        restoreLog();
      }
    });

    for (const order of ['guard first', 'router first'] as const) {
      it(`keeps the session guard in front of Appium, and out of Xenon's way (${order})`, async () => {
        const bidi = new WebSocketServer({ noServer: true });
        const { server, appiumSaw } = appiumLikeServer({ '/bidi/:id': bidi });
        const ownerOf = sinon.stub().resolves('alice');
        const guard = createSessionUpgradeGuard('', {
          enabled: () => true,
          authDisabled: () => false,
          verifier: new CommandCallerVerifier({
            verifyKeyPair: sinon.stub().resolves(null),
            verifyBearer: sinon.stub().resolves(null),
          }),
          ownerOf,
          ownersOf: async () => new Map(),
          logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        });
        const route = {
          name: 'xenon',
          matches: (req: http.IncomingMessage) => String(req.url).startsWith('/xenon/'),
          handle: (req: http.IncomingMessage, socket: any, head: Buffer) =>
            new WebSocketServer({ noServer: true }).handleUpgrade(
              req,
              socket,
              head,
              () => undefined,
            ),
        };
        if (order === 'guard first') {
          guardUpgradeEvents(server, guard);
          upgradeRouterFor(server).add(route);
        } else {
          upgradeRouterFor(server).add(route);
          guardUpgradeEvents(server, guard);
        }
        const listening = await listen(server);
        shut = listening.shut;

        expect(await connect(listening.port, '/bidi/s1')).to.deep.equal({
          kind: 'http',
          status: 404,
        });
        expect(await connect(listening.port, '/xenon/x')).to.deep.equal({ kind: 'open' });
        expect(appiumSaw).to.deep.equal([]);
      });
    }
  });
});
