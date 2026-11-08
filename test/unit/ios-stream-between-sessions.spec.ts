import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { Container } from 'typedi';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { APP_SERVICE } from '../../src/dashboard/services/app-service';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { SocketServer } from '../../src/services/SocketServer';
import { PluginContext } from '../../src/PluginContext';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * Every iOS session on a real iPhone started WebDriverAgent again: about 9 s
 * before the driver ran, measured on 2.19.0 (Xenon Test's ENH-15). Of that,
 * 2 s were a fixed wait after the stream had already answered, and the rest
 * was the stream a session's end had stopped. A server can now keep that
 * stream for the next session.
 */
describe("an iPhone's WebDriverAgent between sessions", () => {
  const IPHONE = { udid: 'iphone-1', host: 'h', platform: 'ios', realDevice: true } as any;
  const SIMULATOR = { udid: 'sim-1', host: 'h', platform: 'ios', realDevice: false } as any;
  let restore: () => void;
  let savedArgs: any;
  let ios: {
    keepForNextSession: sinon.SinonStub;
    getStreamStatus: sinon.SinonStub;
    stopStream: sinon.SinonStub;
  };

  beforeEach(() => {
    restore = saveRegistrations(IOSStreamService, AndroidStreamService, SocketServer);
    ios = {
      keepForNextSession: sinon.stub().returns(true),
      getStreamStatus: sinon.stub().returns({ status: 'running', viewerCount: 0 }),
      stopStream: sinon.stub().resolves(),
    };
    Container.set(IOSStreamService, ios as any);
    Container.set(AndroidStreamService, { getStreamStatus: () => undefined } as any);
    Container.set(SocketServer, { emitToDashboardForDevices: async () => undefined } as any);
    const context = Container.get(PluginContext);
    savedArgs = context.pluginArgs;
  });

  afterEach(() => {
    Container.get(PluginContext).pluginArgs = savedArgs;
    sinon.restore();
    restore();
  });

  const keepOption = (on: boolean) => {
    const context = Container.get(PluginContext);
    context.pluginArgs = { ...context.pluginArgs, keepIosStreamBetweenSessions: on };
  };
  const teardown = (device: any) =>
    (DASHBORD_EVENT_MANAGER as any).stopIdleStreamForDevice(device) as Promise<void>;

  describe("at a session's end", () => {
    it('stops the stream, as before, with keepIosStreamBetweenSessions off', async () => {
      keepOption(false);
      await teardown(IPHONE);

      expect(ios.stopStream.calledOnceWith('iphone-1')).to.equal(true);
      expect(ios.keepForNextSession.called).to.equal(false);
    });

    it('keeps it for the next session with the option on', async () => {
      keepOption(true);
      await teardown(IPHONE);

      expect(ios.keepForNextSession.calledOnceWith('iphone-1')).to.equal(true);
      expect(ios.stopStream.called).to.equal(false);
    });

    it("stops a simulator's, which the session's driver ran", async () => {
      keepOption(true);
      await teardown(SIMULATOR);

      expect(ios.keepForNextSession.called).to.equal(false);
      expect(ios.stopStream.calledOnceWith('sim-1')).to.equal(true);
    });

    it('does as before when there was no running stream to keep', async () => {
      keepOption(true);
      ios.keepForNextSession.returns(false);
      ios.getStreamStatus.returns(undefined);
      await teardown(IPHONE);

      expect(ios.stopStream.called).to.equal(false);
    });
  });

  describe('keepForNextSession', () => {
    function service(sessions: Array<[string, any]>): any {
      const svc: any = Object.create(IOSStreamService.prototype);
      svc.sessions = new Map(sessions);
      return svc;
    }

    it("counts the stream's idle time from the session's end", () => {
      const longAgo = Date.now() - 60 * 60 * 1000;
      const session = { status: 'running', lastViewerAt: longAgo };
      const svc = service([['iphone-1', session]]);

      expect(svc.keepForNextSession('iphone-1')).to.equal(true);
      expect(Date.now() - session.lastViewerAt).to.be.lessThan(1_000);
    });

    it("keeps nothing that isn't running", () => {
      const svc = service([['iphone-1', { status: 'error', lastViewerAt: 0 }]]);
      expect(svc.keepForNextSession('iphone-1')).to.equal(false);
      expect(svc.keepForNextSession('iphone-2')).to.equal(false);
    });
  });

  describe("a session's start", () => {
    let wdaFile: string;

    beforeEach(() => {
      wdaFile = path.join(os.tmpdir(), `xenon-test-wda-start-${process.pid}.ipa`);
      fs.writeFileSync(wdaFile, 'ipa');
      sinon
        .stub(APP_SERVICE, 'getWDAApp')
        .resolves({ id: 'wda-1', md5: 'm', name: 'wda-signed.ipa', filepath: wdaFile } as any);
      sinon.stub(DeviceStoreFactory.getStore(), 'updateDevice').resolves(undefined as any);
      ios.getStreamStatus.returns(undefined);
      (ios as any).startStream = sinon.stub().resolves({ wdaPort: 8123, mjpegPort: 9123 });
    });

    afterEach(() => {
      if (fs.existsSync(wdaFile)) fs.unlinkSync(wdaFile);
    });

    it('points the driver at the stream as soon as it answers, with no fixed wait', async () => {
      const lifecycle: any = Object.create(SessionLifecycleService.prototype);
      lifecycle.logger = { info: () => undefined, warn: () => undefined, debug: () => undefined };
      const caps: any = { alwaysMatch: {}, firstMatch: [{}] };

      const started = Date.now();
      await lifecycle.handleLocalWDAProvisioning(IPHONE, caps);
      const took = Date.now() - started;

      expect(caps.alwaysMatch['appium:webDriverAgentUrl']).to.equal('http://127.0.0.1:8123');
      // Through 2.21 a 2 s wait followed the stream's start.
      expect(took).to.be.lessThan(1_000);
    });

    it("reuses a running stream's WebDriverAgent, a kept one included", async () => {
      ios.getStreamStatus.returns({ status: 'running', wdaPort: 8124, viewerCount: 0 });
      const lifecycle: any = Object.create(SessionLifecycleService.prototype);
      lifecycle.logger = { info: () => undefined, warn: () => undefined, debug: () => undefined };
      const caps: any = { alwaysMatch: {}, firstMatch: [{}] };

      await lifecycle.handleLocalWDAProvisioning(IPHONE, caps);

      expect(caps.alwaysMatch['appium:webDriverAgentUrl']).to.equal('http://127.0.0.1:8124');
      expect((ios as any).startStream.called, 'nothing started').to.equal(false);
    });
  });
});
