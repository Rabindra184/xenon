import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';
import { installFakeLayout, type FakeLayout } from './logcat/testing/fakeLayout';

// Device control starts a stream and loads panels on mount; these tests need
// the header and the Actions tab, so the rest is stubbed.
const api = vi.hoisted(() => ({
  startStream: vi.fn(),
  stopStream: vi.fn(),
  leaveStream: vi.fn(),
  getDevices: vi.fn(),
  listApps: vi.fn(),
  typeText: vi.fn(),
  pressKey: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn(() => 'toast-id'));
vi.mock('../../api-service', () => ({ default: api }));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));
vi.mock('./useDisplayState', () => ({ useDisplayState: () => 'on' }));
// The real Logs pane, on a stream that never opens a socket.
const LOG_LINES = vi.hoisted(() =>
  [0, 1, 2].map((seq) => ({
    seq,
    ts: Date.UTC(2026, 9, 3, 10, 0, seq),
    pid: 1,
    tid: 1,
    level: 'I',
    tag: 'Tag',
    pkg: 'com.example',
    message: `line ${seq}`,
  })),
);
vi.mock('./logcat/useLogcatStream', () => ({
  useLogcatStream: () => ({
    records: LOG_LINES,
    connected: true,
    clear: () => {},
    deniedReason: null,
    exhausted: false,
    retry: () => {},
  }),
}));
vi.mock('../omni-inspector/OmniInspector', () => ({ default: () => null }));
vi.mock('../bug-report/BugReportButton', () => ({ BugReportButton: () => null }));
vi.mock('../terminal/terminal', () => ({
  Terminal: ({ welcomeMessage }: { welcomeMessage?: string }) => (
    <pre data-testid="welcome">{welcomeMessage}</pre>
  ),
}));

import DeviceControl from './device-control';

const S9: IDevice = {
  udid: '381103b720057ece',
  name: 'star2ltexx',
  marketingName: 'Galaxy S9+',
  host: 'http://127.0.0.1:4723',
  sdk: '10',
  platform: 'android',
  deviceType: 'real',
  realDevice: true,
  offline: false,
  userBlocked: false,
  busy: false,
};

const open = (device: IDevice, tab = 'actions') =>
  render(
    <MemoryRouter initialEntries={[`/devices/${device.udid}/control/${tab}`]}>
      <Routes>
        <Route
          path="/devices/:udid/control/:tab?"
          element={<DeviceControl device={device} onClose={() => {}} titleId="t" />}
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.startStream.mockResolvedValue({});
  api.stopStream.mockResolvedValue({});
  api.leaveStream.mockResolvedValue({});
  api.getDevices.mockResolvedValue([]);
  api.listApps.mockResolvedValue([]);
  api.typeText.mockResolvedValue({});
  api.pressKey.mockResolvedValue({});
});

describe('DeviceControl — releasing the device', () => {
  // Only leaving through the app released it. Closing the tab, reloading or
  // typing another address left the phone held, so tests queued for it and
  // failed "Device is busy".
  it('releases the device when the page is hidden', async () => {
    open(S9);
    await waitFor(() => expect(api.startStream).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('pagehide'));
    expect(api.leaveStream).toHaveBeenCalledWith('381103b720057ece');
  });

  // The hold belongs to the user and the device, not to this tab: stopping
  // outright froze every other tab on the device. Leaving lets the server
  // stop only once nobody is watching.
  it('leaves rather than stops, so another tab on the device keeps working', async () => {
    const { unmount } = open(S9);
    await waitFor(() => expect(api.startStream).toHaveBeenCalledTimes(1));
    unmount();
    expect(api.leaveStream).toHaveBeenCalledWith('381103b720057ece');
    expect(api.stopStream).not.toHaveBeenCalled();
  });

  // A browser keeps a removed MJPEG <img>'s connection open, and the server
  // counts every open connection as a viewer, so the leave above was
  // outvoted by this page's own stream and the phone stayed held.
  it('closes its stream when the page closes', async () => {
    const { unmount } = open(S9);
    const img = await screen.findByAltText('Device Stream');
    expect(img.getAttribute('src')).toContain('/stream?');

    unmount();

    expect(img.hasAttribute('src')).toBe(false);
  });

  it('takes the device back when the page returns from the back/forward cache', async () => {
    open(S9);
    await waitFor(() => expect(api.startStream).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await waitFor(() => expect(api.startStream).toHaveBeenCalledTimes(2));
  });
});

describe('DeviceControl header', () => {
  // The Devices card said "Galaxy S9+" and the control view it opened said
  // "star2ltexx".
  it('names the device as its card does', () => {
    open(S9);
    expect(screen.getByRole('heading', { name: 'Galaxy S9+' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'star2ltexx' })).toBeNull();
  });

  it('names the browser tab after the device, not its UDID', () => {
    open(S9);
    expect(document.title).toBe('Galaxy S9+ · Device · Xenon');
  });

  it('falls back to the reported name when the friendly one is unknown', () => {
    open({ ...S9, marketingName: null });
    expect(screen.getByRole('heading', { name: 'star2ltexx' })).toBeInTheDocument();
  });

  it('greets the shell with the same name', () => {
    open(S9, 'terminal');
    expect(screen.getByTestId('welcome')).toHaveTextContent(
      'Connected to Galaxy S9+ (381103b720057ece).',
    );
  });
});

// Device control types into the phone only while the device screen has focus
// (isCanvasFocused). The Logs pane has its own keys (/, arrows, Enter, Esc,
// End, Cmd/Ctrl+C), none of which may reach the phone.
describe('DeviceControl — the Logs pane keeps keys off the phone', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout();
  });
  afterEach(() => layout.restore());

  it('sends no text and no key event for keys pressed in the Logs pane', async () => {
    open(S9, 'logs');
    const canvas = document.querySelector('.device-stream-canvas') as HTMLElement;
    // The control: with the device screen focused, a key does reach the phone.
    act(() => canvas.focus());
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(api.pressKey).toHaveBeenCalledTimes(1);
    api.pressKey.mockClear();

    const list = screen.getByRole('listbox', { name: 'Log lines' });
    act(() => list.focus());
    ['a', 'Enter', 'Backspace', 'ArrowDown', 'ArrowUp', 'End', 'Escape'].forEach((key) =>
      fireEvent.keyDown(list, { key }),
    );
    fireEvent.keyDown(list, { key: '/' }); // focuses the filter
    const filter = screen.getByLabelText('Filter logs');
    expect(document.activeElement).toBe(filter);
    fireEvent.keyDown(filter, { key: 'x' });
    fireEvent.keyDown(filter, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 120)); // past the 50 ms typing buffer
    expect(api.typeText).not.toHaveBeenCalled();
    expect(api.pressKey).not.toHaveBeenCalled();
  });
});
