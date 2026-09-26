import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { XenonManager } from '../../src/device-managers';
import { ClipboardUnsupportedError } from '../../src/device-managers/clipboardErrors';
import { scopesForRole } from '../../src/middleware/authMiddleware';

/**
 * GET/POST /control/:udid/clipboard answered 200 whatever happened on the
 * device: the Android manager swallowed its errors, and its "set" had no
 * effect at all. The dashboard's toast can only be as honest as the status.
 */

const UDID = 'DEV-CLIP';

// The route finds the manager by constructor name.
class AndroidDeviceManager {
  getClipboard = sinon.stub();
  setClipboard = sinon.stub();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();
  apiRouter.use((req, _res, next) => {
    (req as any).auth = {
      kind: 'user-session',
      userId: 'usr_me',
      role: 'MEMBER',
      scopes: scopesForRole('MEMBER'),
      rateLimit: 100,
    };
    next();
  });
  ControlRouter.register(apiRouter);
  app.use('/xenon/api', apiRouter);
  return app;
}

describe('GET/POST /control/:udid/clipboard', () => {
  let manager: AndroidDeviceManager;

  beforeEach(() => {
    manager = new AndroidDeviceManager();
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => ({
        udid: UDID,
        host: '127.0.0.1',
        platform: 'android',
        busy: false,
        session_id: null,
      }),
    } as any);
    Container.set(ApiKeyService, new ApiKeyService());
    Container.set(XenonManager, { deviceInstances: async () => [manager] } as any);
  });

  afterEach(() => {
    sinon.restore();
    Container.reset();
  });

  it('returns the clipboard text', async () => {
    manager.getClipboard.resolves('xenonread');
    const res = await request(buildApp()).get(`/xenon/api/control/${UDID}/clipboard`);
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ content: 'xenonread' });
  });

  it('says why a read failed, with a 500', async () => {
    manager.getClipboard.rejects(new Error('Appium Settings didn’t return the clipboard.'));
    const res = await request(buildApp()).get(`/xenon/api/control/${UDID}/clipboard`);
    expect(res.status).to.equal(500);
    expect(res.body.error).to.match(/Appium Settings/);
  });

  // Not a failure of this attempt: the platform can't do it, so retrying
  // won't help. 501 says exactly that.
  it('answers 501 when the device cannot set its clipboard', async () => {
    manager.setClipboard.rejects(
      new ClipboardUnsupportedError('Appium Settings can only read it.'),
    );
    const res = await request(buildApp())
      .post(`/xenon/api/control/${UDID}/clipboard`)
      .send({ content: 'x' });
    expect(res.status).to.equal(501);
    expect(res.body).to.deep.equal({ error: 'Appium Settings can only read it.' });
  });

  it('still answers 500 for any other write failure', async () => {
    manager.setClipboard.rejects(new Error('WDA is not running'));
    const res = await request(buildApp())
      .post(`/xenon/api/control/${UDID}/clipboard`)
      .send({ content: 'x' });
    expect(res.status).to.equal(500);
    expect(res.body.error).to.equal('WDA is not running');
  });
});
