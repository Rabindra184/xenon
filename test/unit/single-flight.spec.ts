import { expect } from 'chai';
import { SingleFlight } from '../../src/helpers/singleFlight';

// Guards the bug in issue #194. AndroidStreamService registered its in-flight
// start promise AFTER invoking the task:
//
//   const promise = performStartup();      // async body runs sync to first await
//   this.startPromises.set(udid, promise); // ...but the task's `finally` already
//                                          //    deleted the (unset) key
//
// On the early-return path there was no await at all, so the cleanup ran before
// the registration and left an already-settled promise stuck in the map. Every
// later call then short-circuited to a stale port forever, which silently broke
// Android recording until the process restarted.

describe('SingleFlight', () => {
  it('releases a task that returns synchronously (no await) — the #194 regression', async () => {
    const sf = new SingleFlight<number>();
    let calls = 0;
    // No `await` anywhere: the async body settles during the call itself.
    const task = async () => {
      calls += 1;
      return 42;
    };

    expect(await sf.run('k', task)).to.equal(42);
    expect(sf.has('k'), 'key must not stay registered after settling').to.equal(false);

    // The poisoned map made this return the first (stale) result without
    // re-invoking the task.
    expect(await sf.run('k', task)).to.equal(42);
    expect(calls, 'second run must actually invoke the task again').to.equal(2);
  });

  it('dedupes concurrent callers onto one in-flight task', async () => {
    const sf = new SingleFlight<number>();
    let calls = 0;
    let release: (v: number) => void = () => undefined;
    const task = () => {
      calls += 1;
      return new Promise<number>((res) => {
        release = res;
      });
    };

    const a = sf.run('k', task);
    const b = sf.run('k', task);
    expect(calls, 'second concurrent caller must reuse the in-flight task').to.equal(1);
    expect(sf.has('k')).to.equal(true);

    release(7);
    expect(await a).to.equal(7);
    expect(await b).to.equal(7);
    expect(sf.has('k'), 'key released once settled').to.equal(false);
  });

  it('releases the key when the task rejects, and still surfaces the error', async () => {
    const sf = new SingleFlight<number>();
    let err: Error | undefined;
    try {
      await sf.run('k', async () => {
        throw new Error('boom');
      });
    } catch (e: any) {
      err = e;
    }
    expect(err?.message).to.equal('boom');
    expect(sf.has('k'), 'a failed task must not block future attempts').to.equal(false);

    expect(await sf.run('k', async () => 5)).to.equal(5);
  });

  it('keeps separate keys independent', async () => {
    const sf = new SingleFlight<string>();
    const a = sf.run('a', async () => 'A');
    const b = sf.run('b', async () => 'B');
    expect(await a).to.equal('A');
    expect(await b).to.equal('B');
    expect(sf.size).to.equal(0);
  });

  it('does not evict a newer in-flight task when an older one settles', async () => {
    const sf = new SingleFlight<number>();
    let releaseFirst: (v: number) => void = () => undefined;
    const first = sf.run('k', () => new Promise<number>((r) => (releaseFirst = r)));

    releaseFirst(1);
    await first;
    expect(sf.has('k')).to.equal(false);

    // A second task registers; the first's late cleanup must not remove it.
    const second = sf.run('k', () => new Promise<number>(() => undefined));
    await Promise.resolve();
    expect(sf.has('k'), 'newer in-flight task must survive').to.equal(true);
    void second;
  });
});
