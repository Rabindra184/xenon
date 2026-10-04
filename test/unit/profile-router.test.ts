import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
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
    const app = appWithAuth({
      kind: 'user-session',
      userId: 'u1',
      role: 'ADMIN',
      scopes: 'admin,devices,sessions,read',
    });
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

  it("POST /profile/tokens can't widen past the credential creating it", async () => {
    const create = sinon
      .stub(Container.get(ApiKeyService), 'create')
      .resolves({ id: 'k3', raw: 'x' });
    // An admin's read-only key: the role would allow devices, the key does not.
    const app = appWithAuth({ userId: 'u1', role: 'ADMIN', scopes: 'read' });
    const widened = await request(app)
      .post('/profile/tokens')
      .send({ name: 'CI', scopes: ['devices', 'read'] });
    expect(widened.status).to.equal(400);
    // The role's default (devices, sessions, read) is wider than the key too.
    expect((await request(app).post('/profile/tokens').send({ name: 'CI' })).status).to.equal(400);
    const narrow = await request(app)
      .post('/profile/tokens')
      .send({ name: 'CI', scopes: ['read'] });
    expect(narrow.status).to.equal(201);
    expect(create.calledOnce).to.equal(true);
    expect(create.firstCall.args[0].scopes).to.deep.equal(['read']);
  });

  it('POST /profile/tokens lets a super admin ask for a narrower token', async () => {
    const create = sinon
      .stub(Container.get(ApiKeyService), 'create')
      .resolves({ id: 'k4', raw: 'x' });
    const app = appWithAuth({
      userId: 'u1',
      role: 'SUPER_ADMIN',
      scopes: 'admin,devices,sessions,read',
    });
    const r = await request(app)
      .post('/profile/tokens')
      .send({ name: 'CI', scopes: ['devices'] });
    expect(r.status).to.equal(201);
    expect(create.firstCall.args[0].scopes).to.deep.equal(['devices']);
  });

  it('POST /profile/tokens refuses a scope that does not exist', async () => {
    const app = appWithAuth({ userId: 'u1', role: 'SUPER_ADMIN', scopes: 'admin' });
    const r = await request(app)
      .post('/profile/tokens')
      .send({ name: 'CI', scopes: ['root'] });
    expect(r.status).to.equal(400);
    expect(r.body.error).to.equal('scopes must be some of read, sessions, devices, admin');
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

  // A credential can't do more to its owner's account than it could itself
  // have been made to do.
  describe('what the credential in use limits', () => {
    // Rotating the access key ends every key pair its owner has, whatever
    // their scopes, so it takes the person themselves (a dashboard sign-in)
    // or a credential with the admin scope. Any credential, a read-only
    // token included, could do it.
    describe('POST /profile/access-key/rotate', () => {
      let rotate: sinon.SinonStub;
      beforeEach(() => {
        rotate = sinon
          .stub(Container.get(UserService), 'rotateAccessKey')
          .resolves({ id: 'u1', accessKey: 'xen_NEW' } as any);
      });

      for (const [kind, scopes] of [
        ['bearer', 'read'],
        ['api-key', 'read'],
        ['api-key', 'devices,sessions,read'],
        ['bearer', 'sessions'],
      ]) {
        it(`is refused to ${kind === 'bearer' ? 'a Bearer token' : 'an API key'} with ${scopes}`, async () => {
          const app = appWithAuth({ kind, userId: 'u1', role: 'ADMIN', scopes });
          const r = await request(app).post('/profile/access-key/rotate');
          expect(r.status).to.equal(403);
          expect(r.body.error).to.match(/dashboard sign-in or a credential with the admin scope/);
          expect(rotate.called).to.equal(false);
        });
      }

      it('is allowed to a dashboard sign-in, a member included', async () => {
        const app = appWithAuth({
          kind: 'user-session',
          userId: 'u1',
          role: 'MEMBER',
          scopes: 'devices,sessions,read',
        });
        expect((await request(app).post('/profile/access-key/rotate')).status).to.equal(200);
      });

      it('is allowed to a credential with the admin scope', async () => {
        const app = appWithAuth({
          kind: 'api-key',
          userId: 'u1',
          role: 'SUPER_ADMIN',
          scopes: 'admin',
        });
        expect((await request(app).post('/profile/access-key/rotate')).status).to.equal(200);
      });
    });

    // A token made with a credential that expires ends no later than it: a
    // 1-hour Bearer token made itself a key that never expired.
    describe('POST /profile/tokens from a credential that expires', () => {
      const inAnHour = new Date(Date.now() + 3_600_000);
      const bearer = () =>
        appWithAuth({
          kind: 'bearer',
          userId: 'u1',
          role: 'MEMBER',
          scopes: 'sessions,read',
          credentialExpiresAt: inAnHour.getTime(),
        });
      let create: sinon.SinonStub;
      beforeEach(() => {
        create = sinon
          .stub(Container.get(ApiKeyService), 'create')
          .resolves({ id: 'k9', raw: 'raw' });
      });

      it('expires with that credential when no expiresAt is asked for', async () => {
        const r = await request(bearer()).post('/profile/tokens').send({ name: 'CI' });
        expect(r.status).to.equal(201);
        expect(r.body.expiresAt).to.equal(inAnHour.toISOString());
        expect(create.firstCall.args[0].expiresAt?.getTime()).to.equal(inAnHour.getTime());
      });

      it('refuses an expiresAt later than that credential', async () => {
        const later = new Date(inAnHour.getTime() + 60_000).toISOString();
        const r = await request(bearer())
          .post('/profile/tokens')
          .send({ name: 'CI', expiresAt: later });
        expect(r.status).to.equal(400);
        expect(r.body.error).to.match(/later than the credential/);
        expect(create.called).to.equal(false);
      });

      // Verification allows 60 s of clock skew, so a token can still be
      // accepted just after its exp: it must not make a key already expired.
      it('refuses when that credential has already expired', async () => {
        const app = appWithAuth({
          kind: 'bearer',
          userId: 'u1',
          role: 'MEMBER',
          scopes: 'sessions,read',
          credentialExpiresAt: Date.now() - 1000,
        });
        const r = await request(app).post('/profile/tokens').send({ name: 'CI' });
        expect(r.status).to.equal(400);
        expect(r.body.error).to.match(/has expired/);
        expect(create.called).to.equal(false);
      });

      it('keeps an earlier expiresAt', async () => {
        const sooner = new Date(Date.now() + 600_000).toISOString();
        const r = await request(bearer())
          .post('/profile/tokens')
          .send({ name: 'CI', expiresAt: sooner });
        expect(r.status).to.equal(201);
        expect(r.body.expiresAt).to.equal(sooner);
      });

      it('leaves a dashboard sign-in free to make a key that never expires', async () => {
        const app = appWithAuth({
          kind: 'user-session',
          userId: 'u1',
          role: 'MEMBER',
          scopes: 'devices,sessions,read',
        });
        const r = await request(app).post('/profile/tokens').send({ name: 'CI' });
        expect(r.status).to.equal(201);
        expect(r.body.expiresAt).to.equal(null);
      });
    });
  });
});
