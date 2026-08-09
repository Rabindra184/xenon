import { expect } from 'chai';
import { PackageResolver } from '../../src/services/logcat/PackageResolver';

// `adb shell ps -A -o PID,NAME` output shape.
const psOutput = (rows: Array<[number, string]>) =>
  ['  PID NAME', ...rows.map(([pid, name]) => `${String(pid).padStart(5)} ${name}`)].join('\n');

describe('PackageResolver', () => {
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

  it('refreshes once on a miss, then gives up rather than guessing', async () => {
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
});
