import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetToasts, dismissToast, subscribeToasts, toast } from '../src/renderer/src/components/ui/toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetToasts();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('notifies subscribers when a toast is added', () => {
    const seen: unknown[][] = [];
    subscribeToasts((t) => seen.push([...t]));
    toast('Profile exported');
    expect(seen.at(-1)).toMatchObject([{ message: 'Profile exported', kind: 'success' }]);
  });

  it('auto-dismisses after 4 seconds', () => {
    let current: unknown[] = [];
    subscribeToasts((t) => (current = t));
    toast('bye');
    vi.advanceTimersByTime(4100);
    expect(current).toEqual([]);
  });

  it('keeps an error toast until it is dismissed', () => {
    let current: Array<{ id: number; kind: string }> = [];
    subscribeToasts((t) => (current = t as never));
    toast("Couldn't read 1 file", 'error');
    vi.advanceTimersByTime(10_000);
    expect(current).toMatchObject([{ message: "Couldn't read 1 file", kind: 'error' }]);
    dismissToast(current[0].id);
    expect(current).toEqual([]);
  });

  it('auto-dismisses a success toast after 4000 ms and not before', () => {
    let current: unknown[] = [];
    subscribeToasts((t) => (current = t));
    toast('Saved', 'success');
    vi.advanceTimersByTime(3999);
    expect(current).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(current).toEqual([]);
  });

  it('dismisses manually by id and unsubscribes cleanly', () => {
    let current: Array<{ id: number }> = [];
    const off = subscribeToasts((t) => (current = t as never));
    toast('a');
    dismissToast(current[0].id);
    expect(current).toEqual([]);
    off();
  });
});
