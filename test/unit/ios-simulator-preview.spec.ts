import 'reflect-metadata';
import { expect } from 'chai';
import childProcess from 'child_process';
import { EventEmitter } from 'events';
import express from 'express';
import sinon from 'sinon';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import IOSStreamService, {
  SIMULATOR_PREVIEW_NEEDS_TEST,
  simulatorPreviewRefusal,
} from '../../src/device-managers/ios/IOSStreamService';
import { SessionOwnerResolver } from '../../src/services/device-access/SessionOwnerResolver';
import { IOSTunnels } from '../../src/device-managers/ios/IOSTunnels';
import { SingleFlight } from '../../src/helpers/singleFlight';
import { PortAllocator } from '../../src/services/PortAllocator';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { AppiumUmbrella } from '../../src/sessions/appiumUmbrella';
import { forgetSessionMemory } from '../../src/sessions/sessionMemory';
import { saveRegistrations } from '../helpers/container-registration';
import request from '../helpers/loopbackRequest';
import { loopbackServers } from '../helpers/loopbackServer';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

/**
 * The live preview of an iOS simulator.
 *
 * Every iOS preview went through the iPhone's stream: a go-ios tunnel, iproxy
 * USB forwards and go-ios `runwda`, none of which reach a simulator. With no
 * test running, the start failed (go-ios: "Device not found"), and its two
 * forwards stayed on the ports it had leased to the simulator; a test started
 * meanwhile was given those ports, and its WebDriverAgent couldn't open them
 * ("Unable to start WebDriverAgent session"). With a test running, the start
 * attached to the test's WebDriverAgent but read the picture through a new
 * forward that carries nothing, so a Live devices tile stayed empty.
 *
 * A simulator's picture is its running test's: the XCUITest driver's
 * WebDriverAgent serves it on this Mac at the session's mjpegServerPort.
 * The preview reads it there, starts nothing and leases no port, and ends
 * with the test. With no test running it is refused in plain words.
 */
const SIMULATOR = '35429994-B029-4AF4-9634-880B89DAC782';
const IPHONE = '00008150-000E78612168C01C';

describe('iOS simulator live preview', () => {
  useOwnNodeId();
  const loopback = loopbackServers();

  let row: any;
  let spawned: string[];
  let commands: string[];
  let allocator: Record<string, sinon.SinonStub>;
  let tunnels: Record<string, sinon.SinonStub>;
  let driverOptions: Record<string, Record<string, unknown> | undefined>;
  let svc: any;
  let restoreRegs: () => void;
  let blockDevice: sinon.SinonStub;

  function iosService(): any {
    // Bypass the constructor: it starts watchdog intervals.
    const s: any = Object.create(IOSStreamService.prototype);
    s.sessions = new Map();
    s.endedSimulatorSessions = new Set();
    s.startFlight = new SingleFlight();
    s.recoveryCooldowns = new Map();
    s.RECOVERY_COOLDOWN_MS = 30_000;
    s.goIOSPath = '/nonexistent/go-ios';
    return s;
  }

  const simulator = (over: Record<string, unknown> = {}) => ({
    udid: SIMULATOR,
    host: 'http://127.0.0.1:4723',
    nodeId: OWN_NODE_ID,
    platform: 'ios',
    realDevice: false,
    deviceType: 'simulator',
    busy: false,
    session_id: null,
    wdaLocalPort: 8101,
    mjpegServerPort: 9101,
    screenWidth: '402',
    screenHeight: '874',
    ...over,
  });
  const runningTest = (sessionId = 'sess-1') => ({ busy: true, session_id: sessionId });

  beforeEach(() => {
    restoreRegs = saveRegistrations(IOSStreamService, RecordingStore);
    row = simulator();
    spawned = [];
    commands = [];
    sinon.stub(process, 'kill');
    sinon.stub(childProcess, 'spawn').callsFake(((cmd: string, args: string[]) => {
      spawned.push([cmd, ...(args ?? [])].join(' '));
      const p: any = new EventEmitter();
      p.stdout = new EventEmitter();
      p.stderr = new EventEmitter();
      p.kill = () => true;
      return p;
    }) as any);
    sinon.stub(childProcess, 'execFile').callsFake(((cmd: string, _o: any, cb: any) => {
      commands.push(cmd);
      const done = typeof cb === 'function' ? cb : () => undefined;
      process.nextTick(() => done(Object.assign(new Error('exit 1'), { code: 1 }), '', ''));
      return new EventEmitter();
    }) as any);
    allocator = {
      claim: sinon.stub().resolves(true),
      acquire: sinon.stub().resolves(8150),
      tryAcquire: sinon.stub().resolves(8150),
      release: sinon.stub().resolves(),
      touch: sinon.stub().resolves(),
      releasePurpose: sinon.stub().resolves(),
    };
    tunnels = {
      ensure: sinon.stub().resolves(null),
      envFor: sinon.stub().returns({}),
      stop: sinon.stub().resolves(),
      touch: sinon.stub().resolves(),
      isOnDemand: sinon.stub().returns(false),
    };
    driverOptions = {};
    svc = iosService();
    Container.set(IOSStreamService, svc);
    Container.set(RecordingStore, { isRecording: async () => false } as any);
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === PortAllocator) return allocator;
      if (token === IOSTunnels) return tunnels;
      if (token === ProcessRegistry) return { track: () => undefined };
      if (token === AppiumUmbrella) return { driverOptions: (id: string) => driverOptions[id] };
      return real(token);
    });
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => row,
      updateDevice: async () => undefined,
    } as any);
    blockDevice = sinon.stub(deviceService, 'blockDevice').resolves();
    sinon.stub(deviceService, 'unblockDevice').resolves();
    sinon.stub(SessionOwnerResolver.prototype, 'ownerOf').resolves(null);
  });

  afterEach(async () => {
    sinon.restore();
    restoreRegs();
    await loopback.closeAll();
  });

  /** Nothing of the iPhone's stream ran: no process, no go-ios, no port leased. */
  const startedNothing = () => {
    expect(spawned, 'processes started').to.deep.equal([]);
    expect(commands, 'commands run').to.deep.equal([]);
    expect(tunnels.ensure.called, 'go-ios tunnel').to.equal(false);
    expect(allocator.acquire.called, 'port leased').to.equal(false);
    expect(allocator.claim.called, 'port claimed').to.equal(false);
  };

  describe('the stream service', () => {
    it('refuses a simulator no test runs on, in plain words, and starts nothing', async () => {
      const err = await svc.startStream(SIMULATOR).then(
        () => null,
        (e: Error) => e,
      );

      expect(err?.message).to.equal(SIMULATOR_PREVIEW_NEEDS_TEST);
      startedNothing();
      expect(svc.getStreamStatus(SIMULATOR)).to.equal(undefined);
    });

    it('refuses it again at once: no cool-down after a refusal', async () => {
      await svc.startStream(SIMULATOR).catch(() => undefined);
      const err = await svc.startStream(SIMULATOR).catch((e: Error) => e);
      expect(err.message).to.equal(SIMULATOR_PREVIEW_NEEDS_TEST);
    });

    it("shows a running test's own picture, at the ports its driver runs WebDriverAgent on", async () => {
      Object.assign(row, runningTest());
      driverOptions['sess-1'] = { wdaLocalPort: 8100, mjpegServerPort: 9100 };

      const ports = await svc.startStream(SIMULATOR);

      expect(ports).to.deep.equal({ wdaPort: 8100, mjpegPort: 9100 });
      startedNothing();
      expect(svc.getStreamStatus(SIMULATOR)).to.deep.include({
        status: 'running',
        wdaPort: 8100,
        mjpegPort: 9100,
      });
    });

    it('refuses a test Appium no longer has: it is ending, and its row not yet released', async () => {
      Object.assign(row, runningTest());

      const err = await svc.startStream(SIMULATOR).catch((e: Error) => e);

      expect(err.message).to.equal(SIMULATOR_PREVIEW_NEEDS_TEST);
      expect(svc.getStreamStatus(SIMULATOR)).to.equal(undefined);
      startedNothing();
    });

    it('never shows a test that has ended, though a start lands while it is torn down', async () => {
      Object.assign(row, runningTest('sess-1'));
      driverOptions['sess-1'] = { wdaLocalPort: 8100, mjpegServerPort: 9100 };
      await svc.startStream(SIMULATOR);

      // The test's end, before Appium drops the session and the phone is released.
      await svc.endSimulatorPreviews('sess-1');
      const err = await svc.startStream(SIMULATOR).catch((e: Error) => e);

      expect(err.message).to.equal(SIMULATOR_PREVIEW_NEEDS_TEST);
      expect(svc.getStreamStatus(SIMULATOR)).to.equal(undefined);
    });

    it('leaves an Android emulator alone: it is no simulator', () => {
      const emulator = { platform: 'android', realDevice: false, busy: false, session_id: null };
      expect(simulatorPreviewRefusal(emulator)).to.equal(undefined);
      expect(simulatorPreviewRefusal({ ...emulator, platform: 'ios' })).to.equal(
        SIMULATOR_PREVIEW_NEEDS_TEST,
      );
      expect(simulatorPreviewRefusal({ ...emulator, platform: 'tvos' })).to.equal(
        SIMULATOR_PREVIEW_NEEDS_TEST,
      );
    });

    it("follows a new test on the simulator, never an earlier test's picture", async () => {
      Object.assign(row, runningTest('sess-1'));
      driverOptions['sess-1'] = { wdaLocalPort: 8100, mjpegServerPort: 9100 };
      await svc.startStream(SIMULATOR);

      Object.assign(row, runningTest('sess-2'));
      driverOptions['sess-2'] = { wdaLocalPort: 8102, mjpegServerPort: 9102 };

      expect(await svc.startStream(SIMULATOR)).to.deep.equal({ wdaPort: 8102, mjpegPort: 9102 });
    });

    it('ends with its test, however the test ends, and gives back no port it never leased', async () => {
      Object.assign(row, runningTest('sess-1'));
      driverOptions['sess-1'] = { wdaLocalPort: 8100, mjpegServerPort: 9100 };
      await svc.startStream(SIMULATOR);

      forgetSessionMemory('another-session');
      await new Promise((r) => setImmediate(r));
      expect(svc.getStreamStatus(SIMULATOR), "another test's end").to.not.equal(undefined);

      forgetSessionMemory('sess-1');
      await new Promise((r) => setImmediate(r));
      expect(svc.getStreamStatus(SIMULATOR)).to.equal(undefined);
      expect(allocator.release.called, 'port released').to.equal(false);
      expect(commands, 'go-ios clean-up').to.deep.equal([]);
    });

    it('still runs the iPhone stream for an iPhone', async () => {
      row = { ...simulator(), udid: IPHONE, realDevice: true, deviceType: 'real' };

      const err = await svc.startStream(IPHONE).catch((e: Error) => e);

      expect(err.message).to.not.equal(SIMULATOR_PREVIEW_NEEDS_TEST);
      expect(allocator.acquire.called, 'iPhone stream leases its ports').to.equal(true);
    });
  });

  describe('the dashboard routes', () => {
    function app() {
      const a = express();
      a.use(express.json());
      const api = express.Router();
      api.use((req, _res, next) => {
        (req as any).auth = {
          kind: 'user-session',
          userId: 'usr_alice',
          role: 'ADMIN',
          scopes: 'admin,devices,sessions,read',
          rateLimit: 100,
        };
        next();
      });
      ControlRouter.register(api);
      a.use('/xenon/api', api);
      return a;
    }
    const client = async () => request(await loopback.serve(app()));

    it('stream/start says why a simulator with no test shows nothing', async () => {
      const res = await (await client())
        .post(`/xenon/api/control/${SIMULATOR}/stream/start`)
        .send({ player: 'mjpeg' });

      expect(res.status, JSON.stringify(res.body)).to.equal(409);
      expect(res.body).to.deep.include({
        error: 'simulator_needs_test',
        message: SIMULATOR_PREVIEW_NEEDS_TEST,
      });
      startedNothing();
    });

    it('stream/status gives the reason, for the Live devices tile', async () => {
      const res = await (await client()).get(`/xenon/api/control/${SIMULATOR}/stream/status`);

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.include({
        status: 'stopped',
        lastError: SIMULATOR_PREVIEW_NEEDS_TEST,
        reason: 'simulator_needs_test',
      });
    });

    it("stream/start answers with the running test's picture", async () => {
      Object.assign(row, runningTest());
      driverOptions['sess-1'] = { wdaLocalPort: 8100, mjpegServerPort: 9100 };

      const res = await (await client())
        .post(`/xenon/api/control/${SIMULATOR}/stream/start`)
        .send({ player: 'mjpeg' });

      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(res.body).to.deep.include({ type: 'mjpeg', mjpegPort: 9100 });
      startedNothing();
      // The test holds the simulator; a preview hold could outlive it.
      expect(blockDevice.called, 'held the simulator').to.equal(false);
    });
  });
});
