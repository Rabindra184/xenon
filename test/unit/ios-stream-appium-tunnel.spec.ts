import 'reflect-metadata';
import { expect } from 'chai';
import childProcess from 'child_process';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import tcpPortUsed from 'tcp-port-used';
import { Container } from 'typedi';
import { promisify } from 'util';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { IOSTunnels } from '../../src/device-managers/ios/IOSTunnels';
import { SingleFlight } from '../../src/helpers/singleFlight';
import { PortAllocator } from '../../src/services/PortAllocator';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { previewLeaveDeps } from '../../src/app/routers/control';

/**
 * Each iOS 17+ phone has its own go-ios tunnel (IOSTunnels) on its own pair of
 * leased ports. On iOS 17+ a WDA that go-ios launched (`runwda`) reaches the
 * phone through it, and an Appium session rides such a WDA whenever it was
 * allocated while a stream ran: iOSCapabilities points `webDriverAgentUrl` at
 * the stream's WDA.
 *
 * So no go-ios cleanup runs, and a viewer's stop stops nothing, while an
 * Appium session holds the phone. And nothing is killed by port any more:
 * through 2.7 the orphan sweep kill -9'd whatever listened on go-ios's default
 * ports, 60105 and 60106, which was another iPhone's live tunnel.
 *
 * Nothing real runs here. Every `exec` goes to a fake `execFile` (exec calls
 * `module.exports.execFile`, promisified or not), `process.kill` is stubbed,
 * IOSTunnels is a fake, and processes are fakes.
 */

const IPHONE = 'test-iphone-00008150-tunnel';
const OTHER_IPHONE = 'test-iphone-00008110-other';
const TUNNEL_PORT = 12100;
/** Another iPhone's tunnel, on go-ios's default ports, as `lsof` would name it. */
const DEFAULT_PORT_LISTENER = '515151';

class FakeProcess extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  constructor(readonly pid?: number) {
    super();
  }
  kill(): boolean {
    this.killed = true;
    if (this.exitCode === null) this.exitCode = 137;
    return true;
  }
}

function iosService(): any {
  // Bypass the constructor: it starts watchdog intervals.
  const svc: any = Object.create(IOSStreamService.prototype);
  svc.sessions = new Map();
  svc.startFlight = new SingleFlight();
  svc.recoveryCooldowns = new Map();
  svc.RECOVERY_COOLDOWN_MS = 30_000;
  svc.goIOSPath = '/nonexistent/go-ios';
  return svc;
}

describe('go-ios tunnels under a live Appium session (fake exec, fake processes)', () => {
  let device: any;
  let findDevice: sinon.SinonStub;
  let commands: string[];
  let kill: sinon.SinonStub;
  let allocator: {
    claim: sinon.SinonStub;
    acquire: sinon.SinonStub;
    release: sinon.SinonStub;
    touch: sinon.SinonStub;
    releasePurpose: sinon.SinonStub;
  };
  let tunnels: {
    ensure: sinon.SinonStub;
    envFor: sinon.SinonStub;
    stop: sinon.SinonStub;
    touch: sinon.SinonStub;
    isOnDemand: sinon.SinonStub;
  };
  let svc: any;

  const killed = () => commands.filter((c) => /^kill\b|^pkill\b/.test(c));
  const swept = () => commands.filter((c) => /^lsof\b|^pgrep\b/.test(c));
  const defaultPorts = () => commands.filter((c) => /6010[56]/.test(c));

  /** A stream that launched its own WDA, forwarders and go-ios tunnel. */
  function ownStream(udid = IPHONE) {
    const s = {
      udid,
      wdaProcess: new FakeProcess(),
      forwardWDAProcess: new FakeProcess(),
      forwardMJPEGProcess: new FakeProcess(),
      tunnelPort: TUNNEL_PORT,
      wdaPort: 28101,
      mjpegPort: 29101,
      status: 'running',
      lastViewerAt: Date.now(),
      viewerCount: 0,
    };
    svc.sessions.set(udid, s);
    return s;
  }

  /** A stream attached to the WDA the Appium session forwards: only its MJPEG forwarder is its own. */
  function attachedStream() {
    const s = {
      udid: IPHONE,
      wdaProcess: null,
      forwardWDAProcess: null,
      forwardMJPEGProcess: new FakeProcess(),
      tunnelPort: null,
      wdaPort: 28123,
      mjpegPort: 29101,
      status: 'running',
      lastViewerAt: Date.now(),
      viewerCount: 0,
    };
    svc.sessions.set(IPHONE, s);
    return s;
  }

  beforeEach(() => {
    device = {
      udid: IPHONE,
      host: 'http://127.0.0.1:4723',
      platform: 'ios',
      busy: true,
      session_id: '7f0c5a52-appium-session',
      wdaLocalPort: 28123,
    };
    commands = [];
    // Refuse everything real. lsof names a listener on go-ios's default ports
    // (another iPhone's tunnel), which must never be killed; pgrep finds no
    // tunnel for this udid. Both exit 1 with nothing to report otherwise.
    sinon.stub(childProcess, 'execFile').callsFake(((cmd: string, _opts: any, cb: any) => {
      commands.push(cmd);
      const stdout = /^lsof -ti :6010[56]$/.test(cmd) ? `${DEFAULT_PORT_LISTENER}\n` : '';
      const nothingFound = /^(lsof|pgrep)\b/.test(cmd) && !stdout;
      const done = typeof cb === 'function' ? cb : () => undefined;
      process.nextTick(() =>
        nothingFound
          ? done(Object.assign(new Error('exit 1'), { code: 1 }), '', '')
          : done(null, stdout, ''),
      );
      return new EventEmitter();
    }) as any);
    kill = sinon.stub(process, 'kill');
  });

  // Prove the fake takes exec before anything could run a real kill.
  beforeEach(async () => {
    await promisify(childProcess.exec)('echo xenon-exec-guard');
    expect(commands, 'exec must reach the fake').to.deep.equal(['echo xenon-exec-guard']);
    commands.length = 0;
  });

  beforeEach(() => {
    allocator = {
      claim: sinon.stub().resolves(true),
      acquire: sinon.stub().resolves(29102),
      release: sinon.stub().resolves(),
      touch: sinon.stub().resolves(),
      releasePurpose: sinon.stub().resolves(),
    };
    tunnels = {
      ensure: sinon.stub().resolves(null),
      envFor: sinon.stub().callsFake(() => ({ ...process.env, ENABLE_GO_IOS_AGENT: 'yes' })),
      stop: sinon.stub().resolves(),
      touch: sinon.stub().resolves(),
      isOnDemand: sinon.stub().returns(false),
    };
    svc = iosService();
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === IOSStreamService) return svc;
      if (token === PortAllocator) return allocator;
      if (token === IOSTunnels) return tunnels;
      if (token === ProcessRegistry) return { track: () => undefined };
      return real(token);
    });
    findDevice = sinon.stub().callsFake(async () => device);
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice,
      updateDevice: async () => undefined,
    } as any);
    sinon.stub(deviceService, 'unblockDevice').resolves();
  });

  afterEach(() => sinon.restore());

  describe("a viewer's stop (stream/stop, stream/leave)", () => {
    it("leaves a stream's own WDA and go-ios tunnel running while an Appium session holds the phone", async () => {
      const stream = ownStream();

      await previewLeaveDeps.stop(IPHONE);

      expect(stream.wdaProcess.killed, 'the WDA the session may be driving').to.equal(false);
      expect(stream.forwardWDAProcess.killed, "that WDA's forwarder").to.equal(false);
      expect(tunnels.stop.called, "the phone's tunnel").to.equal(false);
      expect(kill.called, 'no process group is signalled').to.equal(false);
      expect(killed(), 'no kill is run').to.deep.equal([]);
      expect(svc.getStreamStatus(IPHONE), 'the stream stays, for the session teardown').to.equal(
        stream,
      );
      expect(allocator.release.called, 'its ports stay leased').to.equal(false);
    });

    it("stops no tunnel for a stream attached to the Appium session's own WDA", async () => {
      const stream = attachedStream();

      await previewLeaveDeps.stop(IPHONE);

      expect(swept(), 'no lsof/pgrep for go-ios processes').to.deep.equal([]);
      expect(killed()).to.deep.equal([]);
      expect(tunnels.stop.called, 'it started no tunnel').to.equal(false);
      expect(kill.called).to.equal(false);
      expect(stream.forwardMJPEGProcess.killed, 'its own MJPEG forwarder still goes').to.equal(
        true,
      );
      expect(svc.getStreamStatus(IPHONE)).to.equal(undefined);
    });

    it("stops the stream's tunnel and this phone's leftovers, and nothing by port, once no Appium session holds the phone", async () => {
      Object.assign(device, { busy: false, session_id: null });
      const stream = ownStream();

      await previewLeaveDeps.stop(IPHONE);

      expect(stream.wdaProcess.killed).to.equal(true);
      expect(stream.forwardWDAProcess.killed).to.equal(true);
      expect(stream.forwardMJPEGProcess.killed).to.equal(true);
      expect(tunnels.stop.calledWith(IPHONE), "the stream's tunnel").to.equal(true);
      expect(tunnels.stop.alwaysCalledWith(IPHONE), 'and no other phone’s').to.equal(true);
      expect(commands).to.include(`pgrep -f "ios tunnel.*${IPHONE}"`);
      expect(defaultPorts(), 'nothing on 60105/60106 is looked at').to.deep.equal([]);
      expect(killed(), "another iPhone's tunnel is never kill -9'd").to.deep.equal([]);
      expect(svc.getStreamStatus(IPHONE)).to.equal(undefined);
    });

    it('treats a live-preview hold as no Appium session', async () => {
      Object.assign(device, { session_id: `manual_usr_alice_${IPHONE}` });
      const stream = ownStream();

      await previewLeaveDeps.stop(IPHONE);

      expect(stream.wdaProcess.killed).to.equal(true);
      expect(tunnels.stop.calledWith(IPHONE)).to.equal(true);
    });

    it("stopping one iPhone's stream leaves another iPhone's tunnel alone", async () => {
      Object.assign(device, { busy: false, session_id: null });
      ownStream(IPHONE);
      const other = ownStream(OTHER_IPHONE);

      await svc.stopStream(IPHONE);

      expect(tunnels.stop.calledWith(OTHER_IPHONE)).to.equal(false);
      expect(other.wdaProcess.killed).to.equal(false);
      expect(svc.getStreamStatus(OTHER_IPHONE)).to.equal(other);
      expect(commands.some((c) => c.includes(OTHER_IPHONE))).to.equal(false);
      expect(defaultPorts()).to.deep.equal([]);
    });
  });

  describe('a start that attaches to the WDA the Appium session forwards', () => {
    it('stops the stale stream without touching the go-ios tunnel', async () => {
      // A start that failed earlier: its session stays in the map, errored.
      svc.sessions.set(IPHONE, {
        udid: IPHONE,
        wdaProcess: null,
        forwardWDAProcess: null,
        forwardMJPEGProcess: null,
        tunnelPort: null,
        wdaPort: 28101,
        mjpegPort: 29101,
        status: 'error',
        lastViewerAt: Date.now(),
        viewerCount: 0,
      });
      svc.isWDARunning = async (port: number) => port === device.wdaLocalPort;
      svc.updateWDASettings = async () => undefined;
      sinon.stub(tcpPortUsed, 'check').resolves(true);

      const { wdaPort } = await svc.startStream(IPHONE);

      expect(wdaPort, 'attached to the session’s WDA').to.equal(device.wdaLocalPort);
      expect(swept(), 'no lsof/pgrep for go-ios processes').to.deep.equal([]);
      expect(killed()).to.deep.equal([]);
      expect(kill.called).to.equal(false);
      expect(tunnels.ensure.called, 'no tunnel of its own').to.equal(false);
      expect(tunnels.stop.called).to.equal(false);
    });
  });

  describe('a start over a running stream whose WDA does not answer', () => {
    beforeEach(() => {
      // WDA doesn't answer /status: busy with a long command, or dead.
      svc.isWDARunning = async () => false;
      // A restart that gets past the stop fails right after: no go-ios here.
      svc.isGoIOSAvailable = async () => false;
    });

    it('never restarts it while an Appium session holds the phone, and says why', async () => {
      const stream = ownStream();

      const err = await svc.startStream(IPHONE).then(
        () => null,
        (e: Error) => e,
      );

      expect(err?.message).to.match(/Appium session .* holds the device/);
      expect(stream.wdaProcess.killed, 'the WDA the session may be driving').to.equal(false);
      expect(stream.forwardWDAProcess.killed).to.equal(false);
      expect(tunnels.stop.called, "the phone's tunnel").to.equal(false);
      expect(kill.called).to.equal(false);
      expect(commands, 'nothing is exec’d').to.deep.equal([]);
      expect(svc.getStreamStatus(IPHONE)?.status, 'the stream is left as it was').to.equal(
        'running',
      );
      expect(svc.recoveryCooldowns.has(IPHONE), 'no failed start to cool down from').to.equal(
        false,
      );
    });

    it("never restarts one attached to the session's own WDA either", async () => {
      // A restart would launch a second WebDriverAgent over the session's.
      const stream = attachedStream();

      const err = await svc.startStream(IPHONE).then(
        () => null,
        (e: Error) => e,
      );

      expect(err?.message).to.match(/Appium session .* holds the device/);
      expect(stream.forwardMJPEGProcess.killed).to.equal(false);
      expect(svc.getStreamStatus(IPHONE)).to.equal(stream);
    });

    it('still restarts it when no session holds the phone, to recover a dead WDA', async () => {
      Object.assign(device, { busy: false, session_id: null });
      const stream = ownStream();

      const err = await svc.startStream(IPHONE).then(
        () => null,
        (e: Error) => e,
      );

      expect(stream.wdaProcess.killed, 'the dead stream is stopped').to.equal(true);
      expect(tunnels.stop.calledWith(IPHONE), 'with its tunnel').to.equal(true);
      expect(err?.message, 'and a new start is attempted').to.equal('go-ios not available');
    });
  });

  describe('a start after a failed start', () => {
    it("stops the failed start's tunnel before starting again", async () => {
      Object.assign(device, { busy: false, session_id: null });
      // The failed start brought its tunnel up, then WDA never answered.
      svc.sessions.set(IPHONE, {
        udid: IPHONE,
        wdaProcess: null,
        forwardWDAProcess: null,
        forwardMJPEGProcess: null,
        tunnelPort: TUNNEL_PORT,
        wdaPort: 28101,
        mjpegPort: 29101,
        status: 'error',
        lastViewerAt: Date.now(),
        viewerCount: 0,
      });
      svc.isGoIOSAvailable = async () => false;

      const err = await svc.startStream(IPHONE).then(
        () => null,
        (e: Error) => e,
      );

      expect(err?.message).to.equal('go-ios not available');
      expect(tunnels.stop.calledWith(IPHONE), "the failed start's tunnel").to.equal(true);
      expect(tunnels.stop.alwaysCalledWith(IPHONE)).to.equal(true);
      expect(defaultPorts()).to.deep.equal([]);
    });
  });

  describe('a start on a phone whose tunnel was opened for screenshots', () => {
    it('takes that tunnel over, neither stopping nor reaping it', async () => {
      Object.assign(device, { busy: false, session_id: null });
      tunnels.isOnDemand.withArgs(IPHONE).returns(true);

      await svc.cleanupOrphanTunnels(IPHONE);

      expect(tunnels.stop.called, 'the tracked tunnel').to.equal(false);
      expect(swept(), 'no pgrep reap of its process').to.deep.equal([]);
    });
  });

  describe('boot', () => {
    it('reaps every go-ios process, then drops every tunnel port lease', async () => {
      await svc.reapOrphanTunnels();

      expect(commands).to.include('pgrep -f "/nonexistent/go-ios"');
      expect(allocator.releasePurpose.calledOnceWithExactly('tunnel')).to.equal(true);
    });
  });

  describe('the hourly watchdog', () => {
    it("keeps a running stream's tunnel ports leased", async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setInterval'] });
      try {
        sinon.stub(IOSStreamService.prototype as any, 'isStreamResponsive').resolves(true);
        const watched: any = new IOSStreamService();
        watched.sessions.set(IPHONE, {
          udid: IPHONE,
          status: 'running',
          tunnelPort: TUNNEL_PORT,
          wdaPort: 28101,
          mjpegPort: 29101,
          lastViewerAt: Date.now(),
          viewerCount: 1,
        });

        await clock.tickAsync(60 * 60 * 1000);
        await new Promise((resolve) => setImmediate(resolve)); // let the tick's awaits finish

        expect(allocator.touch.calledWith(28101), 'its WDA port, as before').to.equal(true);
        expect(tunnels.touch.calledWith(IPHONE), 'and its tunnel').to.equal(true);
      } finally {
        clock.restore();
      }
    });
  });

  it("leaves go-ios processes alone when the phone's row can't be read", async () => {
    attachedStream();
    findDevice.rejects(new Error('database is locked'));

    await svc.stopStream(IPHONE);

    expect(swept()).to.deep.equal([]);
    expect(killed()).to.deep.equal([]);
    expect(kill.called).to.equal(false);
    expect(tunnels.stop.called).to.equal(false);
  });
});
