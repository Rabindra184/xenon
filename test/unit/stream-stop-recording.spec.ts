import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { RecordingStore } from '../../src/services/recording/recording-store';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
import { scopesForRole } from '../../src/middleware/authMiddleware';

/**
 * POST /control/:udid/stream/stop must not stop the stream under a live
 * recording. The recording reads from that stream: measured 2026-09-26 on a
 * Galaxy S9+, a stream/stop during a 38 s recording left it FAILED at 28 bytes,
 * and dropped the device's lock. Stopping the recording
 * (POST /recordings/:groupId/stop) is the clean way: it keeps the video and
 * releases the device.
 */

const UDID = 'DEV-REC';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';

function buildApp(caller: { userId: string; role?: 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN' }) {
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();
  apiRouter.use((req, _res, next) => {
    const role = caller.role ?? 'MEMBER';
    (req as any).auth = {
      kind: 'user-session',
      userId: caller.userId,
      role,
      scopes: scopesForRole(role),
      rateLimit: 100,
    };
    next();
  });
  ControlRouter.register(apiRouter);
  app.use('/xenon/api', apiRouter);
  return app;
}

describe('POST /control/:udid/stream/stop — a device being recorded', () => {
  let unblock: sinon.SinonStub;
  let androidStop: sinon.SinonStub;
  let h264Stop: sinon.SinonStub;
  let active: { id: string; groupId: string } | null;

  beforeEach(() => {
    active = { id: 'rec-1', groupId: 'grp-1' };
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => ({
        udid: UDID,
        host: '127.0.0.1',
        platform: 'android',
        busy: true,
        session_id: `manual_${ALICE}_${UDID}`,
      }),
    } as any);
    unblock = sinon.stub(deviceService, 'unblockDevice').resolves();
    androidStop = sinon.stub().resolves();
    h264Stop = sinon.stub().resolves();
    Container.set(ApiKeyService, new ApiKeyService());
    Container.set(AndroidStreamService, { stopStream: androidStop } as any);
    Container.set(AndroidH264StreamService, { stop: h264Stop } as any);
    Container.set(IOSStreamService, { stopStream: sinon.stub().resolves() } as any);
    Container.set(RecordingStore, { activeRecordingFor: async () => active } as any);
  });

  afterEach(() => {
    sinon.restore();
    Container.reset();
  });

  const stop = (caller: { userId: string; role?: 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN' }) =>
    request(buildApp(caller)).post(`/xenon/api/control/${UDID}/stream/stop`);

  it('refuses the owner with 409 and names the recording to stop instead', async () => {
    const res = await stop({ userId: ALICE });
    expect(res.status, JSON.stringify(res.body)).to.equal(409);
    expect(res.body).to.deep.include({
      success: false,
      error: 'device_recording',
      message: 'This device is being recorded. Stop the recording first.',
      groupId: 'grp-1',
    });
  });

  it('leaves the stream and the lock untouched', async () => {
    await stop({ userId: ALICE });
    expect(androidStop.called).to.equal(false);
    expect(h264Stop.called).to.equal(false);
    expect(unblock.called).to.equal(false);
  });

  // An admin could force it only by stopping the whole recording group,
  // ending other devices' recordings too; POST /recordings/:groupId/stop is
  // that, done deliberately and cleanly.
  it('refuses an admin too', async () => {
    const res = await stop({ userId: BOB, role: 'ADMIN' });
    expect(res.status).to.equal(409);
    expect(res.body.error).to.equal('device_recording');
    expect(androidStop.called).to.equal(false);
  });

  // Ownership is decided first: someone who may not touch the device learns
  // nothing about the recording on it.
  it('still refuses another user by ownership, without recording details', async () => {
    const res = await stop({ userId: BOB });
    expect(res.status).to.equal(403);
    expect(res.body.error).to.equal('lock_owned_by_another_user');
    expect(res.body.groupId).to.equal(undefined);
  });

  it('stops as before once nothing is recording', async () => {
    active = null;
    const res = await stop({ userId: ALICE });
    expect(res.status).to.equal(200);
    expect(androidStop.calledOnceWith(UDID)).to.equal(true);
    expect(unblock.calledOnce).to.equal(true);
  });
});
