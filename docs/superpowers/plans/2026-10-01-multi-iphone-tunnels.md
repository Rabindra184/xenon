# A go-ios tunnel per iPhone: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let several iOS 17+ iPhones preview and record at once on one Mac, by giving each phone its own go-ios tunnel on its own leased ports.

**Architecture:** A new `IOSTunnels` service owns one `ios tunnel start --udid <phone> --userspace --tunnel-info-port <P>` per phone. P and P + 1 are leased from a new `tunnel` range by a new `PortAllocator.acquirePair`. Every go-ios command that needs a tunnel (`runwda`, `ostrace`, `syslog`, `screenshot`) gets `GO_IOS_AGENT_PORT=<P>` from `IOSTunnels.envFor(udid)`. `IOSStreamService` keeps its policy (never under an Appium session) and drops the fixed 60105/60106 ports and their kill-by-port sweep.

**Tech Stack:** TypeScript 5.5, TypeDI, Prisma (SQLite `PortLease` table), Mocha + Chai + Sinon, go-ios 1.2.1 (vendored at `~/.cache/xenon/goIOS/ios`).

**Spec:** `docs/superpowers/specs/2026-10-01-multi-iphone-tunnels-design.md`

## Global Constraints

- The port range is `[12100, 12199]` and its purpose name is `'tunnel'`. A pair is an even P, for the tunnel-info API, and P + 1, which go-ios derives for the phone's userspace traffic.
- The tunnel command is `tunnel start --udid <udid> --userspace --tunnel-info-port <P>`, spawned detached (`tunnelSpawnOptions`) with `ENABLE_GO_IOS_AGENT=yes`.
- **Readiness:** the tunnel is ready when `GET http://127.0.0.1:<P>/tunnel/<udid>` answers 200. Wait up to `TUNNEL_READY_TIMEOUT_MS = 20_000`, polling every `TUNNEL_READY_POLL_MS = 500`, then warn and return P. If the tunnel exits before it is ready, throw.
- **Lease length:** `TUNNEL_LEASE_TTL_MS = 90 * 60 * 1000`, the same as the stream's ports. The hourly stream watchdog refreshes it.
- **Environment:** a command gets `GO_IOS_AGENT_PORT=<P>` only while its phone has a tunnel. Otherwise it gets today's environment, `process.env` plus `ENABLE_GO_IOS_AGENT=yes`.
- **Never kill by port:** no `lsof` or `kill -9` of 60105 or 60106 anywhere.
- **Appium sessions:** no go-ios cleanup runs while an Appium session holds the phone (`appiumSessionMayUse`). This rule is unchanged.
- **Tests first:** write the failing test, run it red, then make it green.
- **Mocha hooks:** `before`/`after`/`beforeEach`/`afterEach` go inside `describe`, never at the top of a file.
- **`process.kill`:** stub it in any test that can reach `ProcessRegistry` or a process-group kill.
- **Each spec stands alone:** it passes on its own with `npx mocha <file>`. It imports `reflect-metadata` when it touches TypeDI, and it imports what it uses.
- **Staging:** stage explicit paths only. Never `git add -A` or `git add .`, and never stage `temp-appium/*.json`.
- **Formatting:**
  - Never run `npm run lint`, which is `--fix`, or prettier on existing files. Hand-format your own lines in them.
  - Prettier is allowed only on files this plan creates.
- **Commit messages:** no attribution lines.
- **Node:** use v22.19 through nvm, so every shell starts with `source ~/.nvm/nvm.sh && nvm use 22.19.0`.
- **The lab server:** never run `npm run build` in the main checkout. The lab's plugin links to it (`~/.appium/node_modules/@xenon-device-management/xenon -> ~/Workspace/XAenon/xenon`). Hardware checks build in a worktree (Task 7).

## Review Focus

These are the inputs most likely to bite someone that the spec implies but doesn't spell out. Each one has a test in the task that owns it.

1. **A phone unplugged mid-stream, then a new start.**
   - Expected: the dead tunnel gives back its ports, and `ensure` never returns the dead tunnel's port.
   - Test: Task 2, "lets a tunnel that exits on its own go, and starts a new one next time".
2. **A tunnel that can't bind**, because another server took the pair a moment earlier.
   - Expected: the start fails at once with a clear reason, not after 20 s of waiting and a confusing `runwda` error.
   - Test: Task 2, "fails the start when the tunnel exits before it is ready".
3. **Starting or stopping phone B while phone A streams.**
   - Expected: A's tunnel, ports and stream are untouched.
   - Tests: Task 2 "stops only that phone's tunnel", and Task 4 "stopping one iPhone's stream leaves another iPhone's tunnel alone".
4. **A start that failed after its tunnel came up**, so its session sits in the map with status `error`.
   - Expected: the next start stops that tunnel and gives its ports back before starting again.
   - Test: Task 4, "stops the failed start's tunnel before starting again".
5. **The tunnel range is used up, or a pair is half taken.**
   - Expected: a clear `PortRangeExhaustedError`, nothing spawned, and no half-leased pair left behind.
   - Tests: Task 1 "throws PortRangeExhaustedError when no pair is left", and Task 2 "a failed lease starts nothing".

## Files

| File | Change | Responsibility |
|---|---|---|
| `src/services/PortAllocator.ts` | Modify | The new `tunnel` purpose and range; `acquirePair`; `releasePurpose` |
| `src/device-managers/ios/IOSTunnels.ts` | Create | One go-ios tunnel per phone: `ensure`, `portFor`, `envFor`, `stop`, `touch` |
| `src/device-managers/ios/IOSLogStreamService.ts` | Modify | `ostrace` gets `envFor(udid)` |
| `src/device-managers/ios/WDAClient.ts` | Modify | `screenshot` and `syslog` get `envFor(udid)` |
| `src/device-managers/ios/IOSStreamService.ts` | Modify | Use `IOSTunnels`; drop `ensureTunnel`, 60105/60106 and the port sweep; `tunnelPort` on the session; refresh the lease hourly; drop tunnel leases at boot |
| `test/unit/port-allocator-pairs.spec.ts` | Create | `acquirePair` and `releasePurpose` against a scratch lease table |
| `test/unit/ios-tunnels.spec.ts` | Create | `IOSTunnels` |
| `test/unit/ios-go-ios-tunnel-env.spec.ts` | Create | `ostrace`, `syslog` and `screenshot` carry their own phone's port |
| `test/unit/ios-stream-appium-tunnel.spec.ts` | Rewrite | The stream's tunnel rules with `IOSTunnels` |
| `test/unit/ios-stream-port-leases.spec.ts` | Modify | Stub `IOSTunnels`; `runwda` gets the phone's port |
| `CLAUDE.md` | Modify | Document a tunnel per iPhone |

---

### Task 1: `PortAllocator` leases port pairs

**Files:**
- Modify: `src/services/PortAllocator.ts`
- Test: `test/unit/port-allocator-pairs.spec.ts` (create)

**Interfaces:**
- Consumes: the existing `PortAllocator`: `configure`, `release(port, udid)`, protected `isOsFree(port)`, and `PortRangeExhaustedError`.
- Produces:
  - `PortPurpose` gains `'tunnel'`, and `PortRanges` gains `tunnel?: [number, number]`, defaulting to `[12100, 12199]`.
  - `acquirePair(purpose: PortPurpose, udid: string, opts?: { pid?: number; ttlMs?: number }): Promise<number>` returns P; P and P + 1 are both leased to `udid`.
  - `releasePurpose(purpose: PortPurpose): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/port-allocator-pairs.spec.ts`:

```ts
import { expect } from 'chai';
import net from 'net';
import { PortAllocator, PortRangeExhaustedError } from '../../src/services/PortAllocator';
import { useScratchPortLeases } from '../helpers/scratch-port-leases';

/**
 * A go-ios tunnel needs two adjacent ports: P for its tunnel-info API and
 * P + 1, which go-ios derives for the phone's userspace traffic. These run
 * PortAllocator's real queries against a scratch lease table, and real binds.
 */
describe('PortAllocator.acquirePair (go-ios tunnel ports)', () => {
  const scratch = useScratchPortLeases();
  const listeners: net.Server[] = [];

  function allocator(range: [number, number]): PortAllocator {
    const a = new PortAllocator();
    a.configure({ tunnel: range });
    return a;
  }

  /** Something else listening on `port`, as another program's socket would. */
  function hold(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => resolve());
      listeners.push(server);
    });
  }

  async function leasesOf(udid: string): Promise<number[]> {
    const rows = await scratch.db.portLease.findMany({
      where: { leasedToUdid: udid },
      orderBy: { port: 'asc' },
    });
    return rows.map((r) => r.port);
  }

  async function leaseTo(udid: string, port: number, purpose: string): Promise<void> {
    const now = Date.now();
    await scratch.db.portLease.create({
      data: { port, purpose, leasedToUdid: udid, leasedAt: now, expiresAt: now + 60_000 },
    });
  }

  afterEach(async () => {
    await Promise.all(
      listeners.splice(0).map((s) => new Promise((resolve) => s.close(() => resolve(undefined)))),
    );
  });

  it('leases an even port and the next one, and returns the even one', async () => {
    const b = scratch.base;

    const port = await allocator([b, b + 5]).acquirePair('tunnel', 'phone-a', { ttlMs: 60_000 });

    expect(port).to.equal(b);
    expect(await leasesOf('phone-a')).to.deep.equal([b, b + 1]);
    const rows = await scratch.db.portLease.findMany({ where: { leasedToUdid: 'phone-a' } });
    expect(rows.map((r) => r.purpose)).to.deep.equal(['tunnel', 'tunnel']);
  });

  it('gives a second phone the next pair', async () => {
    const b = scratch.base;
    const a = allocator([b, b + 5]);
    await a.acquirePair('tunnel', 'phone-a');

    expect(await a.acquirePair('tunnel', 'phone-b')).to.equal(b + 2);
    expect(await leasesOf('phone-b')).to.deep.equal([b + 2, b + 3]);
  });

  it('skips a pair whose second port is leased, whatever for, and keeps none of it', async () => {
    const b = scratch.base;
    await leaseTo('another-device', b + 1, 'wda');

    expect(await allocator([b, b + 5]).acquirePair('tunnel', 'phone-a')).to.equal(b + 2);
    expect(await leasesOf('phone-a')).to.deep.equal([b + 2, b + 3]);
  });

  it('skips a pair whose second port something else listens on', async () => {
    const b = scratch.base;
    await hold(b + 1);

    expect(await allocator([b, b + 5]).acquirePair('tunnel', 'phone-a')).to.equal(b + 2);
    expect(await leasesOf('phone-a')).to.deep.equal([b + 2, b + 3]);
  });

  it('starts at the first even port of a range that starts odd', async () => {
    const b = scratch.base;

    expect(await allocator([b + 1, b + 4]).acquirePair('tunnel', 'phone-a')).to.equal(b + 2);
  });

  it('throws PortRangeExhaustedError when no pair is left, and keeps no half pair', async () => {
    const b = scratch.base;
    await leaseTo('another-phone', b + 1, 'tunnel');

    const err = await allocator([b, b + 1])
      .acquirePair('tunnel', 'phone-a')
      .then(
        () => null,
        (e: Error) => e,
      );

    expect(err).to.be.instanceOf(PortRangeExhaustedError);
    expect(err?.message).to.match(/tunnel/);
    expect(await leasesOf('phone-a')).to.deep.equal([]);
  });

  it("releasePurpose deletes only that purpose's leases", async () => {
    const b = scratch.base;
    const a = allocator([b, b + 5]);
    await a.acquirePair('tunnel', 'phone-a');
    await leaseTo('phone-a', b + 50, 'wda');

    await a.releasePurpose('tunnel');

    expect(await leasesOf('phone-a')).to.deep.equal([b + 50]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx mocha test/unit/port-allocator-pairs.spec.ts`
Expected: FAIL. ts-node reports TS errors: `'tunnel'` is not assignable to `PortRanges` / `PortPurpose`, and `acquirePair` and `releasePurpose` don't exist.

- [ ] **Step 3: Write the implementation**

In `src/services/PortAllocator.ts`, change the purpose type, the ranges interface and the defaults:

```ts
export type PortPurpose = 'wda' | 'mjpeg' | 'system' | 'proxy' | 'tunnel';

export interface PortRanges {
  wda?: [number, number];
  mjpeg?: [number, number];
  system?: [number, number];
  proxy?: [number, number];
  /** go-ios tunnels, leased in pairs (acquirePair). */
  tunnel?: [number, number];
}

const DEFAULT_RANGES: Required<PortRanges> = {
  wda: [8100, 8199],
  mjpeg: [9100, 9199],
  system: [10100, 10199],
  proxy: [11100, 11199],
  tunnel: [12100, 12199],
};
```

Add these methods directly after `tryAcquire` (before `blockPort`):

```ts
  /**
   * Lease two adjacent ports, an even P and P + 1, and return P. A go-ios
   * tunnel needs both: P for its tunnel-info API, and P + 1, which go-ios
   * itself picks for the phone's traffic.
   *
   * Both must be free in the lease table, whatever purpose holds them, and at
   * the OS. A half-taken pair is given back before the next one is tried.
   */
  async acquirePair(
    purpose: PortPurpose,
    udid: string,
    opts: { pid?: number; ttlMs?: number } = {},
  ): Promise<number> {
    const [start, end] = this.ranges[purpose];
    const ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
    const now = Date.now();

    await prisma.portLease.deleteMany({ where: { expiresAt: { lt: now } } });

    const active = await prisma.portLease.findMany({
      where: { port: { gte: start, lte: end } },
      select: { port: true },
    });
    const taken = new Set(active.map((l: { port: number }) => l.port));
    const lease = {
      purpose,
      leasedToUdid: udid,
      leasedToPid: opts.pid,
      leasedAt: now,
      expiresAt: now + ttlMs,
    };

    for (let port = start + (start % 2); port + 1 <= end; port += 2) {
      if (taken.has(port) || taken.has(port + 1)) continue;
      const leased: number[] = [];
      try {
        for (const p of [port, port + 1]) {
          await prisma.portLease.create({ data: { port: p, ...lease } });
          leased.push(p);
        }
      } catch (err: any) {
        await this.releaseAll(leased, udid);
        if (err.code === 'P2002') continue;
        throw err;
      }

      if ((await this.isOsFree(port)) && (await this.isOsFree(port + 1))) {
        this.log.debug(`Leased ports ${port}-${port + 1} (${purpose}) to ${udid}`);
        return port;
      }
      await this.releaseAll(leased, udid);
    }

    throw new PortRangeExhaustedError(purpose);
  }

  /** Delete every lease of `purpose`. At boot, when nothing of this server holds one. */
  async releasePurpose(purpose: PortPurpose): Promise<void> {
    await prisma.portLease.deleteMany({ where: { purpose } });
  }

  private async releaseAll(ports: number[], udid: string): Promise<void> {
    for (const port of ports) await this.release(port, udid);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha test/unit/port-allocator-pairs.spec.ts test/unit/PortAllocator.test.ts test/unit/port-allocator-os-probe.spec.ts test/unit/port-exhaustion.spec.ts`
Expected: all pass. The new spec reports 7 passing.

- [ ] **Step 5: Commit**

```bash
git add src/services/PortAllocator.ts test/unit/port-allocator-pairs.spec.ts
git commit -m "feat(ports): lease port pairs for go-ios tunnels"
```

---

### Task 2: `IOSTunnels`, one go-ios tunnel per phone

**Files:**
- Create: `src/device-managers/ios/IOSTunnels.ts`
- Test: `test/unit/ios-tunnels.spec.ts` (create)

**Interfaces:**
- Consumes:
  - `PortAllocator.acquirePair('tunnel', udid, { ttlMs })`, `release(port, udid)` and `touch(port, ttlMs)` (Task 1).
  - From `./tunnelProcess`: `killProcessGroup(pid)` and `tunnelSpawnOptions(env)`.
  - From `./iosStreamDiagnostics`: `classifyTunnelStderr(text)`.
  - `ProcessRegistry.track({ kind, udid, process })`.
  - `ResourceIsolationService.wrapSpawn(command, args, 'Performance')`.
- Produces (`src/device-managers/ios/IOSTunnels.ts`):
  - `@Service() export class IOSTunnels` with:
    - `ensure(udid: string): Promise<number | null>`
    - `portFor(udid: string): number | undefined`
    - `envFor(udid: string): NodeJS.ProcessEnv`
    - `stop(udid: string): Promise<void>`
    - `touch(udid: string): Promise<void>`
    - `goIOSPath: string`
  - Exported constants: `TUNNEL_READY_TIMEOUT_MS = 20_000`, `TUNNEL_READY_POLL_MS = 500`, `TUNNEL_LEASE_TTL_MS = 90 * 60 * 1000`.
  - Exported function: `iosVersionOf(info): number`.
  - Protected seams, which tests override:
    - `iosVersion(udid): Promise<number>`
    - `spawnTunnel(udid, args): ChildProcess`
    - `tunnelAnswers(port, udid): Promise<boolean>`
    - `sleep(ms): Promise<void>`
    - `killGroup(pid): void`
    - `allocator(): PortAllocator`

- [ ] **Step 1: Write the failing test**

Create `test/unit/ios-tunnels.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx mocha test/unit/ios-tunnels.spec.ts`
Expected: FAIL with `Cannot find module '../../src/device-managers/ios/IOSTunnels'`.

- [ ] **Step 3: Write the implementation**

Create `src/device-managers/ios/IOSTunnels.ts`:

```ts
/**
 * One go-ios tunnel per iOS 17+ phone, each on its own leased pair of ports.
 *
 * On iOS 17 and later, the go-ios commands Xenon runs against a phone's
 * services (`runwda`, `ostrace`, `syslog`, `screenshot`) reach it through a
 * tunnel, which they find through that tunnel's info API. Through 2.7 every
 * tunnel took go-ios's default ports (60105 for the API, 60106 for the
 * traffic), so a second iPhone's stream killed the first one's tunnel.
 *
 * Each phone now gets `tunnel start --udid <phone> --tunnel-info-port <P>`,
 * an isolated per-device agent: P from the `tunnel` port range, and P + 1,
 * which go-ios derives for the phone's traffic. A command finds its phone's
 * tunnel through GO_IOS_AGENT_PORT, set by {@link IOSTunnels.envFor}.
 *
 * This is mechanism only. When a tunnel may be stopped (never under a live
 * Appium session) is IOSStreamService's decision.
 */
import { Container, Service } from 'typedi';
import { spawn, exec, type ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';
import { promisify } from 'util';
import log from '../../logger';
import { cachePath } from '../../helpers';
import { PortAllocator } from '../../services/PortAllocator';
import { ProcessRegistry } from '../../services/ProcessRegistry';
import { ResourceIsolationService } from '../../services/ResourceIsolationService';
import { classifyTunnelStderr } from './iosStreamDiagnostics';
import { killProcessGroup, tunnelSpawnOptions } from './tunnelProcess';

const execPromise = promisify(exec);

/** How long a new tunnel has to answer for its phone before the start goes on without it. */
export const TUNNEL_READY_TIMEOUT_MS = 20_000;
export const TUNNEL_READY_POLL_MS = 500;
/**
 * A tunnel's port lease: the same as the stream's own ports
 * (IOSStreamService's STREAM_PORT_TTL_MS). The stream watchdog refreshes both
 * every hour, the tunnel's through {@link IOSTunnels.touch}.
 */
export const TUNNEL_LEASE_TTL_MS = 90 * 60 * 1000;

/** The iOS version `ios info` reports, as a number: 17.2 for "17.2.1" or "iOS 17.2", 0 for none. */
export function iosVersionOf(info: {
  ProductVersion?: unknown;
  HumanReadableProductVersionString?: unknown;
}): number {
  const versionStr = String(info.ProductVersion || info.HumanReadableProductVersionString || '0');
  const match = versionStr.match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[0]) : 0;
}

interface Tunnel {
  port: number;
  process: ChildProcess;
}

@Service()
export class IOSTunnels {
  private log = log.scope('IOSTunnels');
  private tunnels = new Map<string, Tunnel>();
  public goIOSPath = path.join(cachePath('goIOS'), 'ios');

  /**
   * The phone's tunnel-info port, starting its tunnel if it has none. Null
   * for a phone below iOS 17, or whose version can't be read: it needs no
   * tunnel. Throws when no pair of ports is left, or when the tunnel exits
   * before it is ready.
   */
  async ensure(udid: string): Promise<number | null> {
    const running = this.portFor(udid);
    if (running !== undefined) return running;

    let version: number;
    try {
      version = await this.iosVersion(udid);
    } catch (e: any) {
      this.log.warn(`[${udid}] Could not read the iOS version, so no go-ios tunnel: ${e?.message ?? e}`);
      return null;
    }
    if (version < 17) return null;

    const port = await this.allocator().acquirePair('tunnel', udid, {
      ttlMs: TUNNEL_LEASE_TTL_MS,
    });
    let proc: ChildProcess;
    try {
      proc = this.spawnTunnel(udid, [
        'tunnel',
        'start',
        '--udid',
        udid,
        '--userspace',
        '--tunnel-info-port',
        String(port),
      ]);
    } catch (e) {
      await this.releasePair(port, udid);
      throw e;
    }
    const tunnel: Tunnel = { port, process: proc };
    this.tunnels.set(udid, tunnel);
    // A tunnel that ends on its own (phone unplugged, go-ios crash) gives its
    // ports back, and the phone's next start gets a new one.
    const ended = () => {
      if (this.tunnels.get(udid) !== tunnel) return;
      this.tunnels.delete(udid);
      void this.releasePair(port, udid);
    };
    proc.once('exit', ended);
    proc.once('error', (err: Error) => {
      this.log.warn(`[${udid}] go-ios tunnel failed: ${err.message}`);
      ended();
    });
    this.logOutput(udid, proc);

    this.log.info(`[${udid}] iOS ${version}: starting a go-ios tunnel on ${port} (traffic on ${port + 1})`);
    const polls = TUNNEL_READY_TIMEOUT_MS / TUNNEL_READY_POLL_MS;
    for (let poll = 0; poll <= polls; poll++) {
      if (poll > 0) await this.sleep(TUNNEL_READY_POLL_MS);
      if (this.tunnels.get(udid) !== tunnel) {
        throw new Error(
          `The go-ios tunnel for ${udid} exited before it was ready (exit code ${proc.exitCode})`,
        );
      }
      if (await this.tunnelAnswers(port, udid)) {
        this.log.info(`[${udid}] go-ios tunnel ready on ${port}`);
        return port;
      }
    }
    this.log.warn(
      `[${udid}] go-ios tunnel on ${port} not ready after ${TUNNEL_READY_TIMEOUT_MS / 1000}s, proceeding anyway`,
    );
    return port;
  }

  /** The phone's tunnel-info port, while its tunnel runs. */
  portFor(udid: string): number | undefined {
    const tunnel = this.tunnels.get(udid);
    return tunnel && tunnel.process.exitCode === null ? tunnel.port : undefined;
  }

  /**
   * The environment for a go-ios command about this phone: today's, plus
   * GO_IOS_AGENT_PORT while the phone has a tunnel, so the command finds that
   * tunnel and not go-ios's default 60105.
   */
  envFor(udid: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' };
    const port = this.portFor(udid);
    if (port !== undefined) env.GO_IOS_AGENT_PORT = String(port);
    return env;
  }

  /** Stop the phone's tunnel and give its ports back. Other phones' tunnels are untouched. */
  async stop(udid: string): Promise<void> {
    const tunnel = this.tunnels.get(udid);
    if (!tunnel) return;
    this.tunnels.delete(udid);
    this.killGroup(tunnel.process.pid);
    await this.releasePair(tunnel.port, udid);
  }

  /** Keep the phone's tunnel ports leased. The stream watchdog calls this hourly. */
  async touch(udid: string): Promise<void> {
    const tunnel = this.tunnels.get(udid);
    if (!tunnel) return;
    const allocator = this.allocator();
    await allocator.touch(tunnel.port, TUNNEL_LEASE_TTL_MS);
    await allocator.touch(tunnel.port + 1, TUNNEL_LEASE_TTL_MS);
  }

  private async releasePair(port: number, udid: string): Promise<void> {
    try {
      const allocator = this.allocator();
      await allocator.release(port, udid);
      await allocator.release(port + 1, udid);
    } catch (e: any) {
      this.log.warn(`[${udid}] Could not release tunnel ports ${port}-${port + 1}: ${e?.message ?? e}`);
    }
  }

  /**
   * go-ios's output, at debug. Its repeated warning about a connected
   * pre-iOS 17 phone (which needs no tunnel) is logged once per phone.
   */
  private logOutput(udid: string, proc: ChildProcess): void {
    proc.stdout?.on('data', (data) => this.log.debug(`Tunnel [${udid}]: ${data}`));
    const loggedUnsupported = new Set<string>();
    proc.stderr?.on('data', (data) => {
      const text = String(data);
      const { unsupported, udid: targetUdid } = classifyTunnelStderr(text);
      if (unsupported) {
        const key = targetUdid ?? 'unknown';
        if (!loggedUnsupported.has(key)) {
          loggedUnsupported.add(key);
          this.log.debug(
            `Tunnel [${udid}]: device ${key} is pre-iOS 17 and needs no tunnel; suppressing repeated go-ios warnings`,
          );
        }
        return;
      }
      this.log.debug(`Tunnel Err [${udid}]: ${text}`);
    });
  }

  // ---------------------------------------------------------------------
  // Seams. Overridden by tests; the defaults are the real thing.
  // ---------------------------------------------------------------------

  protected async iosVersion(udid: string): Promise<number> {
    const { stdout } = await execPromise(`"${this.goIOSPath}" info --udid ${udid}`, {
      env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
    });
    return iosVersionOf(JSON.parse(stdout));
  }

  /**
   * Detached, so the tunnel leads its own process group and its self-forking
   * agent children die with it (see ./tunnelProcess).
   */
  protected spawnTunnel(udid: string, args: string[]): ChildProcess {
    const wrapped = Container.get(ResourceIsolationService).wrapSpawn(
      this.goIOSPath,
      args,
      'Performance', // a tunnel the phone's stream depends on
    );
    const proc = spawn(
      wrapped.command,
      wrapped.args,
      tunnelSpawnOptions({ ...process.env, ENABLE_GO_IOS_AGENT: 'yes' }),
    );
    Container.get(ProcessRegistry).track({ kind: 'other', udid, process: proc });
    return proc;
  }

  /**
   * Whether the tunnel on `port` has the phone: go-ios's API answers
   * `GET /tunnel/<udid>` with 200 once it does, and 404 until then.
   */
  protected tunnelAnswers(port: number, udid: string): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: `/tunnel/${encodeURIComponent(udid)}`,
          timeout: 1000,
          agent: false,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(false));
    });
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected killGroup(pid: number | undefined): void {
    killProcessGroup(pid);
  }

  protected allocator(): PortAllocator {
    return Container.get(PortAllocator);
  }
}
```

Run prettier on the two new files only: `npx prettier --write src/device-managers/ios/IOSTunnels.ts test/unit/ios-tunnels.spec.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha test/unit/ios-tunnels.spec.ts test/unit/ios-tunnel-process.spec.ts`
Expected: all pass. The new spec reports 17 passing.

- [ ] **Step 5: Commit**

```bash
git add src/device-managers/ios/IOSTunnels.ts test/unit/ios-tunnels.spec.ts
git commit -m "feat(ios): a go-ios tunnel per iPhone, on its own leased ports"
```

---

### Task 3: `ostrace`, `syslog` and `screenshot` find their own phone's tunnel

**Files:**
- Modify: `src/device-managers/ios/IOSLogStreamService.ts` (`spawnOstrace` around line 282, `spawnProcess` at line 300)
- Modify: `src/device-managers/ios/WDAClient.ts` (`getScreenshot` around line 422, `startLogStream` around line 818)
- Test: `test/unit/ios-go-ios-tunnel-env.spec.ts` (create)

**Interfaces:**
- Consumes: `IOSTunnels.envFor(udid): NodeJS.ProcessEnv` (Task 2).
- Produces: `IOSLogStreamService`'s protected `spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess`, which gains the `env` parameter.

- [ ] **Step 1: Write the failing test**

Create `test/unit/ios-go-ios-tunnel-env.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { Container } from 'typedi';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { IOSLogStreamService } from '../../src/device-managers/ios/IOSLogStreamService';
import { IOSTunnels } from '../../src/device-managers/ios/IOSTunnels';
import { WDAClient } from '../../src/device-managers/ios/WDAClient';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';

/**
 * On iOS 17+ a go-ios command finds its phone's tunnel through
 * GO_IOS_AGENT_PORT. Each phone has its own tunnel now, so each command has
 * to carry its own phone's port, or it reaches go-ios's default 60105, where
 * no tunnel listens.
 *
 * `go-ios` here is a shell script that reports the port it was run with.
 */

const WITH_TUNNEL = 'test-iphone-tunnel-00008150';
const NO_TUNNEL = 'test-iphone-plain-00008110';

const FAKE_GO_IOS = `#!/bin/sh
# Stands in for go-ios: reports the GO_IOS_AGENT_PORT it was run with.
case "$1" in
  screenshot) printf 'port=%s' "$GO_IOS_AGENT_PORT" > "$5" ;;
  syslog) printf '{"msg":"port=%s"}\\n' "$GO_IOS_AGENT_PORT"; exec sleep 5 ;;
esac
`;

/** IOSTunnels as if WITH_TUNNEL's tunnel ran on 12100 and NO_TUNNEL had none. */
const tunnels = {
  envFor(udid: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' };
    delete env.GO_IOS_AGENT_PORT;
    if (udid === WITH_TUNNEL) env.GO_IOS_AGENT_PORT = '12100';
    return env;
  },
};

describe("go-ios commands find their own phone's tunnel (GO_IOS_AGENT_PORT)", () => {
  let dir: string;
  let goIOS: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-fake-goios-'));
    goIOS = path.join(dir, 'ios');
    fs.writeFileSync(goIOS, FAKE_GO_IOS, { mode: 0o755 });
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  beforeEach(() => {
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === IOSTunnels) return tunnels;
      if (token === IOSStreamService) {
        return { goIOSPath: goIOS, isGoIOSAvailable: async () => true };
      }
      if (token === ProcessRegistry) return { track: () => 'tracked' };
      return real(token);
    });
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async ({ udid }: { udid: string }) => ({ udid, realDevice: true }),
    } as any);
  });

  afterEach(() => sinon.restore());

  describe("device control's screenshot (WDAClient)", () => {
    it("runs go-ios screenshot with the phone's tunnel port", async () => {
      const png = await new WDAClient().getScreenshot(WITH_TUNNEL);

      expect(Buffer.from(png, 'base64').toString()).to.equal('port=12100');
    });

    it('runs it with no tunnel port for a phone that has no tunnel', async () => {
      const png = await new WDAClient().getScreenshot(NO_TUNNEL);

      expect(Buffer.from(png, 'base64').toString()).to.equal('port=');
    });
  });

  describe('the logs read (WDAClient syslog)', () => {
    let client: WDAClient;

    beforeEach(() => {
      client = new WDAClient();
    });

    afterEach(() => {
      (client as any).stopLogStream(WITH_TUNNEL);
      (client as any).stopLogStream(NO_TUNNEL);
    });

    /** The first line the phone's syslog yields; the first read starts it. */
    async function firstLine(udid: string): Promise<string> {
      for (let i = 0; i < 50; i++) {
        const lines = await client.getLogs(udid);
        if (lines) return lines;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return '';
    }

    it("runs go-ios syslog with the phone's tunnel port", async () => {
      expect(await firstLine(WITH_TUNNEL)).to.equal('port=12100');
    });

    it('runs it with no tunnel port for a phone that has no tunnel', async () => {
      expect(await firstLine(NO_TUNNEL)).to.equal('port=');
    });
  });

  describe('the live logs pane (IOSLogStreamService ostrace)', () => {
    class CapturingLogs extends IOSLogStreamService {
      spawned: { command: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
      protected async goIOSPath(): Promise<string> {
        return goIOS;
      }
      protected spawnProcess(command: string, args: string[], env?: NodeJS.ProcessEnv): any {
        this.spawned.push({ command, args, env });
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        return proc;
      }
    }

    it("runs go-ios ostrace with the phone's tunnel port", async () => {
      const logs = new CapturingLogs();

      await (logs as any).spawnOstrace(WITH_TUNNEL, {});

      expect(logs.spawned[0].args[0]).to.equal('ostrace');
      expect(logs.spawned[0].env?.GO_IOS_AGENT_PORT).to.equal('12100');
    });

    it('runs it with no tunnel port for a phone that has no tunnel', async () => {
      const logs = new CapturingLogs();

      await (logs as any).spawnOstrace(NO_TUNNEL, {});

      expect(logs.spawned[0].env, 'an environment is passed').to.not.equal(undefined);
      expect(logs.spawned[0].env?.GO_IOS_AGENT_PORT).to.equal(undefined);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx mocha test/unit/ios-go-ios-tunnel-env.spec.ts`
Expected: FAIL, 4 of 6 tests:
- The screenshot and syslog `WITH_TUNNEL` tests get `'port='` (unless your own shell exports `GO_IOS_AGENT_PORT`).
- Both `ostrace` tests see `env` `undefined`.

The two `NO_TUNNEL` WDAClient tests may already pass. That's expected: today's code passes no port.

- [ ] **Step 3: Write the implementation**

In `src/device-managers/ios/IOSLogStreamService.ts`:

1. Add the import, after `import { IDLE_TIMEOUT_MS, IDLE_POLL_MS } from '../android/LogcatStreamService';`:

```ts
import { IOSTunnels } from './IOSTunnels';
```

2. In `spawnOstrace`, replace

```ts
    const proc = this.spawnProcess(goIOS, args);
```

with

```ts
    // On iOS 17+ ostrace reaches the phone through the phone's own go-ios
    // tunnel, found through GO_IOS_AGENT_PORT (see IOSTunnels).
    const proc = this.spawnProcess(goIOS, args, Container.get(IOSTunnels).envFor(udid));
```

3. Replace

```ts
  protected spawnProcess(command: string, args: string[]): ChildProcess {
    return spawn(command, args);
  }
```

with

```ts
  protected spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
    return spawn(command, args, { env });
  }
```

In `src/device-managers/ios/WDAClient.ts`:

1. Add the import, after `import IOSStreamService from './IOSStreamService';`:

```ts
import { IOSTunnels } from './IOSTunnels';
```

2. In `getScreenshot`, replace

```ts
        await execFilePromise(s.goIOSPath, ['screenshot', '--udid', udid, '--output', p], {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });
```

with

```ts
        await execFilePromise(s.goIOSPath, ['screenshot', '--udid', udid, '--output', p], {
          // This phone's own go-ios tunnel on iOS 17+ (see IOSTunnels).
          env: Container.get(IOSTunnels).envFor(udid),
        });
```

3. In `startLogStream`, replace

```ts
    const proc = spawn(command, args, {
      env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
```

with

```ts
    const proc = spawn(command, args, {
      // This phone's own go-ios tunnel on iOS 17+ (see IOSTunnels).
      env: Container.get(IOSTunnels).envFor(udid),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
```

Leave WDAClient's `install`, `uninstall` and `apps` calls alone: go-ios doesn't need a tunnel for them. Run prettier on the new spec only: `npx prettier --write test/unit/ios-go-ios-tunnel-env.spec.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha test/unit/ios-go-ios-tunnel-env.spec.ts test/unit/ostrace-parse.spec.ts test/unit/ios-wda-status-identity.spec.ts`
Expected: all pass. The new spec reports 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/device-managers/ios/IOSLogStreamService.ts src/device-managers/ios/WDAClient.ts test/unit/ios-go-ios-tunnel-env.spec.ts
git commit -m "feat(ios): ostrace, syslog and screenshot use their phone's own tunnel"
```

---

### Task 4: `IOSStreamService` runs each phone's tunnel through `IOSTunnels`

**Files:**
- Modify: `src/device-managers/ios/IOSStreamService.ts`
- Rewrite: `test/unit/ios-stream-appium-tunnel.spec.ts`
- Modify: `test/unit/ios-stream-port-leases.spec.ts`

**Interfaces:**
- Consumes: `IOSTunnels.ensure`, `envFor`, `stop` and `touch` (Task 2); `PortAllocator.releasePurpose('tunnel')` (Task 1).
- Produces: `StreamSession.tunnelPort: number | null`, which replaces `tunnelProcess`. It holds the phone's tunnel-info port when this stream's start ensured one.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `test/unit/ios-stream-appium-tunnel.spec.ts` with:

```ts
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
  svc.STREAM_PORT_TTL_MS = 90 * 60 * 1000;
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
```

Make these edits to `test/unit/ios-stream-port-leases.spec.ts`:

1. Add the import, after `import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';`:

```ts
import { IOSTunnels } from '../../src/device-managers/ios/IOSTunnels';
```

2. Replace the `FakeProcess` constructor

```ts
  constructor(
    readonly command: string,
    readonly args: string[],
    readonly server?: net.Server,
  ) {
    super();
  }
```

with

```ts
  constructor(
    readonly command: string,
    readonly args: string[],
    readonly server?: net.Server,
    readonly opts?: { env?: NodeJS.ProcessEnv },
  ) {
    super();
  }
```

3. After `let android: any;` (in the `describe` block's `let` list), add:

```ts
  let tunnels: {
    ensure: sinon.SinonStub;
    envFor: sinon.SinonStub;
    stop: sinon.SinonStub;
    touch: sinon.SinonStub;
  };
```

4. Directly before `sinon.stub(process, 'kill');` in the first `beforeEach`, add:

```ts
    tunnels = {
      ensure: sinon.stub().resolves(null),
      envFor: sinon.stub().callsFake(() => ({ ...process.env, ENABLE_GO_IOS_AGENT: 'yes' })),
      stop: sinon.stub().resolves(),
      touch: sinon.stub().resolves(),
    };
```

5. Directly before `      if (token === ProcessRegistry) return { track: () => undefined } as any;`, add:

```ts
      if (token === IOSTunnels) return tunnels as any;
```

6. Replace the spawn fake's signature and constructor call:

```ts
    sinon.stub(childProcess, 'spawn').callsFake(((command: string, args: string[]) => {
```

becomes

```ts
    sinon.stub(childProcess, 'spawn').callsFake(((command: string, args: string[], opts?: any) => {
```

and

```ts
      const proc = new FakeProcess(command, args, server);
```

becomes

```ts
      const proc = new FakeProcess(command, args, server, opts);
```

7. Delete the line `    sinon.stub(ios, 'ensureTunnel').resolves(null);`.

8. In the test 'stopping a stale iOS session never deletes a lease another device holds', change `tunnelProcess: null,` to `tunnelPort: null,`.

9. Add this test directly after the test 'a start after a failed start holds leases on both of its ports':

```ts
  it("runs the iPhone's WDA through the iPhone's own go-ios tunnel", async () => {
    tunnels.ensure.resolves(12100);
    tunnels.envFor.callsFake((udid: string) => ({
      ...process.env,
      ENABLE_GO_IOS_AGENT: 'yes',
      ...(udid === IPHONE ? { GO_IOS_AGENT_PORT: '12100' } : {}),
    }));
    sinon.stub(ios, 'isGoIOSAvailable').resolves(true);

    await ios.startStream(IPHONE);

    expect(tunnels.ensure.calledWith(IPHONE)).to.equal(true);
    expect(ios.getStreamStatus(IPHONE)?.tunnelPort).to.equal(12100);
    const runwda = spawned.find((p) => p.command === ios.goIOSPath && p.args[0] === 'runwda');
    expect(runwda?.opts?.env?.GO_IOS_AGENT_PORT, "runwda finds this phone's tunnel").to.equal(
      '12100',
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha test/unit/ios-stream-appium-tunnel.spec.ts test/unit/ios-stream-port-leases.spec.ts`
Expected: FAIL. The tests that expect `tunnels.stop`, `tunnels.ensure`, `tunnels.touch` or `releasePurpose` to be called fail, because the service still uses `tunnelProcess` and `ensureTunnel`. The no-port-kill assertions fail, because `lsof -ti :60105` and `lsof -ti :60106` still run. The `runwda` test fails because there's no `GO_IOS_AGENT_PORT`.

- [ ] **Step 3: Write the implementation**

Every edit below is in `src/device-managers/ios/IOSStreamService.ts`.

1. **Imports.**
   - From the `./iosStreamDiagnostics` import, remove `classifyTunnelStderr,`.
   - Replace the `./tunnelProcess` import with:

```ts
import { reapAllOrphanTunnels, reapTunnelsForUdid } from './tunnelProcess';
import { IOSTunnels } from './IOSTunnels';
```

2. **`StreamSession`.** Replace `  tunnelProcess: ChildProcess | null;` with:

```ts
  /** The phone's go-ios tunnel-info port, when this stream's start ensured one (iOS 17+). */
  tunnelPort: number | null;
```

3. **The fixed ports.** Delete the `GO_IOS_AGENT_PORTS` constant and its doc comment, the block that begins `/**\n * The ports go-ios's tunnel process listens on` and ends `const GO_IOS_AGENT_PORTS = [60105, 60106];`.

4. **The hourly watchdog.** In its lease refresh, replace

```ts
            await portAllocator.touch(session.wdaPort, this.STREAM_PORT_TTL_MS);
            await portAllocator.touch(session.mjpegPort, this.STREAM_PORT_TTL_MS);
```

with

```ts
            await portAllocator.touch(session.wdaPort, this.STREAM_PORT_TTL_MS);
            await portAllocator.touch(session.mjpegPort, this.STREAM_PORT_TTL_MS);
            await this.tunnels().touch(udid);
```

5. **`ensureTunnel`.** Delete the whole method, from its doc comment `/**\n   * Check if tunnel is needed (iOS 17+) and ensure it's running\n   */` through its closing `}`.

6. **`cleanupOrphanTunnels`.** Replace the method and its doc comment with:

```ts
  /**
   * Clear this phone's go-ios leftovers before a start: the tunnel IOSTunnels
   * tracks for it, then any untracked go-ios process for it from an earlier
   * run. Never another phone's. Each phone's tunnel has its own ports, so
   * nothing is killed by port. Through 2.7 this also kill -9'd whatever
   * listened on go-ios's default ports, 60105 and 60106, which was another
   * iPhone's live tunnel.
   *
   * Never while an Appium session holds the phone. That session may be
   * driving a WDA go-ios launched (iOSCapabilities points a session at the
   * stream's WDA whenever a stream runs), and on iOS 17+ that WDA reaches the
   * phone through the phone's tunnel. Nothing here can tell that tunnel from
   * an orphan, so the sweep waits for the next stop or start after the
   * session ends; a restart reaps every go-ios process at boot.
   */
  private async cleanupOrphanTunnels(udid: string): Promise<void> {
    if (await this.appiumSessionMayUse(udid, 'go-ios tunnels')) return;
    log.debug(`Cleaning up orphan tunnels for ${udid}...`);

    await this.tunnels().stop(udid);

    // Reap the tunnel process *group* for this udid so the self-forking go-ios
    // agent children (whose argv carries no udid, so a udid-scoped pkill can't
    // see them) die with their parent instead of orphaning. Group-scoped, so a
    // second device's tunnel is left untouched. See ./tunnelProcess.
    await reapTunnelsForUdid(udid, execPromise);

    // Small delay to ensure OS releases sockets
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  private tunnels(): IOSTunnels {
    return Container.get(IOSTunnels);
  }
```

7. **Session literals.** In `startStream`, change `tunnelProcess: null,` to `tunnelPort: null,` in both `StreamSession` literals: the attach branch and the `status: 'starting'` one.

8. **The tunnel itself.** Replace

```ts
        // 2. Ensure tunnel for iOS 17+
        session.tunnelProcess = await this.ensureTunnel(udid);
```

with

```ts
        // 2. The phone's own go-ios tunnel, for iOS 17+ (see IOSTunnels)
        session.tunnelPort = await this.tunnels().ensure(udid);
```

9. **`runwda`.** Replace

```ts
        session.wdaProcess = spawn(wdaSpawn.command, wdaSpawn.args, {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });
```

with

```ts
        session.wdaProcess = spawn(wdaSpawn.command, wdaSpawn.args, {
          // GO_IOS_AGENT_PORT: runwda reaches this phone through its own
          // tunnel, not go-ios's default 60105.
          env: this.tunnels().envFor(udid),
        });
```

10. **`stopStream`.** Replace

```ts
    // Kill sidecar processes. The go-ios tunnel is detached (its own process
    // group), so reap the whole group — a plain p.kill() would leave the
    // self-forking agent children behind to respawn. See ./tunnelProcess.
    [session.wdaProcess, session.forwardWDAProcess, session.forwardMJPEGProcess].forEach((p) => {
      if (p)
        try {
          p.kill('SIGKILL');
        } catch (e) {
          // ignore
        }
    });
    killProcessGroup(session.tunnelProcess?.pid);
```

with

```ts
    // Kill sidecar processes.
    [session.wdaProcess, session.forwardWDAProcess, session.forwardMJPEGProcess].forEach((p) => {
      if (p)
        try {
          p.kill('SIGKILL');
        } catch (e) {
          // ignore
        }
    });
    // This stream's go-ios tunnel: its whole process group and its port pair.
    // A stream attached to an Appium session's WDA started none.
    if (session.tunnelPort != null) await this.tunnels().stop(udid);
```

11. **`reapOrphanTunnels`.** Replace the method body with:

```ts
  public async reapOrphanTunnels(): Promise<void> {
    try {
      const reaped = await reapAllOrphanTunnels(this.goIOSPath, execPromise);
      if (reaped > 0) {
        log.info(`[IOSStreamService] Reaped ${reaped} orphan go-ios tunnel process(es)`);
      }
    } catch (err: any) {
      log.warn(`[IOSStreamService] Orphan tunnel reap failed: ${err?.message ?? err}`);
    }
    // Every go-ios process is gone, so no tunnel holds its ports. A lease left
    // by an earlier run would otherwise keep its pair for up to 1.5 hours.
    try {
      await Container.get(PortAllocator).releasePurpose('tunnel');
    } catch (err: any) {
      log.warn(`[IOSStreamService] Releasing tunnel port leases failed: ${err?.message ?? err}`);
    }
  }
```

Then confirm nothing still names the old pieces:

Run: `grep -n "tunnelProcess\|ensureTunnel\|GO_IOS_AGENT_PORTS\|60105\|60106\|killProcessGroup\|tunnelSpawnOptions\|classifyTunnelStderr" src/device-managers/ios/IOSStreamService.ts`
Expected: no output.

Run: `grep -rn "tunnelProcess\|ensureTunnel" src test --include=*.ts`
Expected:
- `test/unit/stream-own-device-row.spec.ts:86: tunnelProcess: null,` is harmless: an untyped fixture whose `tunnelPort` is undefined, so no tunnel is stopped. Change it to `tunnelPort: null,` for clarity.
- Nothing else.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npx tsc --noEmit -p .
npx mocha test/unit/ios-stream-appium-tunnel.spec.ts test/unit/ios-stream-port-leases.spec.ts test/unit/stream-own-device-row.spec.ts test/unit/iosStreamDiagnostics.spec.ts test/unit/ios-stream-port.spec.ts test/unit/ios-tunnels.spec.ts
```

Expected: `tsc` prints nothing, and every spec passes.

- [ ] **Step 5: Commit**

```bash
git add src/device-managers/ios/IOSStreamService.ts test/unit/ios-stream-appium-tunnel.spec.ts test/unit/ios-stream-port-leases.spec.ts test/unit/stream-own-device-row.spec.ts
git commit -m "feat(ios): each iPhone's stream runs on its own go-ios tunnel"
```

---

### Task 5: Document a tunnel per iPhone

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none.

- [ ] **Step 1: Update the iOS streaming bullet**

In `CLAUDE.md`, under "### Device Streaming", replace

```
- **iOS**: `IOSStreamService` shells `go-ios` to start a tunnel (iOS 17+), launches WebDriverAgent via `runwda`,
```

with

```
- **iOS**: `IOSStreamService` starts the phone's own go-ios tunnel (iOS 17+, `IOSTunnels`, see below), launches WebDriverAgent via `runwda`,
```

The rest of that line is unchanged.

- [ ] **Step 2: Replace the tunnel paragraph**

Replace

```
**go-ios tunnels and Appium sessions.** go-ios's tunnel process listens on
60105 (its tunnel-info API) and 60106 (the first phone's userspace tunnel). On
iOS 17+ a WDA that go-ios launched (`runwda`) reaches the phone through it.
The xcuitest driver never uses go-ios, but an Appium session allocated while a
stream runs drives the stream's WDA (`iOSCapabilities` sets
`webDriverAgentUrl`), so that session depends on the stream's WDA, forwarder
and tunnel. Two rules follow:

- `cleanupOrphanTunnels` (the udid reap plus the kill -9 of whatever listens
  on 60105/60106) never runs while an Appium session holds the phone
```

with

```
**A go-ios tunnel per iPhone** (`src/device-managers/ios/IOSTunnels.ts`). On
iOS 17+ the go-ios commands Xenon runs against a phone (`runwda`, `ostrace`,
`syslog`, `screenshot`) reach it through a go-ios tunnel. Each phone gets
its own: `tunnel start --udid <phone> --userspace --tunnel-info-port <P>`, a
per-device agent on a pair of ports leased from the `tunnel` range
(12100–12199, `PortAllocator.acquirePair`). P is its tunnel-info API, and
go-ios derives P + 1 for the phone's traffic.

- **Finding it.** A command finds its phone's tunnel through
  `GO_IOS_AGENT_PORT` (`IOSTunnels.envFor`). A phone with no tunnel gets the
  plain environment.
- **Starting it.** A start waits up to 20 s for `GET :P/tunnel/<udid>` to
  answer 200, then goes on with a warning. A tunnel that exits before then
  fails the start.
- **Losing it.** A tunnel that exits later, on an unplug, gives its ports
  back, and the next start gets a new pair.
- **Who drives it.** The stream's start and stop. At boot, Xenon reaps go-ios
  and then drops every `tunnel` lease.
- **Why.** Through 2.7 every tunnel took go-ios's default ports, 60105 and
  60106. A second iPhone's stream kill -9'd whatever listened there, which was
  the first iPhone's live tunnel, so only one iOS 17+ iPhone per Mac could
  stream. Nothing is killed by port any more.

**go-ios tunnels and Appium sessions.** The xcuitest driver never uses
go-ios. But an Appium session allocated while a stream runs drives the
stream's WDA (`iOSCapabilities` sets `webDriverAgentUrl`), and on iOS 17+
that WDA reaches the phone through the phone's tunnel. So that session
depends on the stream's WDA, forwarder and tunnel. Three rules follow:

- `cleanupOrphanTunnels` (the phone's own tunnel through `IOSTunnels.stop`,
  then a reap of that phone's untracked go-ios processes) never runs while an
  Appium session holds the phone
```

Leave the bullet's remaining lines, from `(\`heldByAppiumSession\`: busy, non-manual` on, unchanged.

- [ ] **Step 3: Add the key file**

In the "## Key Files" table, add this row directly after the `src/device-managers/ios/IOSStreamService.ts` row:

```
| `src/device-managers/ios/IOSTunnels.ts` | One go-ios tunnel per iOS 17+ phone, on a port pair leased from the `tunnel` range; `envFor` gives a go-ios command its phone's `GO_IOS_AGENT_PORT` |
```

- [ ] **Step 4: Check nothing still describes the fixed ports**

Run: `grep -n "60105\|60106" CLAUDE.md`
Expected: only the two "Through 2.7" history lines added in Step 2.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: a go-ios tunnel per iPhone"
```

---

### Task 6: Full verification

**Files:** none changed, unless a check fails.

- [ ] **Step 1: Run the whole unit suite**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && ANDROID_HOME=$HOME/Library/Android/sdk npm run test:all 2>&1 | tail -15`
Expected: `N passing`, about 2,929 (2,894 on main plus about 35 new), `1 pending`, and `0 failing`.

- [ ] **Step 2: Run each new or changed spec on its own**

```bash
for f in test/unit/port-allocator-pairs.spec.ts test/unit/ios-tunnels.spec.ts test/unit/ios-go-ios-tunnel-env.spec.ts test/unit/ios-stream-appium-tunnel.spec.ts test/unit/ios-stream-port-leases.spec.ts test/unit/stream-own-device-row.spec.ts; do npx mocha "$f" 2>&1 | grep -E "passing|failing" | tr '\n' ' '; echo " $f"; done
```

Expected: each line shows `passing` and no `failing`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 4: Compare lint counts with main, without `--fix`**

```bash
for f in src/services/PortAllocator.ts src/device-managers/ios/IOSStreamService.ts src/device-managers/ios/IOSLogStreamService.ts src/device-managers/ios/WDAClient.ts test/unit/ios-stream-appium-tunnel.spec.ts test/unit/ios-stream-port-leases.spec.ts test/unit/stream-own-device-row.spec.ts; do
  before=$(git show main:$f | npx eslint --stdin --stdin-filename "$f" -f unix 2>/dev/null | grep -c ':[0-9]*:[0-9]*:')
  after=$(npx eslint "$f" -f unix 2>/dev/null | grep -c ':[0-9]*:[0-9]*:')
  echo "$f main=$before branch=$after"
done
npx eslint src/device-managers/ios/IOSTunnels.ts test/unit/ios-tunnels.spec.ts test/unit/port-allocator-pairs.spec.ts test/unit/ios-go-ios-tunnel-env.spec.ts
```

Expected:
- `branch` ≤ `main` for every modified file.
- The new files report no problems.
- Fix any new problem by hand, never with `--fix`.

- [ ] **Step 5: Run the three release gates**

```bash
DATABASE_URL='file:./ci-check.db' npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code; echo "migrate diff: $?"
node scripts/check-client-freshness.js; echo "client freshness: $?"
node mac-app/scripts/sync-tokens.mjs --check; echo "token sync: $?"
rm -f ci-check.db
```

Expected: all three print `0`. No schema or token changes are part of this work.

- [ ] **Step 6: Commit any fixes**

If Steps 1–5 needed fixes, stage only the files you changed and commit with `fix: <what>`. Otherwise there's nothing to commit.

---

### Task 7: Two-iPhone hardware check

This runs with the user, who connects and unplugs the second iPhone. It runs against a scratch server on :4726 built from a worktree. The lab (:4723) is never rebuilt or restarted.

**Files:** none in the repo. Notes go in the scratchpad (`$S/ios/notes.md`), and their results go in the PR body.

Set this in every shell:

```bash
S=/private/tmp/claude-501/-Users-rabindrabiswal-Workspace-XAenon-xenon/9a8ed34b-ba86-40d6-a815-6a0ce62ed9a7/scratchpad
GOIOS=$HOME/.cache/xenon/goIOS/ios
```

- [ ] **Step 1: Preconditions**
  - Make sure the lab streams no iPhone. The scratch server's boot reaps every go-ios process on the Mac.
    - Run `sqlite3 ~/.cache/xenon/xenon-dev.db "select udid,busy,session_id from Device where platform='ios';"`.
    - Every `session_id` should be empty, or not `manual_…`.
    - Run `pgrep -fl "ios tunnel start"`. It should print nothing.
  - Ask the user to connect the second iOS 17+ iPhone, unlocked, trusted, with Developer Mode on.
  - Confirm both phones are visible:
    - `$GOIOS list` shows both udids.
    - `$GOIOS info --udid <udid> | grep -o '"ProductVersion":"[^"]*"'` shows 17 or later for each.
  - Confirm WebDriverAgent is on both: `$GOIOS apps --udid <udid> | grep -o 'WebDriverAgentRunner[^"]*'` prints a bundle for each. If the second phone lacks it, stop and ask the user to install it. Signing is theirs.

- [ ] **Step 2: Build the branch in a worktree**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git worktree add --detach .claude/worktrees/tunnels feat/multi-iphone-tunnels
ln -s ../../../node_modules .claude/worktrees/tunnels/node_modules
ln -s ../../../../web/node_modules .claude/worktrees/tunnels/web/node_modules
cd .claude/worktrees/tunnels && source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npm run build:xenon && npm run build
```

Expected: the build ends without errors, and `.claude/worktrees/tunnels/lib/src/device-managers/ios/IOSTunnels.js` exists.

- [ ] **Step 3: Set up the scratch server kit for iOS**

```bash
mkdir -p $S/ios/fakehome/.cache/xenon
ln -sfn $HOME/.cache/xenon/goIOS $S/ios/fakehome/.cache/xenon/goIOS
sed -e 's/platform: android/platform: both/' -e 's/iosDeviceType: both/iosDeviceType: real/' -e 's/bootedSimulators: true/bootedSimulators: false/' $S/sessions/server-real.yaml > $S/ios/server-ios.yaml
ln -sfn /Users/rabindrabiswal/Workspace/XAenon/xenon/.claude/worktrees/tunnels $S/sessions/home/node_modules/@xenon-device-management/xenon
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/.claude/worktrees/tunnels && DATABASE_URL=file:$S/ios/ios.db npx prisma migrate deploy
```

Write `$S/ios/start-ios.sh`, then `chmod +x` it. It is the Sessions kit's `start-real.sh` with this kit's home, database, config and log:

```bash
#!/bin/bash
# Boots the two-iPhone check server on :4726 from the tunnels worktree build.
S=/private/tmp/claude-501/-Users-rabindrabiswal-Workspace-XAenon-xenon/9a8ed34b-ba86-40d6-a815-6a0ce62ed9a7/scratchpad
N=$HOME/.nvm/versions/node/v22.19.0/bin; SDK=$HOME/Library/Android/sdk
lsof -tiTCP:4726 -sTCP:LISTEN >/dev/null && { echo "port 4726 busy"; exit 1; }
LOG=$S/ios/server.log; [ -f $LOG ] && mv $LOG $LOG.$(date +%H%M%S)
cd ~ && env HOME=$S/ios/fakehome APPIUM_HOME=$S/sessions/home ANDROID_HOME=$SDK ANDROID_SDK_ROOT=$SDK \
  DATABASE_URL=file:$S/ios/ios.db "PATH=$N:$SDK/platform-tools:/opt/homebrew/bin:$PATH" \
  nohup $N/node /opt/homebrew/lib/node_modules/appium/index.js server --config $S/ios/server-ios.yaml > "$LOG" 2>&1 &
disown
for i in $(seq 1 60); do grep -aq 'listener started' $LOG && break; sleep 2; done
grep -aq 'listener started' $LOG && echo "up on :4726 (pid $(lsof -tiTCP:4726 -sTCP:LISTEN))" || { echo "DEAD"; tail -8 $LOG; exit 1; }
```

- `HOME` is a fake one, so the check's assets stay out of the lab's `~/.cache/xenon`. Its `goIOS` is the real bundled go-ios, linked in above.
- go-ios keeps its tunnel identity in its working directory, which is `~` here. If a phone shows a pairing or trust prompt on its first tunnel, ask the user to tap Trust. That start may time out first; the next one succeeds.

- [ ] **Step 4: Start it, then preview both iPhones**
  1. Start the server: `bash $S/ios/start-ios.sh`. Expected: `up on :4726`.
  2. Open `http://127.0.0.1:4726/xenon/` in the browser pane. Go to Live Devices and add both iPhones.
  3. Watch for 3 minutes. Both tiles' frames should keep advancing. Check with `read_page` or screenshots a minute apart.
  4. Run `pgrep -fl "ios tunnel start"`. There should be two, with different `--tunnel-info-port` values P1 and P2, both in 12100–12199 and both even.
  5. Run `$GOIOS tunnel ls --tunnel-info-port P1` and the same for P2. Each should list only its own phone.
  6. Run `sqlite3 $S/ios/ios.db "select port,leasedToUdid from PortLease where purpose='tunnel' order by port;"`. It should show four rows: P1, P1+1, P2 and P2+1.

- [ ] **Step 5: Record both**
  1. In Live Devices, record both phones as a group for 60 s while scrolling on each, then stop.
  2. Check the files with `/opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 <file>` on each phone's `video.mp4` and on `_groups/<id>/composite.mp4`. Their paths are under `$S/ios/fakehome/.cache/xenon/`; find them with `find $S/ios/fakehome/.cache/xenon -name '*.mp4' -mmin -5`.
  3. Each file should last about 60 s, within 2 s.

- [ ] **Step 6: Stop and restart one phone**
  1. Note the second phone's tunnel pid from `pgrep -fl "ios tunnel start"`.
  2. Remove the first phone's tile, wait 10 s, then add it again.
  3. The second phone's tile keeps streaming the whole time.
  4. Its tunnel pid is unchanged.
  5. The first phone comes back on a tunnel, possibly on a different pair.

- [ ] **Step 7: Unplug one phone**
  1. Remove the first phone's tile first, so no viewer restarts its stream: the check is that the tunnel itself is stopped. Record `pgrep -fl "ios tunnel start"` and `$GOIOS tunnel ls --tunnel-info-port P` for both phones.
  2. Ask the user to unplug the first phone.
  3. The second phone's tile keeps streaming, and its tunnel pid is unchanged.
  4. Within about 10 s, `checkTunnels` stops the first phone's agent (the log says it "lost its phone"), and its two `tunnel` leases are deleted (the Step 4 `sqlite3` query). go-ios alone would have kept the agent running.
  5. Ask the user to plug it back in, then add its tile again. It streams again on a new agent whose `tunnel ls` shows its traffic on P + 1.

- [ ] **Step 8: An Appium session on one phone while the other previews**
  1. From the browser pane on the :4726 dashboard, use `javascript_tool` to send `fetch('/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capabilities: { alwaysMatch: { platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': '<first udid>' } } }) })`.
     - Read the session id from the answer.
     - If the server's base path isn't `/`, read it from `GET /xenon/api/webdriver` first.
  2. Take a screenshot through `GET /session/<id>/screenshot`.
  3. The second phone's tile keeps streaming throughout.
  4. Send `DELETE /session/<id>`. The second phone is untouched: its tile streams and its tunnel pid is unchanged.

- [ ] **Step 9: Logs and screenshots on each phone**
  1. Open device control for each phone.
  2. The Debug Logs tab shows live `ostrace` lines.
  3. The screenshot button returns that phone's screen, not the other's.

- [ ] **Step 10: Regressions**
  1. Remove one iPhone's tile, so only one iPhone previews. Record it for 30 s. The video is valid.
  2. Run `grep -nE "6010[56]|kill -9" $S/ios/server.log`. It should print nothing.

  The S9+ preview on :4726 is a separate check: `server-ios.yaml` is `platform: both`, so the S9+ is listed. Add its tile next to one iPhone and check that both stream.

- [ ] **Step 11: Clean up**
  1. Stop the scratch server: `kill $(lsof -tiTCP:4726 -sTCP:LISTEN)`, then wait for the port to close. Then run `pkill -f "$S/ios/fakehome"`; it may find nothing.
  2. Remove the worktree: `git worktree remove --force .claude/worktrees/tunnels`. The kit's `xenon` link then dangles until the next check re-points it.
  3. Write each step's result, with numbers, to `$S/ios/notes.md` for the PR body.

---

## After the plan

Use superpowers:finishing-a-development-branch:
1. Push `feat/multi-iphone-tunnels`.
2. Open the PR with `gh pr create --body-file`. The body carries Task 6's numbers and Task 7's notes, with no attribution lines.
3. Release only after Task 7 passes.
