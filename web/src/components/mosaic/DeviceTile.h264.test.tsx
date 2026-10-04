import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_TIMEOUT_MS } from './stream-retry';

/**
 * Which captures a Live devices tile asks for on an Android phone with
 * `streaming.androidH264` on.
 *
 * A tile whose H.264 player failed went straight to its MJPEG `<img>`, a
 * GET /stream, which starts the screencap loop. Nothing told the server the
 * tile had stopped playing H.264, so the scrcpy capture ran on beside the
 * screencap one until the H.264 service's idle stop, ten minutes later: the
 * phone captured twice. Device control tells the server first
 * (`stream/start` with `player: 'mjpeg'`), and so does the tile now, and it
 * opens no `<img>` before that has answered.
 *
 * The tile only asks; it never stops or leaves the stream on a fallback.
 * Another tile or tab may still be playing the phone's H.264 preview, and
 * the server ends that capture only once nobody does
 * (AndroidH264StreamService.endWhenUnwatched).
 *
 * The real api-service runs against a fake preview server. The H.264 player
 * is the only stub: jsdom has neither WebCodecs nor a stream to decode.
 */

const player = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
vi.mock('./WsH264Player', () => ({
  default: (props: Record<string, any>) => {
    player.props = props;
    return <div data-testid="h264-player" data-ws-url={props.wsUrl} />;
  },
}));

import { DeviceTile } from './DeviceTile';

const UDID = 'R58M123';
const NAME = 'star2ltexx';
const H264_PATH = `/xenon/api/control/${UDID}/stream/h264`;

interface Options {
  /** stream/status says the server runs H.264 (the flag on, no recording). */
  h264?: boolean;
  /** The ticket for the H.264 socket can be minted. */
  ticket?: boolean;
  /** stream/start answers only when the test lets it. */
  holdStart?: boolean;
  /** stream/status answers only when the test lets it. */
  holdStatus?: boolean;
  /** stream/start never reaches the server. */
  startFails?: boolean;
}

/** The server's side, as far as the tile sees it: what it was asked, in order. */
function fakePreviewServer(opts: Options = {}) {
  const { h264 = true, ticket = true } = opts;
  const books = { requests: [] as string[], startBodies: [] as unknown[] };
  const holds: Record<'start' | 'status', Array<() => void>> = { start: [], status: [] };
  const held = (which: 'start' | 'status') =>
    new Promise<void>((resolve) => holds[which].push(resolve));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url).split('?')[0];
    const method = init?.method ?? 'GET';
    books.requests.push(`${method} ${path}`);
    if (path.endsWith('/stream/status')) {
      if (opts.holdStatus) await held('status');
      return json({
        status: 'running',
        type: h264 ? 'h264' : 'mjpeg',
        ...(h264 ? { h264Path: H264_PATH } : {}),
      });
    }
    if (path.endsWith('/stream/ticket')) {
      return ticket ? json({ ticket: 'tkt-1', expiresIn: 60 }) : json({ error: 'internal' }, 500);
    }
    if (method === 'POST' && path.endsWith('/stream/start')) {
      books.startBodies.push(init?.body ? JSON.parse(String(init.body)) : {});
      if (opts.holdStart) await held('start');
      if (opts.startFails) throw new TypeError('Failed to fetch');
      return json({ success: true, type: 'mjpeg', mjpegPort: 9100 });
    }
    return json({});
  });
  return {
    fn,
    books,
    release: (which: 'start' | 'status') => holds[which].splice(0).forEach((r) => r()),
    /** The requests that would end the stream for every viewer of the phone. */
    endings: () => books.requests.filter((r) => /\/stream\/(stop|leave)$/.test(r)),
  };
}

const win = window as unknown as { VideoDecoder?: unknown };
const mjpegImg = () => screen.queryByAltText(NAME) as HTMLImageElement | null;
const h264Player = () => screen.queryByTestId('h264-player');
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const tileOf = (props: Partial<React.ComponentProps<typeof DeviceTile>> = {}) => (
  <DeviceTile
    udid={UDID}
    name={NAME}
    mjpegPort={0}
    annotateMode={false}
    shape="RECT"
    color="#ff0000"
    platform="android"
    screenWidth={1080}
    screenHeight={2220}
    onAnnotation={() => undefined}
    {...props}
  />
);

const openTile = (props: Partial<React.ComponentProps<typeof DeviceTile>> = {}) =>
  render(tileOf(props));

/** Every <img> the tile ever puts on the page, however briefly. */
function imgsMounted(container: HTMLElement) {
  const seen: HTMLImageElement[] = [];
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLImageElement) seen.push(n);
        if (n instanceof HTMLElement) seen.push(...Array.from(n.querySelectorAll('img')));
      });
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  return { seen, stop: () => observer.disconnect() };
}

describe('DeviceTile: an Android tile with H.264 preview on', () => {
  beforeEach(() => {
    player.props = null;
    win.VideoDecoder = class {};
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete win.VideoDecoder;
  });

  it('plays H.264 and opens no MJPEG stream beside it', async () => {
    const server = fakePreviewServer();
    vi.stubGlobal('fetch', server.fn);

    openTile();

    const canvas = await screen.findByTestId('h264-player');
    expect(canvas.getAttribute('data-ws-url')).toMatch(/\/stream\/h264\?ticket=tkt-1$/);
    expect(mjpegImg()).toBeNull();
  });

  it('opens no MJPEG stream before it knows which player it shows', async () => {
    // An <img> is a GET /stream, which starts the screencap loop beside the
    // H.264 capture the mosaic's stream/start began.
    const server = fakePreviewServer({ holdStatus: true });
    vi.stubGlobal('fetch', server.fn);

    openTile();
    await settle();
    expect(mjpegImg()).toBeNull();

    await act(async () => server.release('status'));
    await screen.findByTestId('h264-player');
    expect(mjpegImg()).toBeNull();
  });

  it('opens the MJPEG stream at once when the server runs MJPEG for the phone', async () => {
    const server = fakePreviewServer({ h264: false });
    vi.stubGlobal('fetch', server.fn);

    openTile();

    const img = await screen.findByAltText(NAME);
    expect(img.getAttribute('src')).toContain(`/xenon/api/control/${UDID}/stream?`);
    expect(server.books.startBodies).toEqual([]);
    expect(h264Player()).toBeNull();
  });

  it('when the H.264 player fails, asks the server for MJPEG before opening the MJPEG stream', async () => {
    const server = fakePreviewServer({ holdStart: true });
    vi.stubGlobal('fetch', server.fn);
    openTile();
    await screen.findByTestId('h264-player');

    await act(async () => player.props?.onFatal?.());

    // Asked, not yet answered: neither player is open.
    expect(server.books.startBodies).toEqual([{ player: 'mjpeg' }]);
    expect(h264Player()).toBeNull();
    expect(mjpegImg()).toBeNull();

    await act(async () => server.release('start'));
    const img = await screen.findByAltText(NAME);
    expect(img.getAttribute('src')).toContain(`/xenon/api/control/${UDID}/stream?`);
  });

  it('never stops or leaves the stream on a fallback: another viewer may still play its H.264', async () => {
    const server = fakePreviewServer();
    vi.stubGlobal('fetch', server.fn);
    openTile();
    await screen.findByTestId('h264-player');

    await act(async () => player.props?.onFatal?.());
    await screen.findByAltText(NAME);

    expect(server.endings()).toEqual([]);
  });

  it('asks once when the socket reports its failure twice (an error, then the close)', async () => {
    const server = fakePreviewServer();
    vi.stubGlobal('fetch', server.fn);
    openTile();
    await screen.findByTestId('h264-player');

    const { onFatal } = player.props as { onFatal: () => void };
    await act(async () => {
      onFatal();
      onFatal();
    });
    await screen.findByAltText(NAME);

    expect(server.books.startBodies).toEqual([{ player: 'mjpeg' }]);
  });

  it('still opens the MJPEG stream when the server cannot be told', async () => {
    // A picture beats none; the stream's own retries take it from there.
    const server = fakePreviewServer({ startFails: true });
    vi.stubGlobal('fetch', server.fn);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    openTile();
    await screen.findByTestId('h264-player');

    await act(async () => player.props?.onFatal?.());

    expect(await screen.findByAltText(NAME)).toBeInTheDocument();
  });

  it('falls back the same way when the H.264 player shows no frame in the connect window', async () => {
    vi.useFakeTimers();
    const server = fakePreviewServer();
    vi.stubGlobal('fetch', server.fn);
    openTile();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h264Player()).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    });

    expect(server.books.startBodies).toEqual([{ player: 'mjpeg' }]);
    expect(h264Player()).toBeNull();
    expect(mjpegImg()?.getAttribute('src')).toContain(`/xenon/api/control/${UDID}/stream?`);
  });

  it('asks for MJPEG when it cannot get a ticket for the H.264 stream', async () => {
    // The server runs H.264 for the phone and this tile cannot play it.
    const server = fakePreviewServer({ ticket: false });
    vi.stubGlobal('fetch', server.fn);

    openTile();

    await screen.findByAltText(NAME);
    expect(server.books.startBodies).toEqual([{ player: 'mjpeg' }]);
    expect(h264Player()).toBeNull();
  });

  it('opens nothing when closed while it falls back', async () => {
    const server = fakePreviewServer({ holdStart: true });
    vi.stubGlobal('fetch', server.fn);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = openTile();
    await screen.findByTestId('h264-player');
    await act(async () => player.props?.onFatal?.());

    view.unmount();
    await act(async () => server.release('start'));
    await settle();

    // React 17 reports a state update on an unmounted tile here.
    expect(errors).not.toHaveBeenCalled();
  });

  it('mounts no <img> on its way to MJPEG, even one a recording left open', async () => {
    // A socket's close calls onFatal outside React's batching (React 17), so
    // each state change renders on its own. The tile kept MJPEG open through
    // a recording; one render with neither player chosen would mount an
    // <img>, a GET /stream, before the server had been told.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // act() warnings
    const server = fakePreviewServer({ holdStart: true });
    vi.stubGlobal('fetch', server.fn);
    const view = openTile({ recordingId: 'rec-1' });
    view.rerender(tileOf());
    await screen.findByTestId('h264-player');
    server.books.startBodies.length = 0;
    const imgs = imgsMounted(view.container);

    (player.props as { onFatal: () => void }).onFatal();
    await settle();

    expect(server.books.startBodies).toEqual([{ player: 'mjpeg' }]);
    expect(imgs.seen).toEqual([]);
    await act(async () => server.release('start'));
    await screen.findByAltText(NAME);
    expect(imgs.seen).toHaveLength(1);
    imgs.stop();
  });
});
