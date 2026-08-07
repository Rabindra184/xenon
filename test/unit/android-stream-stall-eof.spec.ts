import 'reflect-metadata';
import http from 'http';
import { expect } from 'chai';
import sinon from 'sinon';
import log from '../../src/logger';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import {
  CaptureHealth,
  CAPTURE_STALL_MS,
} from '../../src/device-managers/android/androidStreamReuse';

// Issue #200, the half that the reuse health check cannot cover. The reuse check
// only runs when someone calls startStream; a recording already in flight when
// the device goes silent never re-enters it. Without this, writeFrame kept
// rewriting the last good JPEG every 60ms and ffmpeg recorded a still image into
// an mp4 that ffprobe calls perfectly healthy.

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeService() {
  // Bypass the constructor: it starts a 1h watchdog interval.
  return Object.create(AndroidStreamService.prototype) as any;
}

describe('Android MJPEG server: a stalled capture ends client responses', () => {
  let server: http.Server | undefined;

  afterEach(() => {
    try {
      server?.close();
    } catch {
      /* ignore */
    }
    server = undefined;
    sinon.restore();
  });

  it('logs the stall itself, without depending on the capture loop', async () => {
    // The cable-pull run on a real S9+ found this. Ending the response drops
    // viewerCount to 0; shouldIdleCapture then stops the capture loop attempting
    // anything more, so the failure that would have crossed the threshold never
    // happens and the catch never warns. Live numbers: 10 failures spanning
    // 9.214s against a 10s threshold, then silence — a device that had vanished
    // produced no warning at all, which is precisely what the warn exists for.
    //
    // There is deliberately no capture loop in this test: the announcement must
    // come from the path that actually notices.
    const warn = sinon.stub(log, 'warn');
    const svc = makeService();
    const session: any = {
      udid: 'android-3',
      mjpegPort: 0,
      server: null,
      status: 'running',
      latestFrame: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      latestFrameTimestamp: Date.now(),
      lastViewerAt: Date.now(),
      viewerCount: 0,
      captureHealth: new CaptureHealth(),
    };
    const now = Date.now();
    session.captureHealth.recordFailure(now - CAPTURE_STALL_MS * 2, now);

    server = await svc.createAndListenMjpegServer(session, 0);
    const port = (server as http.Server).address() as any;

    await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: port.port, path: '/' }, resolve);
      req.on('error', reject);
    });
    await delay(200);

    const stallWarnings = warn
      .getCalls()
      .map((c) => String(c.args[0]))
      .filter((m) => /has not answered screencap/.test(m));
    expect(stallWarnings.length, 'the stall must be logged exactly once').to.equal(1);
    expect(stallWarnings[0]).to.match(/android-3/);
  });

  it('serves frames while healthy, then EOFs once the device goes silent', async () => {
    const svc = makeService();
    const session: any = {
      udid: 'android-1',
      mjpegPort: 0,
      server: null,
      status: 'running',
      latestFrame: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      latestFrameTimestamp: Date.now(),
      lastViewerAt: Date.now(),
      viewerCount: 0,
      captureHealth: new CaptureHealth(),
    };

    // Port 0 → the OS picks a free one, so this never collides with a real lease.
    server = await svc.createAndListenMjpegServer(session, 0);
    const port = (server!.address() as any).port;

    const received: Buffer[] = [];
    let ended = false;
    const res: http.IncomingMessage = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, resolve);
      req.on('error', reject);
    });
    res.on('data', (c: Buffer) => received.push(c));
    res.on('end', () => {
      ended = true;
    });

    await delay(250);
    expect(
      Buffer.concat(received).length,
      'frames flow while the device answers',
    ).to.be.greaterThan(0);
    expect(ended, 'a healthy stream stays open').to.equal(false);

    // The device stops answering: dated far enough back to be past the grace window.
    const now = Date.now();
    session.captureHealth.recordFailure(now - CAPTURE_STALL_MS * 2, now);

    await delay(300);
    expect(ended, 'the response must end rather than serve a frozen frame').to.equal(true);

    const bytesAtEof = Buffer.concat(received).length;
    await delay(200);
    expect(Buffer.concat(received).length, 'nothing is written after EOF').to.equal(bytesAtEof);
  });

  it('does not EOF for a capture failure inside the grace window', async () => {
    // A single failed screencap, or the device briefly held by the interaction
    // lock, must not tear down a live preview or an in-flight recording.
    const svc = makeService();
    const session: any = {
      udid: 'android-2',
      mjpegPort: 0,
      server: null,
      status: 'running',
      latestFrame: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      latestFrameTimestamp: Date.now(),
      lastViewerAt: Date.now(),
      viewerCount: 0,
      captureHealth: new CaptureHealth(),
    };

    server = await svc.createAndListenMjpegServer(session, 0);
    const port = (server!.address() as any).port;

    let ended = false;
    const res: http.IncomingMessage = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, resolve);
      req.on('error', reject);
    });
    res.on('data', () => undefined);
    res.on('end', () => {
      ended = true;
    });

    const now = Date.now();
    session.captureHealth.recordFailure(now, now); // just started failing

    await delay(300);
    expect(ended, 'a transient failure must not disconnect clients').to.equal(false);
  });
});
