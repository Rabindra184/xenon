import 'reflect-metadata';
import { expect } from 'chai';
import express, { Router } from 'express';
import request from '../helpers/loopbackRequest';
import register from '../../src/app/routers/sdk-version';

describe('GET /xenon/api/sdk/version (features)', () => {
  const app = express();
  app.use((req: any, _res, next) => {
    req.auth = { teamIds: ['t'], role: 'MEMBER', scopes: ['devices'] };
    next();
  });
  const apiRouter = Router();
  register(apiRouter);
  app.use('/xenon/api', apiRouter);

  it('GET /sdk/version lists lease-groups and lease-queue', async () => {
    const res = await request(app).get('/xenon/api/sdk/version');

    expect(res.status).to.equal(200);
    expect(res.body.supports).to.deep.equal([
      'leases',
      'ports',
      'heartbeat',
      'lease-groups',
      'lease-queue',
    ]);
  });
});
