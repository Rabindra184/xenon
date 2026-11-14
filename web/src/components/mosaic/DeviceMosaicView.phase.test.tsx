import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { phoneKey, type PhoneRef } from '../../lib/phone';
import type { MosaicTile } from './recording-group-store';

const HOST = 'http://127.0.0.1:4723';
// A: a phone this user is previewing (the page brings it back on load).
// B: a free phone.
const rowA = {
  udid: 'A',
  host: HOST,
  name: 'Alpha',
  platform: 'android',
  busy: true,
  session_id: 'manual_me_A',
};
const rowB = { udid: 'B', host: HOST, name: 'Bravo', platform: 'android', busy: false };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const api = vi.hoisted(() => ({
  getDevices: vi.fn(),
  startStream: vi.fn(),
  getActiveRecordings: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));

vi.mock('../../api-service', () => ({
  default: { getDevices: api.getDevices, startStream: api.startStream },
}));
vi.mock('../../api-service/recordings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api-service/recordings')>()),
  getActiveRecordings: api.getActiveRecordings,
  startRecording: api.startRecording,
  stopRecording: api.stopRecording,
}));
vi.mock('../../hooks/useIdleDetector', () => ({
  useIdleDetector: () => ({ warning: false, remainingSec: null, reset: () => undefined }),
}));
vi.mock('./DeviceMosaic', () => ({
  DeviceMosaic: ({
    tiles,
    onRemove,
  }: {
    tiles: MosaicTile[];
    onRemove?: (phone: PhoneRef) => void;
  }) => (
    <ul>
      {tiles.map((t) => (
        <li
          key={phoneKey(t)}
          data-testid="tile"
          data-udid={t.udid}
          data-recording={t.recordingId ?? ''}
        >
          <button type="button" onClick={() => onRemove?.(t)}>
            {`Remove ${t.udid}`}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

import DeviceMosaicView from './DeviceMosaicView';

let fetchMock: ReturnType<typeof vi.fn<[string], Promise<unknown>>>;
let statusAnswer: Promise<unknown>;

const leaves = () =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/stream/leave'));
const tileUdids = () => screen.queryAllByTestId('tile').map((t) => t.dataset.udid);
// Record's accessible name is its title; find it by what it says.
const recordButton = () =>
  screen
    .queryAllByRole('button')
    .find((b) => /^(Record|Starting)/.test(b.textContent?.trim() ?? '')) ?? null;
const pickerRow = (name: RegExp) =>
  screen.getAllByRole('button').find((b) => name.test(b.getAttribute('aria-label') ?? ''))!;

function mount() {
  render(
    <MemoryRouter>
      <DeviceMosaicView />
    </MemoryRouter>,
  );
}

describe('DeviceMosaicView and the recording phase', () => {
  beforeEach(() => {
    api.getDevices.mockResolvedValue([rowA, rowB]);
    api.startStream.mockResolvedValue({});
    api.getActiveRecordings.mockResolvedValue({ serverNow: Date.now(), groups: [] });
    statusAnswer = Promise.resolve({ status: 'running' });
    fetchMock = vi.fn(async (url: string): Promise<unknown> => {
      if (url === '/xenon/api/auth/me') return { ok: true, json: async () => ({ userId: 'me' }) };
      if (url.includes('/stream/status')) {
        const body = await statusAnswer;
        return { ok: true, json: async () => body };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function startingWithTileA() {
    mount();
    await waitFor(() => expect(tileUdids()).toEqual(['A']));
    const start = deferred<unknown>();
    api.startRecording.mockReturnValue(start.promise);
    await act(async () => {
      fireEvent.click(recordButton()!);
    });
    expect(recordButton()).toHaveTextContent('Starting…');
    return start;
  }

  // Through 2.36 the picker read the stored `recording` flag, false while
  // starting: the click went to the remove path, the reducer refused the
  // remove, and stream/leave was still sent for a phone the start had named.
  it('while a recording starts, a device-list click changes nothing and leaves no phone', async () => {
    await startingWithTileA();
    await act(async () => {
      fireEvent.click(pickerRow(/^Alpha/));
    });
    expect(tileUdids()).toEqual(['A']);
    expect(leaves()).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent(/Stop recording before changing/);
  });

  it('while a recording starts, a tile’s × leaves no phone', async () => {
    await startingWithTileA();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove A' }));
    });
    expect(tileUdids()).toEqual(['A']);
    expect(leaves()).toEqual([]);
  });

  // The start had named its phones already: an add was kept with no REC.
  it('while a recording starts, adding a device is refused and starts no stream', async () => {
    await startingWithTileA();
    api.startStream.mockClear();
    await act(async () => {
      fireEvent.click(pickerRow(/^Bravo/));
    });
    expect(tileUdids()).toEqual(['A']);
    expect(api.startStream).not.toHaveBeenCalled();
  });

  it('still leaves the phone when an idle tile is removed', async () => {
    mount();
    await waitFor(() => expect(tileUdids()).toEqual(['A']));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove A' }));
    });
    expect(tileUdids()).toEqual([]);
    expect(leaves()).toHaveLength(1);
  });

  // The rehydrate replaced the grid with its own answer (SET_TILES, twice),
  // dropping a tile added meanwhile whose stream addDevice had started.
  it('the load’s rehydrate keeps a tile added while it ran', async () => {
    const status = deferred<unknown>();
    statusAnswer = status.promise;
    mount();
    await waitFor(() => expect(pickerRow(/^Bravo/)).toBeTruthy());
    await act(async () => {
      fireEvent.click(pickerRow(/^Bravo/));
    });
    expect(tileUdids()).toEqual(['B']);
    await act(async () => {
      status.resolve({ status: 'running' });
    });
    await waitFor(() => expect(tileUdids()).toEqual(['B', 'A']));
  });

  it('the rehydrate doesn’t bring back a tile removed while it ran', async () => {
    const status = deferred<unknown>();
    statusAnswer = status.promise;
    mount();
    await waitFor(() => expect(pickerRow(/^Alpha/)).toBeTruthy());
    // Added by hand, then removed again, before the load's check answers.
    await act(async () => {
      fireEvent.click(pickerRow(/^Alpha/));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove A' }));
    });
    await act(async () => {
      status.resolve({ status: 'running' });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(tileUdids()).toEqual([]);
  });

  // A failed Stop dispatched STOP_RECORDING: Record came back while the
  // server went on recording, and only a reload brought Stop back.
  it('a Stop that fails while the recording still runs keeps the Stop button', async () => {
    const start = await startingWithTileA();
    await act(async () => {
      start.resolve({
        groupId: 'g1',
        startedAt: new Date().toISOString(),
        recordings: [{ id: 'rec-A', udid: 'A', host: HOST, status: 'RECORDING' }],
      });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
    api.stopRecording.mockRejectedValue(new Error('HTTP 502'));
    api.getActiveRecordings.mockResolvedValue({
      serverNow: Date.now(),
      groups: [
        { groupId: 'g1', startedAt: new Date().toISOString(), recordings: [], annotations: [] },
      ],
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
    expect(recordButton()).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/still recording/i);
    expect(tileUdids()).toEqual(['A']);
    expect(screen.getByTestId('tile').dataset.recording).toBe('rec-A');
  });

  it('a Stop that fails after the recording has ended goes back to Record', async () => {
    const start = await startingWithTileA();
    await act(async () => {
      start.resolve({
        groupId: 'g1',
        startedAt: new Date().toISOString(),
        recordings: [{ id: 'rec-A', udid: 'A', host: HOST, status: 'RECORDING' }],
      });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
    api.stopRecording.mockRejectedValue(new Error('HTTP 502'));
    api.getActiveRecordings.mockResolvedValue({ serverNow: Date.now(), groups: [] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    });
    await waitFor(() => expect(recordButton()).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  });
});
