import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { usersRouter } from '../../src/app/routers/users';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { prisma } from '../../src/prisma';

function appWithAuth(auth: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = auth;
    next();
  });
  app.use('/users', usersRouter());
  return app;
}

describe('/users router', () => {
  afterEach(() => sinon.restore());

  it('GET /users returns the listUsers result, filtered by caller role', async () => {
    sinon.stub(Container.get(UserService), 'listUsers').resolves([{ id: 'u1' }] as any);
    const app = appWithAuth({ userId: 'admin', role: 'ADMIN' });
    const r = await request(app).get('/users');
    expect(r.status).to.equal(200);
    expect(r.body[0].id).to.equal('u1');
  });

  it('POST /users creates a user with a temp password when password is omitted', async () => {
    sinon.stub(Container.get(UserService), 'createUser').resolves({
      id: 'new-user',
      email: 'new@x.local',
      name: 'New',
      role: 'MEMBER',
      status: 'ACTIVE',
      accessKey: 'xen_NEW0000NEW00',
    } as any);
    const app = appWithAuth({ userId: 'admin', role: 'ADMIN' });
    const r = await request(app)
      .post('/users')
      .send({ email: 'new@x.local', name: 'New', role: 'MEMBER' });
    expect(r.status).to.equal(201);
    expect(r.body.id).to.equal('new-user');
    expect(r.body.temporaryPassword).to.match(/^[A-Za-z0-9_-]{12,}$/);
  });

  it('POST /users — ADMIN cannot create an ADMIN', async () => {
    const app = appWithAuth({ userId: 'admin', role: 'ADMIN' });
    const r = await request(app)
      .post('/users')
      .send({ email: 'wannabe@x.local', name: 'Wannabe', role: 'ADMIN' });
    expect(r.status).to.equal(403);
  });

  it('PATCH /users/:id — refuses self role-change', async () => {
    const app = appWithAuth({ userId: 'me', role: 'SUPER_ADMIN' });
    const r = await request(app).patch('/users/me').send({ role: 'MEMBER' });
    expect(r.status).to.equal(400);
    expect(r.body.error).to.match(/role-change yourself/);
  });

  it('PATCH /users/:id — refuses email change silently (no error, ignored)', async () => {
    sinon.stub(prisma.user, 'findUnique').resolves({ id: 't1', role: 'MEMBER' } as any);
    const update = sinon.stub(Container.get(UserService), 'updateUser').resolves({
      id: 't1',
      email: 'old@x.local',
      name: 'T',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as any);
    const app = appWithAuth({ userId: 'admin', role: 'ADMIN' });
    const r = await request(app).patch('/users/t1').send({ email: 'evil@x.local', name: 'NewName' });
    expect(r.status).to.equal(200);
    const passedPatch = update.firstCall.args[1];
    expect(passedPatch).to.not.have.property('email');
    expect(passedPatch.name).to.equal('NewName');
  });

  it('DELETE /users/:id — refuses self-delete', async () => {
    const app = appWithAuth({ userId: 'me', role: 'SUPER_ADMIN' });
    const r = await request(app).delete('/users/me');
    expect(r.status).to.equal(400);
    expect(r.body.error).to.match(/delete yourself/);
  });

  it('DELETE /users/:id — refuses last super-admin', async () => {
    sinon
      .stub(prisma.user, 'findUnique')
      .resolves({ id: 'last-sa', role: 'SUPER_ADMIN' } as any);
    sinon.stub(prisma.user, 'count').resolves(0);
    const app = appWithAuth({ userId: 'me', role: 'SUPER_ADMIN' });
    const r = await request(app).delete('/users/last-sa');
    expect(r.status).to.equal(400);
    expect(r.body.error).to.match(/last active super-admin/);
  });
});
