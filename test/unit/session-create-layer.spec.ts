import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import request from 'supertest';
import { errors } from '@appium/base-driver';
import { createSessionCreateLayer } from '../../src/gateway/sessionCreate';
import { currentCreateHandoff } from '../../src/gateway/createHandoff';
import { HUB_TOKEN_HEADER, HubTokenUnavailableError } from '../../src/gateway/hubSessionToken';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * `POST <basePath>/session` in the session gateway: allocation happens here,
 * before Appium's route. A remote phone's session is created on its node and
 * answered here; a local phone's allocation goes on to the plugin through the
 * request's async context, and is given back if nothing takes it.
 *
 * Appium's route is stood in for by a plain route, and the plugin by a
 * function that takes the handoff, the way XenonPlugin.createSession does.
 */
describe('the session gateway’s create layer', () => {
  const loopback = loopbackServers();
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  let lifecycle: any;
  let routeHits: Array<{ headers: any; body: any; took?: any }>;
  let pluginTakes: boolean;
  let base: string;

  const grant = { userId: 'alice', udid: 'phone-1', host: 'http://node:4725' };
  const caps = () => ({
    capabilities: { alwaysMatch: { platformName: 'Android' }, firstMatch: [{}] },
  });

  beforeEach(() => {
    routeHits = [];
    pluginTakes = true;
    lifecycle = {
      prepareSession: sinon.stub().resolves({ remote: false, device: { udid: 'phone-1' } }),
      completeRemoteSession: sinon
        .stub()
        .resolves({ protocol: 'W3C', value: ['node-s1', { platformName: 'Android' }, 'W3C'] }),
      releaseAllocation: sinon.stub().resolves(),
    };
  });

  afterEach(async () => {
    sinon.restore();
    await loopback.closeAll();
  });

  async function serve(
    opts: {
      basePath?: string;
      hubGrants?: { verifyCreate: (token: string) => Promise<any> };
      authDisabled?: boolean;
      beforeRoute?: express.RequestHandler;
    } = {},
  ) {
    const basePath = opts.basePath ?? '/wd/hub';
    const app = express();
    app.use(express.json());
    app.use(
      `${basePath}/session`,
      createSessionCreateLayer({
        lifecycle: () => lifecycle,
        hubGrants: opts.hubGrants,
        authDisabled: () => !!opts.authDisabled,
        logger: quiet,
      }),
    );
    if (opts.beforeRoute) app.use(opts.beforeRoute);
    // Appium's route, with the plugin inside it.
    app.post(`${basePath}/session`, async (req, res) => {
      const hit: any = { headers: { ...req.headers }, body: req.body };
      routeHits.push(hit);
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (pluginTakes) hit.took = currentCreateHandoff()?.take();
      res.json({ value: { sessionId: 'local-s1', capabilities: {} } });
    });
    app.all('*', (_req, res) => res.status(404).json({ value: { error: 'unknown command' } }));
    const server = await loopback.serve(app);
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    return base;
  }

  describe('what it handles', () => {
    it('only a POST of exactly the create path', async () => {
      await serve();
      await request(base).get('/wd/hub/session').expect(404);
      await request(base).post('/wd/hub/session/abc/url').send({}).expect(404);
      await request(base).post('/wd/hub/sessionx').send(caps()).expect(404);
      expect(lifecycle.prepareSession.called).to.equal(false);
    });

    it('a body without a capabilities object goes straight on, for Appium to answer', async () => {
      await serve();
      await request(base).post('/wd/hub/session').send({ desiredCapabilities: {} }).expect(200);
      await request(base).post('/wd/hub/session').send({ capabilities: 'no' }).expect(200);
      expect(lifecycle.prepareSession.called).to.equal(false);
    });

    it('matches the path as the router does: letter case, a trailing slash, any base path', async () => {
      await serve({ basePath: '' });
      await request(base).post('/SESSION/').send(caps()).expect(200);
      expect(lifecycle.prepareSession.calledOnce).to.equal(true);
    });

    it('fills in an omitted firstMatch, as the plugin used to', async () => {
      await serve();
      await request(base)
        .post('/wd/hub/session')
        .send({ capabilities: { alwaysMatch: { platformName: 'Android' } } })
        .expect(200);
      expect(lifecycle.prepareSession.firstCall.args[0].firstMatch).to.deep.equal([{}]);
      expect(routeHits[0].body.capabilities.firstMatch).to.deep.equal([{}]);
    });
  });

  describe('a remote phone', () => {
    beforeEach(() => lifecycle.prepareSession.resolves({ remote: true }));

    it('is created on its node and answered here, as Appium answers a new session', async () => {
      await serve();
      const res = await request(base).post('/wd/hub/session').send(caps());
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
      expect(res.body).to.deep.equal({
        value: { capabilities: { platformName: 'Android' }, sessionId: 'node-s1' },
      });
      expect(routeHits, 'Appium’s route').to.deep.equal([]);
      expect(lifecycle.completeRemoteSession.calledOnce).to.equal(true);
    });

    it('a failure is answered as Appium answers the error', async () => {
      lifecycle.completeRemoteSession.rejects(new errors.SessionNotCreatedError('node said no'));
      await serve();
      const res = await request(base).post('/wd/hub/session').send(caps());
      expect(res.status).to.equal(500);
      expect(res.body.value.error).to.equal('session not created');
      expect(res.body.value.message).to.include('node said no');
      expect(routeHits).to.deep.equal([]);
    });
  });

  describe('a refusal before any phone is allocated', () => {
    it('is answered as Appium answers the error, and Appium never sees the request', async () => {
      lifecycle.prepareSession.rejects(new errors.InvalidArgumentError('session rejected: no'));
      await serve();
      const res = await request(base).post('/wd/hub/session').send(caps());
      expect(res.status).to.equal(400);
      expect(res.body.value).to.include({ error: 'invalid argument' });
      expect(res.body.value.message).to.include('session rejected: no');
      expect(routeHits).to.deep.equal([]);
    });

    it('a plain error is an unknown error', async () => {
      lifecycle.prepareSession.rejects(new Error('No device matching request.'));
      await serve();
      const res = await request(base).post('/wd/hub/session').send(caps());
      expect(res.status).to.equal(500);
      expect(res.body.value.error).to.equal('unknown error');
    });
  });

  describe('a local phone', () => {
    it('its allocation reaches the plugin through Appium’s route, and is not given back', async () => {
      await serve();
      await request(base).post('/wd/hub/session').send(caps()).expect(200);
      expect(routeHits[0].took).to.deep.equal({ remote: false, device: { udid: 'phone-1' } });
      expect(lifecycle.prepareSession.calledOnce).to.equal(true);
      expect(lifecycle.releaseAllocation.called).to.equal(false);
    });

    it('is given back once when Appium answers without the plugin taking it', async () => {
      pluginTakes = false;
      await serve();
      await request(base).post('/wd/hub/session').send(caps()).expect(200);
      await new Promise((resolve) => setImmediate(resolve));
      expect(lifecycle.releaseAllocation.callCount).to.equal(1);
      expect(lifecycle.releaseAllocation.firstCall.args[0].device.udid).to.equal('phone-1');
    });

    it('is given back, and Appium never called, when the client left while it waited', async () => {
      let allocated!: () => void;
      lifecycle.prepareSession.callsFake(
        () =>
          new Promise((resolve) => {
            allocated = () => resolve({ remote: false, device: { udid: 'phone-1' } });
          }),
      );
      await serve();
      const req = request(base).post('/wd/hub/session').send(caps()).timeout(50);
      await req.then(
        () => undefined,
        () => undefined,
      );
      // The server sees the connection close, then the phone turns up.
      await new Promise((resolve) => setTimeout(resolve, 20));
      allocated();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(lifecycle.releaseAllocation.callCount).to.equal(1);
      expect(routeHits).to.deep.equal([]);
    });
  });

  describe('on a node: the hub’s token', () => {
    it('a valid one is the grant the node allocates by; the header goes no further', async () => {
      const verifyCreate = sinon.stub().resolves(grant);
      await serve({ hubGrants: { verifyCreate } });
      await request(base)
        .post('/wd/hub/session')
        .set(HUB_TOKEN_HEADER, 'good-token')
        .send(caps())
        .expect(200);
      expect(verifyCreate.calledOnceWith('good-token')).to.equal(true);
      expect(lifecycle.prepareSession.firstCall.args[1]).to.deep.equal({ hubGrant: grant });
      expect(routeHits[0].headers[HUB_TOKEN_HEADER]).to.equal(undefined);
    });

    it('an invalid one is refused, and nothing is allocated', async () => {
      await serve({ hubGrants: { verifyCreate: async () => null } });
      const res = await request(base)
        .post('/wd/hub/session')
        .set(HUB_TOKEN_HEADER, 'forged')
        .send(caps());
      expect(res.status).to.equal(400);
      expect(res.body.value.error).to.equal('invalid argument');
      expect(res.body.value.message).to.include('session rejected');
      expect(lifecycle.prepareSession.called).to.equal(false);
      expect(routeHits).to.deep.equal([]);
    });

    it('one that cannot be checked is a 503, and nothing is allocated', async () => {
      await serve({
        hubGrants: {
          verifyCreate: async () => {
            throw new HubTokenUnavailableError('hub down');
          },
        },
      });
      const res = await request(base)
        .post('/wd/hub/session')
        .set(HUB_TOKEN_HEADER, 'token')
        .send(caps());
      expect(res.status).to.equal(503);
      expect(res.body.value.error).to.equal('unknown error');
      expect(lifecycle.prepareSession.called).to.equal(false);
    });

    it('with auth disabled it is not checked, only removed', async () => {
      const verifyCreate = sinon.stub().resolves(null);
      await serve({ hubGrants: { verifyCreate }, authDisabled: true });
      await request(base)
        .post('/wd/hub/session')
        .set(HUB_TOKEN_HEADER, 'anything')
        .send(caps())
        .expect(200);
      expect(verifyCreate.called).to.equal(false);
      expect(lifecycle.prepareSession.firstCall.args[1]).to.deep.equal({});
      expect(routeHits[0].headers[HUB_TOKEN_HEADER]).to.equal(undefined);
    });

    it('a hub, which checks no hub tokens, ignores and removes one', async () => {
      await serve();
      await request(base)
        .post('/wd/hub/session')
        .set(HUB_TOKEN_HEADER, 'anything')
        .send(caps())
        .expect(200);
      expect(lifecycle.prepareSession.firstCall.args[1]).to.deep.equal({});
      expect(routeHits[0].headers[HUB_TOKEN_HEADER]).to.equal(undefined);
    });
  });
});
