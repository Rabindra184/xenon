import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import IOSStreamService, {
  shouldStopIdleIosStream,
} from '../../src/device-managers/ios/IOSStreamService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { RecordingStore } from '../../src/services/recording/recording-store';

const UDID = '00008150-000E78612168C01C';
const HOLD = `manual_user-1_${UDID}`;
const MIN = 60_000;

describe('iOS stream: an abandoned preview hold', () => {
  describe('shouldStopIdleIosStream', () => {
    const idle = { idleMs: 11 * MIN, viewers: 0, sessionId: HOLD, recording: false };

    it('stops a preview nobody has watched for 10 minutes', () => {
      expect(shouldStopIdleIosStream(idle)).to.equal(true);
      expect(shouldStopIdleIosStream({ ...idle, sessionId: null })).to.equal(true);
    });

    it('keeps it while watched, recently watched, or recording', () => {
      expect(shouldStopIdleIosStream({ ...idle, viewers: 1 })).to.equal(false);
      expect(shouldStopIdleIosStream({ ...idle, idleMs: 9 * MIN })).to.equal(false);
      expect(shouldStopIdleIosStream({ ...idle, recording: true })).to.equal(false);
    });

    it('never stops a stream an Appium session relies on', () => {
      expect(shouldStopIdleIosStream({ ...idle, sessionId: 'appium-session-1' })).to.equal(false);
    });
  });

  describe('the watchdog', () => {
    let clock: sinon.SinonFakeTimers;
    let device: { udid: string; host: string; busy: boolean; session_id: string | null };
    let recording: boolean;
    let svc: any;
    let stop: sinon.SinonStub;
    let responsive: sinon.SinonStub;

    beforeEach(() => {
      clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['setInterval', 'Date'] });
      device = { udid: UDID, host: 'h', busy: true, session_id: HOLD };
      recording = false;
      sinon.stub(process, 'kill');
      sinon.stub(DeviceStoreFactory, 'getStore').returns({
        findDevice: async () => device,
      } as any);
      const real = Container.get.bind(Container);
      sinon.stub(Container, 'get').callsFake((token: any) => {
        if (token === RecordingStore) return { isRecording: async () => recording } as any;
        return real(token);
      });
      svc = new IOSStreamService();
      stop = sinon.stub(svc, 'stopStream').resolves();
      responsive = sinon.stub(svc, 'isStreamResponsive').resolves(true);
      svc.sessions.set(UDID, {
        status: 'running',
        viewerCount: 0,
        lastViewerAt: Date.now() - 11 * MIN,
        wdaPort: 8100,
        mjpegPort: 9100,
      });
    });

    afterEach(() => {
      clock.restore();
      sinon.restore();
    });

    // Before: the idle check ran hourly and kept every busy device, and a
    // preview hold marks the device busy, so an abandoned hold was never
    // released on iOS.
    it('releases an unwatched preview hold within a minute of the 10-minute mark', async () => {
      await clock.tickAsync(MIN);
      expect(stop.calledOnceWith(UDID)).to.equal(true);
    });

    it('keeps a stream an Appium session relies on', async () => {
      device.session_id = 'appium-session-1';
      await clock.tickAsync(MIN);
      expect(stop.called).to.equal(false);
    });

    it('keeps a stream a recording reads', async () => {
      recording = true;
      await clock.tickAsync(MIN);
      expect(stop.called).to.equal(false);
    });

    it('runs the stream health check hourly, not every minute', async () => {
      svc.sessions.get(UDID).lastViewerAt = Date.now(); // watched: not idle
      await clock.tickAsync(MIN);
      expect(responsive.called).to.equal(false);
    });
  });
});
