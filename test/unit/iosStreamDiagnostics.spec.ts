import { expect } from 'chai';
import {
  classifyTunnelStderr,
  isMissingWdaError,
  isOwnStreamProcess,
  isWdaLaunchFailure,
  missingWdaMessage,
  wdaLaunchFailureMessage,
} from '../../src/device-managers/ios/iosStreamDiagnostics';

/**
 * Both verbatim from a real go-ios run log, and the whole point is that they
 * mean opposite things: reinstall the app, versus trust the app that is
 * already installed.
 */
const GO_IOS_MISSING =
  `{"level":"ERROR","msg":"Failed running WDA","error":"runXUITestWithBundleIdsXcode15Ctx: ` +
  `cannot get test app information: Did not find test app for ` +
  `'com.qasecret.WebDriverAgentRunner.xctrunner' on device. Is it installed?"}`;

const GO_IOS_WONT_LAUNCH =
  `{"level":"ERROR","msg":"Failed running WDA","error":"runXUITestWithBundleIdsXcode15Ctx: ` +
  `cannot start test runner: LaunchAppWithStdIo: failed to launch app: launchApp: ` +
  `failed to get PID: pidFromResponse: could not get pid"}`;

describe('iosStreamDiagnostics', () => {
  describe('isMissingWdaError', () => {
    it('detects the go-ios "Did not find test app" WDA crash', () => {
      const log =
        `setup test config: Did not find test app for ` +
        `'com.qasecret.WebDriverAgentRunner.xctrunner' on device. Is it installed?`;
      expect(isMissingWdaError(log)).to.equal(true);
    });

    it('detects a "WebDriverAgentRunner ... not installed" phrasing', () => {
      expect(isMissingWdaError('WebDriverAgentRunner app is not installed on the device')).to.equal(
        true,
      );
    });

    it('does not flag unrelated WDA crash logs', () => {
      expect(isMissingWdaError('WDA crashed: signal 11 (SIGSEGV)')).to.equal(false);
    });

    it('is safe on empty input', () => {
      expect(isMissingWdaError('')).to.equal(false);
    });

    it('produces an actionable message naming the udid', () => {
      const msg = missingWdaMessage('c008789a75');
      expect(msg).to.contain('c008789a75');
      expect(msg).to.contain('WebDriverAgent');
      expect(msg.toLowerCase()).to.contain('install');
    });
  });

  describe('telling "not installed" apart from "would not start"', () => {
    it('reads the real missing-app log as missing', () => {
      expect(isMissingWdaError(GO_IOS_MISSING)).to.equal(true);
      expect(isWdaLaunchFailure(GO_IOS_MISSING)).to.equal(false);
    });

    it('reads the real launch-failure log as a launch failure, not as missing', () => {
      // This is the one that was reported as "WebDriverAgent is not installed"
      // against a device where it demonstrably was installed, sending the
      // reader off to reinstall an app that was already there.
      expect(isWdaLaunchFailure(GO_IOS_WONT_LAUNCH)).to.equal(true);
      expect(isMissingWdaError(GO_IOS_WONT_LAUNCH)).to.equal(false);
    });

    it('gives the two cases opposite advice', () => {
      expect(missingWdaMessage('udid-1')).to.contain('not installed');
      const launch = wdaLaunchFailureMessage('udid-1');
      expect(launch).to.contain('is installed');
      expect(launch).to.contain('VPN & Device Management');
      expect(launch).to.not.contain('not installed');
    });

    it('is safe on empty input', () => {
      expect(isWdaLaunchFailure('')).to.equal(false);
    });

    it('is why the run log must be truncated per run', () => {
      // These classifiers read a file, and the file used to be appended to
      // across runs. A stale "Did not find test app" from a previous day still
      // wins over today's launch failure — which is exactly how an installed
      // WDA came to be reported as missing. IOSStreamService now empties the
      // log before each spawn; this pins what happens if it stops.
      const stale = `${GO_IOS_MISSING}\n${GO_IOS_WONT_LAUNCH}`;
      expect(isMissingWdaError(stale)).to.equal(true);
      expect(isWdaLaunchFailure(stale)).to.equal(true);
    });

    it('does not flag an unrelated crash as either', () => {
      const crash = 'WDA crashed: signal 11 (SIGSEGV)';
      expect(isMissingWdaError(crash)).to.equal(false);
      expect(isWdaLaunchFailure(crash)).to.equal(false);
    });
  });

  describe('classifyTunnelStderr', () => {
    it('extracts the real target udid from the go-ios JSON payload', () => {
      const line = JSON.stringify({
        error: 'manualPairingTunnelStart: unsupported iOS version 15.8.8',
        level: 'warning',
        msg: 'failed to start tunnel',
        udid: 'c008789a75aac6b5cfb1c014e306beeb5d45b85d',
      });
      expect(classifyTunnelStderr(line)).to.deep.equal({
        unsupported: true,
        udid: 'c008789a75aac6b5cfb1c014e306beeb5d45b85d',
      });
    });

    it('recovers the udid via regex when the chunk is not clean JSON', () => {
      const noisy =
        'time=... level=warning "error":"unsupported iOS version 15.8.8" "udid":"abc123" trailing';
      expect(classifyTunnelStderr(noisy)).to.deep.equal({ unsupported: true, udid: 'abc123' });
    });

    it('reports unsupported with a null udid when none can be parsed', () => {
      expect(classifyTunnelStderr('go-ios: unsupported iOS version 15.8.8')).to.deep.equal({
        unsupported: true,
        udid: null,
      });
    });

    it('classifies ordinary tunnel stderr as not-unsupported', () => {
      expect(classifyTunnelStderr('tunnel established on port 60105')).to.deep.equal({
        unsupported: false,
        udid: null,
      });
    });

    it('is safe on empty input', () => {
      expect(classifyTunnelStderr('')).to.deep.equal({ unsupported: false, udid: null });
    });
  });

  describe('isOwnStreamProcess', () => {
    const udid = '00008110-00084CE80E51401E';

    it('claims an iproxy forward for this udid', () => {
      expect(isOwnStreamProcess(`iproxy -u ${udid} 9101:9100`, udid)).to.equal(true);
    });

    it('claims a go-ios/WDA process for this udid', () => {
      expect(
        isOwnStreamProcess(`/root/.cache/xenon/goIOS/ios runwda --udid ${udid}`, udid),
      ).to.equal(true);
    });

    it('does NOT claim a neighbour process bound to the same port under a different udid', () => {
      // The Android stream leased port 9100; an iOS device defaulting to 9100
      // must not kill it during cleanup.
      expect(isOwnStreamProcess('iproxy -u 381103b720057ece 9100:9100', udid)).to.equal(false);
    });

    it('does NOT claim a process with no udid in its command', () => {
      expect(isOwnStreamProcess('node /opt/app/android-stream-capture.js', udid)).to.equal(false);
    });

    it('is safe on empty command or udid', () => {
      expect(isOwnStreamProcess('', udid)).to.equal(false);
      expect(isOwnStreamProcess(`iproxy -u ${udid}`, '')).to.equal(false);
    });
  });
});
