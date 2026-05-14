import 'reflect-metadata';
import { expect } from 'chai';
import express, { Router } from 'express';
import request from 'supertest';

describe('GET /xenon/api/sdk/version', () => {
  it('returns pluginVersion + supports array', async () => {
    const register = (await import('../../src/app/routers/sdk-version')).default;
    const app = express();
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'a', scopes: ['devices'] };
      req.auth = { teamIds: ['t'], role: 'MEMBER' };
      next();
    });
    const apiRouter = Router();
    register(apiRouter);
    app.use('/xenon/api', apiRouter);
    const res = await request(app).get('/xenon/api/sdk/version');
    expect(res.status).to.equal(200);
    expect(res.body.pluginVersion).to.be.a('string');
    expect(res.body.supports).to.include.members(['leases', 'ports', 'heartbeat']);
  });
});
