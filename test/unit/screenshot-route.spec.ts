import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { XenonManager } from '../../src/device-managers';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

/**
 * GET /control/:udid/screenshot. A capture that threw left the request
 * unanswered: the handler had no catch, and Express 4 doesn't catch a
 * rejected async handler. An iPhone with no live preview (no WebDriverAgent,
 * no go-ios tunnel) did exactly that, and its Screenshot tab spun forever.
 */

const UDID = 'DEV-SHOT';

// The route finds the manager by constructor name.
class IOSDeviceManager {
  getScreenshot = sinon.stub();
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

describe('GET /control/:udid/screenshot', () => {
  // The fake row is this server's own phone.
  useOwnNodeId();

  let manager: IOSDeviceManager;
  let restoreContainer: () => void;
  const loopback = loopbackServers();
  const app = async () => loopback.serve(buildApp());

  beforeEach(() => {
    restoreContainer = saveRegistrations(ApiKeyService, XenonManager);
    manager = new IOSDeviceManager();
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => ({
        udid: UDID,
        host: '127.0.0.1',
        nodeId: OWN_NODE_ID,
        platform: 'ios',
        busy: false,
        session_id: null,
      }),
    } as any);
    Container.set(ApiKeyService, new ApiKeyService());
    Container.set(XenonManager, { deviceInstances: async () => [manager] } as any);
  });

  afterEach(async () => {
    sinon.restore();
    restoreContainer();
    await loopback.closeAll();
  });

  it('returns the screenshot', async () => {
    manager.getScreenshot.resolves('A'.repeat(200));
    const res = await request(await app()).get(`/xenon/api/control/${UDID}/screenshot`);
    expect(res.status).to.equal(200);
    expect(res.body.screenshot).to.have.length(200);
  });

  it('answers a capture that failed with 502 and the reason, rather than never', async () => {
    manager.getScreenshot.rejects(new Error('connect ECONNREFUSED 127.0.0.1:8100'));
    const res = await request(await app())
      .get(`/xenon/api/control/${UDID}/screenshot`)
      .timeout(5000);
    expect(res.status).to.equal(502);
    expect(res.body.error).to.include('ECONNREFUSED');
  });
});
