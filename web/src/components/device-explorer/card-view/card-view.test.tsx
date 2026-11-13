import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { IDevice } from '../../../interfaces/IDevice';

const ADMIN = { userId: 'me', email: 'me@acme.com', name: 'Me', role: 'ADMIN', teams: [] };
vi.mock('../../../auth/auth-context', () => ({ useAuth: () => ({ me: ADMIN }) }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../api-service', () => ({
  default: { listTeams: vi.fn().mockResolvedValue([]) },
}));

import CardView from './card-view';

const phone = (host: string, name: string): IDevice =>
  ({
    name,
    host,
    udid: 'emulator-5554',
    sdk: '14',
    deviceType: 'emulator',
    offline: false,
    userBlocked: false,
    busy: false,
    platform: 'android',
    realDevice: false,
    session_id: null,
  }) as IDevice;

afterEach(() => {
  vi.restoreAllMocks();
});

// Each card is keyed by its phone, so what a card is doing (here, its team
// picker open) stays with that phone when the list changes order. Cards keyed
// by their place handed the open picker to whichever phone moved there.
describe('CardView', () => {
  it("keeps a card's state with its phone when the order changes", () => {
    const hub = phone('http://10.0.0.1:4723', 'Hub phone');
    const node = phone('http://10.0.0.2:4723', 'Node phone');
    const view = (devices: IDevice[]) => (
      <MemoryRouter>
        <CardView devices={devices} reloadDevices={vi.fn()} />
      </MemoryRouter>
    );
    const { container, rerender } = render(view([hub, node]));
    const cardOf = (name: string) =>
      (Array.from(container.querySelectorAll('.dc2')) as HTMLElement[]).find((c) =>
        c.textContent?.includes(name),
      ) as HTMLElement;

    fireEvent.click(within(cardOf('Node phone')).getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Assign team…' }));
    expect(
      within(cardOf('Node phone')).getByRole('combobox', { name: 'Team' }),
    ).toBeInTheDocument();

    rerender(view([node, hub]));
    expect(
      within(cardOf('Node phone')).getByRole('combobox', { name: 'Team' }),
    ).toBeInTheDocument();
    expect(within(cardOf('Hub phone')).queryByRole('combobox', { name: 'Team' })).toBeNull();
  });
});
