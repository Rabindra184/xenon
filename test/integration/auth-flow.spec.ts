import 'reflect-metadata';
import { expect } from 'chai';
import request from '../helpers/loopbackRequest';
import express from 'express';
import { authPublicRouter, authAuthedRouter } from '../../src/app/routers/auth';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { useScratchDatabase } from '../helpers/scratch-database';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authPublicRouter());
  app.use('/api', authMiddleware);
  app.use('/api/auth', authAuthedRouter());
  app.get('/api/whoami', (req, res) => res.json(req.auth));
  return app;
}

describe('auth flow (integration)', function () {
  this.timeout(30_000);
  useScratchDatabase({ wholeSuite: true });
  let user: any;

  before(async () => {
    user = await Container.get(UserService).createUser({
      email: 'loginflow@xenon.local',
      name: 'Login Flow',
      password: 'flow-test-12',
      role: 'ADMIN',
    });
  });

  // Through 2.18 the cookie also took a raw API token, checked alone: without
  // the access key the header login needs, unaffected by signing out, and
  // renewed on every request. Only a sign-in session goes in the cookie now.
  describe('an API token in the dashboard cookie', () => {
    let superAdmin: any;
    let token: string;

    before(async () => {
      superAdmin = await Container.get(UserService).createUser({
        email: 'rawcookie@xenon.local',
        name: 'Raw Cookie',
        password: 'raw-cookie-12',
        role: 'SUPER_ADMIN',
      });
      ({ raw: token } = await Container.get(ApiKeyService).create({
        name: 'raw-cookie',
        scopes: ['admin', 'devices', 'sessions', 'read'],
        userId: superAdmin.id,
      }));
    });

    it('is refused, though the same token works with its access key', async () => {
      const app = buildApp();
      const asCookie = await request(app)
        .get('/api/whoami')
        .set('Cookie', `xenon_dashboard_session=${token}`);
      expect(asCookie.status).to.equal(401);
      expect(asCookie.headers['set-cookie']).to.equal(undefined);

      const asPair = await request(app)
        .get('/api/whoami')
        .set('x-xenon-access-key', superAdmin.accessKey)
        .set('x-xenon-token', token);
      expect(asPair.status).to.equal(200);
      expect(asPair.body.userId).to.equal(superAdmin.id);
    });

    it('POST /auth/dashboard-session no longer makes one: no such route, no cookie', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/auth/dashboard-session')
        .set('x-xenon-access-key', superAdmin.accessKey)
        .set('x-xenon-token', token)
        .send({ apiKey: token });
      expect(res.status).to.equal(404);
      expect(res.headers['set-cookie']).to.equal(undefined);
    });
  });

  it('login → cookie → /whoami → logout → 401', async () => {
    const app = buildApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'loginflow@xenon.local', password: 'flow-test-12' });
    expect(login.status).to.equal(204);
    const cookie = login.headers['set-cookie']?.[0];
    expect(cookie).to.match(/^xenon_dashboard_session=/);

    const me = await request(app).get('/api/whoami').set('Cookie', cookie!);
    expect(me.status).to.equal(200);
    expect(me.body.userId).to.equal(user.id);
    expect(me.body.kind).to.equal('user-session');

    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie!);
    expect(out.status).to.equal(204);

    const me2 = await request(app).get('/api/whoami').set('Cookie', cookie!);
    expect(me2.status).to.equal(401);
  });

  it('login with wrong password returns generic 401 (no enumeration)', async () => {
    const app = buildApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'loginflow@xenon.local', password: 'WRONG' });
    expect(login.status).to.equal(401);
    expect(login.body.error).to.equal('invalid credentials');
  });

  it('login with unknown email returns the same generic 401', async () => {
    const app = buildApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-such@xenon.local', password: 'whatever' });
    expect(login.status).to.equal(401);
    expect(login.body.error).to.equal('invalid credentials');
  });
});
