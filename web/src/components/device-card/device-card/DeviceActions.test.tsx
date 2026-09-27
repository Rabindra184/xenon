import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../../interfaces/IDevice';

const MEMBER = { userId: 'me', email: 'me@acme.com', name: 'Me', role: 'MEMBER', teams: [] };
const ADMIN = { ...MEMBER, role: 'ADMIN' };
const auth = vi.hoisted(() => ({ me: null as any }));
vi.mock('../../../auth/auth-context', () => ({ useAuth: () => ({ me: auth.me ?? MEMBER }) }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const api = vi.hoisted(() => ({
  releaseReservation: vi.fn(),
  blockDevice: vi.fn(),
  unblockDevice: vi.fn(),
}));
vi.mock('../../../api-service', () => ({ default: api }));

import { DeviceControlButtons, DeviceMoreMenu, useDeviceActions } from './DeviceActions';

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

function Host({
  d,
  navigate = vi.fn(),
  reload = vi.fn(),
}: {
  d: IDevice;
  navigate?: any;
  reload?: any;
}) {
  const actions = useDeviceActions(d, reload);
  return (
    <>
      <DeviceControlButtons device={d} actions={actions} navigate={navigate} />
      <DeviceMoreMenu device={d} actions={actions} />
      {actions.dialogs}
    </>
  );
}

describe('DeviceActions', () => {
  it('opens a ready device and offers Reserve', () => {
    const navigate = vi.fn();
    render(<Host d={device()} navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    expect(navigate).toHaveBeenCalledWith('/devices/U1/control');
    expect(screen.getByRole('button', { name: 'Reserve' })).toBeInTheDocument();
  });

  it('offers Release on a reserved device', () => {
    render(<Host d={device({ reservedUntil: Date.now() + 60_000, reservedBy: 'x' } as any)} />);
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
  });

  it('disables Control with the reason on an offline device', () => {
    render(<Host d={device({ offline: true })} />);
    expect(screen.getByRole('button', { name: 'Control' })).toBeDisabled();
  });

  it('shows the admin items in More only to admins', () => {
    auth.me = MEMBER;
    const { unmount } = render(<Host d={device()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: /Copy UDID/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Manage tags/ })).toBeNull();
    unmount();
    auth.me = ADMIN;
    render(<Host d={device()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: /Manage tags/ })).toBeInTheDocument();
    auth.me = null;
  });
});
