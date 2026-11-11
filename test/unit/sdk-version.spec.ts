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

  it('GET /sdk/version lists what a client can detect', async () => {
    const res = await request(app).get('/xenon/api/sdk/version');

    expect(res.status).to.equal(200);
    expect(res.body.supports).to.deep.equal([
      'leases',
      'ports',
      'heartbeat',
      'lease-groups',
      'lease-queue',
      'lease-read',
      'lease-extend-never-shortens',
      'healing-tiers-empty-off',
      'own-phone-leases',
      'sensitive-commands',
      'mask-input',
      'lease-exclude-tags',
      'fingerprint-read',
      'ai-redaction',
      'trace-context',
      'app-reuse',
      'ci-app-store',
      'network-profile-mid-session',
      'node-command-spans',
      'lifecycle-webhooks',
      'real-phone-shaping',
    ]);
  });
});
