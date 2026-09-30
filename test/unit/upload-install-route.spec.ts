import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import ControlRouter, { uploadName } from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { XenonManager } from '../../src/device-managers';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

/**
 * POST /control/:udid/upload-install, device control's "Upload file". No
 * multipart parser was mounted for /control, only for /apps, so every upload
 * was answered "No files were uploaded." and nothing was installed.
 */

const UDID = 'DEV-UPLOAD';
const UPLOADS = path.join(os.tmpdir(), 'xenon-uploads');

// The route finds the manager by constructor name.
class AndroidDeviceManager {
  installed: { path: string; bytes: string }[] = [];
  fail = false;
  installApp = async (_udid: string, appPath: string) => {
    this.installed.push({ path: appPath, bytes: fs.readFileSync(appPath, 'utf8') });
    if (this.fail) throw new Error('INSTALL_FAILED_INVALID_APK');
  };
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

describe('POST /control/:udid/upload-install', () => {
  // The fake row is this server's own phone.
  useOwnNodeId();

  let manager: AndroidDeviceManager;
  let restoreContainer: () => void;
  const loopback = loopbackServers();
  const app = async () => loopback.serve(buildApp());
  const upload = async (bytes: string, name: string) =>
    request(await app())
      .post(`/xenon/api/control/${UDID}/upload-install`)
      .attach('app', Buffer.from(bytes), name);

  beforeEach(() => {
    restoreContainer = saveRegistrations(ApiKeyService, XenonManager);
    manager = new AndroidDeviceManager();
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => ({
        udid: UDID,
        host: '127.0.0.1',
        nodeId: OWN_NODE_ID,
        platform: 'android',
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

  it('installs the uploaded file, under its own extension, in the upload folder', async () => {
    const res = await upload('fake-apk-bytes', 'build-42.apk');

    expect(res.status, res.text).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(manager.installed).to.have.length(1);
    const [{ path: saved, bytes }] = manager.installed;
    expect(bytes).to.equal('fake-apk-bytes');
    expect(path.dirname(saved)).to.equal(UPLOADS);
    expect(saved.endsWith('.apk')).to.equal(true);
  });

  it('keeps a crafted file name inside the upload folder', async () => {
    // Built by hand: the test client's multipart library cuts a file name to
    // its last segment itself, but a client under nobody's control needn't.
    // The parser (busboy) cuts it too; uploadName is tested alone below.
    const boundary = 'xenonboundary';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="app"; filename="a/../../../../../tmp/xenon-escape.apk"',
      'Content-Type: application/octet-stream',
      '',
      'x',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const res = await request(await app())
      .post(`/xenon/api/control/${UDID}/upload-install`)
      .set('content-type', `multipart/form-data; boundary=${boundary}`)
      .send(body);

    expect(res.status, res.text).to.equal(200);
    const [{ path: saved }] = manager.installed;
    expect(path.dirname(saved)).to.equal(UPLOADS);
    expect(fs.existsSync(path.join(os.tmpdir(), 'xenon-escape.apk'))).to.equal(false);
  });

  it('removes the saved file once the install is over, whether it worked or not', async () => {
    await upload('ok', 'one.apk');
    manager.fail = true;
    const failed = await upload('bad', 'two.apk');

    expect(failed.status).to.equal(500);
    expect(failed.body.error).to.include('INSTALL_FAILED_INVALID_APK');
    for (const { path: saved } of manager.installed) {
      expect(fs.existsSync(saved), saved).to.equal(false);
    }
  });

  it('still says so when no file came', async () => {
    const res = await request(await app())
      .post(`/xenon/api/control/${UDID}/upload-install`)
      .send({});
    expect(res.status).to.equal(400);
    expect(manager.installed).to.deep.equal([]);
  });
});

// The saved name, alone: the route's parser already cuts a name to its last
// segment, so this is what holds if one ever doesn't.
describe('uploadName', () => {
  it('keeps only the last path segment, in safe characters, with its extension', () => {
    for (const [name, rest] of [
      ['a/../../../../../tmp/xenon-escape.apk', 'xenon-escape.apk'],
      ['..\\..\\evil.ipa', '_.._evil.ipa'],
      ['My App (1).apk', 'My_App_1_.apk'],
      ['..', 'app'],
      ['', 'app'],
    ]) {
      const saved = uploadName(name);
      expect(saved, name).to.match(/^\d+-/);
      expect(saved.replace(/^\d+-/, ''), name).to.equal(rest);
      expect(path.basename(saved), name).to.equal(saved);
    }
  });
});
