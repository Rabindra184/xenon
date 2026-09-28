import 'reflect-metadata';
import { expect } from 'chai';
import childProcess from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { Container } from 'typedi';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import { SingleFlight } from '../../src/helpers/singleFlight';
import { PortAllocator } from '../../src/services/PortAllocator';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { InternalHttpClient } from '../../src/InternalHttpClient';
import { APP_SERVICE } from '../../src/dashboard/services/app-service';
import { useScratchPortLeases } from '../helpers/scratch-port-leases';

/**
 * Seen on the lab (S9+ 381103b720057ece, iPhone 00008150-000E78612168C01C):
 * the iPhone's live preview and recording showed the S9+'s screen, because
 * both streams ended up on local port 9100.
 *
 *  - A retried iOS start deleted its own port leases: acquire() handed the
 *    iPhone back its existing 8100/9100 leases, then the stale-session cleanup
 *    released "its" ports — the same numbers — so the new stream ran on
 *    unleased ports.
 *  - The allocator's OS probe bound 127.0.0.1, which macOS allows beside
 *    iproxy's IPv6 wildcard listener, so it called 9100 free and leased it to
 *    the S9+.
 *
 * Processes are fakes: an "iproxy" here is a real listener on `::` at its
 * local port, which is what the real one is (`lsof`: `IPv6 TCP *:9100`).
 * Nothing is spawned, and the lease table is a scratch SQLite file.
 */

const IPHONE = 'test-iphone-00008150';
const S9 = 'test-android-s9';

class FakeProcess extends EventEmitter {
  pid = undefined;
  exitCode: number | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  constructor(
    readonly command: string,
    readonly args: string[],
    readonly server?: net.Server,
  ) {
    super();
  }
  kill(): boolean {
    if (this.exitCode === null) this.exitCode = 137;
    if (this.server?.listening) this.server.close();
    return true;
  }
}

/** Bind synchronously, as a real iproxy has by the time its process runs. */
function listenNow(port: number, host = '::'): net.Server {
  const server = net.createServer((socket) => {
    server.emit('accepted');
    socket.destroy();
  });
  server.on('error', () => undefined);
  server.listen(port, host);
  return server;
}

function iosService(): any {
  // Bypass the constructor: it starts watchdog intervals.
  const svc: any = Object.create(IOSStreamService.prototype);
  svc.sessions = new Map();
  svc.startFlight = new SingleFlight();
  svc.recoveryCooldowns = new Map();
  svc.RECOVERY_COOLDOWN_MS = 30_000;
  svc.STREAM_PORT_TTL_MS = 90 * 60 * 1000;
  svc.goIOSPath = '/nonexistent/go-ios';
  return svc;
}

function androidService(): any {
  const svc: any = Object.create(AndroidStreamService.prototype);
  svc.sessions = new Map();
  svc.startFlight = new SingleFlight();
  return svc;
}

describe('iOS stream port leases (fake processes, real sockets, scratch DB)', () => {
  const scratch = useScratchPortLeases();
  let allocator: PortAllocator;
  let devices: Map<string, any>;
  let spawned: FakeProcess[];
  let extraServers: net.Server[];
  let appiumWdaPorts: Set<number>;
  let ios: any;
  let android: any;

  beforeEach(() => {
    allocator = new PortAllocator();
    // iOS and Android share the mjpeg range, as they do on the lab.
    allocator.configure({
      mjpeg: [scratch.base, scratch.base + 9],
      wda: [scratch.base + 50, scratch.base + 59],
    });
    devices = new Map([
      [IPHONE, { udid: IPHONE, host: 'h', platform: 'ios', busy: false, session_id: null }],
      [S9, { udid: S9, host: 'h', platform: 'android', busy: false, session_id: null }],
    ]);
    spawned = [];
    extraServers = [];
    appiumWdaPorts = new Set();

    sinon.stub(process, 'kill');
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === PortAllocator) return allocator;
      if (token === ProcessRegistry) return { track: () => undefined } as any;
      return real(token);
    });
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async ({ udid }: { udid: string }) => devices.get(udid),
      updateDevice: async (udid: string, _host: string, data: any) =>
        Object.assign(devices.get(udid), data),
    } as any);
    sinon.stub(childProcess, 'spawn').callsFake(((command: string, args: string[]) => {
      let server: net.Server | undefined;
      if (command === 'iproxy') {
        server = listenNow(Number(args[args.length - 1].split(':')[0]));
      }
      const proc = new FakeProcess(command, args, server);
      spawned.push(proc);
      return proc;
    }) as any);
    sinon.stub(APP_SERVICE, 'getWDAApp').resolves(null as any);
    sinon.stub(InternalHttpClient, 'get').rejects(new Error('no WDA in tests'));

    ios = iosService();
    // WDA answers on a port when an Appium session forwards it, or when this
    // service's own iproxy forwards it while its runwda is up.
    sinon.stub(ios, 'isWDARunning').callsFake(async (...args: any[]) => {
      const port = args[0] as number;
      if (appiumWdaPorts.has(port)) return true;
      const runwda = spawned.some((p) => p.command === ios.goIOSPath && p.exitCode === null);
      return (
        runwda &&
        spawned.some(
          (p) => p.command === 'iproxy' && p.exitCode === null && p.args.includes(`${port}:8100`),
        )
      );
    });
    sinon.stub(ios, 'cleanupOrphanTunnels').resolves();
    sinon.stub(ios, 'killStaleProcesses').resolves();
    sinon.stub(ios, 'ensureTunnel').resolves(null);
    sinon.stub(ios, 'detectWDABundleId').resolves('com.test.WebDriverAgentRunner.xctrunner');
    sinon.stub(ios, 'updateWDASettings').resolves();
    sinon.stub(ios, 'createWDASession').resolves(null);

    android = androidService();
    sinon.stub(android, 'resolveAdbInvocation').resolves({ adbPath: 'adb', adbHostArgs: [] });
    sinon.stub(android, 'captureLoop').callsFake((...args: any[]) => {
      args[1].latestFrame = Buffer.from([0xff, 0xd8]);
    });
  });

  afterEach(async () => {
    for (const p of spawned) p.kill();
    for (const s of extraServers) if (s.listening) s.close();
    for (const s of android.sessions.values()) s.server?.close();
    sinon.restore();
  });

  after(() => {
    const runLog = path.join(os.tmpdir(), 'xenon-logs', `runwda-${IPHONE}.log`);
    if (fs.existsSync(runLog)) fs.unlinkSync(runLog);
  });

  async function leaseOf(port: number) {
    return scratch.db.portLease.findUnique({ where: { port } });
  }

  /** A start that fails after taking its ports: go-ios missing, say. */
  async function failedIosStart() {
    const goIos = sinon.stub(ios, 'isGoIOSAvailable').resolves(false);
    let err: Error | undefined;
    await ios.startStream(IPHONE).catch((e: Error) => (err = e));
    expect(err?.message).to.equal('go-ios not available');
    expect(ios.getStreamStatus(IPHONE)?.status, 'the failed session stays in the map').to.equal(
      'error',
    );
    goIos.restore();
    // The retry comes after the start cooldown has run out.
    ios.recoveryCooldowns.clear();
  }

  it('a start after a failed start holds leases on both of its ports', async () => {
    await failedIosStart();
    sinon.stub(ios, 'isGoIOSAvailable').resolves(true);

    const { wdaPort, mjpegPort } = await ios.startStream(IPHONE);

    expect(ios.getStreamStatus(IPHONE)?.status).to.equal('running');
    const wda = await leaseOf(wdaPort);
    const mjpeg = await leaseOf(mjpegPort);
    expect(wda?.leasedToUdid, `wda port ${wdaPort} must stay leased to the iPhone`).to.equal(
      IPHONE,
    );
    expect(wda?.purpose).to.equal('wda');
    expect(mjpeg?.leasedToUdid, `mjpeg port ${mjpegPort} must stay leased to the iPhone`).to.equal(
      IPHONE,
    );
    expect(mjpeg?.purpose).to.equal('mjpeg');
  });

  it('stopping a stale iOS session never deletes a lease another device holds', async () => {
    // The S9+ has since been leased the port the stale iPhone session names.
    const now = Date.now();
    await scratch.db.portLease.create({
      data: {
        port: scratch.base,
        purpose: 'mjpeg',
        leasedToUdid: S9,
        leasedAt: now,
        expiresAt: now + 60_000,
      },
    });
    ios.sessions.set(IPHONE, {
      udid: IPHONE,
      wdaProcess: null,
      forwardWDAProcess: null,
      forwardMJPEGProcess: null,
      tunnelProcess: null,
      wdaPort: scratch.base + 50,
      mjpegPort: scratch.base,
      status: 'error',
      lastViewerAt: Date.now(),
      viewerCount: 0,
    });

    await ios.stopStream(IPHONE);

    expect((await leaseOf(scratch.base))?.leasedToUdid, "the S9+'s lease must survive").to.equal(
      S9,
    );
  });

  it("an Android stream never gets the port a retried iOS stream is using (the lab's 9100)", async () => {
    await failedIosStart();
    sinon.stub(ios, 'isGoIOSAvailable').resolves(true);
    const { mjpegPort: iphonePort } = await ios.startStream(IPHONE);
    const iproxy = spawned.find(
      (p) => p.command === 'iproxy' && p.args.includes(`${iphonePort}:9100`),
    )?.server;
    if (!iproxy) throw new Error('no iproxy was spawned for the iPhone mjpeg port');
    expect(iproxy.listening, "the iPhone's iproxy is listening").to.equal(true);

    const { mjpegPort: s9Port } = await android.startStream(S9);

    expect(s9Port, 'the S9+ must be given a different port than the iPhone').to.not.equal(
      iphonePort,
    );
    // And the symptom itself: 127.0.0.1:<iPhone port> still reaches the iPhone.
    const reached = new Promise<boolean>((resolve) => {
      iproxy.once('accepted', () => resolve(true));
      setTimeout(() => resolve(false), 1000);
    });
    net.connect(iphonePort, '127.0.0.1').on('error', () => undefined);
    expect(await reached, "127.0.0.1:<iPhone port> must reach the iPhone's iproxy").to.equal(true);
  });

  describe('attaching to the WDA an Appium session runs', () => {
    it("attaches on the device's WDA port and leases it, without launching a second WDA", async () => {
      const appiumPort = scratch.base + 50;
      Object.assign(devices.get(IPHONE), {
        busy: true,
        session_id: '7f0c5a52-appium-session',
        wdaLocalPort: appiumPort,
      });
      // The xcuitest driver's forwarder: net.Server.listen(port), i.e. `::`.
      extraServers.push(listenNow(appiumPort));
      appiumWdaPorts.add(appiumPort);
      const goIos = sinon.stub(ios, 'isGoIOSAvailable').resolves(true);

      const { wdaPort, mjpegPort } = await ios.startStream(IPHONE);

      expect(wdaPort).to.equal(appiumPort);
      expect(goIos.called, 'must not start a WDA of its own').to.equal(false);
      expect(spawned.some((p) => p.command === ios.goIOSPath)).to.equal(false);
      expect((await leaseOf(appiumPort))?.leasedToUdid).to.equal(IPHONE);
      expect((await leaseOf(mjpegPort))?.leasedToUdid).to.equal(IPHONE);
    });

    it('does not attach to a WDA on that port when no Appium session holds the device', async () => {
      // WDA's /status carries no udid, so an answer on a port the Device row
      // names proves nothing on its own: two rows can carry the same stale
      // port, and the answer may be another phone's.
      const strayPort = scratch.base + 50;
      Object.assign(devices.get(IPHONE), { wdaLocalPort: strayPort });
      extraServers.push(listenNow(strayPort));
      appiumWdaPorts.add(strayPort);
      sinon.stub(ios, 'isGoIOSAvailable').resolves(true);

      const { wdaPort } = await ios.startStream(IPHONE);

      expect(wdaPort).to.not.equal(strayPort);
      expect(
        spawned.some((p) => p.command === ios.goIOSPath),
        'starts its own WDA',
      ).to.equal(true);
    });
  });
});
