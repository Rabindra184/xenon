import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { profileRouter } from '../../src/app/routers/profile';
import { Container } from 'typedi';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserService } from '../../src/services/UserService';
import { prisma } from '../../src/prisma';

function appWithAuth(auth: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).auth = auth; next(); });
  app.use('/profile', profileRouter());
  return app;
}

describe('profile router', () => {
  afterEach(() => sinon.restore());

  it('GET /profile/access-key returns the caller accessKey', async () => {
    sinon.stub(Container.get(UserService), 'findById').resolves({ accessKey: 'xen_abc' } as any);
    const app = appWithAuth({ userId: 'u1', role: 'ADMIN', scopes: 'devices,sessions,read' });
    const r = await request(app).get('/profile/access-key');
    expect(r.body.accessKey).to.equal('xen_abc');
  });

  it('POST /profile/access-key/rotate returns a new accessKey', async () => {
    sinon.stub(Container.get(UserService), 'rotateAccessKey').resolves({ id: 'u1', accessKey: 'xen_NEW' } as any);
    const app = appWithAuth({ userId: 'u1', role: 'ADMIN', scopes: 'devices,sessions,read' });
    const r = await request(app).post('/profile/access-key/rotate');
    expect(r.body.accessKey).to.equal('xen_NEW');
  });

  it('GET /profile/tokens lists caller tokens without secrets', async () => {
    sinon.stub(prisma.apiKey, 'findMany').resolves([
      { id: 'k1', name: 'CI', scopes: 'sessions,read', expiresAt: null, createdAt: new Date(), lastUsedAt: null },
    ] as any);
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).get('/profile/tokens');
    expect(r.body[0].name).to.equal('CI');
    expect(r.body[0].keyHash).to.be.undefined;
  });

  it('POST /profile/tokens creates a token with role-derived default scopes', async () => {
    const create = sinon.stub(Container.get(ApiKeyService), 'create')
      .resolves({ id: 'k2', raw: 'rawsecret' });
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).post('/profile/tokens').send({ name: 'CI' });
    expect(r.status).to.equal(201);
    expect(r.body.token).to.equal('rawsecret');
    expect(create.firstCall.args[0].scopes).to.deep.equal(['sessions', 'read']);
  });

  it('POST /profile/tokens rejects an attempt to widen scopes', async () => {
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).post('/profile/tokens').send({ name: 'CI', scopes: ['admin'] });
    expect(r.status).to.equal(400);
    expect(r.body.error).to.match(/cannot widen/);
  });

  it('POST /profile/tokens accepts a future expiresAt and forwards it to the service', async () => {
    const create = sinon.stub(Container.get(ApiKeyService), 'create')
      .resolves({ id: 'k3', raw: 'rawsecret' });
    const future = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).post('/profile/tokens').send({ name: 'CI', expiresAt: future });
    expect(r.status).to.equal(201);
    expect(r.body.expiresAt).to.equal(future);
    expect(create.firstCall.args[0].expiresAt?.toISOString()).to.equal(future);
  });

  it('POST /profile/tokens rejects a past expiresAt with 400', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).post('/profile/tokens').send({ name: 'CI', expiresAt: past });
    expect(r.status).to.equal(400);
    expect(r.body.error).to.match(/future/);
  });

  it('POST /profile/tokens rejects an unparseable expiresAt with 400', async () => {
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).post('/profile/tokens').send({ name: 'CI', expiresAt: 'not-a-date' });
    expect(r.status).to.equal(400);
    expect(r.body.error).to.match(/ISO-8601/);
  });

  it('DELETE /profile/tokens/:id only deletes caller-owned tokens', async () => {
    sinon.stub(prisma.apiKey, 'findFirst').resolves({ id: 'k1', userId: 'u1' } as any);
    const revoke = sinon.stub(Container.get(ApiKeyService), 'revoke').resolves(undefined as any);
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).delete('/profile/tokens/k1');
    expect(r.status).to.equal(204);
    expect(revoke.calledOnceWithExactly('k1')).to.be.true;
  });

  it('DELETE /profile/tokens/:id 404s when the token belongs to someone else', async () => {
    sinon.stub(prisma.apiKey, 'findFirst').resolves(null);
    const app = appWithAuth({ userId: 'u1', role: 'MEMBER', scopes: 'sessions,read' });
    const r = await request(app).delete('/profile/tokens/k1');
    expect(r.status).to.equal(404);
  });
});
