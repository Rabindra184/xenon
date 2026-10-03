import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getScreenshot: vi.fn() }));
const toast = vi.hoisted(() => vi.fn((..._args: unknown[]) => 't'));
const tools = vi.hoisted(() => ({
  copyImage: vi.fn(async () => true),
  capturesZip: vi.fn(async () => new Blob(['zip'])),
  saveBlob: vi.fn(),
  flattenMarks: vi.fn(async () => new Blob(['marked'])),
}));
vi.mock('../../../api-service', () => ({ default: api }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));
vi.mock('./copyImage', () => ({ copyImage: tools.copyImage }));
vi.mock('./downloadAll', async (orig) => ({
  ...(await orig<typeof import('./downloadAll')>()),
  capturesZip: tools.capturesZip,
  saveBlob: tools.saveBlob,
}));
vi.mock('./imageTools', async (orig) => ({
  ...(await orig<typeof import('./imageTools')>()),
  pictureSize: vi.fn(async () => ({ width: 1080, height: 2220 })),
  makeThumbnail: vi.fn(async () => new Blob(['thumb'])),
  flattenMarks: tools.flattenMarks,
}));
// The real overlay draws on a canvas jsdom doesn't have; this one adds a mark.
vi.mock('../../mosaic/AnnotationOverlay', () => ({
  AnnotationOverlay: ({
    committed,
    onCommittedChange,
  }: {
    committed: unknown[];
    onCommittedChange: (n: unknown[]) => void;
  }) => (
    <button
      onClick={() =>
        onCommittedChange([...committed, { shape: 'RECT', color: 'red', geometry: {} }])
      }
    >
      draw a mark
    </button>
  ),
}));

import { memoryStore, type StoredCapture } from './screenshotStore';
import { ScreenshotsPanel } from './ScreenshotsPanel';

const U = 'phone-1';

function stored(n: number): StoredCapture {
  return {
    id: `s${n}`,
    udid: U,
    n,
    takenAt: n * 1000,
    width: 1080,
    height: 2220,
    bytes: 2048,
    png: new Blob(['p']),
    thumb: new Blob(['t']),
  };
}

async function renderPanel(ns: number[] = [], persistent = true) {
  const store = { ...memoryStore(), persistent };
  for (const n of ns) await store.put(stored(n));
  render(<ScreenshotsPanel udid={U} deviceName="Galaxy S9+" openStore={async () => store} />);
  await screen.findByText(/kept/i);
  return store;
}

const options = () => screen.getAllByRole('option');
const selectedName = () =>
  options()
    .find((o) => o.getAttribute('aria-selected') === 'true')
    ?.getAttribute('aria-label');
const toastsOf = (type: string) =>
  toast.mock.calls.filter((c) => (c as unknown[])[1] === type).map((c) => (c as unknown[])[0]);

/** A native Esc from inside the panel, as InPlaceDialog sees it after the panel. */
function escapeFrom(el: Element): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

describe('ScreenshotsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let i = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++i}`);
    URL.revokeObjectURL = vi.fn();
    api.getScreenshot.mockResolvedValue({ screenshot: btoa('png') });
  });
  afterEach(() => {
    cleanup();
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  it('starts empty, and a capture replaces the empty state', async () => {
    await renderPanel([]);
    expect(screen.getByText('No screenshots yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Compare/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Take screenshot/ }));
    await screen.findByRole('option');
    expect(screen.getByText('1 of 50 kept')).toBeInTheDocument();
    expect(screen.getByText('Screenshot 1 · Today', { exact: false }).textContent).toMatch(
      /Portrait · 1080 × 2220/,
    );
  });

  it('says when this browser keeps nothing', async () => {
    await renderPanel([1], false);
    expect(screen.getByText('Kept until you leave this page')).toBeInTheDocument();
  });

  it('moves through the list with the arrow keys and deletes with Delete', async () => {
    await renderPanel([1, 2, 3]);
    expect(selectedName()).toMatch(/^Screenshot 3/);
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(selectedName()).toMatch(/^Screenshot 2/);
    fireEvent.keyDown(list, { key: 'End' });
    expect(selectedName()).toMatch(/^Screenshot 1/);
    fireEvent.keyDown(list, { key: 'Home' });
    expect(selectedName()).toMatch(/^Screenshot 3/);
    fireEvent.keyDown(list, { key: 'Delete' });
    await waitFor(() => expect(options()).toHaveLength(2));
    expect(toastsOf('info')).toContain('Deleted Screenshot 3');
    expect(selectedName()).toMatch(/^Screenshot 2/);
  });

  it('compares two, the right side picked in the list, and Esc ends it without closing', async () => {
    await renderPanel([1, 2, 3]);
    fireEvent.click(screen.getByRole('button', { name: /Compare/ }));
    const preview = screen.getByRole('region', { name: 'Preview' });
    expect(within(preview).getAllByRole('figure')).toHaveLength(2);
    expect(within(preview).getByText(/^Screenshot 3 ·/)).toBeInTheDocument();
    expect(within(preview).getByText(/^Screenshot 2 ·/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: /^Screenshot 1/ }));
    expect(within(preview).getByText(/^Screenshot 1 ·/)).toBeInTheDocument();
    expect(within(preview).queryByText(/^Screenshot 2 ·/)).not.toBeInTheDocument();

    const e = escapeFrom(screen.getByRole('listbox'));
    expect(e.defaultPrevented).toBe(true);
    expect(within(preview).queryAllByRole('figure')).toHaveLength(0);
    // With nothing left to leave, Esc is device control's again.
    expect(escapeFrom(screen.getByRole('listbox')).defaultPrevented).toBe(false);
  });

  it('saves marks as a new capture and leaves the original', async () => {
    await renderPanel([1, 2]);
    fireEvent.click(screen.getByRole('button', { name: /Annotate/ }));
    const save = screen.getByRole('button', { name: 'Save copy' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByText('draw a mark'));
    fireEvent.click(save);
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(tools.flattenMarks).toHaveBeenCalledTimes(1);
    expect(selectedName()).toMatch(/^Screenshot 3, marked copy of 2/);
    expect(screen.getByText(/^Screenshot 3 · marked copy of 2 ·/)).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Annotate' })).not.toBeInTheDocument();
  });

  it('leaves annotate on Esc without saving', async () => {
    await renderPanel([1]);
    fireEvent.click(screen.getByRole('button', { name: /Annotate/ }));
    fireEvent.click(screen.getByText('draw a mark'));
    expect(escapeFrom(screen.getByRole('toolbar', { name: 'Annotate' })).defaultPrevented).toBe(
      true,
    );
    expect(screen.queryByRole('toolbar', { name: 'Annotate' })).not.toBeInTheDocument();
    expect(tools.flattenMarks).not.toHaveBeenCalled();
  });

  it('copies, and says what to do where the browser can’t', async () => {
    await renderPanel([1]);
    fireEvent.click(screen.getByRole('button', { name: /^Copy/ }));
    await waitFor(() => expect(toastsOf('success')).toContain('Copied Screenshot 1'));
    tools.copyImage.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /^Copy/ }));
    await waitFor(() =>
      expect(toastsOf('error')).toContain(
        'Your browser can’t copy pictures on this address. Use Download instead.',
      ),
    );
  });

  it('downloads one, and all as a zip', async () => {
    await renderPanel([1, 2]);
    fireEvent.click(screen.getByRole('button', { name: /^Download$/ }));
    expect(tools.saveBlob).toHaveBeenLastCalledWith(
      expect.any(Blob),
      expect.stringMatching(/^galaxy-s9-screenshot-2-.*\.png$/),
    );
    fireEvent.click(screen.getByRole('button', { name: /Download all/ }));
    await waitFor(() =>
      expect(tools.saveBlob).toHaveBeenLastCalledWith(
        expect.any(Blob),
        expect.stringMatching(/^galaxy-s9-screenshots-\d{4}-\d{2}-\d{2}\.zip$/),
      ),
    );
    const [, captures] = tools.capturesZip.mock.calls[0] as unknown as [string, StoredCapture[]];
    expect(captures.map((c) => c.n)).toEqual([2, 1]);
  });

  it('says why the zip failed', async () => {
    tools.capturesZip.mockRejectedValueOnce(new Error('out of memory'));
    await renderPanel([1]);
    fireEvent.click(screen.getByRole('button', { name: /Download all/ }));
    await waitFor(() =>
      expect(toastsOf('error')).toContain('Couldn’t make the zip: out of memory'),
    );
  });
});
