import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { nodeSecretMiddleware } from '../../src/middleware/nodeSecretMiddleware';
import { resetLegacyNodeUserCache } from '../../src/services/identity/legacyNodeUser';
import GridRouter from '../../src/app/routers/grid';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';

describe('node pair auth — REST /register (integration)', function () {
  this.timeout(60_000);
  const NODE_SECRET = 'test-node-secret-' + Date.now();
  let nodeUser: { id: string; accessKey: string };
  let rawToken: string;

  before(async () => {
    // Provision a "node user" + a devices-scoped token, simulating the
    // post-Phase-4B operator workflow.
    const u = await Container.get(UserService).createUser({
      email: `phase4b-node-${Date.now()}@xenon.local`,
      name: 'Phase 4B Test Node',
      password: 'unused-test-pass-1',
      role: 'ADMIN',
    });
    nodeUser = { id: u.id, accessKey: u.accessKey };
    const tok = await Container.get(ApiKeyService).create({
      name: 'phase4b test',
      scopes: ['devices'],
      userId: u.id,
    });
    rawToken = tok.raw;
  });

  after(async () => {
    resetLegacyNodeUserCache();
    await prisma.apiKey.deleteMany({ where: { userId: nodeUser.id } });
    await prisma.userSession.deleteMany({ where: { userId: nodeUser.id } });
    await prisma.user.delete({ where: { id: nodeUser.id } });
    // Also clear the lazy-created Legacy Node row so we don't pollute the
    // test DB across runs.
    await prisma.user
      .delete({ where: { email: 'legacy-node@xenon.local' } })
      .catch(() => undefined);
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(['/register'], nodeSecretMiddleware(NODE_SECRET));
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

  it('legacy x-xenon-node-secret + flag on → not 401', async () => {
    const orig = (config as any).acceptLegacyNodeSecret;
    (config as any).acceptLegacyNodeSecret = true;
    try {
      const r = await request(buildApp())
        .post('/register')
        .query({ type: 'add' })
        .set('x-xenon-node-secret', NODE_SECRET)
        .send([]);
      expect(r.status).to.not.equal(401);
      expect(r.status).to.not.equal(403);
    } finally {
      (config as any).acceptLegacyNodeSecret = orig;
    }
  });

  it('legacy x-xenon-node-secret + flag off → 401', async () => {
    const orig = (config as any).acceptLegacyNodeSecret;
    (config as any).acceptLegacyNodeSecret = false;
    try {
      const r = await request(buildApp())
        .post('/register')
        .query({ type: 'add' })
        .set('x-xenon-node-secret', NODE_SECRET)
        .send([]);
      expect(r.status).to.equal(401);
      expect(r.body.error).to.match(/XENON_ACCEPT_LEGACY_NODE_SECRET/);
    } finally {
      (config as any).acceptLegacyNodeSecret = orig;
    }
  });

  it('no auth headers → 401', async () => {
    const r = await request(buildApp())
      .post('/register')
      .query({ type: 'add' })
      .send([]);
    expect(r.status).to.equal(401);
  });

  it('pair AND legacy both present → pair wins (no Legacy Node row created)', async () => {
    // Drop any pre-existing Legacy Node row + cache so we can assert it
    // is NOT lazy-created during this test.
    resetLegacyNodeUserCache();
    await prisma.user
      .delete({ where: { email: 'legacy-node@xenon.local' } })
      .catch(() => undefined);

    const r = await request(buildApp())
      .post('/register')
      .query({ type: 'add' })
      .set('x-xenon-access-key', nodeUser.accessKey)
      .set('x-xenon-token', rawToken)
      .set('x-xenon-node-secret', NODE_SECRET)
      .send([]);
    expect(r.status).to.not.equal(401);

    const legacy = await prisma.user.findUnique({
      where: { email: 'legacy-node@xenon.local' },
    });
    expect(legacy).to.be.null;
  });
});
