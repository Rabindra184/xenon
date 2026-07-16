import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import { authAuthedRouter } from '../../src/app/routers/auth';
import { UserService } from '../../src/services/UserService';
import { config } from '../../src/config';

/**
 * When XENON_AUTH_DISABLED=true, authMiddleware fabricates a synthetic
 * SUPER_ADMIN whose userId ('auth-disabled') has no row in the User table.
 * GET /auth/me must not try to resolve that id against the database — if it
 * does, it 401s, the dashboard's RouteGuard bounces to /login, and the
 * dashboard is unreachable on a server that has auth turned off.
 */
function appWithSyntheticAuth() {
  const app = express();
  // Stand in for authMiddleware's authDisabled branch (authMiddleware.ts:63-74).
  app.use((req, _res, next) => {
    (req as any).auth = {
      kind: 'api-key',
      userId: 'auth-disabled',
      role: 'SUPER_ADMIN',
      scopes: 'admin',
      rateLimit: 100_000,
      teamIds: undefined,
    };
    next();
  });
  app.use('/auth', authAuthedRouter());
  return app;
}

describe('GET /auth/me with authDisabled', () => {
  let original: boolean;

  beforeEach(() => {
    original = config.authDisabled;
  });

  afterEach(() => {
    config.authDisabled = original;
    sinon.restore();
  });

  it('returns the synthetic admin identity without a User row', async () => {
    config.authDisabled = true;
    // No User row exists for the synthetic id — this is the real-world state.
    const findById = sinon.stub(Container.get(UserService), 'findById').resolves(null as any);

    const res = await request(appWithSyntheticAuth()).get('/auth/me');

    expect(res.status).to.equal(200);
    expect(res.body.userId).to.equal('auth-disabled');
    expect(res.body.role).to.equal('SUPER_ADMIN');
    expect(res.body.scopes).to.equal('admin');
    expect(res.body.teams).to.deep.equal([]);
    // The synthetic id must never be looked up — there is nothing to find.
    expect(findById.called, 'findById should not be called when auth is disabled').to.be.false;
  });

  it('still 401s when auth is enabled and the user does not exist', async () => {
    config.authDisabled = false;
    sinon.stub(Container.get(UserService), 'findById').resolves(null as any);

    const res = await request(appWithSyntheticAuth()).get('/auth/me');

    expect(res.status).to.equal(401);
    expect(res.body.error).to.equal('unauthenticated');
  });
});
