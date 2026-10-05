import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import GridRouter from '../../src/app/routers/grid';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { useScratchDatabase } from '../helpers/scratch-database';

describe('node pair auth — REST /register (integration)', function () {
  this.timeout(60_000);
  useScratchDatabase({ wholeSuite: true });
  let nodeUser: { id: string; accessKey: string };
  let rawToken: string;

  before(async () => {
    const u = await Container.get(UserService).createUser({
      email: `node-${Date.now()}@xenon.local`,
      name: 'Test Node',
      password: 'unused-test-pass-1',
      role: 'ADMIN',
    });
    nodeUser = { id: u.id, accessKey: u.accessKey };
    const tok = await Container.get(ApiKeyService).create({
      name: 'node test',
      scopes: ['devices'],
      userId: u.id,
    });
    rawToken = tok.raw;
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    GridRouter.register(app as any, {} as any);
    return app;
  }

  it('pair (accessKey, token) → not 401/403', async () => {
    const r = await request(buildApp())
      .post('/register')
      .query({ type: 'add' })
      .set('x-xenon-access-key', nodeUser.accessKey)
      .set('x-xenon-token', rawToken)
      .send([]);
    expect(r.status).to.not.equal(401);
    expect(r.status).to.not.equal(403);
  });

  it('no auth headers → 401', async () => {
    const r = await request(buildApp())
      .post('/register')
      .query({ type: 'add' })
      .send([]);
    expect(r.status).to.equal(401);
  });
});
