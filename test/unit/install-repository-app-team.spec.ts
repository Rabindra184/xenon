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
import { APP_SERVICE } from '../../src/dashboard/services/app-service';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * Installing an uploaded app onto a phone hands over its binary as surely as
 * downloading it does, so POST /control/:udid/install-repository-app follows
 * the app team rule too: another team's app answers as an unknown id.
 */
const UDID = 'DEV-INSTALL';

// The route finds the manager by constructor name.
class AndroidDeviceManager {
  installApp = sinon.stub().resolves();
}

const APPS: Record<string, any> = {
  'app-shared': { id: 'app-shared', name: 'shared.apk', filepath: '/x/shared.apk', teamId: null },
  'app-a': { id: 'app-a', name: 'a.apk', filepath: '/x/a.apk', teamId: 'team-a' },
  'app-b': { id: 'app-b', name: 'b.apk', filepath: '/x/b.apk', teamId: 'team-b' },
};

function buildApp(teamIds: string[] | undefined) {
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();
  const role = teamIds === undefined ? 'ADMIN' : 'MEMBER';
  apiRouter.use((req, _res, next) => {
    (req as any).auth = {
      kind: 'user-session',
      userId: 'usr_me',
      role,
      scopes: scopesForRole(role),
      rateLimit: 100,
      teamIds,
    };
    next();
  });
  ControlRouter.register(apiRouter);
  app.use('/xenon/api', apiRouter);
  return app;
}

describe('POST /control/:udid/install-repository-app follows the app team rule', () => {
  let manager: AndroidDeviceManager;
  let restore: () => void;

  beforeEach(() => {
    restore = saveRegistrations(ApiKeyService, XenonManager);
    manager = new AndroidDeviceManager();
    // A shared phone, so the device team guard lets every caller through.
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => ({
        udid: UDID,
        host: '127.0.0.1',
        platform: 'android',
        busy: false,
        session_id: null,
        teamId: null,
      }),
    } as any);
    sinon.stub(APP_SERVICE, 'getAppById').callsFake(async (id: string) => APPS[id] ?? null);
    Container.set(ApiKeyService, new ApiKeyService());
    Container.set(XenonManager, { deviceInstances: async () => [manager] } as any);
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  const install = (teamIds: string[] | undefined, appId: string) =>
    request(buildApp(teamIds))
      .post(`/xenon/api/control/${UDID}/install-repository-app`)
      .send({ appId });

  it("installs a member's team app and a shared one", async () => {
    for (const id of ['app-a', 'app-shared']) {
      const r = await install(['team-a'], id);
      expect(r.status, id).to.equal(200);
    }
    expect(manager.installApp.callCount).to.equal(2);
  });

  it("answers another team's app exactly as an unknown id, installing nothing", async () => {
    const hidden = await install(['team-a'], 'app-b');
    const unknown = await install(['team-a'], 'no-such-app');
    expect(hidden.status).to.equal(404);
    expect(hidden.text).to.equal('App not found in repository');
    expect(unknown.status).to.equal(hidden.status);
    expect(unknown.text).to.equal(hidden.text);
    expect(manager.installApp.called).to.equal(false);
  });

  it('lets an admin install any team’s app', async () => {
    const r = await install(undefined, 'app-b');
    expect(r.status).to.equal(200);
    expect(manager.installApp.calledOnceWith(UDID, '/x/b.apk')).to.equal(true);
  });
});
