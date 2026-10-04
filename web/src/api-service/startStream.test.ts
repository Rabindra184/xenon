import { afterEach, describe, expect, it, vi } from 'vitest';
import XenonApiService from './index';

/**
 * stream/start says which player the page shows, so the server never runs an
 * H.264 capture the page cannot show beside the MJPEG one its <img> starts.
 */
describe('XenonApiService.startStream', () => {
  const realFetch = globalThis.fetch;
  const win = window as unknown as { VideoDecoder?: unknown };
  const bodyOfStart = () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    return { url: String(url), method: init.method, body: JSON.parse(init.body) };
  };
  const stubFetch = () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as unknown as typeof fetch;
  };

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete win.VideoDecoder;
  });

  it('leaves the choice to the server in a browser that can decode H.264', async () => {
    win.VideoDecoder = class {};
    stubFetch();

    await XenonApiService.startStream('U1');

    expect(bodyOfStart()).toEqual({
      url: '/xenon/api/control/U1/stream/start',
      method: 'POST',
      body: {},
    });
  });

  it('says MJPEG in a browser that cannot (no WebCodecs, as on plain http)', async () => {
    delete win.VideoDecoder;
    stubFetch();

    await XenonApiService.startStream('U1');

    expect(bodyOfStart().body).toEqual({ player: 'mjpeg' });
  });

  it('says MJPEG when the page asks, whatever the browser can decode', async () => {
    win.VideoDecoder = class {};
    stubFetch();

    await XenonApiService.startStream('U1', { player: 'mjpeg' });

    expect(bodyOfStart().body).toEqual({ player: 'mjpeg' });
  });
});
