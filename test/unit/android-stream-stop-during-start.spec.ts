import 'reflect-metadata';
import childProcess from 'child_process';
import { EventEmitter } from 'events';
import net from 'net';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import AndroidStreamService, {
  AndroidStreamStartSuperseded,
} from '../../src/device-managers/android/AndroidStreamService';
import * as previewHold from '../../src/device-managers/android/previewHold';
import { SingleFlight } from '../../src/helpers/singleFlight';
import { PortAllocator } from '../../src/services/PortAllocator';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { withFindDevices } from '../helpers/one-row-store';

/**
 * A stop that lands while the MJPEG stream is still starting (in its wait for
 * the first frame, up to 5 s) used to leave a zombie. The stop closed the
 * server and dropped the entry; the start then set the detached session
 * `running`, so its capture loop (which ran while the status was `running` or
 * `starting`) went on taking screenshots for ever against a closed server, and
 * the start handed back that dead port and wrote it to the Device row.
 */

const UDID = 'R58M-STOP-START';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

/** A 100x100 RGBA screencap: 16-byte header, then the pixels. */
function screencap(): Buffer {
  const header = Buffer.alloc(16);
  header.writeInt32LE(100, 0);
  header.writeInt32LE(100, 4);
  header.writeInt32LE(1, 8);
  return Buffer.concat([header, Buffer.alloc(100 * 100 * 4)]);
}

describe('AndroidStreamService: a stop during a start', () => {
  let svc: any;
  let spawns: number;
  let holdScreencap: boolean;
  let releaseHeld: Array<() => void>;
  let released: number[];
  let updateDevice: sinon.SinonSpy;
  let findDevice: () => Promise<any>;

  beforeEach(async () => {
    svc = Object.create(AndroidStreamService.prototype);
    svc.sessions = new Map();
    svc.startFlight = new SingleFlight();
    svc.startEpochs = new Map();
    svc.sharpFailureWarned = new Set();
    svc.resolveAdbInvocation = async () => ({ adbPath: 'adb', adbHostArgs: [] });
    svc.encodeFrame = async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    spawns = 0;
    holdScreencap = false;
    releaseHeld = [];
    // Every screencap is a fake adb child; a held one answers when the test says.
    sinon.stub(childProcess, 'spawn').callsFake((() => {
      spawns += 1;
      const proc: any = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.kill = () => undefined;
      const answer = () => {
        proc.stdout.emit('data', screencap());
        proc.emit('close', 0);
      };
      if (holdScreencap) releaseHeld.push(answer);
      else setTimeout(answer, 5);
      return proc;
    }) as any);

    released = [];
    const port = await freePort();
    const allocator = {
      acquire: async () => port,
      release: async (p: number) => void released.push(p),
      blockPort: async () => undefined,
    };
    const containerStub = sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === PortAllocator) return allocator as any;
      return (containerStub as any).wrappedMethod.call(Container, token);
    });

    updateDevice = sinon.spy(async () => undefined);
    findDevice = async () => ({ udid: UDID, host: '127.0.0.1', platform: 'android' });
    sinon
      .stub(DeviceStoreFactory, 'getStore')
      .returns(withFindDevices({ findDevice: () => findDevice(), updateDevice }) as any);
    sinon.stub(previewHold, 'releaseIdlePreviewHold').resolves(false);
  });

  afterEach(async () => {
    // Whatever a test left running is ended, so no capture loop outlives it.
    for (const udid of [...svc.sessions.keys()]) await svc.stopStream(udid);
    sinon.restore();
  });

  async function settle(p: Promise<any>): Promise<{ value?: any; error?: any }> {
    try {
      return { value: await p };
    } catch (error) {
      return { error };
    }
  }

  it('in the first-frame wait: the start fails as superseded and its capture loop ends', async () => {
    holdScreencap = true;
    const starting = settle(svc.startStream(UDID));
    // The start is now waiting for its first frame, the screencap held.
    for (let i = 0; i < 100 && releaseHeld.length === 0; i++) await pause(10);
    expect(releaseHeld.length, 'the capture loop asked for a frame').to.equal(1);

    await svc.stopStream(UDID);
    holdScreencap = false;
    releaseHeld.splice(0).forEach((answer) => answer());

    const result = await starting;
    expect(result.error, 'the start must not hand back a port').to.be.instanceOf(
      AndroidStreamStartSuperseded,
    );
    expect(svc.sessions.has(UDID), 'no entry left').to.equal(false);
    expect(updateDevice.called, 'the dead port is not written to the Device row').to.equal(false);

    const after = spawns;
    await pause(400);
    expect(spawns, 'the capture loop took no more screenshots').to.equal(after);
  });

  it('before its server exists: the start fails as superseded and binds nothing', async () => {
    let lookups = 0;
    let finishLookup!: () => void;
    const lookedUp = new Promise<void>((r) => (finishLookup = r));
    findDevice = async () => {
      lookups += 1;
      await lookedUp;
      return { udid: UDID, host: '127.0.0.1', platform: 'android' };
    };
    const starting = settle(svc.startStream(UDID));
    for (let i = 0; i < 100 && lookups === 0; i++) await pause(5);

    await svc.stopStream(UDID);
    finishLookup();

    const result = await starting;
    expect(result.error).to.be.instanceOf(AndroidStreamStartSuperseded);
    expect(svc.sessions.has(UDID)).to.equal(false);
    expect(spawns, 'no capture loop was started').to.equal(0);
  });

  it('a start after the stop is a new start, not the stale one', async () => {
    holdScreencap = true;
    const stale = settle(svc.startStream(UDID));
    for (let i = 0; i < 100 && releaseHeld.length === 0; i++) await pause(10);
    await svc.stopStream(UDID);

    holdScreencap = false;
    const fresh = settle(svc.startStream(UDID));
    releaseHeld.splice(0).forEach((answer) => answer());

    expect((await stale).error).to.be.instanceOf(AndroidStreamStartSuperseded);
    const result = await fresh;
    expect(result.error, String(result.error)).to.equal(undefined);
    expect(result.value?.mjpegPort).to.be.a('number');
    const session = svc.sessions.get(UDID);
    expect(session?.status).to.equal('running');
    expect(session?.server?.listening, 'the new stream serves').to.equal(true);
  });

  it('a start nobody stops still goes live and writes its port', async () => {
    const result = await settle(svc.startStream(UDID));
    expect(result.error, String(result.error)).to.equal(undefined);
    expect(svc.sessions.get(UDID)?.status).to.equal('running');
    expect(updateDevice.calledOnce).to.equal(true);
  });
});

describe('AndroidStreamService viewers are counted on the stream they joined', () => {
  function entry(): any {
    return { udid: UDID, viewerCount: 0, lastViewerAt: 0 };
  }

  it("a viewer's leave after a restart does not uncount the new stream's viewer", () => {
    const svc: any = Object.create(AndroidStreamService.prototype);
    svc.sessions = new Map();
    const first = entry();
    svc.sessions.set(UDID, first);
    const leaveFirst = svc.addViewer(UDID);
    expect(first.viewerCount).to.equal(1);

    // The stream restarts (a stall, a stop and a start): a new entry.
    const second = entry();
    svc.sessions.set(UDID, second);
    svc.addViewer(UDID);
    expect(second.viewerCount).to.equal(1);

    leaveFirst();
    expect(second.viewerCount, 'the new viewer still watches').to.equal(1);
    expect(first.viewerCount).to.equal(0);
  });

  it('a leave counts once, however often it is called', () => {
    const svc: any = Object.create(AndroidStreamService.prototype);
    svc.sessions = new Map();
    const only = entry();
    svc.sessions.set(UDID, only);
    const leave = svc.addViewer(UDID);
    svc.addViewer(UDID);
    leave();
    leave();
    expect(only.viewerCount).to.equal(1);
  });

  it('with no stream, joining counts nothing and leaving is harmless', () => {
    const svc: any = Object.create(AndroidStreamService.prototype);
    svc.sessions = new Map();
    const leave = svc.addViewer(UDID);
    expect(() => leave()).to.not.throw();
  });
});
