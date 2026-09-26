import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../../interfaces/IDevice';

vi.mock('../../../auth/auth-context', () => ({
  useAuth: () => ({
    me: { userId: 'me', email: 'me@acme.com', name: 'Me', role: 'MEMBER', teams: [] },
  }),
}));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../api-service', () => ({ default: {} }));

import { DeviceCard } from './device-card';

const device = (over: Partial<IDevice> = {}): IDevice => ({
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
  batteryLevel: 80,
  thermalStatus: 'Normal',
  ...over,
});

const card = (over: Partial<IDevice> = {}) =>
  render(<DeviceCard device={device(over)} reloadDevices={vi.fn()} navigate={vi.fn()} />);

const control = () => screen.getByRole('button', { name: 'Control' }) as HTMLButtonElement;

describe('DeviceCard', () => {
  it('labels a device in maintenance as maintenance, not error', () => {
    const { container } = card({ userBlocked: true });
    expect(container.querySelector('.dc2-header')).toHaveTextContent(/maintenance/i);
    expect(container.querySelector('.dc2-header')).not.toHaveTextContent(/error/i);
  });

  it('disables Control on an offline device and says why, on the card', () => {
    card({ offline: true });
    expect(control().disabled).toBe(true);
    expect(screen.getByText('Device is offline')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reserve' })).toBeNull();
  });

  it('never shows the internal lock id of another user’s live control', () => {
    const { container } = card({ busy: true, session_id: 'manual_u42_U1' });
    expect(container).not.toHaveTextContent('manual_');
    expect(container).toHaveTextContent('Live control by another user');
    expect(control().disabled).toBe(true);
  });

  it('describes a reservation in words', () => {
    const { container } = card({
      reservedBy: 'priya@acme.com',
      reservedUntil: Date.now() + 46 * 60_000 + 30_000,
    });
    expect(container).toHaveTextContent('46m left · by priya@acme.com');
    expect(container).not.toHaveTextContent('RES ·');
  });
});
