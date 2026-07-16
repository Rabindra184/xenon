import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncer } from '../src/renderer/src/debounce';

describe('createDebouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces rapid calls into one, using the latest args', () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 300);
    d.call('a');
    d.call('ab');
    d.call('abc');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('abc');
  });

  it('runs again after the window elapses', () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 300);
    d.call(1);
    vi.advanceTimersByTime(300);
    d.call(2);
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(2);
  });

  it('flush runs the pending call immediately and clears it', () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 300);
    d.call('pending');
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('pending');
    // The timer must not fire a second time.
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op when nothing is pending', () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 300);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel drops the pending call', () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 300);
    d.call('dropped');
    d.cancel();
    vi.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
  });
});
