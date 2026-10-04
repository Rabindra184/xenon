import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';

/**
 * Which captures of the phone run while device control is open.
 *
 * With `streaming.androidH264` on, device control's stream/start started the
 * H.264 service while its `<img>` (GET /stream) started the screencap MJPEG
 * loop: two captures of one phone. Here the real api-service and device
 * control run against a fake preview server that keeps the same books the real
 * one does (control.ts): stream/start without `player: mjpeg` starts the H.264
 * capture when the flag is on; one with it starts the MJPEG capture and ends
 * an H.264 one first; and an MJPEG `<img>` on the page is a GET /stream, which
 * starts the MJPEG capture. The players are the only stubs: jsdom has neither
 * WebCodecs nor a stream to decode.
 */

const player = vi.hoisted(() => ({ props: null as null | Record<string, any>, mounts: 0 }));
vi.mock('../mosaic/WsH264Player', () => ({
  default: (props: Record<string, any>) => {
    player.props = props;
    player.mounts += 1;
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

/** The server's side of the preview: what it started, as control.ts decides. */
function fakePreviewServer(flagOn: boolean, device: IDevice = S9) {
  const books = {
    h264: false,
    mjpeg: false,
    startBodies: [] as unknown[],
    requests: [] as string[],
  };
  const startMjpegCapture = () => {
    books.h264 = false; // stream/start ends an H.264 capture before this one
    books.mjpeg = true;
  };
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    books.requests.push(`${method} ${path}`);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    if (method === 'POST' && path.endsWith('/stream/start')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      books.startBodies.push(body);
      if (flagOn && body.player !== 'mjpeg') {
        books.h264 = true;
        return json({
          success: true,
          type: 'h264',
          h264Path: `/xenon/api/control/${S9.udid}/stream/h264`,
        });
      }
      startMjpegCapture();
      return json({
        success: true,
        type: 'mjpeg',
        mjpegPort: 9100,
        streamUrl: `/xenon/api/control/${S9.udid}/stream`,
      });
    }
    if (method === 'POST' && path.endsWith('/stream/ticket')) {
      return json({ ticket: 'tkt-1', expiresIn: 60 });
    }
    if (method === 'GET' && path.includes('/xenon/api/device')) return json([device]);
    return json({});
  });
  return {
    fn,
    books,
    /** An `<img>` on the page is a GET /stream, which starts the screencap loop. */
    captures() {
      const imgOnPage = document.querySelector('img[alt="Device Stream"]');
      return {
        h264: books.h264,
        mjpeg: books.mjpeg || (imgOnPage?.getAttribute('src') ?? '').includes('/stream'),
      };
    },
  };
}

const open = (device: IDevice = S9) =>
  render(
    <MemoryRouter initialEntries={[`/devices/${device.udid}/control/actions`]}>
      <Routes>
        <Route
          path="/devices/:udid/control/:tab?"
          element={<DeviceControl device={device} onClose={() => {}} titleId="t" />}
        />
      </Routes>
    </MemoryRouter>,
  );

const win = window as unknown as { VideoDecoder?: unknown };

describe('device control: which captures of the phone run', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    player.props = null;
    player.mounts = 0;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete win.VideoDecoder;
  });

  it('with H.264 on and a browser that can play it: the H.264 capture alone, played by the H.264 player', async () => {
    win.VideoDecoder = class {};
    const server = fakePreviewServer(true);
    globalThis.fetch = server.fn as unknown as typeof fetch;

    open();

    const canvas = await screen.findByTestId('h264-player');
    expect(canvas.getAttribute('data-ws-url')).toMatch(
      /^wss?:\/\/[^/]+\/xenon\/api\/control\/R58M123\/stream\/h264\?ticket=tkt-1$/,
    );
    expect(screen.queryByAltText('Device Stream')).toBeNull();
    expect(server.captures()).toEqual({ h264: true, mjpeg: false });
  });

  it('with H.264 on and a browser that cannot play it: the MJPEG capture alone', async () => {
    // WebCodecs is only exposed on https and localhost: plain http://hub:4723 has none.
    delete win.VideoDecoder;
    const server = fakePreviewServer(true);
    globalThis.fetch = server.fn as unknown as typeof fetch;

    open();

    const img = await screen.findByAltText('Device Stream');
    expect(img.getAttribute('src')).toContain('/xenon/api/control/R58M123/stream?');
    expect(screen.queryByTestId('h264-player')).toBeNull();
    expect(server.books.startBodies).toEqual([{ player: 'mjpeg' }]);
    expect(server.captures()).toEqual({ h264: false, mjpeg: true });
  });

  it('with H.264 off: the MJPEG capture alone, as before', async () => {
    win.VideoDecoder = class {};
    const server = fakePreviewServer(false);
    globalThis.fetch = server.fn as unknown as typeof fetch;

    open();

    await screen.findByAltText('Device Stream');
    expect(screen.queryByTestId('h264-player')).toBeNull();
    expect(server.books.requests.some((r) => r.endsWith('/stream/ticket'))).toBe(false);
    expect(server.captures()).toEqual({ h264: false, mjpeg: true });
  });

  it('opens no stream until the server has said which one runs', async () => {
    win.VideoDecoder = class {};
    const server = fakePreviewServer(true);
    let release: () => void = () => {};
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/stream/start')) await new Promise<void>((r) => (release = r));
      return server.fn(url, init);
    }) as unknown as typeof fetch;

    open();

    // Waiting for stream/start: an <img> here would start the screencap loop.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByAltText('Device Stream')).toBeNull();
    expect(screen.queryByTestId('h264-player')).toBeNull();
    await act(async () => release());
    await screen.findByTestId('h264-player');
  });

  it('falls back to MJPEG when the H.264 player fails, and the H.264 capture ends', async () => {
    win.VideoDecoder = class {};
    const server = fakePreviewServer(true);
    globalThis.fetch = server.fn as unknown as typeof fetch;
    open();
    await screen.findByTestId('h264-player');

    await act(async () => player.props?.onFatal?.());

    await screen.findByAltText('Device Stream');
    expect(screen.queryByTestId('h264-player')).toBeNull();
    expect(server.books.startBodies).toEqual([{}, { player: 'mjpeg' }]);
    expect(server.captures()).toEqual({ h264: false, mjpeg: true });
  });

  it('falls back to MJPEG when the H.264 player shows no frame within 30 s', async () => {
    win.VideoDecoder = class {};
    const server = fakePreviewServer(true);
    globalThis.fetch = server.fn as unknown as typeof fetch;
    // The page's own watchdog is the only 30 s timer; take it and fire it by hand.
    const watchdogs: Array<() => void> = [];
    const realSetTimeout = window.setTimeout;
    const spy = vi.spyOn(window, 'setTimeout').mockImplementation(((
      fn: any,
      ms?: number,
      ...a: any[]
    ) => {
      if (ms === 30000) {
        watchdogs.push(fn);
        return 0 as any;
      }
      return realSetTimeout(fn, ms, ...a);
    }) as any);
    try {
      open();
      await screen.findByTestId('h264-player');

      await act(async () => watchdogs[watchdogs.length - 1]());

      await screen.findByAltText('Device Stream');
      expect(screen.queryByTestId('h264-player')).toBeNull();
      expect(server.books.startBodies).toEqual([{}, { player: 'mjpeg' }]);
      expect(server.captures()).toEqual({ h264: false, mjpeg: true });
    } finally {
      spy.mockRestore();
    }
  });

  it('shows an Appium session’s own video, and starts no H.264 capture beside it', async () => {
    win.VideoDecoder = class {};
    const running = { ...S9, busy: true, session_id: 'abc123-session' };
    const server = fakePreviewServer(true, running);
    globalThis.fetch = server.fn as unknown as typeof fetch;

    open(running);

    const img = await screen.findByAltText('Device Stream');
    expect(img.getAttribute('src')).toContain('/xenon/api/session/abc123-session/live_video');
    expect(server.books.startBodies).toEqual([{ player: 'mjpeg' }]);
    expect(server.books.h264).toBe(false);
  });

  it('counts the first frame of the H.264 player as the stream being up', async () => {
    win.VideoDecoder = class {};
    const server = fakePreviewServer(true);
    globalThis.fetch = server.fn as unknown as typeof fetch;
    open();
    await screen.findByTestId('h264-player');
    expect(screen.getByText(/Waiting for stream/i)).toBeInTheDocument();

    await act(async () => player.props?.onReady?.());

    await waitFor(() => expect(screen.queryByText(/Waiting for stream/i)).toBeNull());
  });
});
