import 'reflect-metadata';
import http from 'http';
import type { AddressInfo } from 'net';
import { expect } from 'chai';
import { Container } from 'typedi';
import { WebSocket } from 'ws';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
import type { H264Packet } from '../../src/device-managers/android/H264Multiplexer';
import { attachH264Ws } from '../../src/app/ws/h264StreamWs';
import { PluginContext } from '../../src/PluginContext';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * Which viewers an H.264 capture outlives once a page has asked for MJPEG.
 *
 * A page whose H.264 player fails (a device control page, or a Live devices
 * tile) asks for MJPEG (`stream/start` with `player: 'mjpeg'`). The phone may
 * have other viewers still playing its H.264 preview: another tile, another
 * tab, another admin. Ending the capture under them froze their picture on
 * its last frame. So the capture ends when nobody watches it: at once if
 * nobody does, else the moment the last one leaves, and never after the
 * ten-minute idle wait an unwatched H.264 capture otherwise gets.
 */

const UDID = 'R58M123';
const key = (n: number): H264Packet => ({ type: 'key', data: Buffer.from([n]), ptsMs: n });

// The capture seam (openCapture) is stubbed, as in android-h264-service.spec.ts.
function make(): any {
  const svc: any = Object.create(AndroidH264StreamService.prototype);
  svc.sessions = new Map();
  svc.startPromises = new Map();
  svc.scrcpyIncompatible = new Set();
  return svc;
}

/** A service whose next capture is under the test's control. */
function withCapture() {
  const svc = make();
  const capture: { kills: number; push: (p: H264Packet) => void } = {
    kills: 0,
    push: () => undefined,
  };
  let release: () => void = () => undefined;
  let held = false;
  svc.openCapture = async (_udid: string, onPacket: (p: H264Packet) => void) => {
    capture.push = onPacket;
    if (held) await new Promise<void>((r) => (release = r));
    onPacket({ type: 'config', data: Buffer.from([0]), ptsMs: 0 });
    return {
      kill: () => {
        capture.kills += 1;
      },
    };
  };
  return {
    svc,
    capture,
    /** Keep the next capture starting until `finishStart()`. */
    holdStart: () => (held = true),
    finishStart: () => release(),
  };
}

/** A viewer's socket: what it received, and how it leaves. */
function watch(mux: any) {
  const got: string[] = [];
  const leave = mux.addClient((p: H264Packet) => got.push(p.type));
  return { got, leave };
}

/** Waits for `done()`, a few milliseconds at a time: a socket's close lands on the server later. */
async function until(done: () => boolean, what: string): Promise<void> {
  const by = Date.now() + 2000;
  while (!done()) {
    if (Date.now() > by) throw new Error(`timed out waiting until ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('AndroidH264StreamService: a page that asks for MJPEG', () => {
  const loopback = loopbackServers();
  let restoreContainer: () => void;
  beforeEach(() => {
    restoreContainer = saveRegistrations(PluginContext);
    Container.set(PluginContext, { pluginArgs: {} });
  });
  afterEach(async () => {
    restoreContainer();
    await loopback.closeAll();
  });

  it('ends the H.264 capture at once when nobody watches it', async () => {
    const { svc, capture } = withCapture();
    await svc.start(UDID);

    await svc.endWhenUnwatched(UDID);

    expect(capture.kills).to.equal(1);
    expect(svc.getMultiplexer(UDID)).to.equal(undefined);
  });

  it('keeps it for a viewer still playing it', async () => {
    const { svc, capture } = withCapture();
    const viewer = watch(await svc.start(UDID));

    await svc.endWhenUnwatched(UDID);

    expect(capture.kills).to.equal(0);
    capture.push(key(1));
    expect(viewer.got).to.deep.equal(['config', 'key']);
  });

  it('ends it the moment its last viewer leaves, not after the idle wait', async () => {
    const { svc, capture } = withCapture();
    const mux = await svc.start(UDID);
    const a = watch(mux);
    const b = watch(mux);

    await svc.endWhenUnwatched(UDID);
    a.leave();
    expect(capture.kills, 'b still plays it').to.equal(0);
    b.leave();

    expect(capture.kills).to.equal(1);
    expect(svc.getMultiplexer(UDID)).to.equal(undefined);
  });

  it('serves a viewer who joins before then, and ends when they leave too', async () => {
    const { svc, capture } = withCapture();
    const a = watch(await svc.start(UDID));
    await svc.endWhenUnwatched(UDID);

    const late = watch(await svc.start(UDID));
    a.leave();
    expect(capture.kills).to.equal(0);
    capture.push(key(2));
    expect(late.got).to.include('key');

    late.leave();
    expect(capture.kills).to.equal(1);
  });

  it('does nothing when no H.264 capture runs for the phone', async () => {
    const { svc, capture } = withCapture();

    await svc.endWhenUnwatched(UDID);

    expect(capture.kills).to.equal(0);
    expect(svc.getMultiplexer(UDID)).to.equal(undefined);
  });

  it('leaves a capture that is still starting to the viewer starting it', async () => {
    // A tile's socket starts the capture it is about to watch: ending it
    // mid-start would leave that capture running with nothing to stop it.
    const { svc, capture, holdStart, finishStart } = withCapture();
    holdStart();
    const starting = svc.start(UDID);
    await Promise.resolve();

    await svc.endWhenUnwatched(UDID);
    finishStart();
    const viewer = watch(await starting);
    expect(capture.kills).to.equal(0);

    viewer.leave();
    expect(capture.kills).to.equal(1);
  });

  it('ends a capture whose viewer never came at the watchdog’s next look', async () => {
    const { svc, capture, holdStart, finishStart } = withCapture();
    holdStart();
    const starting = svc.start(UDID);
    await Promise.resolve();
    await svc.endWhenUnwatched(UDID);
    finishStart();
    await starting;

    svc.sweep(Date.now());

    expect(capture.kills).to.equal(1);
  });

  it('keeps the idle wait for a capture no page asked to end', async () => {
    const { svc, capture } = withCapture();
    await svc.start(UDID);

    svc.sweep(Date.now());
    svc.sweep(Date.now() + 60_000);

    expect(capture.kills).to.equal(0);
    expect(svc.getMultiplexer(UDID)).to.not.equal(undefined);
  });

  it('does not end a newer capture when an older one’s last viewer leaves', async () => {
    const { svc, capture } = withCapture();
    const old = watch(await svc.start(UDID));
    await svc.endWhenUnwatched(UDID);
    await svc.stop(UDID); // a recording took the phone, say
    expect(capture.kills).to.equal(1);

    await svc.start(UDID);
    old.leave();

    expect(capture.kills).to.equal(1);
    expect(svc.getMultiplexer(UDID)).to.not.equal(undefined);
  });

  it('ends it when the last viewer’s H.264 socket closes', async () => {
    // The socket route (h264StreamWs.ts), as a tile's player opens and closes it.
    const { svc, capture } = withCapture();
    const server = await loopback.serve(http.createServer());
    attachH264Ws(server, {
      redeem: async () => ({ actorId: 'usr_alice' }),
      startStream: (udid) => svc.start(udid),
    });
    const { port } = server.address() as AddressInfo;
    // The config packet is sent the moment the socket joins the multiplexer.
    const viewer = () =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/xenon/api/control/${UDID}/stream/h264?ticket=t`,
        );
        ws.once('message', () => resolve(ws));
        ws.once('error', reject);
      });
    const tile = await viewer();
    const otherTab = await viewer();
    const viewers = () => svc.getMultiplexer(UDID)?.clientCount ?? 0;

    await svc.endWhenUnwatched(UDID);
    tile.close();
    await until(() => viewers() === 1, 'the tile’s socket has left');
    expect(capture.kills, 'the other tab still plays it').to.equal(0);

    otherTab.close();
    await until(() => capture.kills === 1, 'the capture has ended');
    expect(svc.getMultiplexer(UDID)).to.equal(undefined);
  });
});

/**
 * A capture stopped while viewers still play it: a recording starting on the
 * phone (ensureMjpegForRecording), or a stream/stop. Their sockets stayed open
 * with no frames, so the picture froze on its last frame and the page never
 * fell back to MJPEG.
 */
describe('AndroidH264StreamService: a capture stopped under its viewers', () => {
  const loopback = loopbackServers();
  let restoreContainer: () => void;
  beforeEach(() => {
    restoreContainer = saveRegistrations(PluginContext);
    Container.set(PluginContext, { pluginArgs: {} });
  });
  afterEach(async () => {
    restoreContainer();
    await loopback.closeAll();
  });

  it('closes its viewers’ sockets with 1012 when the capture is stopped under them', async () => {
    // 1012 says the stream ended: the player shows MJPEG, without asking the
    // server to end an H.264 capture that is already gone.
    const { svc, capture } = withCapture();
    const server = await loopback.serve(http.createServer());
    attachH264Ws(server, {
      redeem: async () => ({ actorId: 'usr_alice' }),
      startStream: (udid) => svc.start(udid),
    });
    const { port } = server.address() as AddressInfo;
    const sockets: WebSocket[] = [];
    // How the socket ended, or 'still open' if it hadn't within 2 s.
    const viewer = () =>
      new Promise<{ closed: Promise<[number, string] | 'still open'> }>((resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/xenon/api/control/${UDID}/stream/h264?ticket=t`,
        );
        sockets.push(ws);
        const closed = new Promise<[number, string] | 'still open'>((r) => {
          const timer = setTimeout(() => r('still open'), 2000);
          ws.once('close', (code, reason) => {
            clearTimeout(timer);
            r([code, reason.toString()]);
          });
        });
        ws.once('message', () => resolve({ closed }));
        ws.once('error', reject);
      });
    try {
      const tile = await viewer();
      const otherTab = await viewer();

      await svc.stop(UDID);

      expect(await tile.closed).to.deep.equal([1012, 'stream ended']);
      expect(await otherTab.closed).to.deep.equal([1012, 'stream ended']);
    } finally {
      sockets.forEach((ws) => ws.terminate());
    }
    expect(capture.kills).to.equal(1);
  });
});
