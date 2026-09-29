import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import * as deviceService from '../../src/data-service/device-service';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import SessionType from '../../src/enums/SessionType';
import { NodeBasePathResolver, webdriverInfoHandler } from '../../src/gateway/nodeWebDriverUrl';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * A session the hub creates on a node's phone (today's createSession path,
 * through the plugin):
 * - it is created under the node's own base path, which need not be the hub's;
 * - it is registered in SESSION_MANAGER whatever the dashboard and video
 *   settings, because that is where the session gateway finds it.
 */
describe('a session the hub creates on a node', () => {
  const loopback = loopbackServers();
  let nodeOrigin: string;
  let created: Array<{ url: string; body: any }>;
  let context: PluginContext;
  let saved: Partial<PluginContext>;
  let restore: () => void;
  const SESSION = 'node-session-1';

  beforeEach(async () => {
    created = [];
    const node = express();
    node.use(express.json());
    // The node's Appium runs at the root; the hub's at /wd/hub.
    node.get(
      '/xenon/api/webdriver',
      webdriverInfoHandler(() => ''),
    );
    node.post('/session', (req, res) => {
      created.push({ url: req.originalUrl, body: req.body });
      res.json({ value: { sessionId: SESSION, capabilities: { platformName: 'Android' } } });
    });
    const server = await loopback.serve(node);
    nodeOrigin = `http://127.0.0.1:${(server.address() as any).port}`;

    restore = saveRegistrations(NodeBasePathResolver);
    Container.set(NodeBasePathResolver, new NodeBasePathResolver());
    context = Container.get(PluginContext);
    saved = { ...context };
    context.pluginArgs = { ...DefaultPluginArgs, enableDashboard: false } as any;
    context.nodeId = 'hub-node-id';
    context.nodeBasePath = '/wd/hub';
    sinon.stub(deviceService, 'updatedAllocatedDevice').resolves();
  });

  afterEach(async () => {
    SESSION_MANAGER.removeSession(SESSION);
    Object.assign(context, saved);
    sinon.restore();
    restore();
    await loopback.closeAll();
  });

  const device = () =>
    ({ udid: 'u1', host: nodeOrigin, nodeId: 'node-peer', platform: 'android' }) as any;
  const caps = {
    alwaysMatch: { platformName: 'Android', 'xe:options': { recordVideo: false } },
    firstMatch: [{}],
  };

  it('is created under the node’s own base path', async () => {
    const svc = new SessionLifecycleService();
    const response = await svc.forwardSessionRequest(device(), caps as any);
    expect(created.map((c) => c.url)).to.deep.equal(['/session']);
    expect((response as any).value[0]).to.equal(SESSION);
  });

  it('is registered in SESSION_MANAGER with the node’s URL, with the dashboard and video off', async () => {
    const svc = new SessionLifecycleService();
    sinon.stub(svc as any, 'getFreshDevice').callsFake(async (d: any) => d);
    await (svc as any).finalizeSession(
      { protocol: 'W3C', value: [SESSION, { platformName: 'Android' }, 'W3C'] },
      device(),
      caps,
      {},
      true,
    );
    const session = SESSION_MANAGER.getSession(SESSION) as any;
    expect(session, 'registered').to.not.equal(undefined);
    expect(session.getType()).to.equal(SessionType.REMOTE);
    expect(session.getWebDriverUrl()).to.equal(nodeOrigin);
  });
});
