import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import ControlRouter, { previewLeaveDeps, previewLeaves } from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { RecordingStore } from '../../src/services/recording/recording-store';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';

const UDID = 'DEV-1';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';

function buildApp(userId: string) {
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();
  apiRouter.use((req, _res, next) => {
    (req as any).auth = {
      kind: 'user-session',
      userId,
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

describe('POST /control/:udid/stream/leave', () => {
  let deviceRow: any;
  let unblock: sinon.SinonStub;
  let androidStop: sinon.SinonStub;
  let h264Stop: sinon.SinonStub;
  let iosStop: sinon.SinonStub;
  let h264Clients: number;
  let mjpegViewers: number;
  let iosViewers: number;
  let restoreContainer: () => void;
  // Served on 127.0.0.1: request(app) listens on every address and connects
  // to 127.0.0.1, where another process's listener on that port can answer.
  const loopback = loopbackServers();

  beforeEach(() => {
    restoreContainer = saveRegistrations(
      ApiKeyService,
      AndroidStreamService,
      AndroidH264StreamService,
      IOSStreamService,
      RecordingStore,
    );
    deviceRow = {
      udid: UDID,
      host: '127.0.0.1',
      platform: 'android',
      busy: true,
      session_id: `manual_${ALICE}_${UDID}`,
    };
    h264Clients = 0;
    mjpegViewers = 0;
    iosViewers = 0;
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => deviceRow,
    } as any);
    unblock = sinon.stub(deviceService, 'unblockDevice').resolves();
    androidStop = sinon.stub().resolves();
    h264Stop = sinon.stub().resolves();
    iosStop = sinon.stub().resolves();
    Container.set(ApiKeyService, new ApiKeyService());
    Container.set(AndroidStreamService, {
      stopStream: androidStop,
      getStreamStatus: () => ({ viewerCount: mjpegViewers }),
    } as any);
    Container.set(AndroidH264StreamService, {
      stop: h264Stop,
      getMultiplexer: () => ({ clientCount: h264Clients }),
    } as any);
    Container.set(IOSStreamService, {
      stopStream: iosStop,
      getStreamStatus: () => ({ viewerCount: iosViewers }),
    } as any);
    Container.set(RecordingStore, {
      activeRecordingFor: async () => null,
      isRecording: async () => false,
    } as any);
  });

  afterEach(async () => {
    sinon.restore();
    restoreContainer();
    await loopback.closeAll();
  });

  describe('the route', () => {
    it('schedules the leave for the holder and answers at once', async () => {
      const leave = sinon.stub(previewLeaves, 'leave');
      const res = await request(await loopback.serve(buildApp(ALICE))).post(
        `/xenon/api/control/${UDID}/stream/leave`,
      );
      expect(res.status, JSON.stringify(res.body)).to.equal(202);
      expect(leave.calledOnceWith(UDID)).to.equal(true);
      // Nothing is stopped yet: that waits for the grace and the viewer count.
      expect(androidStop.called || h264Stop.called || unblock.called).to.equal(false);
    });

    it('refuses someone else’s hold', async () => {
      const leave = sinon.stub(previewLeaves, 'leave');
      const res = await request(await loopback.serve(buildApp(BOB))).post(
        `/xenon/api/control/${UDID}/stream/leave`,
      );
      expect(res.status).to.equal(403);
      expect(leave.called).to.equal(false);
    });

    // A reload leaves and then starts again; the start must win.
    it('stream/start cancels a pending leave', async () => {
      const cancel = sinon.stub(previewLeaves, 'cancel');
      await request(await loopback.serve(buildApp(ALICE))).post(
        `/xenon/api/control/${UDID}/stream/start`,
      );
      expect(cancel.calledWith(UDID)).to.equal(true);
    });
  });

  describe('what a settled leave counts and stops', () => {
    it('counts H.264 and MJPEG viewers on Android', async () => {
      h264Clients = 1;
      mjpegViewers = 2;
      expect(await previewLeaveDeps.viewers(UDID)).to.equal(3);
    });

    it('counts the stream’s viewers on iOS', async () => {
      deviceRow.platform = 'ios';
      iosViewers = 1;
      expect(await previewLeaveDeps.viewers(UDID)).to.equal(1);
    });

    it('stops both Android streams and releases the preview hold', async () => {
      await previewLeaveDeps.stop(UDID);
      expect(androidStop.calledOnceWith(UDID)).to.equal(true);
      expect(h264Stop.calledOnceWith(UDID)).to.equal(true);
      expect(unblock.calledOnce).to.equal(true);
    });

    it('never releases an Appium session’s lock', async () => {
      deviceRow.session_id = 'appium-session-1';
      await previewLeaveDeps.stop(UDID);
      expect(unblock.called).to.equal(false);
    });
  });
});
