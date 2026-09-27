import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * stream/ticket and inspector/snapshot look the device up before anything
 * else. A store that throws there must get an answer, not a hung request:
 * Express 4 doesn't catch a rejected async handler. An admin gets here with no
 * guard lookup in front (the team guard skips admins, and the ownership guard
 * skips both routes), so the handler's own lookup is the first to fail.
 */
describe('stream/ticket and inspector/snapshot answer a failed device lookup', () => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    const apiRouter = express.Router();
    apiRouter.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'user-session',
        userId: 'usr_admin',
        role: 'ADMIN',
        scopes: 'admin,devices,sessions,read',
        rateLimit: 100,
      };
      next();
    });
    ControlRouter.register(apiRouter);
    app.use('/xenon/api', apiRouter);
    return app;
  }

  let restoreRegistrations: () => void;

  beforeEach(() => {
    // mutationScopeGuard asks ApiKeyService.hasScope.
    restoreRegistrations = saveRegistrations(ApiKeyService);
    Container.set(ApiKeyService, new ApiKeyService());
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => {
        throw new Error('store hiccup');
      },
    } as any);
  });

  afterEach(() => {
    sinon.restore();
    restoreRegistrations();
  });

  const UNAVAILABLE = {
    success: false,
    error: 'device_ownership_unavailable',
    message: 'Could not verify device ownership. Try again.',
  };

  it('POST stream/ticket gets 503, not a hung request', async function () {
    this.timeout(5000);
    const res = await request(buildApp())
      .post('/xenon/api/control/DEV-1/stream/ticket')
      .timeout(2000);
    expect(res.status).to.equal(503);
    expect(res.body).to.deep.equal(UNAVAILABLE);
  });

  it('GET inspector/snapshot gets 503, not a hung request', async function () {
    this.timeout(5000);
    const res = await request(buildApp())
      .get('/xenon/api/control/DEV-1/inspector/snapshot')
      .timeout(2000);
    expect(res.status).to.equal(503);
    expect(res.body).to.deep.equal(UNAVAILABLE);
  });
});
