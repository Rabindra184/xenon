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

  it('dismisses manually by id and unsubscribes cleanly', () => {
    let current: Array<{ id: number }> = [];
    const off = subscribeToasts((t) => (current = t as never));
    toast('a');
    dismissToast(current[0].id);
    expect(current).toEqual([]);
    off();
  });
});
