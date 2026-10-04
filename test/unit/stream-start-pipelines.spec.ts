import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { RecordingStore } from '../../src/services/recording/recording-store';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
import { PluginContext } from '../../src/PluginContext';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

/**
 * Which capture pipelines POST /control/:udid/stream/start runs.
 *
 * With `streaming.androidH264` on, the start ran the H.264 service (scrcpy),
 * and device control's `<img>` then asked GET /stream, which ran the screencap
 * MJPEG loop beside it: two captures of one phone, the very thing the comment
 * in the handler says must not happen. Device control, and any browser that
 * cannot decode H.264 (WebCodecs exists only in a secure context, so plain
 * http://hub:4723 has none), shows MJPEG, so it says so when it starts the
 * stream (`player: 'mjpeg'`), and the server then runs MJPEG only.
 */

const UDID = 'DEV-1';

function buildApp() {
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();
  apiRouter.use((req, _res, next) => {
    (req as any).auth = {
      kind: 'user-session',
      userId: 'usr_alice',
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

describe('POST /control/:udid/stream/start: which capture runs', () => {
  useOwnNodeId();
  const loopback = loopbackServers();

  let restoreContainer: () => void;
  let savedArgs: PluginContext['pluginArgs'];
  let mjpegStart: sinon.SinonStub;
  let h264Start: sinon.SinonStub;
  let h264Stop: sinon.SinonStub;
  let h264Running: boolean;
  let row: any;

  const flag = (androidH264: unknown) => {
    Container.get(PluginContext).pluginArgs = {
      ...savedArgs,
      streaming: { androidH264 },
    } as any;
  };

  beforeEach(() => {
    restoreContainer = saveRegistrations(
      AndroidStreamService,
      AndroidH264StreamService,
      IOSStreamService,
      RecordingStore,
    );
    savedArgs = Container.get(PluginContext).pluginArgs;
    row = {
      udid: UDID,
      host: '127.0.0.1',
      nodeId: OWN_NODE_ID,
      platform: 'android',
      busy: false,
      session_id: null,
      screenWidth: '1080',
      screenHeight: '2220',
    };
    sinon.stub(DeviceStoreFactory, 'getStore').returns({ findDevice: async () => row } as any);
    sinon.stub(deviceService, 'blockDevice').resolves();
    h264Running = false;
    mjpegStart = sinon.stub().resolves({ mjpegPort: 9100 });
    h264Start = sinon.stub().callsFake(async () => {
      h264Running = true;
      return {};
    });
    h264Stop = sinon.stub().callsFake(async () => {
      h264Running = false;
    });
    Container.set(AndroidStreamService, {
      startStream: mjpegStart,
      getStreamStatus: () => undefined,
    } as any);
    Container.set(IOSStreamService, { getStreamStatus: () => undefined } as any);
    Container.set(AndroidH264StreamService, {
      start: h264Start,
      stop: h264Stop,
      getMultiplexer: () => (h264Running ? { clientCount: 0 } : undefined),
    } as any);
    Container.set(RecordingStore, { isRecording: async () => false } as any);
  });

  afterEach(async () => {
    sinon.restore();
    Container.get(PluginContext).pluginArgs = savedArgs;
    restoreContainer();
    await loopback.closeAll();
  });

  const start = async (body?: Record<string, unknown>) =>
    request(await loopback.serve(buildApp()))
      .post(`/xenon/api/control/${UDID}/stream/start`)
      .send(body ?? {});

  it('runs the H.264 service alone when the flag is on and the page can play it', async () => {
    flag(true);

    const res = await start();

    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(res.body.type).to.equal('h264');
    expect(res.body.h264Path).to.equal(`/xenon/api/control/${UDID}/stream/h264`);
    expect(h264Start.calledOnce).to.equal(true);
    expect(mjpegStart.called).to.equal(false);
  });

  it('runs the MJPEG capture alone when the page says it shows MJPEG', async () => {
    flag(true);

    const res = await start({ player: 'mjpeg' });

    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(res.body.type).to.equal('mjpeg');
    expect(res.body.streamUrl).to.equal(`/xenon/api/control/${UDID}/stream`);
    expect(mjpegStart.calledOnce).to.equal(true);
    expect(h264Start.called).to.equal(false);
  });

  it('ends an H.264 capture already running for the phone, so the two never overlap', async () => {
    flag(true);
    h264Running = true;

    await start({ player: 'mjpeg' });

    expect(h264Stop.calledOnceWith(UDID)).to.equal(true);
    expect(mjpegStart.calledOnce).to.equal(true);
    expect(h264Running).to.equal(false);
  });

  it('stops the H.264 capture before it starts the MJPEG one', async () => {
    flag(true);
    h264Running = true;

    await start({ player: 'mjpeg' });

    expect(h264Stop.calledBefore(mjpegStart)).to.equal(true);
  });

  it('runs MJPEG alone, and stops nothing, when the flag is off', async () => {
    flag(false);

    const res = await start();

    expect(res.body.type).to.equal('mjpeg');
    expect(mjpegStart.calledOnce).to.equal(true);
    expect(h264Start.called).to.equal(false);
    expect(h264Stop.called).to.equal(false);
  });

  it('ignores a player it does not know, and uses the server’s choice', async () => {
    flag(true);

    const res = await start({ player: 'hologram' });

    expect(res.body.type).to.equal('h264');
    expect(h264Start.calledOnce).to.equal(true);
    expect(mjpegStart.called).to.equal(false);
  });

  it('keeps MJPEG for a phone that is being recorded, as before', async () => {
    flag(true);
    Container.set(RecordingStore, { isRecording: async () => true } as any);

    const res = await start();

    expect(res.body.type).to.equal('mjpeg');
    expect(mjpegStart.calledOnce).to.equal(true);
    expect(h264Start.called).to.equal(false);
  });
});
