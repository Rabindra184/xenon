import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import * as goIosBinary from '../../src/device-managers/ios/goIosBinary';
import * as tunnelProcess from '../../src/device-managers/ios/tunnelProcess';
import { SingleFlight } from '../../src/helpers/singleFlight';
import { PortAllocator } from '../../src/services/PortAllocator';
import log from '../../src/logger';
import { fakeGoIos } from '../helpers/fake-go-ios';

/**
 * go-ios comes with the plugin, beside its code (goIosBinaryPath). Before 2.18
 * it was downloaded to ~/.cache/xenon/goIOS, so a server upgraded from then
 * can find go-ios of the older Xenon still running there: the start reaps
 * both paths, a shutdown only this server's own.
 *
 * Nothing real runs here: the reap and the check on the binary are stubbed,
 * and so is `process.kill`. The one go-ios command run is a script standing
 * in for it (test/helpers/fake-go-ios.ts).
 */

function iosService(): any {
  // Bypass the constructor: it starts watchdog intervals.
  const svc: any = Object.create(IOSStreamService.prototype);
  svc.sessions = new Map();
  svc.startFlight = new SingleFlight();
  svc.recoveryCooldowns = new Map();
  svc.RECOVERY_COOLDOWN_MS = 30_000;
  svc.goIOSPath = '/nonexistent/go-ios';
  return svc;
}

describe('IOSStreamService and the go-ios that comes with Xenon', () => {
  let service: any;
  let reap: sinon.SinonStub;
  let releasePurpose: sinon.SinonStub;
  let check: sinon.SinonStub;

  beforeEach(() => {
    sinon.stub(process, 'kill');
    reap = sinon.stub(tunnelProcess, 'reapAllOrphanTunnels').resolves(0);
    releasePurpose = sinon.stub(PortAllocator.prototype, 'releasePurpose').resolves();
    check = sinon.stub(goIosBinary, 'checkGoIosBinary');
    service = iosService();
  });

  afterEach(() => sinon.restore());

  describe('reaping go-ios', () => {
    it('reaps only the bundled path at shutdown', async () => {
      await service.cleanup();

      expect(reap.callCount).to.equal(1);
      expect(reap.firstCall.args[0]).to.equal(service.goIOSPath);
    });

    it('reaps the bundled and the legacy path at start', async () => {
      reap.onFirstCall().resolves(2).onSecondCall().resolves(1);
      const info = sinon.stub(log, 'info');

      await service.reapOrphanTunnels({ includeLegacy: true });

      expect(reap.callCount).to.equal(2);
      expect(reap.firstCall.args[0]).to.equal(service.goIOSPath);
      expect(reap.secondCall.args[0]).to.equal(goIosBinary.legacyGoIosBinaryPath());
      expect(releasePurpose.calledOnceWithExactly('tunnel')).to.equal(true);
      expect(info.calledWithMatch(/Reaped 3 orphan go-ios/)).to.equal(true);
    });

    it('still reaps the legacy path when the bundled reap fails', async () => {
      reap.onFirstCall().rejects(new Error('pgrep failed'));
      sinon.stub(log, 'warn');

      await service.reapOrphanTunnels({ includeLegacy: true });

      expect(reap.secondCall.args[0]).to.equal(goIosBinary.legacyGoIosBinaryPath());
      expect(releasePurpose.calledOnceWithExactly('tunnel')).to.equal(true);
    });
  });

  describe('isGoIOSAvailable', () => {
    it('is unavailable, and says why, when the bundled go-ios is missing', async () => {
      check.returns('missing');
      const warn = sinon.stub(log, 'warn');

      expect(await service.isGoIOSAvailable()).to.equal(false);

      expect(check.calledOnceWithExactly(service.goIOSPath)).to.equal(true);
      expect(
        warn.calledWithExactly(goIosBinary.goIosStateMessage('missing', service.goIOSPath)),
      ).to.equal(true);
    });

    it('is available when the check is ok', async () => {
      check.returns('ok');

      expect(await service.isGoIOSAvailable()).to.equal(true);
    });
  });

  // go-ios is under the user's APPIUM_HOME, so its path can hold a quote, a
  // `$` or backticks: it is run as the command, never inside a shell string.
  describe('finding the WebDriverAgent installed on a phone', () => {
    it('asks go-ios for the apps, run as the command, its path in no shell string', async () => {
      const phone = 'test-iphone-00008110-wda';
      const goIos = fakeGoIos(
        ['apps', '--udid', phone],
        JSON.stringify([
          { CFBundleIdentifier: 'com.example.shop', CFBundleName: 'Shop' },
          {
            CFBundleIdentifier: 'com.test.WebDriverAgentRunner.xctrunner',
            CFBundleName: 'WebDriverAgentRunner-Runner',
          },
        ]),
      );
      service.goIOSPath = goIos.binary;
      try {
        expect(await service.detectWDABundleId(phone)).to.equal(
          'com.test.WebDriverAgentRunner.xctrunner',
        );
      } finally {
        goIos.remove();
      }
    });
  });
});
