import { expect } from 'chai';
import {
  decideAndroidStreamReuse,
  AndroidStreamSessionView,
  CaptureHealth,
  CAPTURE_STALL_MS,
} from '../../src/device-managers/android/androidStreamReuse';

// Guards issue #196. AndroidStreamService.startStream reused any session marked
// 'running' *or* 'starting' without checking that anything was still serving:
//
//   const existing = this.sessions.get(udid);
//   if (existing && (existing.status === 'running' || existing.status === 'starting')) {
//     return { mjpegPort: existing.mjpegPort };
//   }
//
// so a session whose HTTP server had closed, or which never captured a frame,
// handed every caller — including ensureMjpegForRecording — a port that serves
// nothing. ffmpeg then exits 1 against it and leaves a 0-byte mp4, the same
// silent symptom that took a while to diagnose in #194.

const healthy: AndroidStreamSessionView = {
  status: 'running',
  serverListening: true,
  hasFrame: true,
  captureStalled: false,
};

describe('decideAndroidStreamReuse', () => {
  it('reuses a running session that is listening and has a frame', () => {
    expect(decideAndroidStreamReuse(healthy)).to.deep.equal({ reuse: true });
  });

  it('starts fresh when there is no session', () => {
    expect(decideAndroidStreamReuse(undefined)).to.deep.equal({
      reuse: false,
      reason: 'no-session',
    });
  });

  it("does not treat 'starting' as ready", () => {
    // The bind loop registers the candidate as 'starting' *before* awaiting the
    // listen, so a caller arriving in that window used to get a port that was
    // not yet bound. SingleFlight (#195) closes the concurrent case; this keeps
    // a session left stranded in 'starting' from being handed out later.
    expect(decideAndroidStreamReuse({ ...healthy, status: 'starting' })).to.deep.equal({
      reuse: false,
      reason: 'not-running',
    });
  });

  it('restarts a stopped or errored session', () => {
    for (const status of ['stopped', 'error']) {
      expect(decideAndroidStreamReuse({ ...healthy, status }), status).to.deep.equal({
        reuse: false,
        reason: 'not-running',
      });
    }
  });

  it('restarts a running session whose server is no longer listening', () => {
    expect(decideAndroidStreamReuse({ ...healthy, serverListening: false })).to.deep.equal({
      reuse: false,
      reason: 'server-closed',
    });
  });

  it('restarts a running session that never captured a frame', () => {
    // startStream logs "no frames captured after 5000ms" and goes 'running'
    // anyway, so this state is reachable today: every later caller gets a live
    // socket that emits headers and no JPEGs.
    expect(decideAndroidStreamReuse({ ...healthy, hasFrame: false })).to.deep.equal({
      reuse: false,
      reason: 'no-frame',
    });
  });

  it('restarts a running session whose capture loop has stalled', () => {
    // Issue #200: the device stopped answering (unplugged, adb killed, reboot).
    // The capture loop swallows the errors and keeps status 'running', and
    // latestFrame is never cleared — so a presence-only check reused the session
    // forever and clients received one frozen JPEG at full frame rate.
    expect(decideAndroidStreamReuse({ ...healthy, captureStalled: true })).to.deep.equal({
      reuse: false,
      reason: 'capture-stalled',
    });
  });

  it('reports the most fundamental failure first', () => {
    // The reason drives a log line, so it should name the cause rather than a
    // downstream consequence. 'never captured a frame' outranks 'stopped
    // capturing': a stream that never worked is a different problem from one
    // that worked and then died.
    expect(
      decideAndroidStreamReuse({
        status: 'stopped',
        serverListening: false,
        hasFrame: false,
        captureStalled: true,
      }),
    ).to.deep.equal({ reuse: false, reason: 'not-running' });

    expect(
      decideAndroidStreamReuse({ ...healthy, hasFrame: false, captureStalled: true }),
    ).to.deep.equal({ reuse: false, reason: 'no-frame' });
  });
});

// The signal behind `captureStalled`. Time-based rather than a failure count:
// a screencap that fails fast and one that hits the 15s ADB timeout are very
// different amounts of frozen video for the same count, so "how long has the
// device been silent" is the honest measure.
describe('CaptureHealth', () => {
  const T0 = 1_000_000;

  it('is not stalled before anything has failed', () => {
    expect(new CaptureHealth().isStalled(T0)).to.equal(false);
  });

  it('is not stalled while failures are still inside the grace window', () => {
    const h = new CaptureHealth();
    h.recordFailure(T0, T0);
    expect(h.isStalled(T0 + CAPTURE_STALL_MS - 1), 'one tick short of the threshold').to.equal(
      false,
    );
  });

  it('is stalled once the device has been silent for the threshold', () => {
    const h = new CaptureHealth();
    h.recordFailure(T0, T0);
    expect(h.isStalled(T0 + CAPTURE_STALL_MS)).to.equal(true);
  });

  it('measures from when the failing attempt STARTED, not when it threw', () => {
    // A 15s ADB timeout means the device was already silent for 15s by the time
    // the catch runs. Dating the stall from the throw would add the whole grace
    // window on top of a timeout that already proved the device is gone.
    const h = new CaptureHealth();
    h.recordFailure(T0, T0 + 15_000); // attempt began at T0, threw 15s later
    expect(h.isStalled(T0 + 15_000), 'already past the threshold on the first failure').to.equal(
      true,
    );
    expect(h.failingForMs(T0 + 15_000)).to.equal(15_000);
  });

  it('a successful frame clears the stall', () => {
    const h = new CaptureHealth();
    h.recordFailure(T0, T0);
    expect(h.isStalled(T0 + CAPTURE_STALL_MS)).to.equal(true);
    h.recordSuccess();
    expect(h.isStalled(T0 + CAPTURE_STALL_MS)).to.equal(false);
    expect(h.failingForMs(T0 + CAPTURE_STALL_MS)).to.equal(0);
  });

  it('warns exactly once per stall episode, and again after a recovery', () => {
    const h = new CaptureHealth();
    expect(h.recordFailure(T0, T0).shouldWarn, 'not yet stalled').to.equal(false);
    expect(h.recordFailure(T0, T0 + CAPTURE_STALL_MS).shouldWarn, 'crossing the line').to.equal(
      true,
    );
    expect(
      h.recordFailure(T0, T0 + CAPTURE_STALL_MS + 1).shouldWarn,
      'already warned — must not spam once per second',
    ).to.equal(false);

    h.recordSuccess();
    const T1 = T0 + 60_000;
    h.recordFailure(T1, T1);
    expect(
      h.recordFailure(T1, T1 + CAPTURE_STALL_MS).shouldWarn,
      'a new episode deserves its own warning',
    ).to.equal(true);
  });

  it('counts consecutive failures for the log line and resets them on success', () => {
    const h = new CaptureHealth();
    expect(h.recordFailure(T0, T0).consecutive).to.equal(1);
    expect(h.recordFailure(T0, T0 + 1000).consecutive).to.equal(2);
    h.recordSuccess();
    expect(h.recordFailure(T0, T0 + 2000).consecutive).to.equal(1);
  });
});
