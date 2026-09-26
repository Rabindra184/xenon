import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';

vi.mock('../../hooks/useSocket', () => ({ useSocket: () => ({ on: () => () => {} }) }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ me: { userId: 'me', role: 'MEMBER', teams: [] } }),
}));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
// Device control streams video; the page only needs its close button.
vi.mock('../device-control/device-control', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      Close device
    </button>
  ),
}));

const base = {
  host: 'http://127.0.0.1:4723',
  sdk: '14',
  offline: false,
  userBlocked: false,
  busy: false,
  session_id: null,
} as const;
const DEVICES: IDevice[] = [
  {
    ...base,
    udid: 'U-S9',
    name: 'star2ltexx',
    marketingName: 'Galaxy S9+',
    platform: 'android',
    deviceType: 'real',
    realDevice: true,
  },
  {
    ...base,
    udid: 'U-IOS',
    name: 'iPhone',
    marketingName: 'iPhone 17 Pro',
    platform: 'ios',
    deviceType: 'real',
    realDevice: true,
  },
  {
    ...base,
    udid: 'U-SIM',
    name: 'iPhone 16 Simulator',
    platform: 'ios',
    deviceType: 'simulator',
    realDevice: false,
  },
];
vi.mock('../../api-service', () => ({
  default: {
    getDevices: async () => DEVICES,
    getPendingSessionsCount: async () => 0,
    getQueueSummary: async () => null,
    listTeams: async () => [],
  },
}));

import DeviceExplorerWrapper from './device-explorer';

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const page = (
  <>
    <DeviceExplorerWrapper />
    <Where />
  </>
);
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/devices" element={page} />
        <Route path="/devices/:udid/control/:tab?" element={page} />
      </Routes>
    </MemoryRouter>,
  );
const where = () => screen.getByTestId('where').textContent;
const tab = (control: string, name: RegExp) =>
  within(screen.getByRole('tablist', { name: control })).getByRole('tab', { name });

describe('Devices page filters', () => {
  it('opens pre-filtered from the link', async () => {
    renderAt('/devices?platform=ios');
    expect(await screen.findByText('iPhone 17 Pro')).toBeInTheDocument();
    expect(screen.getByText('iPhone 16 Simulator')).toBeInTheDocument();
    expect(screen.queryByText('Galaxy S9+')).toBeNull();
  });

  it('writes a clicked filter into the link', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    fireEvent.click(tab('Platform', /^Android/));
    expect(where()).toBe('/devices?platform=android');
    expect(screen.queryByText('iPhone 17 Pro')).toBeNull();
    fireEvent.click(tab('Device type', /^Virtual/));
    expect(where()).toBe('/devices?platform=android&type=virtual');
  });

  it('searches the name the card shows', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search devices' }), {
      target: { value: 'galaxy' },
    });
    expect(where()).toBe('/devices?q=galaxy');
    expect(screen.getByText('Galaxy S9+')).toBeInTheDocument();
    expect(screen.queryByText('iPhone 17 Pro')).toBeNull();
  });

  it('says when nothing matches, and Clear filters shows every device', async () => {
    renderAt('/devices?platform=ios&q=nothing-like-this');
    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByText('No devices match these filters')).toBeNull();
    expect(where()).toBe('/devices');
    expect(await screen.findByText('Galaxy S9+')).toBeInTheDocument();
  });

  it('keeps the filters when a device is opened and closed', async () => {
    renderAt('/devices?platform=ios');
    await screen.findByText('iPhone 17 Pro');
    const card = screen.getByText('iPhone 17 Pro').closest('.dc2') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Control' }));
    expect(where()).toBe('/devices/U-IOS/control?platform=ios');
    fireEvent.click(await screen.findByRole('button', { name: 'Close device' }));
    expect(where()).toBe('/devices?platform=ios');
  });
});
