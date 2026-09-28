import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../../interfaces/IDevice';

const MEMBER = { userId: 'me', email: 'me@acme.com', name: 'Me', role: 'MEMBER', teams: [] };
const auth = vi.hoisted(() => ({ me: null as any }));
vi.mock('../../../auth/auth-context', () => ({ useAuth: () => ({ me: auth.me ?? MEMBER }) }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const api = vi.hoisted(() => ({
  releaseReservation: vi.fn(),
  blockDevice: vi.fn(),
  unblockDevice: vi.fn(),
  setDeviceTeam: vi.fn().mockResolvedValue(undefined),
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

/** The element and its ancestors that carry an opacity below 1. */
const fadedAncestors = (el: Element) => {
  const out: Element[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (Number(getComputedStyle(n).opacity || 1) < 1) out.push(n);
  }
  return out;
};

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

  // A filter can narrow the list to one host while the rows are still sorted
  // by it. Hiding the column then left no header saying how the rows are
  // ordered, so Host stays while it is the sort.
  it('keeps Host, marked as the sort, while sorting by it with one host', () => {
    table({ sort: { key: 'host', dir: 'desc' } });
    expect(screen.getByRole('columnheader', { name: /Host/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: /Status/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const alpha = rows().find((r) => r.textContent?.includes('Alpha'))!;
    expect(within(alpha).getAllByRole('cell')[5]).toHaveAttribute('title', 'http://127.0.0.1:4723');
  });

  it('drops Host again with one host once another column is the sort', () => {
    table({ sort: { key: 'device', dir: 'asc' } });
    expect(screen.queryByRole('columnheader', { name: /Host/ })).toBeNull();
  });

  it('sorts by Host when its header button is clicked', () => {
    const onSortChange = vi.fn();
    table({
      devices: [...list, device({ udid: 'D', host: 'http://node-b:4723' })],
      onSortChange,
    });
    fireEvent.click(screen.getByRole('button', { name: /Host/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'host', dir: 'asc' });
  });

  it('gives the Platform, Team and Host cells a title with their full text', () => {
    table({ devices: [...list, device({ udid: 'D', host: 'http://node-b:4723' })] });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const gamma = rows().find((r) => r.textContent?.includes('Gamma'))!;
    // The Device cell is a rowheader, not a cell: getAllByRole('cell') no
    // longer includes it, so Platform is cells[0], not cells[1].
    const cells = within(gamma).getAllByRole('cell');
    expect(cells[1]).toHaveAttribute('title', 'iOS 17.0');
    expect(cells[3]).toHaveAttribute('title', 'QA');
    expect(cells[5]).toHaveAttribute('title', 'http://127.0.0.1:4723');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const alpha = rows().find((r) => r.textContent?.includes('Alpha'))!;
    expect(within(alpha).getAllByRole('cell')[3]).toHaveAttribute('title', 'Shared');
  });

  it('gives the Device cell a title with the name and UDID, while it is not being edited', () => {
    table();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const gamma = rows().find((r) => r.textContent?.includes('Gamma'))!;
    expect(within(gamma).getByRole('rowheader')).toHaveAttribute('title', 'Gamma\nC');
  });

  it('truncates the Status and Device cells one line at a time', () => {
    table();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const gamma = rows().find((r) => r.textContent?.includes('Gamma'))!;
    // The Device cell's title line and subtitle line are separate elements,
    // each carrying the truncation class, not one block truncated as a whole.
    const rowheader = within(gamma).getByRole('rowheader');
    const subtitle = rowheader.querySelector('.devtable-muted');
    expect(subtitle).not.toBeNull();
    expect(subtitle).toHaveClass('devtable-line');
    const titleLine = rowheader.querySelector('.devtable-line:not(.devtable-muted)');
    expect(titleLine).not.toBeNull();
    expect(titleLine).not.toBe(subtitle);
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
    expect(rows().map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
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
    expect(cells[1]).toHaveTextContent('iOS 17.0');
    expect(cells[2]).toHaveTextContent('Real');
    expect(cells[3]).toHaveTextContent('QA');
    expect(cells[4]).toHaveTextContent('#a');
    expect(cells[4]).toHaveTextContent('+1');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const alpha = rows().find((r) => r.textContent?.includes('Alpha'))!;
    expect(within(alpha).getAllByRole('cell')[3]).toHaveTextContent('Shared');
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

  // Faded to 0.55 the tags measured 3.2:1 (dark) and 2.6:1 (light). They take
  // the card's offline tag colour instead; the status dot still fades.
  it('keeps an offline row’s tags readable while its status dot fades', () => {
    const { container } = table({
      devices: [device({ udid: 'B', name: 'Beta', offline: true, tags: ['a', 'b', 'c'] })],
    });
    const tags = Array.from(container.querySelectorAll('.devtable-row.is-offline .devtable-tag'));
    expect(tags.map((t) => t.textContent)).toEqual(['#a', '#b', '+1']);
    for (const tag of tags) {
      expect(fadedAncestors(tag)).toEqual([]);
      expect(getComputedStyle(tag).color).toBe('var(--status-offline-tag)');
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(fadedAncestors(container.querySelector('.devtable-status-dot')!)).not.toEqual([]);
  });

  // The row's own Team-cell branch: not covered by device-card.test.tsx or
  // any live check, and its onDone handler is duplicated from the card.
  describe('assigning a team from a row, as an admin', () => {
    afterEach(() => {
      auth.me = null;
    });

    it('shows the TeamPicker in the row’s Team cell after Assign team…', () => {
      auth.me = { ...MEMBER, role: 'ADMIN' };
      table();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const alpha = rows().find((r) => r.textContent?.includes('Alpha'))!;
      fireEvent.click(within(alpha).getByRole('button', { name: 'More actions' }));
      // The menu renders through a portal, so it isn't inside the row.
      fireEvent.click(screen.getByRole('menuitem', { name: 'Assign team…' }));
      expect(within(alpha).getByRole('combobox', { name: 'Team' })).toBeInTheDocument();
    });

    it('assigns the picked team and reloads', async () => {
      auth.me = { ...MEMBER, role: 'ADMIN' };
      const reloadDevices = vi.fn();
      table({ reloadDevices });
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const alpha = rows().find((r) => r.textContent?.includes('Alpha'))!;
      fireEvent.click(within(alpha).getByRole('button', { name: 'More actions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Assign team…' }));
      fireEvent.change(within(alpha).getByRole('combobox', { name: 'Team' }), {
        target: { value: 't1' },
      });
      expect(api.setDeviceTeam).toHaveBeenCalledWith('A', 't1');
      await waitFor(() => expect(reloadDevices).toHaveBeenCalled());
      expect(within(alpha).queryByRole('combobox', { name: 'Team' })).toBeNull();
    });
  });
});
