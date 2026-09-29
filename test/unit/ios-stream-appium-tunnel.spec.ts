import 'reflect-metadata';
import { expect } from 'chai';
import childProcess from 'child_process';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import tcpPortUsed from 'tcp-port-used';
import { Container } from 'typedi';
import { promisify } from 'util';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { SingleFlight } from '../../src/helpers/singleFlight';
import { PortAllocator } from '../../src/services/PortAllocator';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { previewLeaveDeps } from '../../src/app/routers/control';

/**
 * go-ios's tunnel process serves its tunnel-info API on 60105 and the first
 * phone's userspace tunnel on 60106. On iOS 17+ a WDA that go-ios launched
 * (`runwda`) reaches the phone through it, and an Appium session rides such a
 * WDA whenever it was allocated while a stream ran: iOSCapabilities points
 * `webDriverAgentUrl` at the stream's WDA.
 *
 * The stream service's orphan sweep kill -9'd whatever listened on those
 * ports, and a viewer's stop killed the stream's own WDA and tunnel, with a
 * live Appium session on the phone either way.
 *
 * Nothing real runs here. Every `exec` goes to a fake `execFile` (exec calls
 * `module.exports.execFile`, promisified or not), `process.kill` is stubbed,
 * and processes are fakes.
 */

const IPHONE = 'test-iphone-00008150-tunnel';
const TUNNEL_PID = 424242;
const AGENT_LISTENER_PID = '515151';

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
  svc.STREAM_PORT_TTL_MS = 90 * 60 * 1000;
  svc.goIOSPath = '/nonexistent/go-ios';
  return svc;
}

describe('go-ios tunnels under a live Appium session (fake exec, fake processes)', () => {
  let device: any;
  let findDevice: sinon.SinonStub;
  let commands: string[];
  let kill: sinon.SinonStub;
  let allocator: { claim: sinon.SinonStub; acquire: sinon.SinonStub; release: sinon.SinonStub };
  let svc: any;

  const killed = () => commands.filter((c) => /^kill\b|^pkill\b/.test(c));
  const swept = () => commands.filter((c) => /^lsof\b|^pgrep\b/.test(c));

  /** A stream that launched its own WDA, forwarders and go-ios tunnel. */
  function ownStream() {
    const s = {
      udid: IPHONE,
      wdaProcess: new FakeProcess(),
      forwardWDAProcess: new FakeProcess(),
      forwardMJPEGProcess: new FakeProcess(),
      tunnelProcess: new FakeProcess(TUNNEL_PID),
      wdaPort: 28101,
      mjpegPort: 29101,
      status: 'running',
      lastViewerAt: Date.now(),
      viewerCount: 0,
    };
    svc.sessions.set(IPHONE, s);
    return s;
  }

  /** A stream attached to the WDA the Appium session forwards: only its MJPEG forwarder is its own. */
  function attachedStream() {
    const s = {
      udid: IPHONE,
      wdaProcess: null,
      forwardWDAProcess: null,
      forwardMJPEGProcess: new FakeProcess(),
      tunnelProcess: null,
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
    // Refuse everything real. lsof names the go-ios agent's listener, pgrep a
    // tunnel for this udid; both exit 1 with nothing to report otherwise.
    sinon.stub(childProcess, 'execFile').callsFake(((cmd: string, _opts: any, cb: any) => {
      commands.push(cmd);
      const stdout = /^lsof -ti :6010[56]$/.test(cmd) ? `${AGENT_LISTENER_PID}\n` : '';
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
    };
    svc = iosService();
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === IOSStreamService) return svc;
      if (token === PortAllocator) return allocator;
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
      expect(kill.called, 'no process group is signalled (the tunnel)').to.equal(false);
      expect(killed(), 'no kill is run').to.deep.equal([]);
      expect(svc.getStreamStatus(IPHONE), 'the stream stays, for the session teardown').to.equal(
        stream,
      );
      expect(allocator.release.called, 'its ports stay leased').to.equal(false);
    });

    it('sweeps no go-ios port when the stream is attached to the Appium session’s own WDA', async () => {
      const stream = attachedStream();

      await previewLeaveDeps.stop(IPHONE);

      expect(swept(), 'no lsof/pgrep for go-ios processes').to.deep.equal([]);
      expect(killed(), 'no kill -9 of the go-ios listener').to.deep.equal([]);
      expect(kill.called).to.equal(false);
      expect(stream.forwardMJPEGProcess.killed, 'its own MJPEG forwarder still goes').to.equal(
        true,
      );
      expect(svc.getStreamStatus(IPHONE)).to.equal(undefined);
    });

    it('still stops everything and sweeps real orphans once no Appium session holds the phone', async () => {
      Object.assign(device, { busy: false, session_id: null });
      const stream = ownStream();

      await previewLeaveDeps.stop(IPHONE);

      expect(stream.wdaProcess.killed).to.equal(true);
      expect(stream.forwardWDAProcess.killed).to.equal(true);
      expect(stream.forwardMJPEGProcess.killed).to.equal(true);
      expect(kill.calledWith(-TUNNEL_PID, 'SIGKILL'), "the stream's tunnel group").to.equal(true);
      expect(commands).to.include(`pgrep -f "ios tunnel.*${IPHONE}"`);
      expect(commands).to.include('lsof -ti :60105');
      expect(commands).to.include('lsof -ti :60106');
      expect(killed()).to.include(`kill -9 ${AGENT_LISTENER_PID}`);
      expect(svc.getStreamStatus(IPHONE)).to.equal(undefined);
    });

    it('treats a live-preview hold as no Appium session', async () => {
      Object.assign(device, { session_id: `manual_usr_alice_${IPHONE}` });
      const stream = ownStream();

      await previewLeaveDeps.stop(IPHONE);

      expect(stream.wdaProcess.killed).to.equal(true);
      expect(killed()).to.include(`kill -9 ${AGENT_LISTENER_PID}`);
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
        tunnelProcess: null,
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
      expect(killed(), 'no kill -9 of the go-ios listener').to.deep.equal([]);
      expect(kill.called).to.equal(false);
    });
  });

  it("leaves go-ios processes alone when the phone's row can't be read", async () => {
    attachedStream();
    findDevice.rejects(new Error('database is locked'));

    await svc.stopStream(IPHONE);

    expect(swept()).to.deep.equal([]);
    expect(killed()).to.deep.equal([]);
    expect(kill.called).to.equal(false);
  });
});
