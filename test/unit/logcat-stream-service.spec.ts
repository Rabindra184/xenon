import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';
import {
  LogcatStreamService,
  PS_TIMEOUT_MS,
  type ChildProcessLike,
} from '../../src/device-managers/android/LogcatStreamService';
import { REPLAY_BUFFER_SIZE } from '../../src/device-managers/android/LogcatMultiplexer';
import { PackageResolver, PS_COMMAND } from '../../src/services/logcat/PackageResolver';
import type { LogcatRecord } from '../../src/services/logcat/logcatParse';

function fakeProc() {
  const stdout = new PassThrough();
  const handlers: Record<string, ((a?: unknown) => void)[]> = {};
  let killed = false;
  return {
    stdout,
    killed: () => killed,
    on(ev: string, cb: (a?: unknown) => void) {
      (handlers[ev] ||= []).push(cb);
    },
    emit(ev: string, a?: unknown) {
      (handlers[ev] || []).forEach((h) => h(a));
    },
    kill() {
      killed = true;
    },
  };
}

/**
 * The service is container-constructed and therefore takes no constructor
 * arguments; its I/O boundaries are `protected` seams. Tests override them by
 * subclassing, the same way AndroidH264StreamService's `openCapture` is
 * overridden.
 */
class TestLogcatStreamService extends LogcatStreamService {
  constructor(
    private readonly spawnFn: (udid: string) => Promise<ChildProcessLike>,
    private readonly resolverFn: (udid: string) => PackageResolver,
  ) {
    super();
  }
  protected spawnLogcat(udid: string): Promise<ChildProcessLike> {
    return this.spawnFn(udid);
  }
  protected makeResolver(udid: string): PackageResolver {
    return this.resolverFn(udid);
  }
}

const makeService = (
  spawnFn: (udid: string) => Promise<ChildProcessLike>,
  resolverFn: (udid: string) => PackageResolver = () => new PackageResolver(async () => ''),
) => new TestLogcatStreamService(spawnFn, resolverFn);

const wait = () => new Promise((r) => setImmediate(r));

const LINE = (msg: string, pid = 1408, ms = '005') =>
  `08-09 16:11:00.${ms}  ${pid}  ${pid} D Tag: ${msg}\n`;

describe('LogcatStreamService', () => {
  it('parses stdout lines into records and pushes them to the mux', async () => {
    const proc = fakeProc();
    const svc = makeService(async () => proc as any);
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient(
      (r) => seen.push(r),
      () => true,
    );

    proc.stdout.write('08-09 16:11:00.005  1408  1408 D Tag: hello\n');
    await wait();

    expect(seen.map((r) => r.message)).to.deep.equal(['hello']);
    await svc.stop('DEV-1');
  });

  // The service is reached through the container everywhere else in this
  // codebase (AndroidH264StreamService is Container.get'ed from control.ts and
  // ServerManager.ts, and the design spec's file table says `@Service()`), so
  // `new` working is not enough. With emitDecoratorMetadata on, a constructor
  // parameter whose type is not an injectable class makes TypeDI throw
  // ServiceNotFoundError here.
  it('resolves through the TypeDI container', () => {
    const svc = Container.get(LogcatStreamService);
    expect(svc).to.be.instanceOf(LogcatStreamService);
    // A resolved-but-broken instance would still be an instance; prove it works.
    expect(svc.getMultiplexer('never-started')).to.equal(undefined);
  });

  // A wrapped message must not be lost, and must not become its own record.
  // Asserted exactly: `contain('wrapped remainder')` cannot tell `+=` from `=`,
  // so an overwrite that silently discards the first half of every wrapped
  // message would ship green.
  it('appends a continuation line to the previous record', async () => {
    const proc = fakeProc();
    const svc = makeService(async () => proc as any);
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient(
      (r) => seen.push(r),
      () => true,
    );

    proc.stdout.write('08-09 16:11:00.005  1408  1408 D Tag: first\n');
    proc.stdout.write('   wrapped remainder\n');
    proc.stdout.write('08-09 16:11:00.006  1408  1408 D Tag: second\n');
    await wait();

    expect(seen.map((r) => r.message)).to.deep.equal(['first\nwrapped remainder', 'second']);
    await svc.stop('DEV-1');
  });

  // Banners and blank lines parse to null exactly like a continuation line
  // does, so the only thing keeping them out of a pending message is the pair
  // of exclusions in onLine(). A banner swallowed into a message is precisely
  // the corruption the parser contract exists to prevent.
  it('drops banner and blank lines instead of appending them to the pending record', async () => {
    const proc = fakeProc();
    const svc = makeService(async () => proc as any);
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient(
      (r) => seen.push(r),
      () => true,
    );

    proc.stdout.write('08-09 16:11:00.005  1408  1408 D Tag: first\n');
    proc.stdout.write('   wrapped remainder\n');
    proc.stdout.write('--------- beginning of main\n');
    proc.stdout.write('\n');
    proc.stdout.write('08-09 16:11:00.006  1408  1408 D Tag: second\n');
    await wait();

    expect(seen.map((r) => r.message)).to.deep.equal(['first\nwrapped remainder', 'second']);
    await svc.stop('DEV-1');
  });

  it('attaches the resolved package', async () => {
    const proc = fakeProc();
    const svc = makeService(
      async () => proc as any,
      () => new PackageResolver(async () => '  PID NAME\n 1408 com.android.systemui'),
    );
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient(
      (r) => seen.push(r),
      () => true,
    );

    proc.stdout.write('08-09 16:11:00.005  1408  1408 D Tag: hello\n');
    await wait();
    await wait();

    expect(seen[0].pkg).to.equal('com.android.systemui');
    await svc.stop('DEV-1');
  });

  // Spec: "adb shell ps fails -> Records still flow with pkg absent. Package
  // resolution must never block or drop a log line."
  //
  // The guard in flushPending() is what makes that true, and only a resolver
  // that genuinely REJECTS reaches it. PackageResolver.resolve() never
  // rejects — refresh() swallows its runner's errors internally — so handing
  // this test a PackageResolver over a throwing runner tests the resolver, not
  // the boundary. Without the guard, flushChain becomes a rejected promise and
  // every later `.then(onFulfilled)` is skipped: the device's stream dies
  // permanently and silently. Three records, so a chain broken by the first is
  // visible as records 2 and 3 never arriving.
  it('keeps records flowing when package resolution rejects', async () => {
    const proc = fakeProc();
    const rejectingResolver = {
      resolve: () => Promise.reject(new Error('adb shell ps failed')),
    } as unknown as PackageResolver;
    const svc = makeService(
      async () => proc as any,
      () => rejectingResolver,
    );
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient(
      (r) => seen.push(r),
      () => true,
    );

    proc.stdout.write(LINE('hello', 1408, '005'));
    proc.stdout.write(LINE('world', 1409, '006'));
    proc.stdout.write(LINE('again', 1410, '007'));
    await wait();
    await wait();

    expect(seen.map((r) => r.message)).to.deep.equal(['hello', 'world', 'again']);
    expect(seen[0].pkg, 'pkg must be absent, not a stale/wrong guess').to.equal(undefined);
    expect(seen[2].pkg).to.equal(undefined);
    await svc.stop('DEV-1');
  });

  // Package resolution latency varies per pid (cache hit vs a cold refresh).
  // If each record's push were chained off its OWN resolve() independently,
  // a faster-resolving later record could overtake a slower-resolving earlier
  // one. Chaining every push behind the previous one (flushChain) must
  // prevent that regardless of which resolve() settles first.
  it('preserves line order even when package resolution settles out of order', async () => {
    const proc = fakeProc();
    const delays = [30, 0]; // first record's resolve() takes longer than the second's
    let calls = 0;
    const fakeResolver = {
      resolve: (_pid: number) =>
        new Promise<string | undefined>((r) =>
          setTimeout(() => r(undefined), delays[calls++] ?? 0),
        ),
    } as unknown as PackageResolver;
    const svc = makeService(
      async () => proc as any,
      () => fakeResolver,
    );
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient(
      (r) => seen.push(r),
      () => true,
    );

    proc.stdout.write('08-09 16:11:00.005  1408  1408 D Tag: first\n');
    proc.stdout.write('08-09 16:11:00.006  1409  1409 D Tag: second\n');
    await new Promise((r) => setTimeout(r, 80));

    expect(seen.map((r) => r.message)).to.deep.equal(['first', 'second']);
    await svc.stop('DEV-1');
  });

  it('reuses one process for concurrent starts on the same udid', async () => {
    let spawns = 0;
    const proc = fakeProc();
    const svc = makeService(async () => {
      spawns += 1;
      return proc as any;
    });
    const [a, b] = await Promise.all([svc.start('DEV-1'), svc.start('DEV-1')]);
    expect(spawns).to.equal(1);
    expect(a).to.equal(b);
    await svc.stop('DEV-1');
  });

  // The concurrent case above is served by the in-flight join; this one is
  // served by the live-session short-circuit, and nothing exercised it. A
  // second viewer arriving after the first start has completed would otherwise
  // spawn a second `adb logcat` and orphan the first.
  it('reuses one process for a sequential start on the same udid', async () => {
    let spawns = 0;
    const proc = fakeProc();
    const svc = makeService(async () => {
      spawns += 1;
      return proc as any;
    });
    const a = await svc.start('DEV-1');
    const b = await svc.start('DEV-1');
    expect(spawns).to.equal(1);
    expect(a).to.equal(b);
    await svc.stop('DEV-1');
  });

  // A settled promise left behind in the de-dup map hands every later caller a
  // stale mux for the life of the process — issue #194, and the reason
  // SingleFlight exists. After a start/stop cycle the next start must produce a
  // genuinely new stream.
  it('starts a fresh stream after a stop rather than replaying a settled start', async () => {
    let spawns = 0;
    const procs = [fakeProc(), fakeProc()];
    const svc = makeService(async () => procs[spawns++] as any);
    const first = await svc.start('DEV-1');
    await svc.stop('DEV-1');
    const second = await svc.start('DEV-1');

    expect(spawns).to.equal(2);
    expect(second, 'a stale start promise would hand back the dead mux').to.not.equal(first);
    await svc.stop('DEV-1');
  });

  it('emits a synthetic end-of-stream record when the process exits', async () => {
    const proc = fakeProc();
    const svc = makeService(async () => proc as any);
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient(
      (r) => seen.push(r),
      () => true,
    );

    proc.emit('close');
    await wait();

    const end = seen.find((r) => r.synthetic);
    expect(end, 'an end-of-stream record must be emitted').to.not.equal(undefined);
    expect(end!.level).to.equal('E');
    expect(end!.tag).to.equal('xenon');
    // Spec: `E/xenon  log stream ended (<reason>)`. The reason distinguishes
    // this exit path from the 'error' one below — interchangeable reasons make
    // the two handlers indistinguishable in a log.
    expect(end!.message).to.equal('log stream ended (process exited)');
    // The session is dropped so the next viewer starts clean.
    expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
  });

  // 'error' is a distinct listener from 'close' in the implementation
  // (separate adb-restart / cable-pull failure mode) — pin it directly so it
  // cannot silently rot into dead code.
  it('emits a synthetic end-of-stream record when the process errors', async () => {
    const proc = fakeProc();
    const svc = makeService(async () => proc as any);
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient(
      (r) => seen.push(r),
      () => true,
    );

    proc.emit('error', new Error('adb restart'));
    await wait();

    const end = seen.find((r) => r.synthetic);
    expect(end, 'an end-of-stream record must be emitted').to.not.equal(undefined);
    expect(end!.level).to.equal('E');
    expect(end!.tag).to.equal('xenon');
    expect(end!.message).to.equal('log stream ended (process error)');
    expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
  });

  // Spec error table: "Emit synthetic ..., close clients, drop the multiplexer
  // so the next viewer starts clean." Dropping the mux without closing leaves
  // the sockets attached to an orphan showing a frozen log, and those tabs
  // never recover. The close must follow the record so a client sees why.
  it('closes its clients after the end-of-stream record', async () => {
    const proc = fakeProc();
    const svc = makeService(async () => proc as any);
    const mux = await svc.start('DEV-1');
    const events: string[] = [];
    mux.addClient(
      (r) => events.push(`record:${r.message}`),
      () => true,
      () => events.push('closed'),
    );

    proc.emit('close');
    await wait();

    expect(events).to.deep.equal(['record:log stream ended (process exited)', 'closed']);
    expect(mux.clientCount).to.equal(0);
  });

  // An explicit stop() must release its viewers too, not just the process-exit
  // path — the killed child's own 'close' hits the stray-suppression guard, so
  // nothing else ever tells them. No synthetic record here: an
  // operator-initiated stop is not an error.
  //
  // The ordering assertion is the point. A bare `s.mux.close()` in stop()
  // (rather than one chained onto flushChain) runs before the chain drains and
  // SWALLOWS the last line — measured `[]` instead of `['record:...', 'closed']`
  // — and every other test in this file stays green. Assert the record and the
  // close together, in order, or the regression is invisible.
  it('flushes the last pending line before closing its clients on stop()', async () => {
    const proc = fakeProc();
    const svc = makeService(async () => proc as any);
    const mux = await svc.start('DEV-1');
    const events: string[] = [];
    mux.addClient(
      (r) => events.push(`record:${r.message}`),
      () => true,
      () => events.push('closed'),
    );

    // Same tick: the nextTick flush has not run when stop() is called.
    proc.stdout.write('08-09 16:11:00.005  1408  1408 D Tag: last words\n');
    await svc.stop('DEV-1');
    await wait();

    expect(events).to.deep.equal(['record:last words', 'closed']);
    expect(mux.clientCount).to.equal(0);
  });

  it('kills the process on stop and forgets the session', async () => {
    const proc = fakeProc();
    const svc = makeService(async () => proc as any);
    await svc.start('DEV-1');
    await svc.stop('DEV-1');
    expect(proc.killed()).to.equal(true);
    expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
  });

  // Called from the SIGTERM handler in src/index.ts. Verified on a Galaxy S9
  // that without it a server kill left a host `adb … logcat` running and two
  // device-side readers alive — ProcessRegistry.terminateAll() misses them
  // because this service spawns its child directly rather than registering it.
  // Every restart leaked another pair, which adds up fast on the desktop
  // launcher where restarts are routine.
  it('cleanup() stops every device, not just one', async () => {
    const procs = [fakeProc(), fakeProc(), fakeProc()];
    let i = 0;
    const svc = makeService(async () => procs[i++] as any);
    await svc.start('DEV-1');
    await svc.start('DEV-2');
    await svc.start('DEV-3');

    await svc.cleanup();

    // All three, not merely the first — a cleanup that breaks out of its loop
    // or awaits sequentially and throws would still pass a single-device test.
    expect(procs.map((p) => p.killed())).to.deep.equal([true, true, true]);
    for (const udid of ['DEV-1', 'DEV-2', 'DEV-3']) {
      expect(svc.getMultiplexer(udid), udid).to.equal(undefined);
    }
  });

  // The safety net for the above. On SIGTERM, Appium's own handler exits the
  // process before this plugin's async cleanup runs — measured against a real
  // device — so the only hook left is 'exit', which forbids async work.
  // kill() is a syscall and is safe there; nothing else in stop() is.
  it('killAllSync() kills every child synchronously, without awaiting', async () => {
    const procs = [fakeProc(), fakeProc()];
    let i = 0;
    const svc = makeService(async () => procs[i++] as any);
    await svc.start('DEV-1');
    await svc.start('DEV-2');

    svc.killAllSync(); // deliberately not awaited — an 'exit' handler cannot

    // Asserted on the same tick: anything deferred to a microtask would be
    // dropped when the process exits, so a promise-based teardown would pass
    // a test that awaited here while still leaking in production.
    expect(procs.map((p) => p.killed())).to.deep.equal([true, true]);
    expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
    expect(svc.getMultiplexer('DEV-2')).to.equal(undefined);
  });

  it('killAllSync() survives a child that throws on kill', () => {
    const bad = {
      ...fakeProc(),
      kill: () => {
        throw new Error('ESRCH');
      },
    };
    const svc = makeService(async () => bad as any);
    return svc.start('DEV-1').then(() => {
      expect(() => svc.killAllSync()).to.not.throw();
      expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
    });
  });

  it('cleanup() is a no-op when nothing is streaming', async () => {
    const svc = makeService(async () => fakeProc() as any);
    await svc.cleanup();
    expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
  });

  // The real ChildProcess we killed in stop() still emits its own 'close'
  // once the signal lands. That must not surface as a second, stray
  // "log stream ended" after we already told everyone the stream stopped.
  it('does not emit a stray end-of-stream record when the process closes after an intentional stop()', async () => {
    const proc = fakeProc();
    const svc = makeService(async () => proc as any);
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient(
      (r) => seen.push(r),
      () => true,
    );

    await svc.stop('DEV-1');
    proc.emit('close');
    await wait();

    expect(
      seen.find((r) => r.synthetic),
      'stop() must not leave a stray end-of-stream record behind',
    ).to.equal(undefined);
  });

  // The last line before a cable pull is the one a reader most wants, and it
  // must not land AFTER the marker that says the stream is over.
  //
  // Reaching end()'s own flushPending needs the chunk and the exit in the same
  // tick: onLine() schedules a nextTick flush, and a real ChildProcess 'close'
  // lands in a later tick, by which time nothing is pending. Emitting 'data'
  // directly is exactly what a stream does with an arriving chunk (readline
  // parses it synchronously in that handler) — it just puts the exit inside
  // the same tick instead of a later one.
  it('flushes a still-pending record before the end-of-stream record', async () => {
    const proc = fakeProc();
    const svc = makeService(async () => proc as any);
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient(
      (r) => seen.push(r),
      () => true,
    );

    proc.stdout.emit('data', Buffer.from(LINE('last words')));
    proc.emit('close'); // same tick — the nextTick flush has not run yet
    await wait();

    expect(seen.map((r) => r.message)).to.deep.equal([
      'last words',
      'log stream ended (process exited)',
    ]);
  });

  describe('default adb invocation', () => {
    /** Exercises the real spawnLogcat / makeResolver, stubbing only the OS boundary. */
    class ArgvProbe extends LogcatStreamService {
      spawned: { command: string; args: string[] }[] = [];
      execs: { command: string; args: string[]; opts: { timeout: number } }[] = [];
      constructor(
        private readonly proc: ReturnType<typeof fakeProc>,
        private readonly adb: unknown,
      ) {
        super();
      }
      protected async getAdb(): Promise<any> {
        return this.adb;
      }
      protected spawnProcess(command: string, args: string[]): ChildProcess {
        this.spawned.push({ command, args });
        return this.proc as unknown as ChildProcess;
      }
      protected async execFileCapture(
        command: string,
        args: string[],
        opts: { timeout: number },
      ): Promise<string> {
        this.execs.push({ command, args, opts });
        return '  PID NAME\n 1408 com.example.app';
      }
    }

    // A server launched from the Mac app has no shell PATH, so a bare
    // spawn('adb') ENOENTs. And `-d` is the one-shot dump-and-exit poll this
    // whole feature replaces.
    //
    // `-T` is the one that only hardware caught: without it logcat replays the
    // device's whole ring buffer before reaching live output. Measured on a
    // Galaxy S9 — records 94 minutes stale, arriving at ~84/sec, overrunning
    // both the server replay and the client buffer with history while the pane
    // claimed LIVE. Bounding it to REPLAY_BUFFER_SIZE also makes the first
    // viewer's window match what a later viewer gets from the multiplexer.
    it('spawns the resolved adb binary tailing a bounded `logcat -v threadtime`', async () => {
      const svc = new ArgvProbe(fakeProc(), {
        executable: { path: '/opt/sdk/platform-tools/adb' },
      });
      await svc.start('DEV-1');

      expect(svc.spawned).to.have.length(1);
      expect(svc.spawned[0].command, 'never a bare `adb`').to.equal('/opt/sdk/platform-tools/adb');
      expect(svc.spawned[0].args).to.deep.equal([
        '-s',
        'DEV-1',
        'logcat',
        '-v',
        'threadtime',
        '-T',
        '2000',
      ]);
      await svc.stop('DEV-1');
    });

    // The tail bound and the replay bound are the same number on purpose: a
    // first viewer and a late joiner must see the same window. Drifting them
    // apart is silent, so pin the relationship, not just the literal.
    it('bounds the logcat tail to exactly the multiplexer replay size', async () => {
      const svc = new ArgvProbe(fakeProc(), {
        executable: { path: '/opt/sdk/platform-tools/adb' },
      });
      await svc.start('DEV-1');

      const args = svc.spawned[0].args;
      expect(args[args.indexOf('-T') + 1]).to.equal(String(REPLAY_BUFFER_SIZE));
      await svc.stop('DEV-1');
    });

    it('carries the adb host/port through to the child', async () => {
      const svc = new ArgvProbe(fakeProc(), {
        executable: { path: '/opt/sdk/platform-tools/adb' },
        adbHost: '10.0.0.5',
        adbPort: 5037,
      });
      await svc.start('DEV-1');

      expect(svc.spawned[0].args).to.deep.equal([
        '-H',
        '10.0.0.5',
        '-P',
        '5037',
        '-s',
        'DEV-1',
        'logcat',
        '-v',
        'threadtime',
        '-T',
        '2000',
      ]);
      await svc.stop('DEV-1');
    });

    // PackageResolver's parser is written against exactly PS_COMMAND's
    // two-column shape; plain `ps -A` returns nine columns, parses to zero rows
    // and makes every package label vanish with no other symptom. The timeout
    // lives here because PackageResolver deliberately has none of its own.
    it('resolves packages with exactly PS_COMMAND, under a timeout', async () => {
      const proc = fakeProc();
      const svc = new ArgvProbe(proc, { executable: { path: '/opt/sdk/platform-tools/adb' } });
      const mux = await svc.start('DEV-1');
      const seen: LogcatRecord[] = [];
      mux.addClient(
        (r) => seen.push(r),
        () => true,
      );

      proc.stdout.write(LINE('hello'));
      await wait();
      await wait();

      expect(svc.execs).to.have.length(1);
      expect(svc.execs[0].command).to.equal('/opt/sdk/platform-tools/adb');
      expect(svc.execs[0].args).to.deep.equal(['-s', 'DEV-1', 'shell', ...PS_COMMAND.split(' ')]);
      expect(svc.execs[0].opts.timeout).to.equal(PS_TIMEOUT_MS);
      expect(seen[0].pkg).to.equal('com.example.app');
      await svc.stop('DEV-1');
    });

    // Stricter than AndroidH264StreamService's `|| 'adb'` fallback on purpose.
    it('fails the start rather than falling back to a bare `adb`', async () => {
      const svc = new ArgvProbe(fakeProc(), { executable: {} });
      let err: Error | undefined;
      await svc.start('DEV-1').catch((e) => (err = e));

      expect(err?.message).to.contain('adb executable path not resolved');
      expect(svc.spawned).to.have.length(0);
      expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
    });
  });

  describe('idle watchdog', () => {
    let clock: sinon.SinonFakeTimers;

    afterEach(() => {
      clock?.restore();
    });

    // Highest risk per the spec: "stop 30s after the last client leaves".
    // Two-stage check so a watchdog mistakenly wired to 15s (stops too early)
    // or 60s (stops too late) both fail this test, not just one direction.
    // The window is measured from the departure itself (the mux stamps it), so
    // the poll interval only adds detection latency — the 33s bound is what
    // holds that latency down to ~10% of the budget.
    it('stops the stream 30s after the last client leaves, not sooner and not much later', async () => {
      clock = sinon.useFakeTimers();
      const proc = fakeProc();
      const svc = makeService(async () => proc as any);
      const mux = await svc.start('DEV-1');
      const remove = mux.addClient(
        () => undefined,
        () => true,
      );
      remove(); // zero clients as of t=0

      clock.tick(29_000);
      expect(
        svc.getMultiplexer('DEV-1'),
        'must not stop before the 30s idle window has elapsed',
      ).to.not.equal(undefined);

      clock.tick(4_000); // t=33s
      expect(
        svc.getMultiplexer('DEV-1'),
        'must stop within ~10% of the 30s window, not a poll interval later',
      ).to.equal(undefined);
      expect(proc.killed()).to.equal(true);
    });

    it('does not stop while a client is still attached, even well past the idle window', async () => {
      clock = sinon.useFakeTimers();
      const proc = fakeProc();
      const svc = makeService(async () => proc as any);
      const mux = await svc.start('DEV-1');
      mux.addClient(
        () => undefined,
        () => true,
      ); // never removed

      clock.tick(90_000); // several multiples of the 30s window
      expect(svc.getMultiplexer('DEV-1')).to.not.equal(undefined);
    });

    // The spec's "long enough to survive a tab reload" clause. Without the
    // reset, a device that empties, regains a viewer, then empties again is
    // stopped 30s after its FIRST departure ever — mid-session, with someone
    // watching.
    it('restarts the countdown when a viewer returns', async () => {
      clock = sinon.useFakeTimers();
      const proc = fakeProc();
      const svc = makeService(async () => proc as any);
      const mux = await svc.start('DEV-1');

      const first = mux.addClient(
        () => undefined,
        () => true,
      );
      first(); // empty at t=0
      clock.tick(20_000); // t=20s, still inside the window

      const second = mux.addClient(
        () => undefined,
        () => true,
      ); // the tab came back
      clock.tick(20_000); // t=40s — past 30s from the FIRST departure
      expect(
        svc.getMultiplexer('DEV-1'),
        "a returning viewer must clear the earlier departure's clock",
      ).to.not.equal(undefined);

      second(); // empty again at t=40s
      clock.tick(29_000); // t=69s — 29s since the second departure
      expect(svc.getMultiplexer('DEV-1')).to.not.equal(undefined);
      clock.tick(4_000); // t=73s
      expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
    });
  });
});
