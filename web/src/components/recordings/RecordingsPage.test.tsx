import * as React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { LibraryResponse, RecordingSummary } from '../../api-service/recordings';

const { listRecordings } = vi.hoisted(() => ({ listRecordings: vi.fn() }));
vi.mock('../../api-service/recordings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api-service/recordings')>()),
  listRecordings,
}));

import RecordingsPage from './RecordingsPage';

const g2: RecordingSummary = {
  groupId: 'g2',
  startedAt: '2026-01-05T10:00:00.000Z',
  endedAt: '2026-01-05T10:04:12.000Z',
  durationMs: 252000,
  status: 'done',
  phones: [
    {
      recordingId: 'r1',
      udid: 'U1',
      name: 'Galaxy S9+',
      platform: 'android',
      status: 'STOPPED',
      offsetMs: 0,
      durationMs: 252000,
      failReason: null,
      annotationCount: 0,
    },
    {
      recordingId: 'r2',
      udid: 'U2',
      name: 'iPhone 17',
      platform: 'ios',
      status: 'STOPPED',
      offsetMs: 0,
      durationMs: 252000,
      failReason: null,
      annotationCount: 0,
    },
    {
      recordingId: 'r3',
      udid: 'U3',
      name: 'Pixel',
      platform: 'android',
      status: 'STOPPED',
      offsetMs: 0,
      durationMs: 252000,
      failReason: null,
      annotationCount: 0,
    },
  ],
  startedBy: { id: 'alice', name: 'Alice' },
  bookmarkCount: 2,
  annotationCount: 0,
  keptUntil: '2026-02-04T10:00:00.000Z',
  sizeBytes: 1024,
  hasComposite: true,
};

const g1: RecordingSummary = {
  groupId: 'g1',
  startedAt: '2026-01-05T11:00:00.000Z',
  endedAt: null,
  durationMs: null,
  status: 'recording',
  phones: [
    {
      recordingId: 'r4',
      udid: 'U4',
      name: 'Galaxy S9+',
      platform: 'android',
      status: 'RECORDING',
      offsetMs: 0,
      durationMs: null,
      failReason: null,
      annotationCount: 0,
    },
  ],
  startedBy: null,
  bookmarkCount: 0,
  annotationCount: 0,
  keptUntil: '2026-02-04T11:00:00.000Z',
  sizeBytes: 0,
  hasComposite: false,
};

function response(overrides: Partial<LibraryResponse> = {}): LibraryResponse {
  return {
    recordings: [g2, g1],
    nextCursor: null,
    total: 2,
    facets: {
      phones: [
        { udid: 'U1', name: 'Galaxy S9+', count: 1 },
        { udid: 'U2', name: 'iPhone 17', count: 1 },
      ],
      people: [{ id: 'alice', name: 'Alice', count: 1 }],
      unknownCount: 1,
      when: { any: 2, '24h': 2, '7d': 2, '30d': 2 },
    },
    retention: { days: 30, maxCount: 100 },
    ...overrides,
  };
}

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const page = (
  <>
    <RecordingsPage />
    <Where />
  </>
);

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/recordings" element={page} />
      </Routes>
    </MemoryRouter>,
  );

const where = () => screen.getByTestId('where').textContent;

describe('RecordingsPage', () => {
  beforeEach(() => {
    listRecordings.mockReset();
  });

  it('shows the recording count and a row per recording', async () => {
    listRecordings.mockResolvedValue(response());
    renderAt('/recordings');

    expect(await screen.findByText('2 recordings')).toBeInTheDocument();

    const phonesCell = screen.getByText('Galaxy S9+, iPhone 17 +1');
    expect(phonesCell).toHaveAttribute('title', 'Galaxy S9+\niPhone 17\nPixel');
    expect(screen.getByText('4:12')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Recording…')).toBeInTheDocument();
  });

  it("links the first row's When cell to the recording, and the running one to Live devices", async () => {
    listRecordings.mockResolvedValue(response());
    renderAt('/recordings');
    await screen.findByText('Galaxy S9+, iPhone 17 +1');

    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    const firstLink = within(rows[0]).getAllByRole('link')[0];
    expect(firstLink.getAttribute('href')).toBe('/recordings/g2');
    const secondLink = within(rows[1]).getAllByRole('link')[0];
    expect(secondLink.getAttribute('href')).toBe('/devices/live');
  });

  it('filters by phone through the FilterMenu, writing the URL and re-querying', async () => {
    listRecordings.mockResolvedValue(response());
    renderAt('/recordings');
    await screen.findByText('Galaxy S9+, iPhone 17 +1');
    listRecordings.mockClear();
    listRecordings.mockResolvedValue(response());

    fireEvent.click(screen.getByRole('button', { name: 'Phone' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Galaxy/ }));

    expect(where()).toBe('/recordings?phone=U1');
    await waitFor(() =>
      expect(listRecordings).toHaveBeenCalledWith(expect.objectContaining({ udid: 'U1' })),
    );
  });

  it('writes the search box into the q filter', async () => {
    listRecordings.mockResolvedValue(response());
    renderAt('/recordings');
    await screen.findByText('Galaxy S9+, iPhone 17 +1');

    fireEvent.change(screen.getByRole('textbox', { name: 'Search recordings' }), {
      target: { value: 'alice' },
    });

    expect(where()).toBe('/recordings?q=alice');
    await waitFor(() =>
      expect(listRecordings).toHaveBeenCalledWith(expect.objectContaining({ q: 'alice' })),
    );
  });

  it('shows "No recordings yet" with a link to Live devices when there are none and no filters', async () => {
    listRecordings.mockResolvedValue(response({ recordings: [], total: 0 }));
    renderAt('/recordings');

    expect(await screen.findByText('No recordings yet')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open Live devices' });
    expect(link.getAttribute('href')).toBe('/devices/live');
  });

  it('shows "No recordings match" when filtered to zero rows, and Clear filters resets the URL', async () => {
    listRecordings.mockResolvedValue(response({ recordings: [], total: 0 }));
    renderAt('/recordings?phone=U9');

    expect(await screen.findByText('No recordings match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(where()).toBe('/recordings');
  });

  it('loads more rows on demand, sending the cursor', async () => {
    listRecordings.mockResolvedValue(response({ nextCursor: 'c1' }));
    renderAt('/recordings');
    await screen.findByText('Galaxy S9+, iPhone 17 +1');

    const g3: RecordingSummary = { ...g1, groupId: 'g3', status: 'done', durationMs: 1000 };
    listRecordings.mockResolvedValueOnce(response({ recordings: [g3], nextCursor: null }));

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() =>
      expect(listRecordings).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' })),
    );
    // Old rows remain alongside the appended one.
    expect(screen.getByText('Galaxy S9+, iPhone 17 +1')).toBeInTheDocument();
  });

  it('shows an error with Retry, which refetches', async () => {
    listRecordings.mockRejectedValueOnce(new Error('network down'));
    renderAt('/recordings');

    expect(await screen.findByText("Couldn't load recordings")).toBeInTheDocument();
    listRecordings.mockResolvedValueOnce(response());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('2 recordings')).toBeInTheDocument();
  });

  it('shows the retention footnote', async () => {
    listRecordings.mockResolvedValue(response());
    renderAt('/recordings');
    expect(
      await screen.findByText('Recordings are kept for 30 days, up to the newest 100.'),
    ).toBeInTheDocument();
  });

  it('drops a Load-more response that resolves after the filter has changed', async () => {
    let resolveLoadMore!: (value: LibraryResponse) => void;
    const loadMoreDeferred = new Promise<LibraryResponse>((resolve) => {
      resolveLoadMore = resolve;
    });
    const g3: RecordingSummary = { ...g1, groupId: 'g3', status: 'done', durationMs: 1000 };
    const newFilterRow: RecordingSummary = {
      ...g2,
      groupId: 'gNew',
      phones: [{ ...g2.phones[0], udid: 'U9', name: 'OnePlus 5' }],
      startedBy: { id: 'bob', name: 'Bob' },
    };

    listRecordings
      .mockResolvedValueOnce(response({ nextCursor: 'c1' })) // initial page
      .mockImplementationOnce(() => loadMoreDeferred) // Load more, held open
      .mockResolvedValueOnce(response({ recordings: [newFilterRow], nextCursor: null, total: 1 })); // new filter's first page

    renderAt('/recordings');
    await screen.findByText('Galaxy S9+, iPhone 17 +1');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(listRecordings).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' })),
    );

    // Change the filter before the Load-more response arrives; its first page resolves normally.
    fireEvent.click(screen.getByRole('button', { name: 'Phone' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Galaxy/ }));

    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + the new filter's one row

    // Now the stale Load-more finally resolves, for the filter that's no longer selected.
    await act(async () => {
      resolveLoadMore(response({ recordings: [g3], nextCursor: null }));
      await loadMoreDeferred;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryByText('Galaxy S9+')).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('ignores a response that arrives after the page has unmounted', async () => {
    let resolveList!: (value: LibraryResponse) => void;
    const deferred = new Promise<LibraryResponse>((resolve) => {
      resolveList = resolve;
    });
    listRecordings.mockImplementationOnce(() => deferred);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderAt('/recordings');
    await waitFor(() => expect(listRecordings).toHaveBeenCalledTimes(1));

    unmount();

    await act(async () => {
      resolveList(response());
      await deferred;
      await Promise.resolve();
      await Promise.resolve();
    });

    const unmountedWarning = errorSpy.mock.calls.some((args) =>
      String(args[0]).includes('unmounted'),
    );
    expect(unmountedWarning).toBe(false);
    errorSpy.mockRestore();
  });
});
