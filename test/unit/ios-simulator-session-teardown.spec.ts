import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import * as DeviceService from '../../src/data-service/device-service';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { IDevice } from '../../src/interfaces/IDevice';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { PhoneNetworkRestore } from '../../src/services/network/PhoneNetworkRestore';
import { VideoPipelineService } from '../../src/services/VideoPipelineService';
import { LocalSession } from '../../src/sessions/LocalSession';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * What Xenon does around a session on an iOS simulator, whose WebDriverAgent
 * the XCUITest driver runs on this Mac.
 *
 * A session that passed every command ended failed: its end stopped a
 * performance recording that Xenon starts only on an iPhone, the driver
 * refuses that on a simulator without relaxed security, and the refused stop
 * counted as a failed command of the session. Its video was never written:
 * it was read from the iPhone stream's USB forward (iproxy), which on a
 * simulator forwards nothing, while the simulator's own WebDriverAgent serves
 * the picture on this Mac at the session's mjpegServerPort.
 */
const SIMULATOR = '35429994-B029-4AF4-9634-880B89DAC782';
const IPHONE = '00008150-000E78612168C01C';

const device = (udid: string, realDevice: boolean) =>
  ({
    udid,
    name: 'iPhone 16 Pro',
    platform: 'ios',
    sdk: '18.4',
    host: 'http://127.0.0.1:4723',
    realDevice,
    deviceType: realDevice ? 'real' : 'simulator',
    screenWidth: '402',
    screenHeight: '874',
  }) as unknown as IDevice;

describe('iOS simulator sessions: around the session', function () {
  this.timeout(30_000);

  afterEach(() => sinon.restore());

  describe('the end of a session', () => {
    useScratchDatabase();
    let restoreRegs: () => void;

    beforeEach(() => {
      restoreRegs = saveRegistrations(PhoneNetworkRestore, SessionMetricsService);
      Container.set(PhoneNetworkRestore, { restoreSession: sinon.stub().resolves() } as any);
      Container.set(SessionMetricsService, { stop: sinon.stub().resolves() } as any);
      sinon.stub(DeviceService, 'releaseSessionDevices').resolves();
      sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
      sinon.stub(SESSION_MANAGER, 'removeSession');
    });
    afterEach(() => restoreRegs());

    /** Deletes a session on `phone`; resolves to whether its end stopped a performance recording. */
    async function endSessionOn(phone: IDevice): Promise<boolean> {
      const stopPerformanceRecording = sinon.stub().resolves(null);
      const session = {
        isStopping: false,
        getId: () => 's-1',
        getDevice: () => phone,
        stopPerformanceRecording,
        isVideoRecordingInProgress: () => false,
      };
      sinon.stub(SESSION_MANAGER, 'getSession').returns(session as any);

      await Container.get(SessionLifecycleService).deleteSession(sinon.stub().resolves(), 's-1');
      return stopPerformanceRecording.called;
    }

    it('stops no performance recording on a simulator, where none was started', async () => {
      expect(await endSessionOn(device(SIMULATOR, false))).to.equal(false);
    });

    it("still stops an iPhone's, which Xenon started", async () => {
      expect(await endSessionOn(device(IPHONE, true))).to.equal(true);
    });
  });

  describe('the session video', () => {
    let startRecording: sinon.SinonStub;
    let startStream: sinon.SinonStub;

    beforeEach(() => {
      startRecording = sinon.stub(VideoPipelineService.prototype, 'startRecording').resolves();
      startStream = sinon
        .stub(IOSStreamService.prototype, 'startStream')
        .resolves({ mjpegPort: 9150 } as any);
    });

    const local = (phone: IDevice) =>
      new LocalSession({
        sessionId: 's-video',
        device: phone,
        // The capabilities the driver answered the create with.
        sessionResponse: { udid: phone.udid, wdaLocalPort: 8101, mjpegServerPort: 9101 },
        xenonOption: {},
        driver: { opts: { address: '127.0.0.1', port: 4723, basePath: '/wd/hub' }, sessions: {} },
      });

    it("is read from the simulator's own WebDriverAgent, at the session's MJPEG port", async () => {
      await local(device(SIMULATOR, false)).startVideoRecording();

      expect(startStream.called, 'started the iPhone stream').to.equal(false);
      expect(startRecording.calledOnce).to.equal(true);
      expect(startRecording.firstCall.args[0]).to.deep.include({
        udid: SIMULATOR,
        mjpegPort: 9101,
      });
    });

    it("is still read from an iPhone's stream", async () => {
      await local(device(IPHONE, true)).startVideoRecording();

      expect(startStream.calledOnceWith(IPHONE)).to.equal(true);
      expect(startRecording.firstCall.args[0]).to.deep.include({ udid: IPHONE, mjpegPort: 9150 });
    });
  });
});
