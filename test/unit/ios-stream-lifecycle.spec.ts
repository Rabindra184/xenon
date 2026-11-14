import 'reflect-metadata';
import { expect } from 'chai';
import childProcess from 'child_process';
import { EventEmitter } from 'events';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { Container } from 'typedi';
import * as streamModule from '../../src/device-managers/ios/IOSStreamService';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { IOSTunnels } from '../../src/device-managers/ios/IOSTunnels';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
import ControlRouter from '../../src/app/routers/control';
import { SingleFlight } from '../../src/helpers/singleFlight';
import { PortAllocator } from '../../src/services/PortAllocator';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { InternalHttpClient } from '../../src/InternalHttpClient';
import { APP_SERVICE } from '../../src/dashboard/services/app-service';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { PluginContext } from '../../src/PluginContext';
import { useScratchPortLeases } from '../helpers/scratch-port-leases';
import { useScratchDatabase } from '../helpers/scratch-database';
import tcpPortUsed from 'tcp-port-used';
import request from '../helpers/loopbackRequest';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';
import { withFindDevices } from '../helpers/one-row-store';

/**
 * An iPhone stream's starts, restarts and stops (IOSStreamService):
 *
 *  - A restart (a tile's retry after WDA stopped answering) ran stopStream,
 *    which released the phone's preview or recording hold, and nothing wrote
 *    it back: the phone read free while its viewer still watched.
 *  - A stop never cancelled a start still running. The start went on with
 *    its own copy of the entry: its iproxy and runwda ran on with nothing to
 *    end them, and stream/start then wrote the hold a leave had released.
 *  - A failed start left its forwarders and runwda running, and its leases.
 *  - The hourly watchdog recorded its recovery attempt and then called
 *    startStream, which found that attempt and refused: it never healed.
 *
 * Processes are fakes; the lease table is a scratch SQLite file.
 */

const IPHONE = 'test-iphone-lifecycle-00008150';
const HOLD = `manual_usr_alice_${IPHONE}`;

/** StreamStartCancelled, read off the module so this file loads on code without it. */
const isCancelled = (e: unknown) => (e as any)?.constructor?.name === 'StreamStartCancelled';

class FakeProcess extends EventEmitter {
  pid = undefined;
  exitCode: number | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  constructor(
    readonly command: string,
    readonly args: string[],
  ) {
    super();
  }
  kill(): boolean {
    if (this.exitCode === null) this.exitCode = 137;
    return true;
  }
}

async function until(cond: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('iOS stream lifecycle: restarts, stops during a start, failed starts', () => {
  const scratch = useScratchPortLeases();
  let allocator: PortAllocator;
  let device: any;
  let spawned: FakeProcess[];
  let runwdaExits: boolean;
  let unblock: sinon.SinonStub;
  let tunnels: Record<string, sinon.SinonStub>;
  let ios: any;

  const runwdas = () => spawned.filter((p) => p.args[0] === 'runwda');
  const alive = () => spawned.filter((p) => p.exitCode === null);
  const leasesOfIphone = () => scratch.db.portLease.findMany({ where: { leasedToUdid: IPHONE } });

  function stubbedService(svc: any) {
    // WDA answers on a port while a runwda is up and this service's iproxy
    // forwards that port.
    sinon.stub(svc, 'isWDARunning').callsFake(async (...args: any[]) => {
      const port = args[0] as number;
      const runwda = spawned.some((p) => p.args[0] === 'runwda' && p.exitCode === null);
      return (
        runwda &&
        spawned.some(
          (p) => p.command === 'iproxy' && p.exitCode === null && p.args.includes(`${port}:8100`),
        )
      );
    });
    sinon.stub(svc, 'cleanupOrphanTunnels').resolves();
    sinon.stub(svc, 'killStaleProcesses').resolves();
    sinon.stub(svc, 'detectWDABundleId').resolves('com.test.WebDriverAgentRunner.xctrunner');
    sinon.stub(svc, 'updateWDASettings').resolves();
    sinon.stub(svc, 'createWDASession').resolves(null);
    sinon.stub(svc, 'isGoIOSAvailable').resolves(true);
    return svc;
  }

  function iosService(): any {
    // Bypass the constructor: it starts watchdog intervals.
    const svc: any = Object.create(IOSStreamService.prototype);
    svc.sessions = new Map();
    svc.startFlight = new SingleFlight();
    svc.recoveryCooldowns = new Map();
    svc.installedWda = new Map();
    svc.RECOVERY_COOLDOWN_MS = 30_000;
    svc.goIOSPath = '/nonexistent/go-ios';
    return stubbedService(svc);
  }

  beforeEach(() => {
    allocator = new PortAllocator();
    allocator.configure({
      mjpeg: [scratch.base, scratch.base + 9],
      wda: [scratch.base + 50, scratch.base + 59],
    });
    device = { udid: IPHONE, host: 'h', platform: 'ios', busy: false, session_id: null };
    spawned = [];
    runwdaExits = false;
    tunnels = {
      ensure: sinon.stub().resolves(null),
      envFor: sinon.stub().callsFake(() => ({ ...process.env })),
      stop: sinon.stub().resolves(),
      touch: sinon.stub().resolves(),
      isOnDemand: sinon.stub().returns(false),
    };
    sinon.stub(process, 'kill');
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === PortAllocator) return allocator;
      if (token === IOSTunnels) return tunnels as any;
      if (token === ProcessRegistry) return { track: () => undefined } as any;
      return real(token);
    });
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async ({ udid }: { udid: string }) => (udid === IPHONE ? device : undefined),
      updateDevice: async (_udid: string, _host: string, data: any) => Object.assign(device, data),
    } as any);
    // The hold is released through releaseManualHold (hold-scoped, never a claim).
    unblock = sinon.stub(deviceService, 'releaseManualHold').callsFake(async () => {
      Object.assign(device, { busy: false, session_id: null });
      return true;
    });
    sinon.stub(childProcess, 'spawn').callsFake(((command: string, args: string[]) => {
      const proc = new FakeProcess(command, args);
      if (runwdaExits && args[0] === 'runwda') proc.exitCode = 1;
      spawned.push(proc);
      return proc;
    }) as any);
    sinon.stub(APP_SERVICE, 'getWDAApp').resolves(null as any);
    sinon.stub(InternalHttpClient, 'get').rejects(new Error('no WDA in tests'));
    // The MJPEG forward is up at once: no 5 s wait per start.
    sinon.stub(tcpPortUsed, 'check').resolves(true);
    ios = iosService();
  });

  afterEach(() => {
    sinon.restore();
  });

  after(() => {
    const runLog = path.join(os.tmpdir(), 'xenon-logs', `runwda-${IPHONE}.log`);
    if (fs.existsSync(runLog)) fs.unlinkSync(runLog);
  });

  /** WDA stops answering: runwda died on the phone's side. */
  const wdaDies = () => runwdas().forEach((p) => p.kill());

  describe('a restart', () => {
    beforeEach(() => {
      // A live preview's hold, as stream/start writes it.
      Object.assign(device, { busy: true, session_id: HOLD });
    });

    it("keeps the viewer's hold when a retry restarts a stream whose WDA died", async () => {
      await ios.startStream(IPHONE);
      wdaDies();

      await ios.startStream(IPHONE); // the tile's retry: a fresh GET /stream

      expect(ios.getStreamStatus(IPHONE)?.status).to.equal('running');
      expect(runwdas(), 'restarted once').to.have.length(2);
      expect(unblock.called, 'the hold is not released').to.equal(false);
      expect(device).to.include({ busy: true, session_id: HOLD });
    });

    it('still releases it when the viewer stops', async () => {
      await ios.startStream(IPHONE);

      await ios.stopStream(IPHONE, { forViewer: true });

      expect(unblock.calledOnce).to.equal(true);
      expect(device.busy).to.equal(false);
      expect(alive(), 'nothing left running').to.have.length(0);
    });

    it('happens once for two retries at once, and a later retry joins it', async () => {
      await ios.startStream(IPHONE);
      wdaDies();
      const detect = deferred<string>();
      (ios.detectWDABundleId as sinon.SinonStub).callsFake(() => detect.promise);

      const first = ios.startStream(IPHONE);
      const second = ios.startStream(IPHONE);
      await until(() => (ios.detectWDABundleId as sinon.SinonStub).called, 'the restart');
      // A third tile asks while the restart is already under way.
      const third = ios.startStream(IPHONE);
      detect.resolve('com.test.WebDriverAgentRunner.xctrunner');

      const results = await Promise.all([first, second, third]);
      expect(results[1]).to.deep.equal(results[0]);
      expect(results[2]).to.deep.equal(results[0]);
      expect(runwdas(), 'one restart').to.have.length(2);
      expect(ios.getStreamStatus(IPHONE)?.status).to.equal('running');
      expect(unblock.called).to.equal(false);
    });
  });

  describe('a stop while a start is still running', () => {
    it('cancels the start: nothing left running, no leases, no cooldown, no row ports', async () => {
      const detect = deferred<string>();
      (ios.detectWDABundleId as sinon.SinonStub).callsFake(() => detect.promise);

      const start = ios.startStream(IPHONE).then(
        () => null,
        (e: Error) => e,
      );
      await until(() => (ios.detectWDABundleId as sinon.SinonStub).called, 'the start');
      expect(alive().length, 'its forwarders run').to.be.greaterThan(0);

      await ios.stopStream(IPHONE, { forViewer: true });
      detect.resolve('com.test.WebDriverAgentRunner.xctrunner');
      const err = await start;

      expect(isCancelled(err), `cancelled, not ${err}`).to.equal(true);
      expect(runwdas(), 'no runwda launched after the stop').to.have.length(0);
      expect(alive(), 'its forwarders ended').to.have.length(0);
      expect(await leasesOfIphone(), 'its ports given back').to.have.length(0);
      expect(ios.getStreamStatus(IPHONE)).to.equal(undefined);
      expect(ios.recoveryCooldowns.has(IPHONE), 'not a failed start').to.equal(false);
      expect(device.wdaLocalPort).to.equal(undefined);
    });

    it('cancels it before it has an entry, and gives back the ports it took', async () => {
      const stale = deferred<void>();
      (ios.killStaleProcesses as sinon.SinonStub).callsFake(() => stale.promise);

      const start = ios.startStream(IPHONE).then(
        () => null,
        (e: Error) => e,
      );
      await until(() => (ios.killStaleProcesses as sinon.SinonStub).called, 'the start');
      expect(ios.getStreamStatus(IPHONE)).to.equal(undefined);

      await ios.stopStream(IPHONE, { forViewer: true });
      stale.resolve();
      const err = await start;

      expect(isCancelled(err), `cancelled, not ${err}`).to.equal(true);
      expect(spawned).to.have.length(0);
      expect(await leasesOfIphone()).to.have.length(0);
      expect(ios.getStreamStatus(IPHONE)).to.equal(undefined);
    });

    it("doesn't cancel a start an Appium session may be waiting on (a viewer's stop)", async () => {
      Object.assign(device, { busy: true, session_id: '7f0c5a52-appium-session' });
      const detect = deferred<string>();
      (ios.detectWDABundleId as sinon.SinonStub).callsFake(() => detect.promise);

      const start = ios.startStream(IPHONE);
      await until(() => (ios.detectWDABundleId as sinon.SinonStub).called, 'the start');
      await ios.stopStream(IPHONE, { forViewer: true });
      detect.resolve('com.test.WebDriverAgentRunner.xctrunner');

      await start;
      expect(ios.getStreamStatus(IPHONE)?.status).to.equal('running');
    });

    it('a start asked for after the stop runs on its own, once the cancelled one has ended', async () => {
      const detect = deferred<string>();
      (ios.detectWDABundleId as sinon.SinonStub).onFirstCall().callsFake(() => detect.promise);

      const cancelled = ios.startStream(IPHONE).then(
        () => null,
        (e: Error) => e,
      );
      await until(() => (ios.detectWDABundleId as sinon.SinonStub).called, 'the start');
      await ios.stopStream(IPHONE, { forViewer: true });
      // The viewer opens the preview again before the old start has noticed.
      const again = ios.startStream(IPHONE);
      detect.resolve('com.test.WebDriverAgentRunner.xctrunner');

      expect(isCancelled(await cancelled), 'the first start is cancelled').to.equal(true);
      const { wdaPort, mjpegPort } = await again;
      expect(ios.getStreamStatus(IPHONE)?.status).to.equal('running');
      expect(
        runwdas().filter((p) => p.exitCode === null),
        'one runwda',
      ).to.have.length(1);
      const leases = (await leasesOfIphone()).map((l) => l.port).sort();
      expect(leases).to.deep.equal([wdaPort, mjpegPort].sort());
    });
  });

  describe('a failed start', () => {
    it('ends its forwarders and gives back its ports, keeping only the record', async () => {
      tunnels.ensure.resolves(12100);
      runwdaExits = true;

      const err = await ios.startStream(IPHONE).then(
        () => null,
        (e: Error) => e,
      );

      expect(err?.message).to.match(/WDA process exited/);
      expect(spawned.filter((p) => p.command === 'iproxy')).to.have.length(2);
      expect(alive(), 'its iproxy forwards ended').to.have.length(0);
      expect(await leasesOfIphone(), 'its ports given back').to.have.length(0);
      expect(tunnels.stop.calledWith(IPHONE)).to.equal(true);
      const record = ios.getStreamStatus(IPHONE);
      expect(record?.status).to.equal('error');
      expect(record?.lastError).to.match(/WDA process exited/);
    });
  });

  describe('the hourly watchdog', () => {
    let clock: sinon.SinonFakeTimers;
    let svc: any;

    beforeEach(async () => {
      clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['setInterval'] });
      svc = stubbedService(new IOSStreamService());
      await svc.startStream(IPHONE);
      svc.getStreamStatus(IPHONE).viewerCount = 1; // watched: the idle sweep leaves it
      sinon.stub(svc, 'isStreamResponsive').resolves(false);
      wdaDies();
    });

    afterEach(() => clock.restore());

    it('heals a stream whose WDA stopped answering', async () => {
      await clock.tickAsync(3_600_000);
      await until(() => runwdas().length === 2, 'the heal').catch(() => undefined);

      expect(runwdas(), 'the watchdog restarted the stream').to.have.length(2);
      await until(() => svc.getStreamStatus(IPHONE)?.status === 'running', 'running');
    });

    it('leaves a phone an Appium session holds', async () => {
      Object.assign(device, { busy: true, session_id: '7f0c5a52-appium-session' });

      await clock.tickAsync(3_600_000);
      await new Promise((r) => setTimeout(r, 50));

      expect(runwdas()).to.have.length(1);
    });
  });
});

describe('POST /control/:udid/stream/start for an iPhone whose stream is stopped meanwhile', () => {
  useScratchDatabase();
  useOwnNodeId();
  const loopback = loopbackServers();
  const UDID = 'IPHONE-ROUTE-1';
  let restoreContainer: () => void;
  let savedArgs: PluginContext['pluginArgs'];
  let row: any;
  let block: sinon.SinonStub;
  let ios: { startStream: sinon.SinonStub; getStreamStatus: sinon.SinonStub };
  let actor: { userId: string; role: string; scopes: string };

  function buildApp() {
    const app = express();
    app.use(express.json());
    const apiRouter = express.Router();
    apiRouter.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'user-session',
        userId: actor.userId,
        role: actor.role,
        scopes: actor.scopes,
        teamIds: actor.role === 'MEMBER' ? [] : undefined,
        rateLimit: 100,
      };
      next();
    });
    ControlRouter.register(apiRouter);
    app.use('/xenon/api', apiRouter);
    return app;
  }

  beforeEach(() => {
    restoreContainer = saveRegistrations(
      AndroidStreamService,
      AndroidH264StreamService,
      IOSStreamService,
      RecordingStore,
    );
    savedArgs = Container.get(PluginContext).pluginArgs;
    Container.get(PluginContext).pluginArgs = { ...savedArgs, streaming: {} } as any;
    actor = { userId: 'usr_alice', role: 'ADMIN', scopes: 'admin,devices,sessions,read' };
    row = {
      udid: UDID,
      host: '127.0.0.1',
      nodeId: OWN_NODE_ID,
      platform: 'ios',
      realDevice: true,
      busy: false,
      session_id: null,
      screenWidth: '390',
      screenHeight: '844',
    };
    sinon
      .stub(DeviceStoreFactory, 'getStore')
      .returns(withFindDevices({ findDevice: async () => row }) as any);
    block = sinon.stub(deviceService, 'blockDevice').resolves();
    sinon.stub(deviceService, 'releaseManualHold').resolves(true);
    ios = {
      startStream: sinon.stub().resolves({ wdaPort: 8100, mjpegPort: 9100 }),
      getStreamStatus: sinon.stub().returns({ status: 'running', viewerCount: 0 }),
    };
    Container.set(IOSStreamService, ios as any);
    Container.set(AndroidStreamService, { getStreamStatus: () => undefined } as any);
    Container.set(AndroidH264StreamService, { getMultiplexer: () => undefined } as any);
    Container.set(RecordingStore, { isRecording: async () => false } as any);
  });

  afterEach(async () => {
    await loopback.closeAll();
    Container.get(PluginContext).pluginArgs = savedArgs;
    restoreContainer();
    sinon.restore();
  });

  const start = async () =>
    request(await loopback.serve(buildApp()))
      .post(`/xenon/api/control/${UDID}/stream/start`)
      .send({});

  it('writes the hold for a stream that started', async () => {
    const res = await start();
    expect(res.status).to.equal(200);
    expect(block.calledOnce).to.equal(true);
  });

  it('writes no hold when a stop cancelled the start', async () => {
    const Cancelled = (streamModule as any).StreamStartCancelled ?? Error;
    ios.startStream.rejects(new Cancelled('stopped while it was starting'));

    const res = await start();

    expect(res.status).to.equal(409);
    expect(res.body.error).to.equal('stream_stopped');
    expect(block.called).to.equal(false);
  });

  it('writes no hold when the stream was stopped after it started', async () => {
    ios.getStreamStatus.returns(undefined);

    const res = await start();

    expect(block.called).to.equal(false);
    expect(res.body.error).to.equal('stream_stopped');
  });

  it("reclaims another user's hold left beside a failed start's record", async () => {
    actor = { userId: 'usr_bob', role: 'MEMBER', scopes: 'devices,sessions,read' };
    Object.assign(row, { busy: true, session_id: `manual_usr_alice_${UDID}` });
    // The record a failed start leaves: no process runs for it.
    ios.getStreamStatus.callsFake(() =>
      ios.startStream.called
        ? { status: 'running', viewerCount: 0 }
        : { status: 'error', lastError: 'WDA process exited', viewerCount: 0 },
    );

    const res = await start();

    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(block.calledOnce).to.equal(true);
  });
});
