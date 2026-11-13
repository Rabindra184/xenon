import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';

/**
 * Device control on a phone two servers name alike (a hub's emulator-5554
 * and its node's). When the server can't tell which phone is meant it refuses
 * the start (409 `ambiguous_phone`). The page used to ignore that answer and
 * open the stream anyway.
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

const EMULATOR: IDevice = {
  udid: 'emulator-5554',
  name: 'Pixel 7',
  host: 'http://10.0.4.21:4723',
  sdk: '14',
  platform: 'android',
  deviceType: 'emulator',
  realDevice: false,
  offline: false,
  userBlocked: false,
  busy: false,
  screenWidth: '1080',
  screenHeight: '2400',
};

const MESSAGE =
  'Two servers have a phone named emulator-5554. Name the one you mean with its host.';

function fakeServer() {
  const requests: string[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url).split('?')[0];
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${path}`);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (method === 'POST' && path.endsWith('/stream/start')) {
      return json(
        {
          error: 'ambiguous_phone',
          message: MESSAGE,
          hosts: ['http://10.0.4.21:4723', 'http://10.0.4.22:4723'],
        },
        409,
      );
    }
    if (method === 'GET' && path.includes('/xenon/api/device')) return json([EMULATOR]);
    return json({});
  });
  return { fn, requests };
}

describe('device control: a phone two servers name alike', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("shows the server's message and opens no stream", async () => {
    const server = fakeServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;

    render(
      <MemoryRouter initialEntries={[`/devices/${EMULATOR.udid}/control/actions`]}>
        <Routes>
          <Route
            path="/devices/:udid/control/:tab?"
            element={<DeviceControl device={EMULATOR} onClose={() => {}} titleId="t" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(MESSAGE)).toBeTruthy();
    expect(screen.queryByText('Stream unavailable')).toBeNull();
    expect(screen.queryByAltText('Device Stream')).toBeNull();
    expect(server.requests.some((r) => /^GET .*\/stream(\?|$)/.test(r))).toBe(false);
    expect(server.requests.some((r) => r.endsWith('/stream/ticket'))).toBe(false);
  });
});
