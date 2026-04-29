import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { profileRouter } from '../../src/app/routers/profile';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { prisma } from '../../src/prisma';

describe('profile/tokens (integration)', function () {
  this.timeout(30_000);
  let user: any;
  let cookie: string;

  before(async () => {
    await prisma.userSession.deleteMany({ where: { user: { email: 'tokens-it@xenon.local' } } });
    await prisma.user.deleteMany({ where: { email: 'tokens-it@xenon.local' } });
    user = await Container.get(UserService).createUser({
      email: 'tokens-it@xenon.local',
      name: 'Tokens IT',
      password: 'tokens-12',
      role: 'ADMIN',
    });
    const session = await Container.get(UserSessionService).create(user.id);
    cookie = `xenon_dashboard_session=${session.id}`;
  });
  after(async () => {
    await prisma.apiKey.deleteMany({ where: { userId: user.id } });
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('creates and lists a token; rotating accessKey keeps the token valid', async () => {
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    app.use('/profile', profileRouter());

    const created = await request(app)
      .post('/profile/tokens')
      .set('Cookie', cookie)
      .send({ name: 'CI' });
    expect(created.status).to.equal(201);
    const token = created.body.token as string;

    const list = await request(app).get('/profile/tokens').set('Cookie', cookie);
    expect(list.body.length).to.equal(1);

    const me = await request(app).get('/profile/access-key').set('Cookie', cookie);
    const ak = me.body.accessKey;
    const headerCheck = await request(app)
      .get('/profile/tokens')
      .set('x-xenon-access-key', ak)
      .set('x-xenon-token', token);
    expect(headerCheck.status).to.equal(200);

    const rotated = await request(app).post('/profile/access-key/rotate').set('Cookie', cookie);
    const newAk = rotated.body.accessKey;
    expect(newAk).to.not.equal(ak);
    const afterRotate = await request(app)
      .get('/profile/tokens')
      .set('x-xenon-access-key', newAk)
      .set('x-xenon-token', token);
    expect(afterRotate.status).to.equal(200);

    const oldFails = await request(app)
      .get('/profile/tokens')
      .set('x-xenon-access-key', ak)
      .set('x-xenon-token', token);
    expect(oldFails.status).to.equal(401);
  });
});
