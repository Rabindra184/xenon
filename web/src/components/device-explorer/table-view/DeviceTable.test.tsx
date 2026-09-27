import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../../interfaces/IDevice';

const MEMBER = { userId: 'me', email: 'me@acme.com', name: 'Me', role: 'MEMBER', teams: [] };
const auth = vi.hoisted(() => ({ me: null as any }));
vi.mock('../../../auth/auth-context', () => ({ useAuth: () => ({ me: auth.me ?? MEMBER }) }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const api = vi.hoisted(() => ({
  releaseReservation: vi.fn(),
  blockDevice: vi.fn(),
  unblockDevice: vi.fn(),
}));
vi.mock('../../../api-service', () => ({ default: api }));

import { DeviceTable } from './DeviceTable';
import { DEFAULT_SORT } from '../deviceSort';

const device = (over: Partial<IDevice> = {}): IDevice =>
  ({
    name: 'Galaxy',
    host: 'http://127.0.0.1:4723',
    udid: 'U1',
    sdk: '14',
    deviceType: 'real',
    offline: false,
    userBlocked: false,
    busy: false,
    platform: 'android',
    realDevice: true,
    session_id: null,
    ...over,
  }) as IDevice;

const list = [
  device({ udid: 'A', name: 'Alpha' }),
  device({ udid: 'B', name: 'Beta', offline: true }),
  device({
    udid: 'C',
    name: 'Gamma',
    platform: 'ios',
    sdk: '17.0',
    teamId: 't1',
    tags: ['a', 'b', 'c'],
  }),
];
const table = (over: Partial<React.ComponentProps<typeof DeviceTable>> = {}) =>
  render(
    <DeviceTable
      devices={list}
      reloadDevices={vi.fn()}
      sort={DEFAULT_SORT}
      onSortChange={vi.fn()}
      navigate={vi.fn()}
      teams={new Map([['t1', 'QA']])}
      {...over}
    />,
  );
const rows = () => screen.getAllByRole('row').slice(1); // minus the header row

describe('DeviceTable', () => {
  it('has the columns in order and a caption with the count', () => {
    table();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual([
      'Status',
      'Device',
      'Platform',
      'Type',
      'Team',
      'Tags',
      'Actions',
    ]);
    expect(screen.getByRole('table', { name: 'Devices, 3 shown' })).toBeInTheDocument();
  });

  it('shows Host only when devices come from more than one host', () => {
    table({ devices: [...list, device({ udid: 'D', host: 'http://node-b:4723' })] });
    expect(screen.getByRole('columnheader', { name: /Host/ })).toBeInTheDocument();
  });

  it('marks the sorted column and reverses it on a second click', () => {
    const onSortChange = vi.fn();
    table({ onSortChange });
    expect(screen.getByRole('columnheader', { name: /Status/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(screen.getByRole('columnheader', { name: /Device/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    fireEvent.click(screen.getByRole('button', { name: /Status/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'status', dir: 'desc' });
    fireEvent.click(screen.getByRole('button', { name: /Device/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'device', dir: 'asc' });
  });

  it('orders rows by the sort (offline last by status)', () => {
    table();
    expect(rows().map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Gamma'),
      expect.stringContaining('Beta'),
    ]);
  });

  it('shows the card’s status, team, platform, type and tags', () => {
    table();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const gamma = rows().find((r) => r.textContent?.includes('Gamma'))!;
    const cells = within(gamma).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Ready');
    expect(cells[2]).toHaveTextContent('iOS 17.0');
    expect(cells[3]).toHaveTextContent('Real');
    expect(cells[4]).toHaveTextContent('QA');
    expect(cells[5]).toHaveTextContent('#a');
    expect(cells[5]).toHaveTextContent('+1');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const alpha = rows().find((r) => r.textContent?.includes('Alpha'))!;
    expect(within(alpha).getAllByRole('cell')[4]).toHaveTextContent('Shared');
  });

  it('gives each row the card’s actions, with the reason on a disabled Control', () => {
    const navigate = vi.fn();
    table({ navigate });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const beta = rows().find((r) => r.textContent?.includes('Beta'))!;
    const control = within(beta).getByRole('button', { name: 'Control' });
    expect(control).toBeDisabled();
    expect(control).toHaveAccessibleDescription('Device is offline');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const alpha = rows().find((r) => r.textContent?.includes('Alpha'))!;
    fireEvent.click(within(alpha).getByRole('button', { name: 'Control' }));
    expect(navigate).toHaveBeenCalledWith('/devices/A/control');
    expect(within(alpha).getByRole('button', { name: 'Reserve' })).toBeInTheDocument();
    expect(within(alpha).getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });

  it('dims an offline row', () => {
    table();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const beta = rows().find((r) => r.textContent?.includes('Beta'))!;
    expect(beta).toHaveClass('is-offline');
  });
});
