import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import {
  annotatedMp4Url,
  RecordingRequestError,
  type RecordingDetail,
  type RecordingSummary,
} from '../../api-service/recordings';

const api = vi.hoisted(() => ({ getRecording: vi.fn(), deleteRecording: vi.fn() }));
vi.mock('../../api-service/recordings', async () => ({
  ...(await vi.importActual<typeof import('../../api-service/recordings')>(
    '../../api-service/recordings',
  )),
  getRecording: api.getRecording,
  deleteRecording: api.deleteRecording,
}));

const pb = vi.hoisted(() => ({
  state: { timeMs: 0, playing: false, waiting: false },
  play: vi.fn(),
  pause: vi.fn(),
  toggle: vi.fn(),
  seek: vi.fn(),
  bind: vi.fn(() => () => undefined),
}));
vi.mock('./useSyncedPlayback', () => ({
  useSyncedPlayback: () => ({
    ...pb.state,
    play: pb.play,
    pause: pb.pause,
    toggle: pb.toggle,
    seek: pb.seek,
    bind: pb.bind,
  }),
}));

vi.mock('../mosaic/AnnotationOverlay', () => ({
  AnnotationOverlay: ({ committed }: { committed?: unknown[] }) => (
    <div data-testid="overlay" data-count={committed?.length ?? 0} />
  ),
}));

const auth = vi.hoisted(() => ({ me: null as null | { userId: string; role: string } }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ me: auth.me }) }));

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));

const { startDownload } = vi.hoisted(() => ({ startDownload: vi.fn() }));
vi.mock('./recordingActions', async () => ({
  ...(await vi.importActual<typeof import('./recordingActions')>('./recordingActions')),
  startDownload,
}));

import RecordingPage from './RecordingPage';
import { formatWhen } from './RecordingsPage';
import { downloadItems } from './recordingActions';

const ALICE = { userId: 'usr_alice', role: 'MEMBER' };
const BOB = { userId: 'usr_bob', role: 'MEMBER' };
const STOP_FIRST = 'Stop the recording on Live devices first.';

function summary(over: Partial<RecordingSummary> = {}): RecordingSummary {
  return {
    groupId: 'g1',
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
        annotationCount: 1,
      },
      {
        recordingId: 'r2',
        udid: 'U2',
        name: 'iPhone 17',
        platform: 'ios',
        status: 'STOPPED',
        offsetMs: 42000,
        durationMs: 200000,
        failReason: null,
        annotationCount: 0,
      },
      {
        recordingId: 'r3',
        udid: 'U3',
        name: 'Pixel',
        platform: 'android',
        status: 'FAILED',
        offsetMs: 0,
        durationMs: null,
        failReason: 'no frames',
        annotationCount: 0,
      },
    ],
    startedBy: { id: 'usr_alice', name: 'Alice' },
    bookmarkCount: 1,
    annotationCount: 1,
    keptUntil: '2026-02-04T10:00:00.000Z',
    sizeBytes: 1024,
    hasComposite: true,
    ...over,
  };
}

function detail(over: Partial<RecordingSummary> = {}): RecordingDetail {
  return {
    groupId: 'g1',
    summary: summary(over),
    bookmarks: [{ id: 'b1', recordingId: 'r1', timecodeMs: 30000, label: 'Checkout', note: null }],
    annotations: [
      {
        id: 'a1',
        recordingId: 'r1',
        timecodeMs: 1000,
        endTimecodeMs: 5000,
        shape: 'RECT',
        geometry: '{"x":0.1,"y":0.1,"w":0.2,"h":0.2}',
        color: 'red',
        text: null,
      },
    ],
  };
}

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}</output>;
}

const ui = () => (
  <MemoryRouter initialEntries={['/recordings/g1']}>
    <Routes>
      <Route path="/recordings/:groupId" element={<RecordingPage />} />
      <Route path="/recordings" element={<Where />} />
    </Routes>
  </MemoryRouter>
);

const renderPage = () => render(ui());
const tile = (name: string) => screen.getByRole('figure', { name });
const loaded = () => screen.findByRole('figure', { name: 'Galaxy S9+' });

describe('RecordingPage', () => {
  // React sets <video muted> as a property during commit. jsdom answers with a
  // synchronous volumechange, which React 17 then can't dispatch mid-render
  // and warns about. Browsers queue that event.
  let muted: MockInstance;
  beforeAll(() => {
    muted = vi
      .spyOn(HTMLMediaElement.prototype, 'muted', 'set')
      .mockImplementation(() => undefined);
  });
  afterAll(() => muted.mockRestore());

  beforeEach(() => {
    pb.state = { timeMs: 0, playing: false, waiting: false };
    pb.play.mockReset();
    pb.pause.mockReset();
    pb.toggle.mockReset();
    pb.seek.mockReset();
    pb.bind.mockClear(); // mockClear, not mockReset: keep the noop-returning implementation.
    api.getRecording.mockReset();
    api.getRecording.mockResolvedValue(detail());
    api.deleteRecording.mockReset();
    toast.mockReset();
    startDownload.mockReset();
    auth.me = ALICE;
  });

  it('heads the page with the date, the phones, the length and who recorded it', async () => {
    renderPage();
    await loaded();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      formatWhen('2026-01-05T10:00:00.000Z'),
    );
    expect(
      screen.getByText('Galaxy S9+, iPhone 17, Pixel · Length 4:12 · Recorded by Alice'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recordings' })).toHaveAttribute('href', '/recordings');
    const tiles = screen.getAllByRole('figure');
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual([
      'Galaxy S9+',
      'iPhone 17',
      'Pixel',
    ]);
    tiles.forEach((t) =>
      expect(within(t).getByText(t.getAttribute('aria-label') as string)).toBeInTheDocument(),
    );
    // The stub above only hides jsdom's synchronous volumechange; a late-joining
    // phone can only autoplay while muted, so assert the setter actually saw it.
    expect(muted).toHaveBeenCalledWith(true);
  });

  it('notes a phone that joined later, one that failed, and a video that is gone', async () => {
    renderPage();
    await loaded();

    expect(within(tile('iPhone 17')).getByText('Joined at 0:42')).toBeInTheDocument();

    const pixel = tile('Pixel');
    expect(within(pixel).getByText('Recording failed: no frames')).toBeInTheDocument();
    expect(pixel.querySelector('video')).toBeNull();

    const video = tile('Galaxy S9+').querySelector('video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.getAttribute('src')).toMatch(/source\.mp4\?recordingId=r1$/);
    expect(within(tile('Galaxy S9+')).queryByText('Video no longer available')).toBeNull();

    fireEvent.error(video);
    expect(within(tile('Galaxy S9+')).getByText('Video no longer available')).toBeInTheDocument();
  });

  it('draws each phone’s marks only while they are on screen, and hides them on request', async () => {
    pb.state.timeMs = 2000;
    const r = renderPage();
    await loaded();

    const count = (name: string) => within(tile(name)).getByTestId('overlay');
    expect(count('Galaxy S9+')).toHaveAttribute('data-count', '1');
    expect(count('iPhone 17')).toHaveAttribute('data-count', '0');
    expect(within(tile('Pixel')).queryByTestId('overlay')).toBeNull();

    pb.state.timeMs = 6000;
    r.rerender(ui());
    expect(count('Galaxy S9+')).toHaveAttribute('data-count', '0');
    expect(count('iPhone 17')).toHaveAttribute('data-count', '0');

    pb.state.timeMs = 2000;
    r.rerender(ui());
    expect(count('Galaxy S9+')).toHaveAttribute('data-count', '1');

    const toggle = screen.getByRole('checkbox', { name: 'Annotations' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(screen.queryAllByTestId('overlay')).toHaveLength(0);
  });

  it('plays, seeks from the timeline, the diamonds and the list, and takes keys', async () => {
    pb.state.timeMs = 10000;
    renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(pb.toggle).toHaveBeenCalledTimes(1);

    const timeline = screen.getByRole('slider', { name: 'Timeline' });
    expect(timeline).toHaveAttribute('aria-valuetext', '0:10 of 4:12');
    expect(screen.getByText('0:10 / 4:12')).toBeInTheDocument();
    fireEvent.change(timeline, { target: { value: '30000' } });
    expect(pb.seek).toHaveBeenLastCalledWith(30000);

    pb.seek.mockReset();
    const diamond = screen.getByRole('button', { name: 'Bookmark: Checkout, 0:30' });
    expect(diamond).toHaveAttribute('title', 'Checkout');
    fireEvent.click(diamond);
    expect(pb.seek).toHaveBeenLastCalledWith(30000);

    pb.seek.mockReset();
    const list = screen.getByRole('region', { name: 'Bookmarks' });
    fireEvent.click(within(list).getByRole('button', { name: /Checkout/ }));
    expect(pb.seek).toHaveBeenLastCalledWith(30000);
    expect(within(list).getByText('0:30 · Galaxy S9+')).toBeInTheDocument();

    pb.toggle.mockReset();
    pb.seek.mockReset();
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(pb.toggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(pb.seek).toHaveBeenLastCalledWith(15000);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(pb.seek).toHaveBeenLastCalledWith(5000);

    // A focused Play button handles its own Space (a click); the page must not
    // toggle a second time on top of it.
    pb.toggle.mockReset();
    const play = screen.getByRole('button', { name: 'Play' });
    play.focus();
    fireEvent.keyDown(play, { key: ' ' });
    expect(pb.toggle).not.toHaveBeenCalled();

    // The timeline is a range input, but Space and the arrows are the transport's
    // shortcuts, not native range behaviour: focusing it (by click or drag) must
    // not disable them. preventDefault on the arrows also stops the range's own
    // 100ms step from double-applying.
    pb.toggle.mockReset();
    pb.seek.mockReset();
    fireEvent.keyDown(timeline, { key: ' ' });
    expect(pb.toggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(timeline, { key: 'ArrowRight' });
    expect(pb.seek).toHaveBeenLastCalledWith(15000);
  });

  it('ignores a held Space so it cannot flicker play and pause', async () => {
    renderPage();
    await loaded();

    fireEvent.keyDown(document.body, { key: ' ', repeat: true });
    expect(pb.toggle).not.toHaveBeenCalled();
  });

  it('still ignores Space typed into an unrelated text field', async () => {
    renderPage();
    await loaded();

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    try {
      fireEvent.keyDown(input, { key: ' ' });
      expect(pb.toggle).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(input);
    }
  });

  it('ignores a keydown held with Meta or Ctrl', async () => {
    pb.state.timeMs = 10000;
    renderPage();
    await loaded();

    fireEvent.keyDown(document.body, { key: ' ', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowRight', ctrlKey: true });
    expect(pb.toggle).not.toHaveBeenCalled();
    expect(pb.seek).not.toHaveBeenCalled();
  });

  it('ignores Space while the download menu has focus', async () => {
    renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: ' ' });
    expect(pb.toggle).not.toHaveBeenCalled();
  });

  it('ignores Space while the delete dialog has focus', async () => {
    renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this recording?' });
    fireEvent.keyDown(dialog, { key: ' ' });
    expect(pb.toggle).not.toHaveBeenCalled();
  });

  it('starts the timeline at the earliest frame, so a phone that began before t=0 plays in full', async () => {
    // The S9+ was recording 13 s before the iPhone connected and the group's
    // t=0. Server: durationMs = max(-13000 + 30000, 0 + 16000) - (-13000).
    const base = detail();
    api.getRecording.mockResolvedValue({
      ...base,
      summary: summary({
        durationMs: 30000,
        phones: [
          { ...summary().phones[0], offsetMs: -13000, durationMs: 30000 },
          { ...summary().phones[1], offsetMs: 0, durationMs: 16000 },
        ],
      }),
      bookmarks: [{ id: 'b1', recordingId: 'r1', timecodeMs: 6000, label: 'Checkout', note: null }],
      annotations: [{ ...base.annotations[0], timecodeMs: 1000, endTimecodeMs: 5000 }],
    });
    pb.state.timeMs = 15000; // group time 2000: inside the mark's 1000-5000
    renderPage();
    await loaded();

    const timeline = screen.getByRole('slider', { name: 'Timeline' });
    expect(timeline).toHaveAttribute('min', '0');
    expect(timeline).toHaveAttribute('max', '30000');
    // Shifted by 13 s: the S9+'s first frame is at 0, its last at the max.
    expect(pb.bind).toHaveBeenCalledWith('r1', { offsetMs: 0, durationMs: 30000 });
    expect(pb.bind).toHaveBeenCalledWith('r2', { offsetMs: 13000, durationMs: 16000 });
    expect(within(tile('Galaxy S9+')).getByTestId('overlay')).toHaveAttribute('data-count', '1');

    // The bookmark at group time 6000 sits at 19000 on the timeline.
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark: Checkout, 0:19' }));
    expect(pb.seek).toHaveBeenLastCalledWith(19000);
    pb.seek.mockReset();
    const list = screen.getByRole('region', { name: 'Bookmarks' });
    expect(within(list).getByText('0:19 · Galaxy S9+')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: /Checkout/ }));
    expect(pb.seek).toHaveBeenLastCalledWith(19000);
  });

  it('binds every playable phone with its offset and duration, never the failed one', async () => {
    renderPage();
    await loaded();

    expect(pb.bind).toHaveBeenCalledWith('r1', { offsetMs: 0, durationMs: 252000 });
    expect(pb.bind).toHaveBeenCalledWith('r2', { offsetMs: 42000, durationMs: 200000 });
    expect(pb.bind).not.toHaveBeenCalledWith('r3', expect.anything());
  });

  it('shows Buffering… while a phone catches up, and Pause while playing', async () => {
    pb.state = { timeMs: 0, playing: true, waiting: true };
    renderPage();
    await loaded();

    expect(screen.getByRole('status')).toHaveTextContent('Buffering…');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('offers no Download for a group that failed', async () => {
    api.getRecording.mockResolvedValue(detail({ status: 'failed' }));
    renderPage();
    await loaded();

    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('lists the downloads and starts the one picked', async () => {
    renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(downloadItems(summary()).map((i) => i.label));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Galaxy S9+: video with annotations' }));
    expect(startDownload).toHaveBeenCalledWith(annotatedMp4Url('g1', 'r1'));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('offers Delete only to someone who may delete it', async () => {
    auth.me = BOB;
    renderPage();
    await loaded();

    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('deletes after confirming, then says so and goes back to the library', async () => {
    api.deleteRecording.mockResolvedValue(undefined);
    renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this recording?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/recordings'));
    expect(api.deleteRecording).toHaveBeenCalledWith('g1');
    expect(toast).toHaveBeenCalledWith('Recording deleted', 'success');
  });

  it('disables Cancel and ignores Escape while a delete is in flight', async () => {
    let resolveDelete: (() => void) | undefined;
    api.deleteRecording.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this recording?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Delete this recording?' })).toBeInTheDocument();

    resolveDelete?.();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/recordings'));
  });

  it('keeps the dialog open with the reason when the server refuses', async () => {
    api.deleteRecording.mockRejectedValue(new RecordingRequestError(403, 'not_owner'));
    renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this recording?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only the person who recorded it, or an admin, can delete it.',
    );
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(screen.queryByTestId('where')).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("says a recording that can't be found isn't available, with a way back", async () => {
    api.getRecording.mockRejectedValue(new RecordingRequestError(404, 'not_found'));
    renderPage();

    expect(await screen.findByText("This recording isn't available")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Recordings' })).toHaveAttribute(
      'href',
      '/recordings',
    );
  });

  it('offers Retry when loading fails, which loads it again', async () => {
    api.getRecording.mockRejectedValueOnce(new Error('network down'));
    renderPage();

    expect(await screen.findByText("Couldn't load this recording")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await loaded();
    expect(api.getRecording).toHaveBeenCalledTimes(2);
  });

  it('sends a recording still running to Live devices, and cannot delete it yet', async () => {
    api.getRecording.mockResolvedValue(
      detail({
        status: 'recording',
        endedAt: null,
        durationMs: null,
        phones: summary().phones.map((p) => ({ ...p, status: 'RECORDING', durationMs: null })),
      }),
    );
    renderPage();

    expect(await screen.findByText('Still recording')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Live devices' })).toHaveAttribute(
      'href',
      '/devices/live',
    );
    expect(screen.queryAllByRole('figure')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();

    // Found by its text: this @testing-library/dom's name computation lets a
    // button's title win over its content, which browsers (and jest-dom's
    // newer copy, used by the matchers below) do not.
    const del = screen.getByText('Delete').closest('button') as HTMLButtonElement;
    expect(del).toHaveAccessibleName('Delete');
    expect(del).toBeDisabled();
    expect(del).toHaveAccessibleDescription(STOP_FIRST);
  });
});
