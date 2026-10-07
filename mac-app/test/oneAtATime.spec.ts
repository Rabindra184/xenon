import { describe, expect, it } from 'vitest';
import { oneAtATime } from '../src/main/oneAtATime';

/** A job that waits until it is released (or failed), noting each time it runs. Runs end in the order they began. */
function heldJob() {
  const runs: string[] = [];
  const waiting: Array<{ resolve: (value: string) => void; reject: (err: Error) => void }> = [];
  const job = (name: string) =>
    new Promise<string>((resolve, reject) => {
      runs.push(name);
      waiting.push({ resolve, reject });
    });
  return {
    job,
    runs,
    release: (value: string) => waiting.shift()!.resolve(value),
    fail: (err: Error) => waiting.shift()!.reject(err)
  };
}

const busy = () => new Error('Set up is already running. Wait for it to finish.');

describe('oneAtATime', () => {
  it('refuses a call while one is under way, with the busy message, and does not run it', async () => {
    const { job, runs, release } = heldJob();
    const once = oneAtATime(job, busy);
    const first = once('a');
    await expect(once('b')).rejects.toThrow('Set up is already running. Wait for it to finish.');
    expect(runs).toEqual(['a']);
    release('done');
    await expect(first).resolves.toBe('done');
  });

  it('runs the next call once the one before has ended well', async () => {
    const { job, runs, release } = heldJob();
    const once = oneAtATime(job, busy);
    const first = once('a');
    release('one');
    await first;
    const second = once('b');
    release('two');
    await expect(second).resolves.toBe('two');
    expect(runs).toEqual(['a', 'b']);
  });

  it('runs the next call once the one before has failed, and passes the failure on', async () => {
    const { job, runs, fail, release } = heldJob();
    const once = oneAtATime(job, busy);
    const first = once('a');
    fail(new Error('npm failed'));
    await expect(first).rejects.toThrow('npm failed');
    const second = once('b');
    release('ok');
    await expect(second).resolves.toBe('ok');
    expect(runs).toEqual(['a', 'b']);
  });

  it('refuses a second call made in the same tick as the first', async () => {
    let started = 0;
    const once = oneAtATime(async () => {
      started++;
    }, busy);
    const results = await Promise.allSettled([once(), once()]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(started).toBe(1);
  });
});
