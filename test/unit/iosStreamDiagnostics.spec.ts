import { expect } from 'chai';
import {
  classifyTunnelStderr,
  isMissingWdaError,
  missingWdaMessage,
} from '../../src/device-managers/ios/iosStreamDiagnostics';

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
});
