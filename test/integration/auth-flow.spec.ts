import 'reflect-metadata';
import { expect } from 'chai';
import request from 'supertest';
import express from 'express';
import { authPublicRouter, authAuthedRouter } from '../../src/app/routers/auth';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { prisma } from '../../src/prisma';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';

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
  let user: any;

  before(async () => {
    await prisma.userSession.deleteMany({ where: { user: { email: 'loginflow@xenon.local' } } });
    await prisma.user.deleteMany({ where: { email: 'loginflow@xenon.local' } });
    user = await Container.get(UserService).createUser({
      email: 'loginflow@xenon.local',
      name: 'Login Flow',
      password: 'flow-test-12',
      role: 'ADMIN',
    });
  });

  after(async () => {
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
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
