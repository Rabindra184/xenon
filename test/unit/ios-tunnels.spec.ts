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
  TUNNEL_LEASE_TTL_MS,
  TUNNEL_READY_TIMEOUT_MS,
  iosVersionOf,
} from '../../src/device-managers/ios/IOSTunnels';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';

/**
 * Each iOS 17+ phone gets its own go-ios tunnel, an isolated per-device agent
 * on its own pair of leased ports. Through 2.7 every tunnel took go-ios's
 * default 60105/60106, so a second iPhone's stream killed the first's.
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
  answers: (port: number, udid: string) => boolean = () => true;
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
  protected async tunnelAnswers(port: number, udid: string): Promise<boolean> {
    return this.answers(port, udid);
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

  afterEach(() => sinon.restore());

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

  it('lets a tunnel that exits on its own go, and starts a new one next time', async () => {
    await t.ensure(PHONE_A);

    t.spawned[0].proc.exit(0); // the phone was unplugged
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

describe('iosVersionOf', () => {
  it('reads the version ios info reports', () => {
    expect(iosVersionOf({ ProductVersion: '17.2.1' })).to.equal(17.2);
    expect(iosVersionOf({ HumanReadableProductVersionString: 'iOS 18.0' })).to.equal(18);
    expect(iosVersionOf({})).to.equal(0);
  });
});

describe('IOSTunnels: its real seams', () => {
  afterEach(() => sinon.restore());

  it('a tunnel answers for a phone only when its API returns 200 for that phone', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === `/tunnel/${PHONE_A}`) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ Udid: PHONE_A, UserspaceTUN: true, UserspaceTUNPort: 12101 }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const t: any = new IOSTunnels();

    try {
      expect(await t.tunnelAnswers(port, PHONE_A)).to.equal(true);
      expect(await t.tunnelAnswers(port, PHONE_B), 'another phone: 404').to.equal(false);
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
    expect(await t.tunnelAnswers(port, PHONE_A), 'nothing listening').to.equal(false);
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
