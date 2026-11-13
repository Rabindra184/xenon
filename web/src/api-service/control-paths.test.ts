import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every per-phone request names the phone's server (`?host=`), so a udid two
 * servers have reaches the phone the page means instead of `409
 * ambiguous_phone`.
 */
vi.mock('./api-client', () => ({
  default: {
    makeGETRequest: vi.fn(async () => ({})),
    makePOSTRequest: vi.fn(async () => ({})),
    makeDELETERequest: vi.fn(async () => ({})),
    formatUrl: (url: string) => `/xenon/api${url}`,
  },
}));

import apiClient from './api-client';
import XenonApiService from './index';

const phone = { udid: 'emulator-5554', host: 'http://192.168.0.2:4723' };
const host = 'host=http%3A%2F%2F192.168.0.2%3A4723';
const post = apiClient.makePOSTRequest as unknown as ReturnType<typeof vi.fn>;
const get = apiClient.makeGETRequest as unknown as ReturnType<typeof vi.fn>;

describe('XenonApiService per-phone paths', () => {
  beforeEach(() => {
    post.mockClear();
    get.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tap', async () => {
    await XenonApiService.tap(phone, 1, 2);
    expect(post.mock.calls[0][0]).toBe(`/control/emulator-5554/tap?${host}`);
    expect(post.mock.calls[0][2]).toEqual({ x: 1, y: 2 });
  });

  it('startStream', async () => {
    await XenonApiService.startStream(phone, { player: 'mjpeg' });
    expect(post.mock.calls[0][0]).toBe(`/control/emulator-5554/stream/start?${host}`);
  });

  it('leaveStream', async () => {
    await XenonApiService.leaveStream(phone);
    expect(post.mock.calls[0][0]).toBe(`/control/emulator-5554/stream/leave?${host}`);
  });

  it('getClipboard', async () => {
    await XenonApiService.getClipboard(phone);
    expect(get.mock.calls[0][0]).toBe(`/control/emulator-5554/clipboard?${host}`);
  });

  it('installRepositoryApp', async () => {
    await XenonApiService.installRepositoryApp(phone, 'app-1');
    expect(post.mock.calls[0][0]).toBe(`/control/emulator-5554/install-repository-app?${host}`);
    expect(post.mock.calls[0][2]).toEqual({ appId: 'app-1' });
  });

  it('encodes a udid with a slash', async () => {
    await XenonApiService.tap({ ...phone, udid: 'a/b' }, 1, 2);
    expect(post.mock.calls[0][0]).toBe(`/control/a%2Fb/tap?${host}`);
  });

  it('uploadAndInstallApp', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await XenonApiService.uploadAndInstallApp(phone, new File(['x'], 'a.apk'));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      `/xenon/api/control/emulator-5554/upload-install?${host}`,
    );
  });

  it("setDeviceTeam sends the phone's host in its body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await XenonApiService.setDeviceTeam(phone, 't1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/xenon/api/device/emulator-5554/team');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ teamId: 't1', host: phone.host });
  });
});
