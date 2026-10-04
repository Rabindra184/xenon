import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import webhook from '../../src/app/routers/webhook';
import recordings from '../../src/app/routers/recordings';
import { NotificationService } from '../../src/services/NotificationService';
import dashboard from '../../src/app/routers/dashboard';
import ConfigRouter from '../../src/app/routers/config';
import { WebConfigService } from '../../src/data-service/web-config-service';
import { AI_SERVICE } from '../../src/services/AIService';
import grid from '../../src/app/routers/grid';
import { SessionManager } from '../../src/sessions/SessionManager';
import { prisma } from '../../src/prisma';
import { csrfMiddleware } from '../../src/middleware/csrfMiddleware';
import { config } from '../../src/config';

/**
 * Scopes on the routes that didn't ask for one, and the same-origin check for
 * bearer callers. Through 2.12 an admin's `read`-only key could list every
 * webhook URL, and any member's could start and stop recordings; and a bearer
 * token (SDK, MCP tools) was refused every change it sent without a
 * browser's Origin header.
 */

type Caller = { role: 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN'; scopes: string };

function appAs(caller: Caller, mount: (router: express.Router) => void) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = { kind: 'api-key', userId: 'usr_x', rateLimit: 1000, ...caller };
    next();
  });
  const router = express.Router();
  mount(router);
  app.use(router);
  return app;
}

describe('access scopes', () => {
  afterEach(() => sinon.restore());

  describe('GET /webhook', () => {
    const app = (scopes: string) => appAs({ role: 'ADMIN', scopes }, (r) => webhook.register(r));

    it("refuses an admin's key without the admin scope", async () => {
      const list = sinon.stub(Container.get(NotificationService), 'getConfigs').resolves([]);
      const r = await request(app('read')).get('/webhook').timeout(5000);
      expect(r.status).to.equal(403);
      expect(list.called).to.equal(false);
    });

    it('answers an admin with the admin scope', async () => {
      sinon.stub(Container.get(NotificationService), 'getConfigs').resolves([]);
      const r = await request(app('admin')).get('/webhook').timeout(5000);
      expect(r.status).to.equal(200);
    });
  });

  describe('recording writes', () => {
    const app = (scopes: string) =>
      appAs({ role: 'MEMBER', scopes }, (r) => recordings.register(r));

    for (const path of [
      '/recordings',
      '/recordings/g1/add-device',
      '/recordings/g1/stop',
      '/recordings/g1/bookmark',
      '/recordings/g1/annotation',
      '/recordings/g1/annotations/clear',
    ]) {
      it(`refuses POST ${path} without the devices scope`, async () => {
        const r = await request(app('sessions,read')).post(path).send({}).timeout(5000);
        expect(r.status).to.equal(403);
        expect(r.body).to.deep.equal({ error: 'insufficient scope' });
      });
    }

    it('lets the same key read recordings', async () => {
      const r = await request(app('sessions,read')).get('/recordings?limit=x').timeout(5000);
      expect(r.status).to.not.equal(403);
    });

    it('leaves routes mounted after the recordings router alone', async () => {
      const a = appAs({ role: 'MEMBER', scopes: 'read' }, (r) => {
        recordings.register(r);
        r.post('/elsewhere', (_req, res) => res.json({ ok: true }));
      });
      const r = await request(a).post('/elsewhere').send({}).timeout(5000);
      expect(r.status).to.equal(200);
    });
  });

  describe('/config', () => {
    const ALL = 'admin,devices,sessions,read';
    const app = (role: Caller['role'], scopes = ALL) =>
      appAs({ role, scopes }, (r) => {
        dashboard.register(r);
        ConfigRouter.register(r);
      });
    const SETTINGS_REFUSED = {
      error: "Only a super admin can change the lab's settings.",
      message: "Only a super admin can change the lab's settings.",
    };

    beforeEach(() => {
      sinon.stub(Container.get(WebConfigService), 'getConfig').resolves({} as any);
    });

    it('refuses a member the settings', async () => {
      expect((await request(app('MEMBER')).get('/config').timeout(5000)).status).to.equal(403);
    });

    it('shows an admin the settings', async () => {
      expect((await request(app('ADMIN')).get('/config').timeout(5000)).status).to.equal(200);
    });

    for (const path of ['/config', '/config/reset-metrics']) {
      it(`refuses an admin POST ${path}, saying why`, async () => {
        const set = sinon.stub(Container.get(WebConfigService), 'setConfig').resolves();
        const r = await request(app('ADMIN'))
          .post(path)
          .send({ buildCleanupDays: 7 })
          .timeout(5000);
        expect(r.status).to.equal(403);
        expect(r.body).to.deep.equal(SETTINGS_REFUSED);
        expect(set.called).to.equal(false);
      });

      it(`refuses a super admin's key without the admin scope POST ${path}`, async () => {
        const r = await request(app('SUPER_ADMIN', 'read')).post(path).send({}).timeout(5000);
        expect(r.status).to.equal(403);
      });
    }

    it('lets a super admin change the settings', async () => {
      const set = sinon.stub(Container.get(WebConfigService), 'setConfig').resolves();
      const r = await request(app('SUPER_ADMIN'))
        .post('/config')
        .send({ buildCleanupDays: 7 })
        .timeout(5000);
      expect(r.status).to.equal(200);
      expect(set.calledOnce).to.equal(true);
    });

    it('refuses an admin an AI provider test, saying why', async () => {
      const test = sinon.stub(AI_SERVICE, 'testConnection').resolves({ success: true } as any);
      const r = await request(app('ADMIN')).post('/config/test-ai').send({}).timeout(5000);
      expect(r.status).to.equal(403);
      expect(r.body.message).to.equal('Only a super admin can test an AI provider.');
      expect(test.called).to.equal(false);
    });
  });

  describe('GET /sessions/active', () => {
    const session = (id: string, udid: string, type: string) => ({
      getId: () => id,
      getType: () => type,
      getDevice: () => ({ udid, name: udid, platform: 'android' }),
    });

    function app(teamIds: string[] | undefined) {
      const a = express();
      a.use((req, _res, next) => {
        (req as any).auth = {
          kind: 'user-session',
          userId: 'usr_x',
          role: teamIds ? 'MEMBER' : 'ADMIN',
          scopes: 'devices,sessions,read',
          rateLimit: 1000,
          teamIds,
        };
        next();
      });
      const router = express.Router();
      grid.register(router, { bindHostOrIp: '127.0.0.1' } as any);
      a.use(router);
      return a;
    }

    beforeEach(() => {
      sinon
        .stub(Container.get(SessionManager), 'getAllSessions')
        .returns([
          session('s-shared', 'SHARED', 'LOCAL'),
          session('s-b1', 'PHONE-B', 'LOCAL'),
          session('s-b2', 'PHONE-B2', 'REMOTE'),
        ] as any);
      sinon.stub(prisma.device as any, 'findMany').resolves([
        { udid: 'SHARED', teamId: null },
        { udid: 'PHONE-B', teamId: 'team-b' },
        { udid: 'PHONE-B2', teamId: 'team-b' },
      ]);
    });

    it("counts only the sessions a member can see, not other teams'", async () => {
      const r = await request(app(['team-a']))
        .get('/sessions/active')
        .timeout(5000);
      expect(r.status).to.equal(200);
      expect(r.body.sessions.map((s: any) => s.id)).to.deep.equal(['s-shared']);
      expect(r.body.stats).to.deep.equal({ total: 1, byType: { local: 1, remote: 0, cloud: 0 } });
    });

    it('counts every session for an admin', async () => {
      const r = await request(app(undefined)).get('/sessions/active').timeout(5000);
      expect(r.body.stats).to.deep.equal({ total: 3, byType: { local: 2, remote: 1, cloud: 0 } });
    });
  });

  describe('the same-origin check', () => {
    let saved: boolean;
    beforeEach(() => {
      saved = config.authDisabled as boolean;
      config.authDisabled = false;
    });
    afterEach(() => {
      config.authDisabled = saved;
    });

    function app() {
      const a = express();
      a.use(csrfMiddleware);
      a.post('/x', (_req, res) => res.json({ ok: true }));
      return a;
    }

    it('lets a bearer request through without Origin or Referer', async () => {
      const r = await request(app())
        .post('/x')
        .set('Authorization', 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig')
        .timeout(5000);
      expect(r.status).to.equal(200);
    });

    it('still refuses a cookie request without Origin or Referer', async () => {
      const r = await request(app())
        .post('/x')
        .set('Cookie', 'xenon_dashboard_session=abc')
        .timeout(5000);
      expect(r.status).to.equal(403);
    });

    it('does not take another Authorization scheme for a bearer token', async () => {
      const r = await request(app()).post('/x').set('Authorization', 'Basic dTpw').timeout(5000);
      expect(r.status).to.equal(403);
    });
  });
});
