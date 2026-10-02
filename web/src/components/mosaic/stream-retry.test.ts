import { describe, expect, it } from 'vitest';
import {
  CONNECT_TIMEOUT_MS,
  MAX_AUTO_RETRIES,
  canAutoRetry,
  describeStreamFailure,
  retryDelayMs,
} from './stream-retry';

describe('retry policy', () => {
  it('allows auto-retry up to MAX_AUTO_RETRIES, then stops', () => {
    expect(canAutoRetry(0)).to.equal(true);
    expect(canAutoRetry(MAX_AUTO_RETRIES - 1)).to.equal(true);
    expect(canAutoRetry(MAX_AUTO_RETRIES)).to.equal(false);
    expect(canAutoRetry(MAX_AUTO_RETRIES + 5)).to.equal(false);
  });

  it('uses increasing backoff, clamped to the last step', () => {
    const d0 = retryDelayMs(0);
    const d1 = retryDelayMs(1);
    const d2 = retryDelayMs(2);
    expect(d0).to.be.lessThan(d1);
    expect(d1).to.be.lessThan(d2);
    // Out-of-range attempts clamp to the final (longest) backoff.
    expect(retryDelayMs(99)).to.equal(d2);
    // Negative is treated as the first attempt.
    expect(retryDelayMs(-1)).to.equal(d0);
  });

  it('keeps the connect window under the backend 120s startStream cap', () => {
    expect(CONNECT_TIMEOUT_MS).to.be.greaterThan(0);
    expect(CONNECT_TIMEOUT_MS).to.be.lessThan(120000);
  });
});

describe('describeStreamFailure', () => {
  it('explains a missing WebDriverAgent (iOS 15.8.8 signing / not-installed case)', () => {
    const msg = describeStreamFailure({
      status: 'error',
      lastError:
        "WDA process exited with code 1. Log: Did not find test app for 'com.qasecret.WebDriverAgentRunner.xctrunner' on device.",
    });
    expect(msg).to.match(/WebDriverAgent is not installed/i);
  });

  it('explains an unsupported iOS version tunnel failure', () => {
    const msg = describeStreamFailure({
      lastError: 'manualPairingTunnelStart: unsupported iOS version 15.8.8',
    });
    expect(msg).to.match(/not supported for live streaming/i);
  });

  it('explains a lost tunnel / connection reset', () => {
    expect(describeStreamFailure({ lastError: 'connect ECONNREFUSED 127.0.0.1:8101' })).to.match(
      /connection to the device tunnel/i,
    );
    expect(describeStreamFailure({ lastError: 'Port 8100 connection reset' })).to.match(
      /connection to the device tunnel/i,
    );
  });

  it('explains a tunnel port range that is used up', () => {
    expect(
      describeStreamFailure({ lastError: "Port range for purpose 'tunnel' is exhausted" }),
    ).to.equal(
      'No free tunnel ports on this host (12100–12199 are in use). Stop another iPhone’s preview, then retry.',
    );
  });

  it("explains a tunnel that stopped while starting, in go-ios's words", () => {
    expect(
      describeStreamFailure({
        lastError:
          'The go-ios tunnel for U1 exited before it was ready (exit code 1): failed to start tunnel: listen tcp 127.0.0.1:12101: bind: address already in use',
      }),
    ).to.equal(
      'The device tunnel stopped while starting (go-ios: failed to start tunnel: listen tcp 127.0.0.1:12101: bind: address already in use). Retry; if it keeps failing, unlock the iPhone and check it trusts this Mac.',
    );
  });

  it('explains a tunnel that stopped while starting, when go-ios gave no reason', () => {
    expect(
      describeStreamFailure({
        lastError: 'The go-ios tunnel for U1 exited before it was ready (exit code null)',
      }),
    ).to.equal(
      'The device tunnel stopped while starting. Retry; if it keeps failing, unlock the iPhone and check it trusts this Mac.',
    );
  });

  it('explains a tunnel that came up on another port', () => {
    expect(
      describeStreamFailure({
        lastError:
          'The go-ios tunnel for U1 came up on port 12103, not its leased 12101, so it was stopped',
      }),
    ).to.equal('The device tunnel started on an unexpected port and was stopped. Retry.');
  });

  it('passes through an unrecognized backend error verbatim', () => {
    expect(describeStreamFailure({ lastError: 'something weird happened' })).to.equal(
      'something weird happened',
    );
  });

  it('falls back to a generic message when there is no backend error', () => {
    expect(describeStreamFailure({})).to.match(/couldn’t start the live stream/i);
    expect(describeStreamFailure({ lastError: '   ' })).to.match(/couldn’t start the live stream/i);
  });
});
