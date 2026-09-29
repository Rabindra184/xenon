import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import { RemoteSession } from '../../src/sessions/RemoteSession';
import { CloudSession } from '../../src/sessions/CloudSession';
import { LocalSession } from '../../src/sessions/LocalSession';
import { HealthErrorType } from '../../src/sessions/XenonSession';
import { HUB_TOKEN_HEADER, HubSessionTokenIssuer } from '../../src/gateway/hubSessionToken';
import { INTERNAL_CALL_HEADER, internalCallHeaders } from '../../src/gateway/internalCall';
import { NodeSessionProbeSupport } from '../../src/gateway/nodeSessionStatus';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * The calls a session object makes about its session over HTTP.
 *
 * A RemoteSession's go to the node, with the hub's session token for that
 * session, so a node with per-command auth on accepts them (the heartbeat's
 * probe among them). A cloud provider is not a Xenon node and never gets one.
 * A LocalSession's go to this server's own `/wd-internal` path with the
 * per-process secret, never through an HTTP proxy, and its heartbeat asks the
 * in-process driver instead of sending a command.
 */
describe('session calls to the server that runs the session', () => {
  const loopback = loopbackServers();
  let seen: Array<{ method: string; url: string; headers: Record<string, unknown> }>;
  let port: number;
  let restore: () => void;
  const env = { ...process.env };

  const device = { udid: 'u1', host: 'http://10.0.0.7:4725', platform: 'android' } as any;

  beforeEach(async () => {
    seen = [];
    const app = express();
    app.use(express.json());
    app.all('*', (req, res) => {
      seen.push({ method: req.method, url: req.originalUrl, headers: req.headers });
      res.json({ value: req.path.endsWith('/source') ? '<hierarchy/>' : 'ok' });
    });
    const server = await loopback.serve(app);
    port = (server.address() as any).port;

    restore = saveRegistrations(HubSessionTokenIssuer, NodeSessionProbeSupport);
    const probes = new NodeSessionProbeSupport();
    probes.logger = { warn: () => undefined };
    Container.set(NodeSessionProbeSupport, probes);
    const issuer = new HubSessionTokenIssuer();
    issuer.useSigner({ sign: async (claims: any) => `hub-token-for-${claims.sid}` });
    Container.set(HubSessionTokenIssuer, issuer);
  });

  afterEach(async () => {
    process.env = { ...env };
    sinon.restore();
    restore();
    await loopback.closeAll();
  });

  function remote(Type: typeof RemoteSession = RemoteSession) {
    return new Type({
      sessionId: 's-1',
      device,
      sessionResponse: {},
      xenonOption: {},
      baseUrl: `http://127.0.0.1:${port}/node-base`,
    });
  }

  describe('RemoteSession (hub to node)', () => {
    it('sends the hub’s session token on every call, the heartbeat probe included', async () => {
      const session = remote();
      await session.getScreenShot();
      await session.getPageSource();
      await session.startVideoRecording({ resolution: '720x1280' });
      await session.stopVideoRecording();
      await session.startPerformanceRecording();
      await session.stopPerformanceRecording();
      const health = await session.checkHealth();
      expect(health.isHealthy).to.equal(true);

      expect(seen.map((r) => `${r.method} ${r.url}`)).to.deep.equal([
        'GET /node-base/session/s-1/screenshot',
        'GET /node-base/session/s-1/source',
        'POST /node-base/session/s-1/appium/start_recording_screen',
        'POST /node-base/session/s-1/appium/stop_recording_screen',
        'POST /node-base/session/s-1/execute/sync',
        'POST /node-base/session/s-1/execute/sync',
        // This node has no session-status route (no NODE_SESSION_STATUS_HEADER
        // on its answer), so the heartbeat falls back to the WebDriver probe.
        'GET /xenon/api/node/sessions/s-1',
        'GET /node-base/session/s-1/timeouts',
      ]);
      for (const r of seen) expect(r.headers[HUB_TOKEN_HEADER]).to.equal('hub-token-for-s-1');
      for (const r of seen) expect(r.headers[INTERNAL_CALL_HEADER]).to.equal(undefined);
    });

    it('goes without a token when the hub cannot sign one', async () => {
      Container.get(HubSessionTokenIssuer).useSigner({
        sign: async () => {
          throw new Error('JWT key service not initialized');
        },
      });
      sinon.stub((Container.get(HubSessionTokenIssuer) as any).logger, 'warn');
      await remote().getPageSource();
      expect(seen).to.have.length(1);
      expect(seen[0].headers[HUB_TOKEN_HEADER]).to.equal(undefined);
    });

    it('says the node’s WebDriver URL it was made with', () => {
      expect((remote() as any).getWebDriverUrl()).to.equal(`http://127.0.0.1:${port}/node-base`);
    });
  });

  describe('CloudSession (hub to a cloud provider)', () => {
    it('never sends a hub token to a cloud provider', async () => {
      await remote(CloudSession).getPageSource();
      await remote(CloudSession).checkHealth();
      expect(seen).to.have.length(2);
      for (const r of seen) expect(r.headers[HUB_TOKEN_HEADER]).to.equal(undefined);
    });
  });

  describe('LocalSession (this server)', () => {
    function local(driver: Record<string, unknown> = {}) {
      return new LocalSession({
        sessionId: 's-1',
        device: { ...device, host: `http://127.0.0.1:${port}` },
        sessionResponse: {},
        xenonOption: {},
        driver: {
          opts: { address: '0.0.0.0', port, basePath: '/wd/hub' },
          sessions: {},
          ...driver,
        },
      });
    }

    it('falls back to /wd-internal with the secret, and never through a proxy', async () => {
      // A proxy in the environment would receive the secret; it must be skipped.
      process.env.HTTP_PROXY = 'http://127.0.0.1:1';
      process.env.http_proxy = 'http://127.0.0.1:1';
      delete process.env.NO_PROXY;
      delete process.env.no_proxy;
      const session = local();
      expect(await session.getPageSource()).to.equal('<hierarchy/>');
      await session.stopVideoRecording();

      expect(seen.map((r) => `${r.method} ${r.url}`)).to.deep.equal([
        'GET /wd/hub/wd-internal/session/s-1/source',
        'POST /wd/hub/wd-internal/session/s-1/appium/stop_recording_screen',
      ]);
      const secret = internalCallHeaders()[INTERNAL_CALL_HEADER];
      for (const r of seen) {
        expect(r.headers[INTERNAL_CALL_HEADER]).to.equal(secret);
        expect(r.headers[HUB_TOKEN_HEADER]).to.equal(undefined);
      }
    });

    it('checks its health in process: no command, so no new-command timeout is reset', async () => {
      const exists = sinon.stub().returns(true);
      const healthy = await local({ sessionExists: exists }).checkHealth();
      expect(healthy).to.deep.include({ isHealthy: true, errorType: HealthErrorType.NONE });
      exists.returns(false);
      const gone = await local({ sessionExists: exists }).checkHealth();
      expect(gone).to.deep.include({
        isHealthy: false,
        errorType: HealthErrorType.SESSION_NOT_FOUND,
      });
      expect(exists.alwaysCalledWith('s-1')).to.equal(true);
      expect(seen).to.deep.equal([]);
    });
  });
});
