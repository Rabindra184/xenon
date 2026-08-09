import { expect } from 'chai';
import sinon from 'sinon';
import { XenonLogger } from '../../src/logger';
import {
  DEFAULT_TTL_MS,
  PackageResolver,
  PS_COMMAND,
} from '../../src/services/logcat/PackageResolver';

// `adb shell ps -A -o PID,NAME` output shape.
const psOutput = (rows: Array<[number, string]>) =>
  ['  PID NAME', ...rows.map(([pid, name]) => `${String(pid).padStart(5)} ${name}`)].join('\n');

/** Yield to the microtask/macrotask queue so a pending refresh can start. */
const tick = () => new Promise((res) => setImmediate(res));

describe('PackageResolver', () => {
  // The resolver logs on every degradation path. Stub at the prototype so the
  // scoped logger built in the constructor is covered, and so a spec that
  // deliberately breaks `ps` does not spray warnings across the test output.
  let warnStub: sinon.SinonStub;
  let infoStub: sinon.SinonStub;

  beforeEach(() => {
    warnStub = sinon.stub(XenonLogger.prototype, 'warn');
    infoStub = sinon.stub(XenonLogger.prototype, 'info');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('resolves a pid to its process name', async () => {
    const r = new PackageResolver(async () => psOutput([[1408, 'com.android.systemui']]));
    expect(await r.resolve(1408)).to.equal('com.android.systemui');
  });

  it('caches, so repeated lookups do not re-run ps', async () => {
    let calls = 0;
    const r = new PackageResolver(async () => {
      calls += 1;
      return psOutput([[1408, 'com.android.systemui']]);
    });
    await r.resolve(1408);
    await r.resolve(1408);
    expect(calls).to.equal(1);
  });

  it('refreshes once on a cold miss, then gives up rather than guessing', async () => {
    let calls = 0;
    const r = new PackageResolver(async () => {
      calls += 1;
      return psOutput([[1408, 'com.android.systemui']]);
    });
    expect(await r.resolve(9999)).to.equal(undefined);
    expect(calls, 'one refresh attempt for the unknown pid').to.equal(1);
  });

  // The trap: pids are reused. Serving the previous process's name is worse
  // than serving nothing — it is silently plausible and sends someone
  // debugging the wrong app.
  it('does NOT serve a stale package after a pid is reused', async () => {
    let table: Array<[number, string]> = [[1408, 'com.old.app']];
    let clock = 0;
    const r = new PackageResolver(
      async () => psOutput(table),
      10_000,
      () => clock,
    );

    expect(await r.resolve(1408)).to.equal('com.old.app');

    table = [[1408, 'com.new.app']];
    clock += 10_001; // TTL expired

    expect(await r.resolve(1408)).to.equal('com.new.app');
  });

  it('drops an entry whose pid disappears on refresh', async () => {
    let table: Array<[number, string]> = [[1408, 'com.old.app']];
    let clock = 0;
    const r = new PackageResolver(
      async () => psOutput(table),
      10_000,
      () => clock,
    );

    expect(await r.resolve(1408)).to.equal('com.old.app');
    table = [[2000, 'com.other.app']];
    clock += 10_001;

    expect(await r.resolve(1408)).to.equal(undefined);
  });

  // Package resolution must never block or drop a log line.
  it('returns undefined when ps fails, without throwing', async () => {
    const r = new PackageResolver(async () => {
      throw new Error('device offline');
    });
    expect(await r.resolve(1408)).to.equal(undefined);
  });

  it('tolerates unparseable ps output', async () => {
    const r = new PackageResolver(async () => 'total nonsense\n');
    expect(await r.resolve(1408)).to.equal(undefined);
  });

  // --- TTL is a spec value, not an implementation detail -------------------

  it('uses the 10s TTL the spec calls for', () => {
    expect(DEFAULT_TTL_MS).to.equal(10_000);
  });

  // These two pin the TTL from BOTH sides via observable behaviour. Passing
  // `undefined` for ttlMs deliberately takes the default while still injecting
  // a clock — hard-coding 10_000 here would leave the constant free to drift.
  it('still serves the cached table 1ms before the TTL expires', async () => {
    let calls = 0;
    let clock = 0;
    const r = new PackageResolver(
      async () => {
        calls += 1;
        return psOutput([[1408, 'com.android.systemui']]);
      },
      undefined,
      () => clock,
    );

    expect(await r.resolve(1408)).to.equal('com.android.systemui');
    clock = 9_999;
    expect(await r.resolve(1408)).to.equal('com.android.systemui');
    expect(calls, 'no refresh inside the TTL window').to.equal(1);
  });

  it('refreshes 1ms after the TTL expires', async () => {
    let calls = 0;
    let clock = 0;
    const r = new PackageResolver(
      async () => {
        calls += 1;
        return psOutput([[1408, 'com.android.systemui']]);
      },
      undefined,
      () => clock,
    );

    await r.resolve(1408);
    clock = 10_001;
    await r.resolve(1408);
    expect(calls, 'the TTL window has closed').to.equal(2);
  });

  // --- Negative caching: one ps per window, not one per log line -----------

  it('runs ps once for a burst of lines from a pid ps does not list', async () => {
    let calls = 0;
    let clock = 0;
    const r = new PackageResolver(
      async () => {
        calls += 1;
        return psOutput([[1408, 'com.android.systemui']]);
      },
      10_000,
      () => clock,
    );

    for (let i = 0; i < 20; i += 1) {
      clock += 100; // 20 lines, all inside one TTL window
      expect(await r.resolve(9999)).to.equal(undefined);
    }

    expect(calls, 'the unknown pid is marked, not re-queried per line').to.equal(1);
  });

  it('runs ps once per window while ps is broken, not once per line', async () => {
    let calls = 0;
    let clock = 0;
    const r = new PackageResolver(
      async () => {
        calls += 1;
        throw new Error('device offline');
      },
      10_000,
      () => clock,
    );

    for (let i = 0; i < 20; i += 1) {
      clock += 100;
      expect(await r.resolve(1408)).to.equal(undefined);
    }

    expect(calls, 'a failing ps must not be re-spawned per log line').to.equal(1);
  });

  // A warm miss is a DIFFERENT path from the cold miss above: the table is
  // inside its TTL, so the early return never fires. This is the path that
  // picks up a process started since the last refresh.
  it('picks up a newly started process on a warm miss', async () => {
    let table: Array<[number, string]> = [[1408, 'com.android.systemui']];
    let calls = 0;
    let clock = 0;
    const r = new PackageResolver(
      async () => {
        calls += 1;
        return psOutput(table);
      },
      10_000,
      () => clock,
    );

    expect(await r.resolve(1408)).to.equal('com.android.systemui');

    table = [
      [1408, 'com.android.systemui'],
      [2000, 'com.new.app'],
    ];
    clock = 5_000; // still fresh — this is a warm miss, not a TTL expiry

    expect(await r.resolve(2000)).to.equal('com.new.app');
    expect(calls, 'exactly one extra ps for the warm miss').to.equal(2);
  });

  // --- A failing refresh must not extend freshness -------------------------

  it('keeps serving a label through a ps blip inside the TTL', async () => {
    let ok = true;
    let clock = 0;
    const r = new PackageResolver(
      async () => {
        if (!ok) throw new Error('device offline');
        return psOutput([[1408, 'com.old.app']]);
      },
      10_000,
      () => clock,
    );

    expect(await r.resolve(1408)).to.equal('com.old.app');
    ok = false;
    clock = 5_000;

    expect(await r.resolve(1408), 'a blip is not worth blanking every label').to.equal(
      'com.old.app',
    );
  });

  it('stops serving labels once the table outlives the TTL and ps keeps failing', async () => {
    let ok = true;
    let clock = 0;
    const r = new PackageResolver(
      async () => {
        if (!ok) throw new Error('device offline');
        return psOutput([[1408, 'com.old.app']]);
      },
      10_000,
      () => clock,
    );

    expect(await r.resolve(1408)).to.equal('com.old.app');
    ok = false;

    clock = 10_001;
    expect(await r.resolve(1408), 'a failed refresh must not renew freshness').to.equal(undefined);

    clock = 1_000_000;
    expect(await r.resolve(1408), 'never an unboundedly stale label').to.equal(undefined);
  });

  // --- A successful-but-empty refresh is still a refresh -------------------

  it('drops the table when a refresh parses to zero rows', async () => {
    let out = psOutput([[1408, 'com.old.app']]);
    let clock = 0;
    const r = new PackageResolver(
      async () => out,
      10_000,
      () => clock,
    );

    expect(await r.resolve(1408)).to.equal('com.old.app');

    // `ps` exits 0 but prints this to stdout — parses to zero rows without
    // throwing. Carrying the old table forward would serve exactly the stale
    // label the spec calls the worst outcome.
    out = 'error: device offline\n';
    clock = 10_001;

    expect(await r.resolve(1408)).to.equal(undefined);
  });

  // --- Concurrency ---------------------------------------------------------

  it('coalesces concurrent resolves into a single ps', async () => {
    let calls = 0;
    const r = new PackageResolver(async () => {
      calls += 1;
      await tick();
      return psOutput([[1408, 'com.android.systemui']]);
    });

    const results = await Promise.all(Array.from({ length: 50 }, () => r.resolve(1408)));

    expect(results.every((v) => v === 'com.android.systemui')).to.equal(true);
    expect(calls, 'one ps for fifty simultaneous log lines').to.equal(1);
  });

  it('frees the inflight slot when a slow refresh finally settles', async () => {
    let release: ((v: string) => void) | undefined;
    let calls = 0;
    let clock = 0;
    const r = new PackageResolver(
      async () => {
        calls += 1;
        if (calls === 1) return new Promise<string>((res) => (release = res));
        return psOutput([[1408, 'com.new.app']]);
      },
      10_000,
      () => clock,
    );

    const first = r.resolve(1408);
    await tick();
    expect(release, 'ps was entered').to.be.a('function');

    release!(psOutput([[1408, 'com.stuck.app']]));
    expect(await first).to.equal('com.stuck.app');

    // If the settled promise were left in `inflight`, this would join it and
    // silently re-serve the old snapshot instead of running ps again.
    clock = 10_001;
    expect(await r.resolve(1408)).to.equal('com.new.app');
    expect(calls).to.equal(2);
  });

  // --- Observability -------------------------------------------------------

  it('warns once per transition into the failing state, not once per call', async () => {
    let ok = false;
    let clock = 0;
    const r = new PackageResolver(
      async () => {
        if (!ok) throw new Error('device offline');
        return psOutput([[1408, 'com.android.systemui']]);
      },
      10_000,
      () => clock,
    );

    for (let i = 0; i < 5; i += 1) {
      clock += 20_000; // past the TTL each time, so ps really is retried
      expect(await r.resolve(1408)).to.equal(undefined);
    }
    expect(warnStub.callCount, 'one warning for the whole failing streak').to.equal(1);

    ok = true;
    clock += 20_000;
    expect(await r.resolve(1408)).to.equal('com.android.systemui');
    expect(infoStub.callCount, 'recovery is announced once').to.equal(1);

    ok = false;
    clock += 20_000;
    expect(await r.resolve(1408)).to.equal(undefined);
    expect(warnStub.callCount, 'a fresh failure warns again').to.equal(2);
  });

  it('names the expected ps shape when the columns are wrong', async () => {
    // Plain `ps -A` — nine columns. Every row silently fails the two-column
    // contract, so without this log the only symptom is "pkg never appears".
    const r = new PackageResolver(
      async () => 'USER PID PPID VSZ RSS WCHAN ADDR S NAME\nroot 1 0 10 4 0 0 S init\n',
    );

    expect(await r.resolve(1)).to.equal(undefined);
    expect(warnStub.callCount).to.equal(1);
    expect(String(warnStub.firstCall.args[0])).to.contain(PS_COMMAND);
  });
});
