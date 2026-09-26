import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../../interfaces/IDevice';

const MEMBER = { userId: 'me', email: 'me@acme.com', name: 'Me', role: 'MEMBER', teams: [] };
const auth = vi.hoisted(() => ({ me: null as any }));
vi.mock('../../../auth/auth-context', () => ({ useAuth: () => ({ me: auth.me ?? MEMBER }) }));
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
    expect(container.querySelector('.dc2-band')).toHaveTextContent(/maintenance/i);
    expect(container.querySelector('.dc2-band')).not.toHaveTextContent(/error/i);
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

  it('puts the state and what the device is doing in the band', () => {
    const { container } = card({
      busy: true,
      session_id: 'abc',
      sessionStartTime: Date.now() - 12 * 60_000,
    });
    const band = container.querySelector('.dc2-band') as HTMLElement;
    expect(band).toHaveClass('dc2-band-busy');
    expect(band).toHaveTextContent('Busy');
    expect(band).toHaveTextContent('Test session · 12m');
  });

  it('shows the friendly name and maker · model · OS', () => {
    const { container } = card({
      marketingName: 'Galaxy S9+',
      manufacturer: 'samsung',
      model: 'SM-G965F',
      sdk: '10',
    });
    expect(container.querySelector('.dc2-title')).toHaveTextContent('Galaxy S9+');
    expect(container.querySelector('.dc2-subtitle')).toHaveTextContent(
      'Samsung SM-G965F · Android 10',
    );
  });

  it('falls back to today’s name when the device reported none', () => {
    const { container } = card({ name: 'star2ltexx' });
    expect(container.querySelector('.dc2-title')).toHaveTextContent('star2ltexx');
  });

  // The UDID, server URL and IP moved into the ⋯ menu; "Time in use" had no
  // period the server could name.
  it('keeps the UDID in the name’s tooltip, not on the card face', () => {
    const { container } = card({ udid: '381103b720057ece' });
    expect(container.querySelector('.dc2-title')?.getAttribute('title')).toContain(
      '381103b720057ece',
    );
    expect(container.querySelector('.dc2-body')).not.toHaveTextContent('381103b7');
    expect(container).not.toHaveTextContent('Server');
    expect(container).not.toHaveTextContent('Network');
    expect(container).not.toHaveTextContent('Time in use');
  });

  it('dims an offline device’s details', () => {
    const { container } = card({ offline: true });
    expect(container.querySelector('.dc2-body')).toHaveClass('dc2-dim');
  });

  // They were on nearly every card, so they said nothing.
  it('drops the Real and Shared labels', () => {
    const { container } = card();
    expect(container).not.toHaveTextContent('Real');
    expect(container).not.toHaveTextContent('Shared');
  });

  // Control was a grey outline and Reserve a borderless ghost: both read as
  // plain text rather than buttons.
  it('draws Control in the accent colour and Reserve as a button', () => {
    card();
    expect(control()).toHaveClass('btn-tonal');
    expect(screen.getByRole('button', { name: 'Reserve' })).toHaveClass('btn-secondary');
  });

  it('draws Release as a button too', () => {
    card({ reservedBy: 'priya@acme.com', reservedUntil: Date.now() + 60 * 60_000 });
    expect(screen.getByRole('button', { name: 'Release' })).toHaveClass('btn-secondary');
  });

  describe('the ⋯ menu', () => {
    afterEach(() => {
      auth.me = null;
    });

    const menuItems = () => {
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      return screen.getAllByRole('menuitem').map((m) => m.textContent?.trim());
    };

    it('gives a member the copy actions only', () => {
      card({ ip: '192.168.0.100' });
      expect(menuItems()).toEqual([
        'Copy UDID',
        'Copy server URL',
        'Copy IP address',
        'Copy capabilities',
      ]);
    });

    // Tags, maintenance and teams are admin-only on the server: a member who
    // picked them got a 403.
    it('adds tags, team and maintenance for an admin', () => {
      auth.me = { ...MEMBER, role: 'ADMIN' };
      card({ ip: '192.168.0.100' });
      expect(menuItems()).toEqual([
        'Copy UDID',
        'Copy server URL',
        'Copy IP address',
        'Copy capabilities',
        'Manage tags…',
        'Assign team…',
        'Enter maintenance',
      ]);
    });

    // The clickable team chip is gone; admins reach the same picker here.
    it('opens the team picker from Assign team…', () => {
      auth.me = { ...MEMBER, role: 'ADMIN' };
      card();
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Assign team…' }));
      expect(screen.getByRole('combobox', { name: 'Team' })).toBeInTheDocument();
    });

    // The old Network row only ever showed a valid IPv4, never a MAC address.
    it('offers Copy IP address only for a valid address', () => {
      card({ ip: 'a4:83:e7:12:34:56' });
      expect(menuItems()).not.toContain('Copy IP address');
    });
  });
});
