import { expect } from 'chai';
import {
  decideAndroidStreamReuse,
  AndroidStreamSessionView,
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

  it('reports the most fundamental failure first', () => {
    // A session that is neither running nor listening is reported as
    // 'not-running' — the reason drives a log line, so it should name the cause
    // rather than a downstream consequence of it.
    expect(
      decideAndroidStreamReuse({ status: 'stopped', serverListening: false, hasFrame: false }),
    ).to.deep.equal({ reuse: false, reason: 'not-running' });
  });
});
