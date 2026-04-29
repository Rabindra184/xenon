import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';

describe('legacy x-xenon-api-key compatibility', function () {
  this.timeout(30_000);
  let user: any;
  let raw: string;

  before(async () => {
    await prisma.user.deleteMany({ where: { email: 'legacy-it@xenon.local' } });
    user = await Container.get(UserService).createUser({
      email: 'legacy-it@xenon.local',
      name: 'Legacy IT',
      password: 'leg-test-12',
      role: 'ADMIN',
    });
    const k = await Container.get(ApiKeyService).create({
      name: 'legacy',
      scopes: ['admin'],
      userId: user.id,
    });
    raw = k.raw;
  });
  after(async () => {
    await prisma.apiKey.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('flag on → x-xenon-api-key works', async () => {
    (config as any).acceptLegacyKey = true;
    const app = express();
    app.use(authMiddleware);
    app.get('/x', (req, res) => res.json(req.auth));
    const r = await request(app).get('/x').set('x-xenon-api-key', raw);
    expect(r.status).to.equal(200);
    expect(r.body.userId).to.equal(user.id);
  });

  it('flag off → x-xenon-api-key 401s', async () => {
    (config as any).acceptLegacyKey = false;
    const app = express();
    app.use(authMiddleware);
    app.get('/x', (req, res) => res.json(req.auth));
    const r = await request(app).get('/x').set('x-xenon-api-key', raw);
    expect(r.status).to.equal(401);
    (config as any).acceptLegacyKey = true; // restore
  });
});
