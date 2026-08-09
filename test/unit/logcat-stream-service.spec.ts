import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { PassThrough } from 'stream';
import { LogcatStreamService } from '../../src/device-managers/android/LogcatStreamService';
import { PackageResolver } from '../../src/services/logcat/PackageResolver';
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

const wait = () => new Promise((r) => setImmediate(r));

describe('LogcatStreamService', () => {
  it('parses stdout lines into records and pushes them to the mux', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () => new PackageResolver(async () => ''),
    );
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

  // A wrapped message must not be lost, and must not become its own record.
  it('appends a continuation line to the previous record', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () => new PackageResolver(async () => ''),
    );
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

    expect(seen).to.have.length(2);
    expect(seen[0].message).to.contain('wrapped remainder');
    expect(seen[1].message).to.equal('second');
    await svc.stop('DEV-1');
  });

  it('attaches the resolved package', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
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
  // resolution must never block or drop a log line." Two records through the
  // SAME always-throwing resolver, so a broken flushChain (no catch, or a
  // catch that doesn't recover the chain for the NEXT record) would surface
  // as a missing second line, not just a missing pkg.
  it('keeps records flowing with pkg absent when adb shell ps fails', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () =>
        new PackageResolver(async () => {
          throw new Error('adb shell ps failed');
        }),
    );
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient(
      (r) => seen.push(r),
      () => true,
    );

    proc.stdout.write('08-09 16:11:00.005  1408  1408 D Tag: hello\n');
    proc.stdout.write('08-09 16:11:00.006  1409  1409 D Tag: world\n');
    await wait();
    await wait();

    expect(seen.map((r) => r.message)).to.deep.equal(['hello', 'world']);
    expect(seen[0].pkg, 'pkg must be absent, not a stale/wrong guess').to.equal(undefined);
    expect(seen[1].pkg).to.equal(undefined);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as PackageResolver;
    const svc = new LogcatStreamService(
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
    const svc = new LogcatStreamService(
      async () => {
        spawns += 1;
        return proc as any;
      },
      () => new PackageResolver(async () => ''),
    );
    const [a, b] = await Promise.all([svc.start('DEV-1'), svc.start('DEV-1')]);
    expect(spawns).to.equal(1);
    expect(a).to.equal(b);
    await svc.stop('DEV-1');
  });

  it('emits a synthetic end-of-stream record when the process exits', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () => new PackageResolver(async () => ''),
    );
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
    expect(end!.message.toLowerCase()).to.contain('ended');
    // The session is dropped so the next viewer starts clean.
    expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
  });

  // 'error' is a distinct listener from 'close' in the implementation
  // (separate adb-restart / cable-pull failure mode) — pin it directly so it
  // cannot silently rot into dead code.
  it('emits a synthetic end-of-stream record when the process errors', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () => new PackageResolver(async () => ''),
    );
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
    expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
  });

  it('kills the process on stop and forgets the session', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () => new PackageResolver(async () => ''),
    );
    await svc.start('DEV-1');
    await svc.stop('DEV-1');
    expect(proc.killed()).to.equal(true);
    expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
  });

  // The real ChildProcess we killed in stop() still emits its own 'close'
  // once the signal lands. That must not surface as a second, stray
  // "log stream ended" after we already told everyone the stream stopped.
  it('does not emit a stray end-of-stream record when the process closes after an intentional stop()', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () => new PackageResolver(async () => ''),
    );
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

  describe('idle watchdog', () => {
    let clock: sinon.SinonFakeTimers;

    afterEach(() => {
      clock?.restore();
    });

    // Highest risk per the spec: "stop 30s after the last client leaves".
    // Two-stage check so a watchdog mistakenly wired to 15s (stops too early)
    // or 60s (stops too late) both fail this test, not just one direction.
    it('stops the stream 30s after the last client leaves, not sooner and not much later', async () => {
      clock = sinon.useFakeTimers();
      const proc = fakeProc();
      const svc = new LogcatStreamService(
        async () => proc as any,
        () => new PackageResolver(async () => ''),
      );
      const mux = await svc.start('DEV-1');
      const remove = mux.addClient(
        () => undefined,
        () => true,
      );
      remove(); // zero clients as of t=0

      // Watchdog polls every 10s; idle is first observed at the t=10s poll,
      // so 30s of idle only elapses once t passes 40s. At t=40s it must
      // still be alive — this is what catches an accidentally-15s window.
      clock.tick(40_000);
      expect(
        svc.getMultiplexer('DEV-1'),
        'must not stop before the 30s idle window has elapsed',
      ).to.not.equal(undefined);

      // By t=60s (well past the t=50s poll where 40s > 30s becomes true) it
      // must be stopped — this is what catches an accidentally-60s window.
      clock.tick(20_000);
      expect(
        svc.getMultiplexer('DEV-1'),
        'must stop once idle for longer than the 30s window',
      ).to.equal(undefined);
      expect(proc.killed()).to.equal(true);
    });

    it('does not stop while a client is still attached, even well past the idle window', async () => {
      clock = sinon.useFakeTimers();
      const proc = fakeProc();
      const svc = new LogcatStreamService(
        async () => proc as any,
        () => new PackageResolver(async () => ''),
      );
      const mux = await svc.start('DEV-1');
      mux.addClient(
        () => undefined,
        () => true,
      ); // never removed

      clock.tick(90_000); // several multiples of the 30s window
      expect(svc.getMultiplexer('DEV-1')).to.not.equal(undefined);
    });
  });
});
