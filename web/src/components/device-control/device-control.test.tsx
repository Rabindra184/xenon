import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';

// Device control starts a stream and loads panels on mount; these tests need
// the header and the Actions tab, so the rest is stubbed.
const api = vi.hoisted(() => ({
  startStream: vi.fn(),
  stopStream: vi.fn(),
  getDevices: vi.fn(),
  listApps: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn(() => 'toast-id'));
vi.mock('../../api-service', () => ({ default: api }));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));
vi.mock('./useDisplayState', () => ({ useDisplayState: () => 'on' }));
vi.mock('./logcat/LogcatView', () => ({ default: () => null }));
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
  api.getDevices.mockResolvedValue([]);
  api.listApps.mockResolvedValue([]);
});

describe('DeviceControl header', () => {
  // The Devices card said "Galaxy S9+" and the control view it opened said
  // "star2ltexx".
  it('names the device as its card does', () => {
    open(S9);
    expect(screen.getByRole('heading', { name: 'Galaxy S9+' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'star2ltexx' })).toBeNull();
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
