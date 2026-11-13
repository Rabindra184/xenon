import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { phoneKey, type PhoneRef } from '../../lib/phone';
import type { MosaicTile } from './recording-group-store';

// A hub's emulator-5554 and a node's: one udid, two phones.
const H1 = 'http://10.0.0.1:4723';
const H2 = 'http://10.0.0.2:4723';
const UDID = 'emulator-5554';
const rows = [H1, H2].map((host) => ({
  udid: UDID,
  host,
  name: 'Pixel 8',
  platform: 'android',
  busy: true,
  session_id: `manual_me_${UDID}`,
}));

const api = vi.hoisted(() => ({
  getDevices: vi.fn(),
  startStream: vi.fn(),
  getActiveRecordings: vi.fn(),
  idle: { warning: false },
}));

vi.mock('../../api-service', () => ({
  default: { getDevices: api.getDevices, startStream: api.startStream },
}));
vi.mock('../../api-service/recordings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api-service/recordings')>()),
  getActiveRecordings: api.getActiveRecordings,
}));
// The idle timer is the hook's own business; here it is warning or not.
vi.mock('../../hooks/useIdleDetector', () => ({
  useIdleDetector: () => ({
    warning: api.idle.warning,
    remainingSec: api.idle.warning ? 10 : null,
    reset: () => undefined,
  }),
}));
// The real tiles open streams; this one shows what the grid was handed.
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
        <li key={phoneKey(t)} data-testid="tile" data-recording={t.recordingId ?? ''}>
          <button type="button" onClick={() => onRemove?.(t)}>
            {`Remove ${phoneKey(t)}`}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

import DeviceMosaicView from './DeviceMosaicView';

const leaveUrl = (host: string) =>
  `/xenon/api/control/${UDID}/stream/leave?host=${encodeURIComponent(host)}`;

let fetchMock: ReturnType<typeof vi.fn<[string, RequestInit?], Promise<unknown>>>;

async function mountWithBothTiles() {
  render(
    <MemoryRouter>
      <DeviceMosaicView />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByTestId('tile')).toHaveLength(2));
}

describe('DeviceMosaicView with two phones of one udid', () => {
  beforeEach(() => {
    api.idle.warning = false;
    api.getDevices.mockResolvedValue(rows);
    api.startStream.mockResolvedValue({});
    api.getActiveRecordings.mockResolvedValue({ serverNow: Date.now(), groups: [] });
    fetchMock = vi.fn(async (url: string, _init?: RequestInit): Promise<unknown> => {
      if (url === '/xenon/api/auth/me') {
        return { ok: true, json: async () => ({ userId: 'me' }) };
      }
      if (url.includes('/stream/status')) {
        return { ok: true, json: async () => ({ status: 'running' }) };
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

  it('brings back a tile for each phone this user holds, each asked about by its host', async () => {
    await mountWithBothTiles();
    const statusUrls = fetchMock.mock.calls
      .map(([u]) => u as string)
      .filter((u) => u.includes('/stream/status'));
    expect(statusUrls.sort()).toEqual(
      [H1, H2].map((h) => `/xenon/api/control/${UDID}/stream/status?host=${encodeURIComponent(h)}`),
    );
  });

  it('binds a running recording’s phones by the host each recording names', async () => {
    api.getActiveRecordings.mockResolvedValue({
      serverNow: Date.now(),
      groups: [
        {
          groupId: 'g1',
          startedAt: new Date().toISOString(),
          compositeEnabled: true,
          recordings: [
            { id: 'rec-2', udid: UDID, host: H2 },
            { id: 'rec-1', udid: UDID, host: H1 },
          ],
          annotations: [],
        },
      ],
    });
    await mountWithBothTiles();
    await waitFor(() =>
      expect(screen.getAllByTestId('tile').map((t) => t.dataset.recording)).toEqual([
        'rec-1',
        'rec-2',
      ]),
    );
  });

  it('leaves the phone whose × was pressed, and keeps the other tile', async () => {
    await mountWithBothTiles();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Remove ${UDID}@${H2}` }));
    });
    const leaves = fetchMock.mock.calls.filter(([u]) => String(u).includes('/stream/leave'));
    expect(leaves).toEqual([[leaveUrl(H2), { method: 'POST' }]]);
    expect(screen.getAllByTestId('tile')).toHaveLength(1);
    expect(screen.getByRole('button', { name: `Remove ${UDID}@${H1}` })).toBeInTheDocument();
  });

  it('releases every tile’s own phone with a beacon naming its host', async () => {
    const sendBeacon = vi.fn((_url: string) => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });
    await mountWithBothTiles();
    api.idle.warning = true;
    // Any state change re-renders, and the warning shows its Release button.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Release now' }));
    });
    expect(sendBeacon.mock.calls.map(([u]) => u)).toEqual([leaveUrl(H1), leaveUrl(H2)]);
    expect(screen.queryAllByTestId('tile')).toHaveLength(0);
  });

  it('falls back to a keepalive fetch naming each host when there is no beacon', async () => {
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
    await mountWithBothTiles();
    api.idle.warning = true;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Release now' }));
    });
    const leaves = fetchMock.mock.calls.filter(([u]) => String(u).includes('/stream/leave'));
    expect(leaves).toEqual([
      [leaveUrl(H1), { method: 'POST', keepalive: true }],
      [leaveUrl(H2), { method: 'POST', keepalive: true }],
    ]);
  });
});
