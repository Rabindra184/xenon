import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';

/**
 * Device control's own stream: what it does when the MJPEG stream it shows
 * ends, when the page comes back from the back/forward cache, when an image
 * error's retry outlives the page, and when the H.264 player fails while the
 * page is still starting.
 *
 * The real api-service runs against a fake preview server; the players are
 * the only stubs.
 */

const player = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
vi.mock('../mosaic/WsH264Player', () => ({
  default: (props: Record<string, any>) => {
    player.props = props;
    return <div data-testid="h264-player" data-ws-url={props.wsUrl} />;
  },
}));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast: vi.fn(), removeToast: vi.fn() }) }));
vi.mock('./useDisplayState', () => ({ useDisplayState: () => 'on' }));
vi.mock('./logcat/useLogcatStream', () => ({
  useLogcatStream: () => ({
    records: [],
    connected: true,
    clear: () => {},
    deniedReason: null,
    exhausted: false,
    retry: () => {},
  }),
}));
vi.mock('../omni-inspector/OmniInspector', () => ({ default: () => null }));
vi.mock('../bug-report/BugReportButton', () => ({ BugReportButton: () => null }));
vi.mock('../terminal/terminal', () => ({ Terminal: () => null }));

import DeviceControl from './device-control';

const S9: IDevice = {
  udid: 'R58M123',
  name: 'star2ltexx',
  host: 'http://127.0.0.1:4723',
  sdk: '10',
  platform: 'android',
  deviceType: 'real',
  realDevice: true,
  offline: false,
  userBlocked: false,
  busy: false,
  screenWidth: '1080',
  screenHeight: '2220',
};

type Hold = 'start' | 'devices';

/** The preview server, as device control sees it. */
function fakePreviewServer(opts: { h264?: boolean } = {}) {
  const books = { startBodies: [] as unknown[], requests: [] as string[] };
  const state = {
    streamStatus: { status: 'running', type: 'mjpeg' } as Record<string, unknown>,
    holds: new Set<Hold>(),
  };
  const waiting: Record<Hold, Array<() => void>> = { start: [], devices: [] };
  const wait = (h: Hold) =>
    state.holds.has(h) ? new Promise<void>((r) => waiting[h].push(r)) : Promise.resolve();
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url).split('?')[0];
    const method = init?.method ?? 'GET';
    books.requests.push(`${method} ${path}`);
    if (method === 'POST' && path.endsWith('/stream/start')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      books.startBodies.push(body);
      await wait('start');
      if (opts.h264 && body.player !== 'mjpeg') {
        return json({
          success: true,
          type: 'h264',
          h264Path: `/xenon/api/control/${S9.udid}/stream/h264`,
        });
      }
      return json({ success: true, type: 'mjpeg', mjpegPort: 9100 });
    }
    if (method === 'POST' && path.endsWith('/stream/ticket')) {
      return json({ ticket: 'tkt-1', expiresIn: 60 });
    }
    if (method === 'GET' && path.endsWith('/stream/status')) return json(state.streamStatus);
    if (method === 'GET' && path.includes('/xenon/api/device')) {
      await wait('devices');
      return json([S9]);
    }
    return json({});
  });
  return {
    fn,
    books,
    state,
    hold: (h: Hold) => state.holds.add(h),
    release: (h: Hold) => {
      state.holds.delete(h);
      waiting[h].splice(0).forEach((r) => r());
    },
  };
}

const open = () =>
  render(
    <MemoryRouter initialEntries={[`/devices/${S9.udid}/control/actions`]}>
      <Routes>
        <Route
          path="/devices/:udid/control/:tab?"
          element={<DeviceControl device={S9} onClose={() => {}} titleId="t" />}
        />
      </Routes>
    </MemoryRouter>,
  );

const img = () => screen.queryByAltText('Device Stream') as HTMLImageElement | null;
const win = window as unknown as { VideoDecoder?: unknown };

/** Back from the back/forward cache. */
const restoreFromCache = () => {
  const e = new Event('pageshow');
  Object.defineProperty(e, 'persisted', { value: true });
  window.dispatchEvent(e);
};

describe('device control: its own stream', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    player.props = null;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete win.VideoDecoder;
    vi.restoreAllMocks();
  });

  it('reconnects an MJPEG stream the server says has ended', async () => {
    // An MJPEG <img> fires no event when its stream ends (a server restart,
    // someone's stream/stop): it froze on its last frame and the page stayed
    // as if live. The tile asks the server; so does device control now.
    const server = fakePreviewServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;
    open();
    const first = await screen.findByAltText('Device Stream');
    const before = first.getAttribute('src');
    // Stopped by the first time the page asks (it asks at once, then every 5 s).
    server.state.streamStatus = { status: 'stopped' };
    fireEvent.load(first);

    await waitFor(() => expect(img()?.getAttribute('src')).not.toBe(before));
    expect(screen.getByText(/Waiting for the screen/)).toBeInTheDocument();
    expect(img()?.getAttribute('src')).toContain('/xenon/api/control/R58M123/stream?');
  });

  it('leaves a stream the server says is running alone', async () => {
    const server = fakePreviewServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;
    open();
    const first = await screen.findByAltText('Device Stream');
    const before = first.getAttribute('src');
    fireEvent.load(first);

    await waitFor(() =>
      expect(server.books.requests.filter((r) => r.endsWith('/stream/status'))).not.toHaveLength(0),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(img()?.getAttribute('src')).toBe(before);
    expect(screen.queryByText(/Waiting for the screen/)).toBeNull();
  });

  it('starts over from scratch when the page comes back from the back/forward cache', async () => {
    // The start ran again, but the page kept its old stream's state: a
    // failed one stayed "Stream unavailable", and a loaded one hid the
    // waiting message and the 30 s watchdog from the new stream.
    const server = fakePreviewServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;
    const watchdogs: Array<() => void> = [];
    const realSetTimeout = window.setTimeout;
    vi.spyOn(window, 'setTimeout').mockImplementation(((fn: any, ms?: number, ...a: any[]) => {
      if (ms === 30000) {
        watchdogs.push(fn);
        return 0 as any;
      }
      return realSetTimeout(fn, ms, ...a);
    }) as any);
    open();
    await screen.findByAltText('Device Stream');
    await act(async () => watchdogs[watchdogs.length - 1]());
    expect(screen.getByText('Stream unavailable')).toBeInTheDocument();

    await act(async () => restoreFromCache());

    await screen.findByAltText('Device Stream');
    expect(server.books.startBodies).toHaveLength(2);
    expect(screen.queryByText('Stream unavailable')).toBeNull();
    expect(screen.getByText(/Waiting for the screen/)).toBeInTheDocument();
  });

  it('waits for the new stream after a restore, even when the old one had loaded', async () => {
    const server = fakePreviewServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;
    open();
    fireEvent.load(await screen.findByAltText('Device Stream'));
    await waitFor(() => expect(screen.queryByText(/Waiting for the screen/)).toBeNull());

    await act(async () => restoreFromCache());

    await waitFor(() => expect(server.books.startBodies).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText(/Starting the screen/)).toBeNull());
    expect(screen.getByText(/Waiting for the screen/)).toBeInTheDocument();
  });

  it('drops an image error’s pending retry when the page closes', async () => {
    const server = fakePreviewServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = open();
    fireEvent.error(await screen.findByAltText('Device Stream'));

    view.unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2100));
    });

    // React 17 reports a state update on an unmounted component here.
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/unmounted/);
  });

  it('opens no MJPEG stream before the server has switched to it, while the page is still starting', async () => {
    // The page's start ends by marking the stream chosen. When the H.264
    // player failed before that, the start's end opened the <img> (a GET
    // /stream, the screencap loop) while the fallback still waited for the
    // server's answer: the phone captured twice.
    win.VideoDecoder = class {};
    const server = fakePreviewServer({ h264: true });
    globalThis.fetch = server.fn as unknown as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    server.hold('devices');
    open();
    await screen.findByTestId('h264-player');

    server.hold('start');
    await act(async () => {
      void player.props?.onFatal?.();
    });
    await act(async () => server.release('devices'));
    await new Promise((r) => setTimeout(r, 20));

    expect(server.books.startBodies).toEqual([{}, { player: 'mjpeg' }]);
    expect(img()).toBeNull();

    await act(async () => server.release('start'));
    await screen.findByAltText('Device Stream');
  });
});
