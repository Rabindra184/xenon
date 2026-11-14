import 'reflect-metadata';
import childProcess from 'child_process';
import { EventEmitter } from 'events';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import AndroidH264StreamService, {
  H264RefusedWhileRecording,
  H264StartSuperseded,
} from '../../src/device-managers/android/AndroidH264StreamService';
import { H264Multiplexer } from '../../src/device-managers/android/H264Multiplexer';
import type { H264Packet } from '../../src/device-managers/android/H264Multiplexer';
import * as scrcpyModule from '../../src/device-managers/android/ScrcpyServerSession';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { PluginContext } from '../../src/PluginContext';
import { SingleFlight } from '../../src/helpers/singleFlight';
import { saveRegistrations } from '../helpers/container-registration';
import { withFindDevices } from '../helpers/one-row-store';

/**
 * A stop that lands while an H.264 capture is still starting used to orphan
 * it: stop() killed `session.capture`, still undefined while openCapture
 * ran, and dropped the entry; openCapture then resolved onto the detached
 * session and nothing ever killed it. scrcpy has no time cap, so it ran until
 * the process exited (`killAllSync` walks only the map).
 *
 * The capture's own exit handlers also looked their session up by udid, so a
 * scrcpy crash stopped whatever capture was current for the phone, and an
 * orphaned screenrecord restarted itself whenever a newer capture ran.
 *
 * And the WebSocket's auto-start (start(udid) straight from a ticket) never
 * asked whether the phone was being recorded, so H.264 could start beside a
 * recording's screencap.
 */

const UDID = 'R58M-H264-STOP';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const config = (): H264Packet => ({ type: 'config', data: Buffer.from([0]), ptsMs: 0 });

function make(): any {
  const svc: any = Object.create(AndroidH264StreamService.prototype);
  svc.sessions = new Map();
  svc.startFlight = new SingleFlight();
  svc.scrcpyIncompatible = new Set();
  return svc;
}

async function settle(p: Promise<any>): Promise<{ value?: any; error?: any }> {
  try {
    return { value: await p };
  } catch (error) {
    return { error };
  }
}

describe('AndroidH264StreamService: a stop during a start', () => {
  let restoreContainer: () => void;
  let recording: boolean;

  beforeEach(() => {
    restoreContainer = saveRegistrations(PluginContext, RecordingStore);
    Container.set(PluginContext, { pluginArgs: {}, port: 4723 } as any);
    recording = false;
    Container.set(RecordingStore, { isRecording: async () => recording } as any);
    sinon.stub(DeviceStoreFactory, 'getStore').returns(
      withFindDevices({
        findDevice: async () => ({ udid: UDID, host: 'http://127.0.0.1:4723' }),
      }) as any,
    );
  });

  afterEach(() => {
    sinon.restore();
    restoreContainer();
  });

  /** A service whose capture starts only when the test says. */
  function heldCapture(sendConfig = true) {
    const svc = make();
    const kills: string[] = [];
    let opens = 0;
    const releases: Array<() => void> = [];
    svc.openCapture = async (_udid: string, onPacket: (p: H264Packet) => void) => {
      const n = ++opens;
      await new Promise<void>((r) => releases.push(r));
      if (sendConfig) onPacket(config());
      return { kill: () => kills.push(`capture-${n}`) };
    };
    return { svc, kills, releases, opens: () => opens };
  }

  it('kills a capture that comes up after the stop, and the start fails as superseded', async () => {
    const { svc, kills, releases, opens } = heldCapture();
    const starting = settle(svc.start(UDID, { source: 'scrcpy' }));
    for (let i = 0; i < 100 && opens() === 0; i++) await pause(5);

    await svc.stop(UDID);
    releases.splice(0).forEach((r) => r());

    const result = await starting;
    expect(result.error).to.be.instanceOf(H264StartSuperseded);
    expect(kills, 'the late capture is killed').to.deep.equal(['capture-1']);
    expect(svc.sessions.has(UDID)).to.equal(false);
    expect(svc.killAllSync(), 'nothing is left for the exit hook').to.equal(0);
  });

  it('a stop in the wait for the first config also fails the start, not a closed stream', async () => {
    const svc = make();
    let kills = 0;
    let opened = false;
    svc.openCapture = async () => {
      opened = true;
      return { kill: () => (kills += 1) }; // no config: the start waits for one
    };
    const starting = settle(svc.start(UDID, { source: 'scrcpy' }));
    for (let i = 0; i < 100 && !opened; i++) await pause(5);
    await pause(10);

    await svc.stop(UDID);
    const result = await starting;
    expect(result.error).to.be.instanceOf(H264StartSuperseded);
    expect(kills).to.equal(1);
  });

  it('a start after the stop is a new start, not the stale one', async () => {
    const { svc, kills, releases, opens } = heldCapture();
    const stale = settle(svc.start(UDID, { source: 'scrcpy' }));
    for (let i = 0; i < 100 && opens() === 0; i++) await pause(5);
    await svc.stop(UDID);

    const fresh = settle(svc.start(UDID, { source: 'scrcpy' }));
    for (let i = 0; i < 100 && opens() < 2; i++) await pause(5);
    expect(opens(), 'the new start opens its own capture').to.equal(2);
    releases.splice(0).forEach((r) => r());

    expect((await stale).error).to.be.instanceOf(H264StartSuperseded);
    const result = await fresh;
    expect(result.error, String(result.error)).to.equal(undefined);
    expect(result.value).to.equal(svc.getMultiplexer(UDID));
    expect(kills, 'only the stale capture is killed').to.deep.equal(['capture-1']);
  });

  it('refuses to start beside a recording of the phone, from any caller', async () => {
    const svc = make();
    let opened = false;
    svc.openCapture = async (_u: string, onPacket: (p: H264Packet) => void) => {
      opened = true;
      onPacket(config());
      return { kill: () => undefined };
    };
    recording = true;
    const result = await settle(svc.start(UDID)); // the WebSocket's start: no opts
    expect(result.error).to.be.instanceOf(H264RefusedWhileRecording);
    expect(opened, 'no capture is opened').to.equal(false);
    expect(svc.sessions.has(UDID)).to.equal(false);
  });

  it('starts as before when the phone is not being recorded', async () => {
    const svc = make();
    svc.openCapture = async (_u: string, onPacket: (p: H264Packet) => void) => {
      onPacket(config());
      return { kill: () => undefined };
    };
    const result = await settle(svc.start(UDID));
    expect(result.error, String(result.error)).to.equal(undefined);
    expect(result.value).to.equal(svc.getMultiplexer(UDID));
  });
});

describe("AndroidH264StreamService: a capture's exit acts on its own session only", () => {
  afterEach(() => sinon.restore());

  /** A newer capture now current for the phone. */
  function withNewerSession(svc: any) {
    const newer = { status: 'running', mux: new H264Multiplexer(), capture: { kill: sinon.spy() } };
    svc.sessions.set(UDID, newer);
    return newer;
  }

  describe('screenrecord', () => {
    let procs: any[];

    beforeEach(() => {
      procs = [];
      sinon.stub(childProcess, 'spawn').callsFake((() => {
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.kill = () => undefined;
        procs.push(proc);
        return proc;
      }) as any);
      const containerStub = sinon.stub(Container, 'get').callsFake((token: any) => {
        if (token === AndroidDeviceManager) {
          return { getAdbForDevice: async () => ({ executable: { path: 'adb' } }) } as any;
        }
        return (containerStub as any).wrappedMethod.call(Container, token);
      });
    });

    it('an ended capture does not restart itself because a newer one runs', async () => {
      const svc = make();
      svc.resolveCaptureSize = async () => '720x1560';
      withNewerSession(svc);
      const owner = { isLive: () => false, end: sinon.spy() };
      await svc.openScreenrecordCapture(UDID, () => undefined, owner);
      expect(procs.length).to.equal(1);
      procs[0].stdout.emit('data', Buffer.from([0, 0, 0, 1, 0x65, 1]));
      procs[0].emit('close', 0);
      await pause(450); // past the 300 ms restart wait
      expect(procs.length, 'no screenrecord was started for a session that is gone').to.equal(1);
    });

    it('a live capture still restarts at its time limit', async () => {
      const svc = make();
      svc.resolveCaptureSize = async () => '720x1560';
      const owner = { isLive: () => true, end: sinon.spy() };
      const capture = await svc.openScreenrecordCapture(UDID, () => undefined, owner);
      procs[0].stdout.emit('data', Buffer.from([0, 0, 0, 1, 0x65, 1]));
      procs[0].emit('close', 0);
      await pause(450);
      expect(procs.length).to.equal(2);
      capture.kill();
    });
  });

  describe('scrcpy', () => {
    let fake: any;

    beforeEach(() => {
      class FakeScrcpy extends EventEmitter {
        stopped = 0;
        constructor() {
          super();
          fake = this;
        }
        async start(): Promise<void> {
          return undefined;
        }
        stop(): void {
          this.stopped += 1;
        }
      }
      sinon.stub(scrcpyModule, 'ScrcpyServerSession').value(FakeScrcpy);
      sinon
        .stub(DeviceStoreFactory, 'getStore')
        .returns(withFindDevices({ findDevice: async () => null }) as any);
    });

    /** SPS, PPS and an IDR, then a start code: enough for config and a keyframe. */
    const frames = Buffer.from([
      0, 0, 0, 1, 0x67, 0xaa, 0, 0, 0, 1, 0x68, 0xbb, 0, 0, 0, 1, 0x65, 0xcc, 0, 0, 0, 1, 0x09,
    ]);

    it("a crash of an ended capture leaves the phone's newer capture running", async () => {
      const svc = make();
      const newer = withNewerSession(svc);
      const owner = { isLive: () => false, end: sinon.spy() };
      const starting = svc.startScrcpyOrThrow(UDID, () => undefined, owner);
      await pause(5);
      fake.emit('data', frames);
      await starting;
      fake.emit('close');
      expect(owner.end.called).to.equal(false);
      expect(svc.sessions.get(UDID), 'the newer capture is still current').to.equal(newer);
      expect(newer.status).to.equal('running');
      expect(newer.capture.kill.called).to.equal(false);
    });

    it('a crash of the live capture ends that capture', async () => {
      const svc = make();
      const owner = { isLive: () => true, end: sinon.spy() };
      const starting = svc.startScrcpyOrThrow(UDID, () => undefined, owner);
      await pause(5);
      fake.emit('data', frames);
      await starting;
      fake.emit('close');
      expect(owner.end.calledOnce).to.equal(true);
      expect(svc.scrcpyIncompatible.has(UDID)).to.equal(true);
    });
  });
});
