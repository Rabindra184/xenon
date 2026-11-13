import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';
import { VIEW_KEY } from './deviceView';

vi.mock('../../hooks/useSocket', () => ({ useSocket: () => ({ on: () => () => {} }) }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ me: { userId: 'me', role: 'MEMBER', teams: [] } }),
}));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
// Device control streams video; the page only needs its close button, and
// which phone it was opened on.
const mounts = vi.hoisted(() => [] as string[]);
vi.mock('../device-control/device-control', () => ({
  default: function FakeControl({
    device,
    onClose,
  }: {
    device: { udid: string; host: string };
    onClose: () => void;
  }) {
    React.useEffect(() => {
      mounts.push(device.host);
    }, []);
    return (
      <>
        <button type="button" onClick={onClose}>
          Close device
        </button>
        <output data-testid="control-host">{device.host}</output>
      </>
    );
  },
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
const listed = vi.hoisted(() => ({ devices: null as IDevice[] | null }));
vi.mock('../../api-service', () => ({
  default: {
    getDevices: async () => listed.devices ?? DEVICES,
    getPendingSessionsCount: async () => 0,
    getQueueSummary: async () => null,
    listTeams: async () => [],
  },
}));

import DeviceExplorerWrapper from './device-explorer';

function Where() {
  const l = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="where">{l.pathname + l.search}</output>
      <input aria-label="Go to" onChange={(e) => navigate(e.target.value)} />
    </>
  );
}
const H = encodeURIComponent('http://127.0.0.1:4723');

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

describe('Devices page filters', () => {
  it('opens pre-filtered from the link', async () => {
    renderAt('/devices?platform=ios');
    expect(await screen.findByText('iPhone 17 Pro')).toBeInTheDocument();
    expect(screen.getByText('iPhone 16 Simulator')).toBeInTheDocument();
    expect(screen.queryByText('Galaxy S9+')).toBeNull();
    expect(screen.getByRole('button', { name: 'Platform: iOS' })).toBeInTheDocument();
  });

  it('writes a menu choice into the link', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    fireEvent.click(screen.getByRole('button', { name: 'Platform' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Android/ }));
    expect(where()).toBe('/devices?platform=android');
    expect(screen.queryByText('iPhone 17 Pro')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Virtual/ }));
    expect(where()).toBe('/devices?platform=android&type=virtual');
  });

  it('the chip’s × removes that filter from the link', async () => {
    renderAt('/devices?platform=ios&type=real');
    fireEvent.click(await screen.findByRole('button', { name: 'Clear platform filter' }));
    expect(where()).toBe('/devices?type=real');
  });

  it('shows Clear only while filtered, and it resets everything', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    const status = screen.getByRole('tablist', { name: 'Status' });
    fireEvent.click(within(status).getByRole('tab', { name: /^Ready/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(where()).toBe('/devices');
    expect(screen.getByRole('textbox', { name: 'Search devices' })).toHaveFocus();
  });

  it('says how many devices show', async () => {
    renderAt('/devices?platform=ios');
    expect(await screen.findByText('2 of 3 devices')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear platform filter' }));
    expect(screen.getByText('3 devices')).toBeInTheDocument();
  });

  it('focuses the search on /, but not while typing in it', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    const search = screen.getByRole('textbox', { name: 'Search devices' });
    // fireEvent returns false when the handler prevented the default.
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(false);
    expect(search).toHaveFocus();
    expect(fireEvent.keyDown(search, { key: '/' })).toBe(true);
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
    expect(where()).toBe(`/devices/U-IOS/control?host=${H}&platform=ios`);
    fireEvent.click(await screen.findByRole('button', { name: 'Close device' }));
    expect(where()).toBe('/devices?platform=ios');
  });
});

describe('Devices page view', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('defaults to cards', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('switches to the table, writes the link and remembers the choice', async () => {
    renderAt('/devices');
    await screen.findByText('Galaxy S9+');
    const view = screen.getByRole('tablist', { name: 'View' });
    fireEvent.click(within(view).getByRole('tab', { name: 'Table' }));
    expect(screen.getByRole('table', { name: 'Devices, 3 shown' })).toBeInTheDocument();
    expect(where()).toBe('/devices?view=table');
    expect(window.localStorage.getItem(VIEW_KEY)).toBe('table');
  });

  it('opens the table from the link', async () => {
    renderAt('/devices?view=table');
    expect(await screen.findByRole('table', { name: 'Devices, 3 shown' })).toBeInTheDocument();
  });

  it('opens the table from a stored preference with no URL param', async () => {
    window.localStorage.setItem(VIEW_KEY, 'table');
    renderAt('/devices');
    expect(await screen.findByRole('table', { name: 'Devices, 3 shown' })).toBeInTheDocument();
  });

  it('sorting a column keeps the table view in the link', async () => {
    renderAt('/devices?view=table');
    const table = await screen.findByRole('table', { name: 'Devices, 3 shown' });
    fireEvent.click(within(table).getByRole('button', { name: 'Device' }));
    expect(where()).toBe('/devices?view=table&sort=device');
  });

  it('changing a filter keeps the view and sort in the link', async () => {
    renderAt('/devices?view=table&sort=device');
    await screen.findByRole('table', { name: 'Devices, 3 shown' });
    // The table also has a "Platform" sort button; the filter trigger is the
    // one with aria-expanded (from aria-haspopup="menu").
    fireEvent.click(screen.getByRole('button', { name: 'Platform', expanded: false }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Android/ }));
    expect(where()).toBe('/devices?platform=android&view=table&sort=device');
  });

  // Host shows only with more than one host. A filter that leaves one host
  // used to hide the column the rows were sorted by, so no header said how
  // they were ordered.
  it('keeps the Host column, marked as the sort, when a filter leaves one host', async () => {
    const s9 = DEVICES[0];
    const host = s9.host;
    s9.host = 'http://node-b:4723';
    try {
      renderAt('/devices?view=table&sort=host');
      await screen.findByRole('table', { name: 'Devices, 3 shown' });
      fireEvent.click(screen.getByRole('button', { name: 'Platform', expanded: false }));
      fireEvent.click(await screen.findByRole('menuitemradio', { name: /iOS/ }));
      const table = screen.getByRole('table', { name: 'Devices, 2 shown' });
      expect(within(table).getByRole('columnheader', { name: /Host/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      );
      expect(where()).toBe('/devices?platform=ios&view=table&sort=host');
    } finally {
      s9.host = host;
    }
  });

  // A `?view=cards` link has to beat a stored `table`, or the first filter
  // change drops it and the page flips to the table underneath the user.
  it('keeps a cards link over a stored table when a filter changes', async () => {
    window.localStorage.setItem(VIEW_KEY, 'table');
    renderAt('/devices?view=cards');
    await screen.findByText('Galaxy S9+');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Platform' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Android/ }));
    expect(where()).toBe('/devices?platform=android&view=cards');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens a device from the table and returns to it, keeping view and sort', async () => {
    renderAt('/devices?view=table&sort=device');
    const table = await screen.findByRole('table', { name: 'Devices, 3 shown' });
    const row = within(table)
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('Galaxy S9+')) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Control' }));
    expect(where()).toBe(`/devices/U-S9/control?host=${H}&view=table&sort=device`);
    fireEvent.click(await screen.findByRole('button', { name: 'Close device' }));
    expect(where()).toBe('/devices?view=table&sort=device');
    expect(screen.getByRole('table', { name: 'Devices, 3 shown' })).toBeInTheDocument();
  });

  it('switching back to Cards removes view from the link and stores cards', async () => {
    renderAt('/devices?view=table');
    await screen.findByRole('table', { name: 'Devices, 3 shown' });
    const view = screen.getByRole('tablist', { name: 'View' });
    fireEvent.click(within(view).getByRole('tab', { name: 'Cards' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(where()).toBe('/devices');
    expect(window.localStorage.getItem(VIEW_KEY)).toBe('cards');
  });
});

describe('Device control on a udid two servers have', () => {
  const H1 = 'http://10.0.0.1:4723';
  const H2 = 'http://10.0.0.2:4724';
  const twin = (host: string, name: string): IDevice => ({
    ...base,
    host,
    udid: 'emulator-5554',
    name,
    platform: 'android',
    deviceType: 'emulator',
    realDevice: false,
  });
  beforeEach(() => {
    listed.devices = [twin(H1, 'Pixel 7 API 34'), twin(H2, 'Pixel 8 API 35'), DEVICES[0]];
    mounts.length = 0;
  });
  afterEach(() => {
    listed.devices = null;
  });
  const heading = 'Two servers have a phone named emulator-5554. Choose one.';

  it('lists the phones for a link without a host, and opens neither', async () => {
    renderAt('/devices/emulator-5554/control/logs');
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/devices/emulator-5554/control/logs?host=${encodeURIComponent(H1)}`,
      `/devices/emulator-5554/control/logs?host=${encodeURIComponent(H2)}`,
    ]);
    expect(screen.queryByTestId('control-host')).toBeNull();

    fireEvent.click(links[1]);
    expect(await screen.findByTestId('control-host')).toHaveTextContent(H2);
    expect(screen.queryByRole('heading', { name: heading })).toBeNull();
  });

  it('opens the phone its link names', async () => {
    renderAt(`/devices/emulator-5554/control?host=${encodeURIComponent(H2)}`);
    expect(await screen.findByTestId('control-host')).toHaveTextContent(H2);
    expect(screen.queryByRole('heading', { name: heading })).toBeNull();
  });

  it('opens the one phone of a udid without a host', async () => {
    renderAt('/devices/U-S9/control');
    expect(await screen.findByTestId('control-host')).toHaveTextContent(base.host);
  });

  // A bookmark from before links carried the host: pinned to the phone it
  // opened, so a second server's phone of that udid turning up later doesn't
  // swap device control for the chooser mid-use.
  it('pins an old link to the phone it opened, by adding its host', async () => {
    listed.devices = [DEVICES[0]];
    renderAt('/devices/U-S9/control/logs?view=table');
    expect(await screen.findByTestId('control-host')).toHaveTextContent(base.host);
    await waitFor(() => expect(where()).toBe(`/devices/U-S9/control/logs?host=${H}&view=table`));

    listed.devices = [DEVICES[0], { ...DEVICES[0], host: H2, marketingName: 'Other S9' }];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh devices', hidden: true }));
    await screen.findByText('Other S9');
    expect(screen.getByTestId('control-host')).toHaveTextContent(base.host);
    expect(screen.queryByRole('heading', { name: /Two servers have a phone/ })).toBeNull();
    expect(mounts).toEqual([base.host]);
  });

  it('opens nothing for a host no listed phone has', async () => {
    renderAt(`/devices/emulator-5554/control?host=${encodeURIComponent('http://10.0.0.3:4723')}`);
    await screen.findByText('Pixel 8 API 35');
    expect(screen.queryByTestId('control-host')).toBeNull();
    expect(screen.queryByRole('heading', { name: heading })).toBeNull();
  });

  it('opens the other phone afresh, not with the first one’s state', async () => {
    renderAt(`/devices/emulator-5554/control?host=${encodeURIComponent(H1)}`);
    expect(await screen.findByTestId('control-host')).toHaveTextContent(H1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Go to', hidden: true }), {
      target: { value: `/devices/emulator-5554/control?host=${encodeURIComponent(H2)}` },
    });
    expect(await screen.findByTestId('control-host')).toHaveTextContent(H2);
    expect(mounts).toEqual([H1, H2]);
  });

  it('closes to the Devices page without the host', async () => {
    renderAt(`/devices/emulator-5554/control?host=${encodeURIComponent(H1)}&platform=android`);
    fireEvent.click(await screen.findByRole('button', { name: 'Close device' }));
    expect(where()).toBe('/devices?platform=android');
  });
});
