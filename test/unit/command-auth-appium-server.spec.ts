import { expect } from 'chai';
import http from 'http';
import path from 'path';
import sinon from 'sinon';
import request from 'supertest';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import { UNKNOWN_SESSION_BODY } from '../../src/middleware/commandAuth';
import { registerCommandAuth } from '../../src/app/registerCommandAuth';

/**
 * Per-command auth inside Appium 3's own server.
 *
 * This boots base-driver's `server()`, the function Appium's main uses, with
 * Appium's own WebDriver routes (`routeConfiguringFunction`) around a small
 * fake driver, and registerCommandAuth as a server updater. So the app is
 * Express 5 as Appium builds it: its middleware, then every WebDriver route,
 * then the plugin updaters, then its catch-all 404. The fake driver records
 * each command that reaches it, which shows whether the check ran first.
 */

const EXACT_UNKNOWN_SESSION = JSON.stringify(UNKNOWN_SESSION_BODY);
const LIVE_SESSION = 'live-session';

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
  let warnings: string[];

  async function boot() {
    const baseDriver = appiumBaseDriver();
    commands = [];
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
        return 'about:blank';
      },
    };
    const verifier = new CommandCallerVerifier({
      verifyKeyPair: sinon.stub().callsFake(async (_ak: string, token: string) =>
        token === 'alice-token'
          ? {
              row: { id: 'k', userId: 'alice', scopes: 'sessions', expiresAt: null },
              user: { id: 'alice', role: 'MEMBER', status: 'ACTIVE' },
            }
          : null,
      ),
      verifyBearer: sinon.stub().resolves(null),
    });
    server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(driver),
      port: 0,
      hostname: '127.0.0.1',
      basePath: '/wd/hub',
      // Appium hands plugins the raw CLI args; the base path here is normalised
      // by registerCommandAuth itself.
      cliArgs: { basePath: 'wd/hub/' },
      serverUpdaters: [
        (app: any, _httpServer: any, cliArgs: any) => {
          registerCommandAuth(app, cliArgs, {
            enabled: () => enabled,
            authDisabled: () => false,
            verifier,
            ownerOf: async (id: string) => (id === LIVE_SESSION ? 'alice' : null),
            logger: {
              info: () => undefined,
              warn: (m: string) => warnings.push(m),
              error: () => undefined,
            },
          });
        },
      ],
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
});
