import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import path from 'path';
import sinon from 'sinon';
import request from 'supertest';
import { XenonPlugin } from '../../src/plugin';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';

/**
 * createSession through the hub, with Appium's real umbrella driver.
 *
 * When the hub creates a session on a node's phone, Xenon's plugin answers
 * createSession itself and never calls next(), so the umbrella never records
 * the session. Appium (2.15 up to base-driver 10.2.0, the one installed here)
 * then promotes its sessionless plugins to that session id and builds their
 * log prefix from `this.sessions[id]`, which is undefined:
 * `generateDriverLogPrefix(undefined)` throws, and the client gets a 500 while
 * the node keeps the session.
 *
 * The stopgap is appium-device-farm's: the plugin instance that answered such
 * a createSession sets `updateLogPrefix = null`, so the promotion loop (which
 * checks `_.isFunction(p.updateLogPrefix)`) skips it. Only then, so a local
 * session's plugin keeps its per-session log prefix. PR 2 moves remote
 * creation into the session gateway and removes this.
 */

function appiumDir() {
  return path.dirname(require.resolve('appium/package.json'));
}

function appiumBaseDriver(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(require.resolve('@appium/base-driver', { paths: [appiumDir()] }));
}

describe("createSession through the hub, in Appium's real umbrella driver", function () {
  this.timeout(60_000);
  let server: http.Server | undefined;
  let umbrella: any;

  let appiumLog: { level: string } | undefined;
  let appiumLogLevel: string | undefined;
  before(() => {
    appiumBaseDriver();
    const support = require.resolve('@appium/support', { paths: [appiumDir()] });
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

  afterEach(async () => {
    sinon.restore();
    if (!server) return;
    const s = server;
    server = undefined;
    s.closeAllConnections();
    await new Promise<void>((resolve) => http.Server.prototype.close.call(s, () => resolve()));
  });

  async function boot() {
    const baseDriver = appiumBaseDriver();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppiumDriver } = require(path.join(appiumDir(), 'build/lib/appium.js'));
    umbrella = new AppiumDriver({});
    umbrella.pluginClasses = new Map([[XenonPlugin, 'xenon']]);
    server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(umbrella),
      port: 0,
      hostname: '127.0.0.1',
      basePath: '/wd/hub',
      cliArgs: {},
    });
    return server as http.Server;
  }

  const caps = { capabilities: { alwaysMatch: { platformName: 'Android' }, firstMatch: [{}] } };

  it('answers 200 with the node’s session when the plugin creates it remotely', async () => {
    // A node's phone: the lifecycle forwards to the node and never calls next().
    sinon.stub(SessionLifecycleService.prototype, 'createSession').resolves({
      protocol: 'W3C',
      value: ['node-session-1', { platformName: 'Android' }, 'W3C'],
    } as any);
    const app = await boot();
    const res = await request(app).post('/wd/hub/session').send(caps);
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(res.body.value.sessionId).to.equal('node-session-1');
    expect(res.body.value.capabilities).to.deep.equal({ platformName: 'Android' });
    // The umbrella holds no driver for it: its commands go through the gateway.
    expect(umbrella.sessions['node-session-1']).to.equal(undefined);
  });

  describe('the plugin instance', () => {
    const plugin = () => new XenonPlugin('xenon', {});

    it('drops its log-prefix hook when createSession did not reach the driver', async () => {
      sinon
        .stub(SessionLifecycleService.prototype, 'createSession')
        .resolves({ protocol: 'W3C', value: ['s', {}, 'W3C'] } as any);
      const p = plugin();
      await p.createSession(sinon.stub(), {}, {}, {}, caps.capabilities as any);
      expect((p as any).updateLogPrefix).to.equal(null);
    });

    it('keeps it when the driver created the session (a local phone)', async () => {
      sinon
        .stub(SessionLifecycleService.prototype, 'createSession')
        .callsFake(async (next: () => any) => next());
      const p = plugin();
      const next = sinon.stub().resolves({ protocol: 'W3C', value: ['s', {}, 'W3C'] });
      await p.createSession(next, {}, {}, {}, caps.capabilities as any);
      expect(next.calledOnce).to.equal(true);
      expect((p as any).updateLogPrefix).to.be.a('function');
    });

    it('keeps it when createSession failed', async () => {
      sinon.stub(SessionLifecycleService.prototype, 'createSession').rejects(new Error('no phone'));
      const p = plugin();
      let failed = false;
      try {
        await p.createSession(sinon.stub(), {}, {}, {}, caps.capabilities as any);
      } catch {
        failed = true;
      }
      expect(failed).to.equal(true);
      expect((p as any).updateLogPrefix).to.be.a('function');
    });
  });
});
