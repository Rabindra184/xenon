import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { createRouter } from '../../src/app/index';
import { config } from '../../src/config';
import { useScratchDatabase } from '../helpers/scratch-database';
import sinon from 'sinon';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';

/**
 * Device control's answers say what happened: a missing field is a 400, not
 * a 500 from deep inside the server.
 */
describe('device control answers', () => {
  useScratchDatabase();
  useOwnNodeId();
  const UDID = 'R5CT32ABCDE';
  let app: express.Express;
  let saved: boolean;

  before(() => {
    app = express();
    app.use('/xenon', createRouter({ bindHostOrIp: '127.0.0.1', enableDashboard: true } as any));
  });
  beforeEach(async () => {
    saved = config.authDisabled as boolean;
    config.authDisabled = true;
    // The store, not a row: which store the process uses depends on the specs
    // that ran before this one.
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async (filter: { udid?: string }) =>
        filter?.udid === UDID
          ? {
              udid: UDID,
              host: 'http://127.0.0.1:4723',
              nodeId: OWN_NODE_ID,
              platform: 'android',
              busy: false,
              session_id: null,
              teamId: null,
            }
          : undefined,
    } as any);
  });
  afterEach(() => {
    config.authDisabled = saved;
    sinon.restore();
  });

  // Most routes answered an unknown udid with the text "Device not found",
  // which a JSON client couldn't parse; two answered a different JSON shape.
  for (const [method, action] of [
    ['get', 'screenshot'],
    ['post', 'tap'],
    ['get', 'display'],
    ['get', 'appium-session'],
    ['get', 'logs'],
  ] as const) {
    it(`${method.toUpperCase()} ${action} answers an unknown device with JSON`, async () => {
      const r = await request(app)
        [method](`/xenon/api/control/NO-SUCH-PHONE/${action}`)
        .send({ x: 1, y: 2 })
        .timeout(5000);
      expect(r.status).to.equal(404);
      expect(r.type).to.equal('application/json');
      expect(r.body).to.deep.equal({ error: 'not_found', message: 'Device not found' });
    });
  }

  describe('POST /api/control/:udid/install-repository-app', () => {
    for (const [what, body] of [
      ['no body', {}],
      ['an empty appId', { appId: '' }],
      ['an appId that is not a string', { appId: 42 }],
    ] as const) {
      it(`answers 400 for ${what}`, async () => {
        const r = await request(app)
          .post(`/xenon/api/control/${UDID}/install-repository-app`)
          .send(body)
          .timeout(5000);
        expect(r.status).to.equal(400);
        expect(r.body).to.deep.equal({ error: 'bad_request', message: 'appId is required' });
      });
    }

    it('answers 404 for an app the library does not have', async () => {
      const r = await request(app)
        .post(`/xenon/api/control/${UDID}/install-repository-app`)
        .send({ appId: '6f1d2c3b-0000-4000-8000-000000000000' })
        .timeout(5000);
      expect(r.status).to.equal(404);
    });
  });
});

/**
 * Android's live logs answered 200 when adb failed, with the error inside
 * `logs` as if it were a log line, and the session log stored it as one.
 */
describe('AndroidDeviceManager.getLogs', () => {
  afterEach(() => sinon.restore());

  it('fails when adb fails', async () => {
    const manager = new AndroidDeviceManager({} as any);
    sinon.stub(manager as any, 'getAdb').resolves({
      adbInstance: { adbExec: sinon.stub().rejects(new Error('device offline')) },
    });
    const err = await manager.getLogs('R5CT32ABCDE').then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).to.equal('device offline');
  });

  it('fails when adb is not available', async () => {
    const manager = new AndroidDeviceManager({} as any);
    sinon.stub(manager as any, 'getAdb').resolves({ adbInstance: undefined });
    const err = await manager.getLogs('R5CT32ABCDE').then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).to.equal('ADB is not available');
  });

  it('returns the lines when adb answers', async () => {
    const manager = new AndroidDeviceManager({} as any);
    sinon.stub(manager as any, 'getAdb').resolves({
      adbInstance: { adbExec: sinon.stub().resolves('10-04 09:00:00.000 1 1 I Tag: hello') },
    });
    expect(await manager.getLogs('R5CT32ABCDE')).to.include('hello');
  });
});
