import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';

/**
 * Device control on an iOS simulator no test runs on.
 *
 * A simulator's preview is its running test's picture, so with none running
 * the server refuses the start (409 `simulator_needs_test`) and says why. The
 * page used to log the refusal to the console, open the stream anyway and,
 * after its retries, say only "Stream unavailable".
 */

vi.mock('../ui/toast', () => ({ useToast: () => ({ toast: vi.fn(), removeToast: vi.fn() }) }));
vi.mock('./useDisplayState', () => ({ useDisplayState: () => 'unknown' }));
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

const SIMULATOR: IDevice = {
  udid: '35429994-B029-4AF4-9634-880B89DAC782',
  name: 'iPhone 16 Pro',
  host: 'http://127.0.0.1:4723',
  sdk: '18.4',
  platform: 'ios',
  deviceType: 'simulator',
  realDevice: false,
  offline: false,
  userBlocked: false,
  busy: false,
  screenWidth: '402',
  screenHeight: '874',
};

const REASON = "A simulator's screen shows here only while a test runs on it.";

function fakeServer() {
  const requests: string[] = [];
  let refuse = true;
  let listed: IDevice = SIMULATOR;
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${path}`);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (method === 'POST' && path.endsWith('/stream/start')) {
      return refuse
        ? json({ success: false, error: 'simulator_needs_test', message: REASON }, 409)
        : json({ success: true, type: 'mjpeg', mjpegPort: 9100 });
    }
    if (method === 'GET' && path.endsWith('/stream/status')) {
      return json({
        status: 'stopped',
        type: 'mjpeg',
        lastError: REASON,
        reason: 'simulator_needs_test',
      });
    }
    if (method === 'GET' && path.includes('/xenon/api/device')) return json([listed]);
    return json({});
  });
  return {
    fn,
    requests,
    /** A test starts: the preview is allowed, and the device list says so. */
    allow(running?: IDevice) {
      refuse = false;
      if (running) listed = running;
    },
  };
}

const page = (device: IDevice) => (
  <MemoryRouter initialEntries={[`/devices/${SIMULATOR.udid}/control/actions`]}>
    <Routes>
      <Route
        path="/devices/:udid/control/:tab?"
        element={<DeviceControl device={device} onClose={() => {}} titleId="t" />}
      />
    </Routes>
  </MemoryRouter>
);
const open = () => render(page(SIMULATOR));

describe('device control: a simulator no test runs on', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('says why it shows nothing, and opens no stream', async () => {
    const server = fakeServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;

    open();

    expect(await screen.findByText(REASON)).toBeTruthy();
    expect(screen.queryByText('Stream unavailable')).toBeNull();
    expect(screen.queryByAltText('Device Stream')).toBeNull();
    expect(server.requests.some((r) => /^GET .*\/stream(\?|$)/.test(r))).toBe(false);
  });

  it('asks again on Retry, and shows the picture once a test runs', async () => {
    const server = fakeServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;
    open();
    await screen.findByText(REASON);

    server.allow();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByAltText('Device Stream')).toBeTruthy());
    expect(screen.queryByText(REASON)).toBeNull();
    expect(server.requests.filter((r) => r.endsWith('/stream/start'))).toHaveLength(2);
  });

  // Control is greyed out while a test runs, so the page was opened first.
  it("shows the test's picture by itself once a test starts", async () => {
    const server = fakeServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;
    const view = open();
    await screen.findByText(REASON);

    const running = { ...SIMULATOR, busy: true, session_id: 'sess-1' };
    server.allow(running);
    view.rerender(page(running));

    const img = await screen.findByAltText('Device Stream');
    expect(img.getAttribute('src')).toContain('/xenon/api/session/sess-1/live_video');
    expect(screen.queryByText(REASON)).toBeNull();
    // Not asked of stream/start: a member watching another user's test is refused it.
    expect(server.requests.filter((r) => r.endsWith('/stream/start'))).toHaveLength(1);
  });

  it('follows the next test, and says why again when the tests end', async () => {
    const server = fakeServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;
    const view = open();
    await screen.findByText(REASON);

    view.rerender(page({ ...SIMULATOR, busy: true, session_id: 'sess-1' }));
    await waitFor(() =>
      expect(screen.getByAltText('Device Stream').getAttribute('src')).toContain(
        '/session/sess-1/live_video',
      ),
    );

    view.rerender(page({ ...SIMULATOR, busy: true, session_id: 'sess-2' }));
    await waitFor(() =>
      expect(screen.getByAltText('Device Stream').getAttribute('src')).toContain(
        '/session/sess-2/live_video',
      ),
    );

    view.rerender(page(SIMULATOR));
    expect(await screen.findByText(REASON)).toBeTruthy();
    expect(screen.queryByAltText('Device Stream')).toBeNull();
    expect(server.requests.filter((r) => r.endsWith('/stream/start'))).toHaveLength(1);
  });
});
