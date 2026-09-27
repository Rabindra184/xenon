import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import * as deviceService from '../../src/data-service/device-service';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { RecordingStore } from '../../src/services/recording/recording-store';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
import {
  mayReleasePreviewHold,
  releaseIdlePreviewHold,
} from '../../src/device-managers/android/previewHold';

const UDID = 'android-1';
const HOLD = `manual_user-1_${UDID}`;

describe('Android live-preview hold', () => {
  let unblock: sinon.SinonStub;
  let device: { udid: string; host: string; session_id: string | null; busy: boolean };
  let use: { h264Clients: number; mjpegViewers: number; recording: boolean };

  beforeEach(() => {
    device = { udid: UDID, host: 'h', session_id: HOLD, busy: true };
    use = { h264Clients: 0, mjpegViewers: 0, recording: false };
    unblock = sinon.stub(deviceService, 'unblockDevice').resolves();
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => device,
    } as any);
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === 'AndroidH264StreamService') {
        return {
          getMultiplexer: () => (use.h264Clients ? { clientCount: use.h264Clients } : undefined),
        } as any;
      }
      if (token === 'AndroidStreamService') {
        return { getStreamStatus: () => ({ viewerCount: use.mjpegViewers }) } as any;
      }
      if (token === RecordingStore) return { isRecording: async () => use.recording } as any;
      return real(token);
    });
  });

  afterEach(() => sinon.restore());

  describe('mayReleasePreviewHold', () => {
    const idle = { sessionId: HOLD, h264Clients: 0, mjpegViewers: 0, recording: false };

    it('allows a preview hold that nothing uses', () => {
      expect(mayReleasePreviewHold(idle)).to.equal(true);
    });

    it('keeps it while anyone watches, over either transport, or a recording runs', () => {
      expect(mayReleasePreviewHold({ ...idle, h264Clients: 1 })).to.equal(false);
      expect(mayReleasePreviewHold({ ...idle, mjpegViewers: 1 })).to.equal(false);
      expect(mayReleasePreviewHold({ ...idle, recording: true })).to.equal(false);
    });

    it('never touches an Appium session, or a device nobody holds', () => {
      expect(mayReleasePreviewHold({ ...idle, sessionId: 'd4098122-appium' })).to.equal(false);
      expect(mayReleasePreviewHold({ ...idle, sessionId: null })).to.equal(false);
    });
  });

  describe('releaseIdlePreviewHold', () => {
    it('releases the hold when nothing uses the device', async () => {
      expect(await releaseIdlePreviewHold(UDID)).to.equal(true);
      expect(unblock.calledOnceWith(UDID, 'h')).to.equal(true);
    });

    it('keeps the hold while an H.264 viewer, an MJPEG viewer or a recording remains', async () => {
      for (const busy of [{ h264Clients: 1 }, { mjpegViewers: 1 }, { recording: true }]) {
        Object.assign(use, { h264Clients: 0, mjpegViewers: 0, recording: false }, busy);
        expect(await releaseIdlePreviewHold(UDID), JSON.stringify(busy)).to.equal(false);
      }
      expect(unblock.called).to.equal(false);
    });
  });

  // Before: the H.264 service stopped an unwatched stream after 10 minutes
  // but left the hold, so with H.264 preview on, a closed tab's hold was
  // never released by the server.
  describe('H.264 idle stop', () => {
    let clock: sinon.SinonFakeTimers;
    beforeEach(() => {
      clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['setInterval', 'Date'] });
    });
    afterEach(() => clock.restore());

    it('releases the hold once nobody has watched for 10 minutes', async () => {
      const svc: any = new AndroidH264StreamService();
      const kill = sinon.spy();
      svc.sessions.set(UDID, { status: 'running', mux: { clientCount: 0 }, capture: { kill } });
      await clock.tickAsync(60_000); // first sweep notes it is empty
      await clock.tickAsync(11 * 60_000);
      expect(kill.called, 'capture stopped').to.equal(true);
      expect(unblock.calledOnceWith(UDID, 'h'), 'hold released').to.equal(true);
    });

    it('keeps the hold if a recording holds the device', async () => {
      use.recording = true;
      const svc: any = new AndroidH264StreamService();
      svc.sessions.set(UDID, {
        status: 'running',
        mux: { clientCount: 0 },
        capture: { kill() {} },
      });
      await clock.tickAsync(12 * 60_000);
      expect(unblock.called).to.equal(false);
    });
  });

  describe('MJPEG stream', () => {
    // Before: checked once an hour, so an abandoned hold lasted up to 70 minutes.
    it('checks for an idle stream every minute', async () => {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['setInterval', 'Date'] });
      try {
        const svc: any = new AndroidStreamService();
        const stop = sinon.stub(svc, 'stopStream').resolves();
        svc.sessions.set(UDID, {
          udid: UDID,
          status: 'running',
          viewerCount: 0,
          lastViewerAt: Date.now() - 11 * 60_000,
        });
        await clock.tickAsync(60_000);
        expect(stop.calledOnceWith(UDID)).to.equal(true);
      } finally {
        clock.restore();
      }
    });

    // One hold covers both transports: stopping an idle MJPEG stream must not
    // drop it under someone watching over H.264.
    it('does not drop the hold on stop while an H.264 viewer remains', async () => {
      use.h264Clients = 1;
      const svc: any = Object.create(AndroidStreamService.prototype);
      svc.sessions = new Map([
        [UDID, { udid: UDID, status: 'running', server: null, viewerCount: 0, lastViewerAt: 0 }],
      ]);
      await svc.stopStream(UDID);
      expect(unblock.called).to.equal(false);
    });
  });
});
