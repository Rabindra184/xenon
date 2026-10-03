import * as React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getScreenshot: vi.fn() }));
const toast = vi.hoisted(() => vi.fn((..._args: unknown[]) => 't'));
vi.mock('../../../api-service', () => ({ default: api }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));
// jsdom loads no images; the real helpers are tested in browserHelpers.test.ts.
vi.mock('./imageTools', async (orig) => ({
  ...(await orig<typeof import('./imageTools')>()),
  pictureSize: vi.fn(async () => ({ width: 1080, height: 2220 })),
  makeThumbnail: vi.fn(async () => new Blob(['thumb'])),
}));

import { memoryStore, type ScreenshotStore, type StoredCapture } from './screenshotStore';
import { MAX_KEPT, useScreenshots } from './useScreenshots';

const U = 'phone-1';
const ok = () => api.getScreenshot.mockResolvedValue({ screenshot: btoa('png') });

function stored(n: number, udid = U): StoredCapture {
  return {
    id: `s${n}`,
    udid,
    n,
    takenAt: n * 1000,
    width: 1,
    height: 2,
    bytes: 3,
    png: new Blob(['p']),
    thumb: new Blob(['t']),
  };
}

// @testing-library/react 11 (React 17) has no renderHook.
function setup(store: ScreenshotStore = memoryStore()) {
  const result = { current: null as unknown as ReturnType<typeof useScreenshots> };
  function Probe() {
    result.current = useScreenshots(U, async () => store);
    return null;
  }
  const { unmount } = render(<Probe />);
  return { result, waitFor, unmount, store };
}

const lastToast = () => toast.mock.calls[toast.mock.calls.length - 1] as unknown[];

describe('useScreenshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let i = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++i}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    cleanup();
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  it('loads the phone’s kept captures, newest first, and selects the newest', async () => {
    const store = memoryStore();
    await store.put(stored(1));
    await store.put(stored(2));
    await store.put(stored(9, 'other'));
    const { result, waitFor } = setup(store);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.captures.map((c) => c.n)).toEqual([2, 1]);
    expect(result.current.selectedId).toBe('s2');
    expect(result.current.persistent).toBe(false);
  });

  it('takes a capture: numbered after the highest, selected, kept in the store', async () => {
    ok();
    const store = memoryStore();
    await store.put(stored(4));
    const { result, waitFor } = setup(store);
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.take());
    const [first] = result.current.captures;
    expect(first.n).toBe(5);
    expect(result.current.selectedId).toBe(first.id);
    expect((await store.list(U)).map((c) => c.n)).toEqual([5, 4]);
    expect(result.current.taking).toBe(false);
  });

  it('says why a capture failed and adds nothing', async () => {
    api.getScreenshot.mockRejectedValue(new Error('device offline'));
    const { result, waitFor } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.take());
    expect(result.current.captures).toEqual([]);
    expect(lastToast()).toEqual(['Couldn’t take a screenshot: device offline', 'error']);
  });

  it('says so when the phone sends no picture', async () => {
    api.getScreenshot.mockResolvedValue({});
    const { result, waitFor } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.take());
    expect(lastToast()).toEqual([
      'Couldn’t take a screenshot. The phone sent no picture.',
      'error',
    ]);
  });

  it('keeps the capture in memory when the store refuses it', async () => {
    ok();
    const store = memoryStore();
    store.put = vi.fn(async () => Promise.reject(new Error('QuotaExceededError')));
    const { result, waitFor } = setup(store);
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.take());
    expect(result.current.captures).toHaveLength(1);
    expect(lastToast()[0]).toBe(
      'Couldn’t keep Screenshot 1 in this browser. It’s here until you leave the page.',
    );
  });

  it(`keeps the newest ${MAX_KEPT}`, async () => {
    ok();
    const store = memoryStore();
    for (let n = 1; n <= MAX_KEPT; n++) await store.put(stored(n));
    const { result, waitFor } = setup(store);
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.take());
    expect(result.current.captures).toHaveLength(MAX_KEPT);
    expect(result.current.captures.some((c) => c.n === 1)).toBe(false);
    expect((await store.list(U)).some((c) => c.n === 1)).toBe(false);
  });

  it('deletes with undo, selecting the next older capture', async () => {
    const store = memoryStore();
    for (const n of [1, 2, 3]) await store.put(stored(n));
    const { result, waitFor } = setup(store);
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.select('s2'));
    await act(() => result.current.remove('s2'));
    expect(result.current.captures.map((c) => c.n)).toEqual([3, 1]);
    expect(result.current.selectedId).toBe('s1');
    expect((await store.list(U)).map((c) => c.n)).toEqual([3, 1]);

    const [message, type, duration, action] = lastToast() as [
      string,
      string,
      number,
      { label: string; onClick: () => void },
    ];
    expect([message, type, duration, action.label]).toEqual([
      'Deleted Screenshot 2',
      'info',
      6000,
      'Undo',
    ]);
    await act(async () => action.onClick());
    await waitFor(() => expect(result.current.captures.map((c) => c.n)).toEqual([3, 2, 1]));
    expect(result.current.selectedId).toBe('s2');
    expect((await store.list(U)).map((c) => c.n)).toEqual([3, 2, 1]);
  });

  it('never reuses a number held for undo', async () => {
    ok();
    const store = memoryStore();
    await store.put(stored(1));
    const { result, waitFor } = setup(store);
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.remove('s1'));
    await act(() => result.current.take());
    expect(result.current.captures[0].n).toBe(2);
  });

  it('clears all with undo', async () => {
    const store = memoryStore();
    for (const n of [1, 2]) await store.put(stored(n));
    const { result, waitFor } = setup(store);
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.clearAll());
    expect(result.current.captures).toEqual([]);
    expect(result.current.selectedId).toBeNull();
    expect(await store.list(U)).toEqual([]);
    const [message, , , action] = lastToast() as [string, string, number, { onClick: () => void }];
    expect(message).toBe('Cleared 2 screenshots');
    await act(async () => action.onClick());
    await waitFor(() => expect(result.current.captures.map((c) => c.n)).toEqual([2, 1]));
  });

  it('adds a marked copy beside its original', async () => {
    const store = memoryStore();
    await store.put(stored(3));
    const { result, waitFor } = setup(store);
    await waitFor(() => expect(result.current.ready).toBe(true));
    const original = result.current.captures[0];
    await act(() => result.current.addMarkedCopy(original, new Blob(['marked'])));
    const [copy] = result.current.captures;
    expect(copy.n).toBe(4);
    expect(copy.markedFrom).toBe(3);
    expect(result.current.selectedId).toBe(copy.id);
  });

  it('gives back every picture URL when it unmounts', async () => {
    const store = memoryStore();
    await store.put(stored(1));
    const { result, waitFor, unmount } = setup(store);
    await waitFor(() => expect(result.current.ready).toBe(true));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
