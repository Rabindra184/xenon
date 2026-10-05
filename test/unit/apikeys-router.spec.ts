import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { apiKeysRouter } from '../../src/app/routers/apikeys';
import { ApiKeyService } from '../../src/services/ApiKeyService';

/**
 * POST /apikeys stores the scopes it is given. It stored any string, so a
 * typo (`session`, `Admin`) made a key that silently had none of the scopes
 * its maker meant, and a list shown back on the API keys page that no check
 * reads. It takes the four scopes POST /profile/tokens takes.
 */
describe('POST /apikeys takes only scopes that exist', () => {
  let create: sinon.SinonStub;

  function app(auth: Record<string, unknown> = {}) {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'user-session',
        userId: 'admin1',
        role: 'SUPER_ADMIN',
        scopes: 'admin,devices,sessions,read',
        ...auth,
      };
      next();
    });
    a.use('/apikeys', apiKeysRouter());
    return a;
  }

  beforeEach(() => {
    create = sinon.stub(Container.get(ApiKeyService), 'create').resolves({ id: 'k1', raw: 'raw' });
  });

  afterEach(() => sinon.restore());

  for (const scopes of [['root'], ['sessions', 'Admin'], ['session'], [42]]) {
    it(`refuses ${JSON.stringify(scopes)}`, async () => {
      const r = await request(app()).post('/apikeys').send({ name: 'CI', scopes });
      expect(r.status).to.equal(400);
      expect(r.body.error).to.equal('scopes must be some of read, sessions, devices, admin');
      expect(create.called).to.equal(false);
    });
  }

  it('creates a key with known scopes', async () => {
    const r = await request(app())
      .post('/apikeys')
      .send({ name: 'CI', scopes: ['sessions', 'devices'] });
    expect(r.status).to.equal(200);
    expect(create.firstCall.args[0].scopes).to.deep.equal(['sessions', 'devices']);
  });

  // Made with a credential that expires, a key ends no later than it: an
  // admin's 1-hour Bearer token made itself a key that never expired.
  describe('from a credential that expires', () => {
    const inAnHour = new Date(Date.now() + 3_600_000);
    const bearer = () =>
      app({ kind: 'bearer', scopes: 'admin', credentialExpiresAt: inAnHour.getTime() });

    it('expires with that credential when no expiresAt is asked for', async () => {
      const r = await request(bearer())
        .post('/apikeys')
        .send({ name: 'CI', scopes: ['sessions'] });
      expect(r.status).to.equal(200);
      expect(r.body.expiresAt).to.equal(inAnHour.toISOString());
      expect(create.firstCall.args[0].expiresAt?.getTime()).to.equal(inAnHour.getTime());
    });

    it('refuses an expiresAt later than that credential', async () => {
      const later = new Date(inAnHour.getTime() + 60_000).toISOString();
      const r = await request(bearer())
        .post('/apikeys')
        .send({ name: 'CI', scopes: ['sessions'], expiresAt: later });
      expect(r.status).to.equal(400);
      expect(r.body.error).to.match(/later than the credential/);
      expect(create.called).to.equal(false);
    });
  });
});
