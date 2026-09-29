import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import sinon from 'sinon';
import request from 'supertest';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import log from '../../src/logger';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { commandAuthDeps, registerSessionGateway } from '../../src/app/registerCommandAuth';
import {
  FAKE_AUTOMATION,
  appiumBaseDriver,
  quietAppiumLogs,
  umbrellaWith,
} from '../helpers/appium-umbrella';

/**
 * createSession on a node's phone, against Appium's real umbrella driver
 * (base-driver 10.2.0, the one installed here).
 *
 * The umbrella can't hold a session another server runs. If Xenon's plugin
 * answers such a createSession itself, without calling next(), the umbrella
 * never records the session, then promotes its sessionless plugins to that id
 * and builds their log prefix from `this.sessions[id]`, which is undefined:
 * `generateDriverLogPrefix(undefined)` throws and the client gets a 500 while
 * the node keeps the session (Appium 2.15 up to base-driver 10.2.0). Later
 * base-drivers don't throw, but still leave the promoted plugin behind.
 *
 * So the session gateway creates it, in front of Appium's route, and answers
 * it there: the umbrella never sees it. The guard below keeps the old failure
 * reproducible, so the gateway is shown to be what prevents it.
 */
describe('createSession on a node’s phone, in Appium’s real umbrella driver', function () {
  this.timeout(60_000);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  let server: http.Server | undefined;
  let umbrella: any;
  let appiumLogs: { restore(): void };

  before(() => {
    appiumLogs = quietAppiumLogs();
  });
  after(() => appiumLogs.restore());

  afterEach(async () => {
    sinon.restore();
    if (!server) return;
    const s = server;
    server = undefined;
    s.closeAllConnections();
    await new Promise<void>((resolve) => http.Server.prototype.close.call(s, () => resolve()));
  });

  async function boot(opts: { gateway: boolean }) {
    const baseDriver = appiumBaseDriver();
    umbrella = umbrellaWith([[XenonPlugin, 'xenon']]);
    server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(umbrella),
      port: 0,
      hostname: '127.0.0.1',
      basePath: '/wd/hub',
      cliArgs: { basePath: '/wd/hub' },
      serverUpdaters: opts.gateway
        ? [
            (app: any) =>
              registerSessionGateway(
                app,
                { basePath: '/wd/hub' },
                commandAuthDeps({ enabled: () => false, authDisabled: () => false, logger: quiet }),
                { create: { lifecycle: () => Container.get(SessionLifecycleService) } },
              ),
          ]
        : [],
    });
    return server as http.Server;
  }

  const caps = {
    capabilities: {
      alwaysMatch: { platformName: 'Android', 'appium:automationName': FAKE_AUTOMATION },
      firstMatch: [{}],
    },
  };
  const remoteAllocation = { remote: true, device: { udid: 'node-phone' } } as any;
  const nodeSession = {
    protocol: 'W3C',
    value: ['node-session-1', { platformName: 'Android' }, 'W3C'],
  } as any;

  it('through the gateway, never reaches Appium’s createSession and leaves no plugin behind', async () => {
    sinon.stub(SessionLifecycleService.prototype, 'prepareSession').resolves(remoteAllocation);
    sinon.stub(SessionLifecycleService.prototype, 'completeRemoteSession').resolves(nodeSession);
    const app = await boot({ gateway: true });
    const umbrellaCommands = sinon.spy(umbrella, 'executeCommand');
    const pluginCreate = sinon.spy(XenonPlugin.prototype, 'createSession');

    const res = await request(app).post('/wd/hub/session').send(caps);
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(res.body).to.deep.equal({
      value: { capabilities: { platformName: 'Android' }, sessionId: 'node-session-1' },
    });
    expect(umbrellaCommands.called, 'the umbrella').to.equal(false);
    expect(pluginCreate.called, 'the plugin').to.equal(false);
    expect(umbrella.sessions).to.deep.equal({});
    expect(umbrella.sessionlessPlugins).to.deep.equal([]);
    expect(umbrella.sessionPlugins).to.deep.equal({});
  });

  it('guard: without the gateway, a plugin that answers it itself still gets Appium’s 500', async () => {
    // What the plugin did before the gateway: create on the node, never call next().
    sinon.stub(SessionLifecycleService.prototype, 'createSession').resolves(nodeSession);
    const app = await boot({ gateway: false });
    const res = await request(app).post('/wd/hub/session').send(caps);
    expect(res.status).to.equal(500);
    expect(res.body.value.message).to.include(
      "Cannot read properties of undefined (reading 'constructor')",
    );
  });

  it('the plugin no longer drops its log-prefix hook (the stopgap is gone)', async () => {
    sinon.stub(SessionLifecycleService.prototype, 'createSession').resolves(nodeSession);
    const plugin = new XenonPlugin('xenon', {});
    await plugin.createSession(sinon.stub(), {}, {}, {}, caps.capabilities as any);
    expect((plugin as any).updateLogPrefix).to.be.a('function');
  });

  describe('when a create reaches the plugin without the gateway', () => {
    it('a node’s phone is refused and given back, never answered for Appium', async () => {
      sinon.stub(SessionLifecycleService.prototype, 'prepareSession').resolves(remoteAllocation);
      const forward = sinon.stub(SessionLifecycleService.prototype, 'completeRemoteSession');
      const release = sinon.stub(SessionLifecycleService.prototype, 'releaseAllocation').resolves();
      const app = await boot({ gateway: false });
      const res = await request(app).post('/wd/hub/session').send(caps);
      expect(res.status).to.equal(500);
      expect(res.body.value.error).to.equal('session not created');
      expect(res.body.value.message).to.include('session gateway');
      expect(forward.called, 'forwarded to the node').to.equal(false);
      expect(release.calledOnceWith(remoteAllocation)).to.equal(true);
    });

    it('a local phone is still created, by the plugin, and says so', async () => {
      sinon
        .stub(SessionLifecycleService.prototype, 'prepareSession')
        .resolves({ remote: false, device: { udid: 'hub-phone' } } as any);
      sinon
        .stub(SessionLifecycleService.prototype, 'completeLocalSession')
        .callsFake(async (_allocation: any, next: () => any) => next());
      // The umbrella makes the plugin instance on this request, with this logger.
      const warnings: string[] = [];
      const scope = log.scope.bind(log);
      sinon.stub(log, 'scope').callsFake((name: string) => {
        const scoped = scope(name);
        if (name !== 'Plugin') return scoped;
        return Object.assign(Object.create(scoped), {
          warn: (message: string) => warnings.push(message),
        });
      });
      const app = await boot({ gateway: false });
      const res = await request(app).post('/wd/hub/session').send(caps);
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(Object.keys(umbrella.sessions)).to.deep.equal([res.body.value.sessionId]);
      expect(warnings.join('\n')).to.include('session gateway');
    });
  });
});
