import 'reflect-metadata';
import { expect } from 'chai';
import childProcess from 'child_process';
import { EventEmitter } from 'events';
import http from 'http';
import { AddressInfo } from 'net';
import sinon from 'sinon';
import { Container } from 'typedi';
import {
  IOSTunnels,
  TUNNEL_CHECK_MS,
  TUNNEL_LEASE_TTL_MS,
  TUNNEL_READY_TIMEOUT_MS,
  TunnelState,
  goIosReason,
  iosVersionOf,
} from '../../src/device-managers/ios/IOSTunnels';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';

/**
 * Each iOS 17+ phone gets its own go-ios tunnel, an isolated per-device agent
 * on its own pair of leased ports. Through 2.7 every tunnel took go-ios's
 * default 60105/60106, so a second iPhone's stream killed the first's.
 *
 * go-ios keeps a per-device agent running when its phone is unplugged, and
 * starts the replugged phone's tunnel on its next traffic port, P + 2: the
 * next phone's pair. So a tunnel that loses its phone, or moves its traffic
 * port, is stopped.
 *
 * go-ios, the allocator, HTTP and timers are fakes here, except in the last
 * block, which runs the real seams against a local HTTP server and a stubbed
 * spawn.
 */

const PHONE_A = 'test-iphone-a-00008150';
const PHONE_B = 'test-iphone-b-00008110';

class FakeProcess extends EventEmitter {
  exitCode: number | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  constructor(readonly pid: number) {
    super();
  }
  exit(code = 1): void {
    this.exitCode = code;
    this.emit('exit', code);
  }
}

/** Two adjacent ports per phone from 12100, as PortAllocator.acquirePair leases them. */
function fakeAllocator() {
  let next = 12100;
  const leased = new Map<number, string>();
  return {
    leased,
    acquirePair: sinon.stub().callsFake(async (_purpose: string, udid: string) => {
      const port = next;
      next += 2;
      leased.set(port, udid);
      leased.set(port + 1, udid);
      return port;
    }),
    release: sinon.stub().callsFake(async (port: number, udid: string) => {
      if (leased.get(port) === udid) leased.delete(port);
    }),
    touch: sinon.stub().resolves(),
  };
}

class TestTunnels extends IOSTunnels {
  versions = new Map<string, number>();
  spawned: { udid: string; args: string[]; proc: FakeProcess }[] = [];
  killed: (number | undefined)[] = [];
  sleeps: number[] = [];
  /** Each tunnel-info poll: true is the phone's tunnel on P + 1, false a 404. */
  answers: (port: number, udid: string) => boolean | TunnelState = () => true;
  ports = fakeAllocator();
  private nextPid = 7000;

  protected async iosVersion(udid: string): Promise<number> {
    const version = this.versions.get(udid);
    if (version === undefined) throw new Error(`no such phone: ${udid}`);
    return version;
  }
  protected spawnTunnel(udid: string, args: string[]): any {
    const proc = new FakeProcess(this.nextPid++);
    this.spawned.push({ udid, args, proc });
    return proc;
  }
  protected async tunnelInfo(port: number, udid: string): Promise<TunnelState> {
    const answer = this.answers(port, udid);
    if (answer === true) return { state: 'up', userspacePort: port + 1 };
    if (answer === false) return { state: 'gone' };
    return answer;
  }
  protected async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
  }
  protected killGroup(pid: number | undefined): void {
    this.killed.push(pid);
  }
  protected allocator(): any {
    return this.ports;
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('IOSTunnels: a go-ios tunnel per iPhone', () => {
  let t: TestTunnels;

  beforeEach(() => {
    sinon.stub(process, 'kill');
    t = new TestTunnels();
    t.versions.set(PHONE_A, 17.4);
    t.versions.set(PHONE_B, 18.1);
  });

  afterEach(async () => {
    await t.stop(PHONE_A);
    await t.stop(PHONE_B);
    sinon.restore();
  });

  it('starts no tunnel for a phone below iOS 17', async () => {
    t.versions.set('old-iphone', 16.7);

    expect(await t.ensure('old-iphone')).to.equal(null);
    expect(t.spawned).to.deep.equal([]);
    expect(t.ports.acquirePair.called).to.equal(false);
  });

  it("starts no tunnel when the phone's version can't be read", async () => {
    expect(await t.ensure('unknown-iphone')).to.equal(null);
    expect(t.spawned).to.deep.equal([]);
  });

  it("leases a pair and starts the phone's own agent on it", async () => {
    const port = await t.ensure(PHONE_A);

    expect(port).to.equal(12100);
    expect(
      t.ports.acquirePair.calledOnceWithExactly('tunnel', PHONE_A, { ttlMs: TUNNEL_LEASE_TTL_MS }),
    ).to.equal(true);
    expect(t.spawned.map((s) => s.args)).to.deep.equal([
      ['tunnel', 'start', '--udid', PHONE_A, '--userspace', '--tunnel-info-port', '12100'],
    ]);
    expect(t.portFor(PHONE_A)).to.equal(12100);
  });

  it('is ready only once the tunnel answers for the phone', async () => {
    const asked: [number, string][] = [];
    t.answers = (port, udid) => {
      asked.push([port, udid]);
      return asked.length === 3;
    };

    expect(await t.ensure(PHONE_A)).to.equal(12100);
    expect(asked).to.deep.equal([
      [12100, PHONE_A],
      [12100, PHONE_A],
      [12100, PHONE_A],
    ]);
    expect(t.sleeps).to.deep.equal([500, 500]);
  });

  it('waits 20 s in all for a tunnel that never answers, then goes on with it', async () => {
    t.answers = () => false;

    expect(await t.ensure(PHONE_A)).to.equal(12100);
    expect(t.sleeps.reduce((a, b) => a + b, 0)).to.equal(TUNNEL_READY_TIMEOUT_MS);
    expect(t.portFor(PHONE_A), 'still tracked').to.equal(12100);
  });

  it('fails the start when the tunnel exits before it is ready, and gives its ports back', async () => {
    t.answers = () => {
      t.spawned[0].proc.exit(1);
      return false;
    };

    const err = await t.ensure(PHONE_A).then(
      () => null,
      (e: Error) => e,
    );
    await settle();

    expect(err?.message).to.match(/exited before it was ready/);
    expect(t.portFor(PHONE_A)).to.equal(undefined);
    expect([...t.ports.leased.keys()]).to.deep.equal([]);
  });

  it("says why the tunnel exited before it was ready, in go-ios's words", async () => {
    t.answers = () => {
      const proc = t.spawned[0].proc;
      proc.stderr.emit(
        'data',
        Buffer.from(
          '{"level":"INFO","msg":"Using userspace networking"}\n' +
            '{"level":"ERROR","msg":"failed to start tunnel","error":"listen tcp 127.0.0.1:12101: bind: address already in use"}\n',
        ),
      );
      proc.exit(1);
      return false;
    };

    const err = await t.ensure(PHONE_A).then(
      () => null,
      (e: Error) => e,
    );

    expect(err?.message).to.equal(
      `The go-ios tunnel for ${PHONE_A} exited before it was ready (exit code 1): ` +
        'failed to start tunnel: listen tcp 127.0.0.1:12101: bind: address already in use',
    );
  });

  it('fails the start when the tunnel comes up on another traffic port, and stops it', async () => {
    t.answers = () => ({ state: 'up', userspacePort: 12102 });

    const err = await t.ensure(PHONE_A).then(
      () => null,
      (e: Error) => e,
    );
    await settle();

    expect(err?.message).to.match(/12102/);
    expect(t.killed).to.deep.equal([t.spawned[0].proc.pid]);
    expect(t.portFor(PHONE_A)).to.equal(undefined);
    expect([...t.ports.leased.keys()]).to.deep.equal([]);
  });

  it('gives a second phone its own pair, and leaves the first alone', async () => {
    await t.ensure(PHONE_A);

    expect(await t.ensure(PHONE_B)).to.equal(12102);
    expect(t.spawned[1].args).to.include.members(['--udid', PHONE_B, '12102']);
    expect(t.portFor(PHONE_A)).to.equal(12100);
    expect(t.killed).to.deep.equal([]);
  });

  it("reuses a phone's running tunnel", async () => {
    await t.ensure(PHONE_A);

    expect(await t.ensure(PHONE_A)).to.equal(12100);
    expect(t.spawned.length).to.equal(1);
    expect(t.ports.acquirePair.callCount).to.equal(1);
  });

  it("stops only that phone's tunnel and gives its pair back", async () => {
    await t.ensure(PHONE_A);
    await t.ensure(PHONE_B);

    await t.stop(PHONE_A);

    expect(t.killed).to.deep.equal([t.spawned[0].proc.pid]);
    expect(t.portFor(PHONE_A)).to.equal(undefined);
    expect(t.portFor(PHONE_B)).to.equal(12102);
    expect([...t.ports.leased.entries()]).to.deep.equal([
      [12102, PHONE_B],
      [12103, PHONE_B],
    ]);
  });

  it('stops nothing for a phone with no tunnel', async () => {
    await t.stop(PHONE_A);

    expect(t.killed).to.deep.equal([]);
    expect(t.ports.release.called).to.equal(false);
  });

  it('lets a tunnel whose process exits go, and starts a new one next time', async () => {
    await t.ensure(PHONE_A);

    t.spawned[0].proc.exit(2); // go-ios crashed
    await settle();

    expect(t.portFor(PHONE_A)).to.equal(undefined);
    expect(t.ports.leased.has(12100)).to.equal(false);
    expect(t.ports.leased.has(12101)).to.equal(false);
    expect(await t.ensure(PHONE_A)).to.equal(12102);
    expect(t.spawned.length).to.equal(2);
  });

  it('a failed lease starts nothing', async () => {
    t.ports.acquirePair.rejects(new Error("Port range for purpose 'tunnel' is exhausted"));

    const err = await t.ensure(PHONE_A).then(
      () => null,
      (e: Error) => e,
    );

    expect(err?.message).to.match(/exhausted/);
    expect(t.spawned).to.deep.equal([]);
    expect(t.portFor(PHONE_A)).to.equal(undefined);
  });

  it('envFor sets GO_IOS_AGENT_PORT only while the phone has a tunnel', async () => {
    const inherited = process.env.GO_IOS_AGENT_PORT;

    expect(t.envFor(PHONE_A).ENABLE_GO_IOS_AGENT).to.equal('yes');
    expect(t.envFor(PHONE_A).GO_IOS_AGENT_PORT).to.equal(inherited);

    await t.ensure(PHONE_A);
    expect(t.envFor(PHONE_A).GO_IOS_AGENT_PORT).to.equal('12100');
    expect(t.envFor(PHONE_B).GO_IOS_AGENT_PORT, 'another phone').to.equal(inherited);

    await t.stop(PHONE_A);
    expect(t.envFor(PHONE_A).GO_IOS_AGENT_PORT).to.equal(inherited);
  });

  it("touch keeps both of the phone's ports leased", async () => {
    await t.ensure(PHONE_A);

    await t.touch(PHONE_A);
    await t.touch(PHONE_B); // no tunnel: nothing to touch

    expect(t.ports.touch.args).to.deep.equal([
      [12100, TUNNEL_LEASE_TTL_MS],
      [12101, TUNNEL_LEASE_TTL_MS],
    ]);
  });
});

describe('IOSTunnels: a phone that goes away (go-ios keeps its agent running)', () => {
  let t: TestTunnels;

  beforeEach(async () => {
    sinon.stub(process, 'kill');
    t = new TestTunnels();
    t.versions.set(PHONE_A, 17.4);
    t.versions.set(PHONE_B, 18.1);
    await t.ensure(PHONE_A);
    await t.ensure(PHONE_B);
  });

  afterEach(async () => {
    await t.stop(PHONE_A);
    await t.stop(PHONE_B);
    sinon.restore();
  });

  it("stops the tunnel of a phone that went away, gives its ports back, and leaves the other phone's", async () => {
    t.answers = (_port, udid) => udid !== PHONE_A; // A's agent: 404 for A

    await t.checkTunnels();

    expect(t.killed).to.deep.equal([t.spawned[0].proc.pid]);
    expect(t.portFor(PHONE_A)).to.equal(undefined);
    expect(t.portFor(PHONE_B)).to.equal(12102);
    expect([...t.ports.leased.keys()]).to.deep.equal([12102, 12103]);
  });

  it('stops a tunnel that came back on another traffic port (a replug)', async () => {
    t.answers = (port, udid) =>
      udid === PHONE_A ? { state: 'up', userspacePort: port + 2 } : true;

    await t.checkTunnels();

    expect(t.killed).to.deep.equal([t.spawned[0].proc.pid]);
    expect(t.portFor(PHONE_A)).to.equal(undefined);
    expect(t.portFor(PHONE_B)).to.equal(12102);
  });

  it("leaves a tunnel alone when its agent doesn't answer (busy, not gone)", async () => {
    t.answers = () => ({ state: 'unknown' });

    await t.checkTunnels();

    expect(t.killed).to.deep.equal([]);
    expect(t.portFor(PHONE_A)).to.equal(12100);
  });

  it('leaves a tunnel that never came up alone while it answers 404', async () => {
    t.versions.set('slow-iphone', 17.0);
    t.answers = (_port, udid) => udid !== 'slow-iphone'; // never ready: the start goes on after 20 s
    await t.ensure('slow-iphone');

    await t.checkTunnels();

    expect(t.killed).to.deep.equal([]);
    expect(t.portFor('slow-iphone')).to.equal(12104);
    await t.stop('slow-iphone');
  });

  it('checks every 5 s while a tunnel runs, and stops checking when none does', async () => {
    await t.stop(PHONE_A);
    await t.stop(PHONE_B);
    const clock = sinon.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const check = sinon.stub(t, 'checkTunnels').resolves();
      await t.ensure(PHONE_A);

      clock.tick(TUNNEL_CHECK_MS);
      expect(check.callCount).to.equal(1);

      await t.stop(PHONE_A);
      clock.tick(TUNNEL_CHECK_MS * 3);
      expect(check.callCount, 'no tunnel, no checks').to.equal(1);
    } finally {
      clock.restore();
    }
  });
});

describe('goIosReason', () => {
  it("reads go-ios's last error or warning", () => {
    expect(goIosReason('{"level":"INFO","msg":"Tunnel server started"}\n')).to.equal(undefined);
    expect(goIosReason('{"level":"WARN","msg":"failed to get tunnel info","udid":"X"}')).to.equal(
      'failed to get tunnel info',
    );
    expect(
      goIosReason(
        '{"level":"ERROR","msg":"first"}\n{"level":"ERROR","msg":"failed to start tunnel","error":"EOF"}\n',
      ),
    ).to.equal('failed to start tunnel: EOF');
  });

  it('keeps a line that is not JSON, trimmed and at most 200 characters', () => {
    expect(goIosReason('  panic: runtime error  \n')).to.equal('panic: runtime error');
    expect(goIosReason('x'.repeat(500))).to.have.length(200);
    expect(goIosReason('\n  \n')).to.equal(undefined);
  });
});

describe('iosVersionOf', () => {
  it('reads the version ios info reports', () => {
    expect(iosVersionOf({ ProductVersion: '17.2.1' })).to.equal(17.2);
    expect(iosVersionOf({ HumanReadableProductVersionString: 'iOS 18.0' })).to.equal(18);
    expect(iosVersionOf({})).to.equal(0);
  });
});

describe('IOSTunnels: its real seams', () => {
  afterEach(() => sinon.restore());

  it("reads the phone's tunnel from its agent: up with its traffic port, gone on 404, unknown when unreachable", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === `/tunnel/${PHONE_A}`) {
        res.writeHead(200, { 'content-type': 'application/json' });
        // go-ios 1.2.1's answer, as the lab's agent gave it
        res.end(
          JSON.stringify({
            address: 'fd51:c966:7c74::1',
            rsdPort: 53752,
            udid: PHONE_A,
            userspaceTun: true,
            userspaceTunPort: 12101,
          }),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const t: any = new IOSTunnels();

    try {
      expect(await t.tunnelInfo(port, PHONE_A)).to.deep.equal({
        state: 'up',
        userspacePort: 12101,
      });
      expect(await t.tunnelInfo(port, PHONE_B), 'another phone: 404').to.deep.equal({
        state: 'gone',
      });
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
    expect(await t.tunnelInfo(port, PHONE_A), 'nothing listening').to.deep.equal({
      state: 'unknown',
    });
  });

  it('spawns the tunnel detached, with the agent setting, and tracks it', () => {
    const fake = new FakeProcess(4321);
    const spawn = sinon.stub(childProcess, 'spawn').returns(fake as any);
    const track = sinon.stub();
    const real = Container.get.bind(Container);
    sinon
      .stub(Container, 'get')
      .callsFake((token: any) => (token === ProcessRegistry ? { track } : real(token)));
    const t: any = new IOSTunnels();

    const proc = t.spawnTunnel(PHONE_A, ['tunnel', 'start', '--udid', PHONE_A]);

    expect(proc).to.equal(fake);
    const [command, args, opts] = spawn.firstCall.args as any[];
    expect(command).to.equal(t.goIOSPath);
    expect(args).to.deep.equal(['tunnel', 'start', '--udid', PHONE_A]);
    expect(opts.detached).to.equal(true);
    expect(opts.env.ENABLE_GO_IOS_AGENT).to.equal('yes');
    expect(track.calledOnceWithExactly({ kind: 'other', udid: PHONE_A, process: fake })).to.equal(
      true,
    );
  });
});
