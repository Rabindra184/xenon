import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUIT_WAIT_CAP_MS, decideQuit, withCap } from '../src/main/quitFlow';
import { STOP_GRACE_MS, STOP_TERM_GRACE_MS } from '../src/main/stopEscalation';

describe('decideQuit', () => {
  it('quits at once when Xenon is not running', () => {
    expect(decideQuit({ serverActive: false, stopping: false, quitPending: false })).toBe('quit');
  });

  it('stops Xenon first, then quits, when it is running', () => {
    expect(decideQuit({ serverActive: true, stopping: false, quitPending: false })).toBe('stop-then-quit');
  });

  it('just waits when a Stop is already in progress', () => {
    expect(decideQuit({ serverActive: true, stopping: true, quitPending: false })).toBe('wait');
  });

  it('forces the stop on a second quit, whether or not a stop is in progress', () => {
    expect(decideQuit({ serverActive: true, stopping: false, quitPending: true })).toBe('force-then-quit');
    expect(decideQuit({ serverActive: true, stopping: true, quitPending: true })).toBe('force-then-quit');
  });
});

describe('withCap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps the quit wait just past the full SIGINT, SIGTERM, SIGKILL ladder', () => {
    expect(QUIT_WAIT_CAP_MS).toBe(STOP_GRACE_MS + STOP_TERM_GRACE_MS + 2000);
  });

  it('passes the value through when the promise settles first', async () => {
    const p = Promise.resolve('done');
    await expect(withCap(p, 1000)).resolves.toBe('done');
  });

  it('resolves "timeout" when the promise does not settle within the cap', async () => {
    const never = new Promise<string>(() => {});
    const result = withCap(never, 1000);
    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('timeout');
  });

  it('does not leave the cap timer armed once the promise settles', async () => {
    await withCap(Promise.resolve(1), 1000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
