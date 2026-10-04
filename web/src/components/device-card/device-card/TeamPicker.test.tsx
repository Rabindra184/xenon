import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../../interfaces/IDevice';

// The real api-service, toast and device card; only the network is faked.
const ADMIN = { userId: 'me', email: 'me@acme.com', name: 'Me', role: 'ADMIN', teams: [] };
vi.mock('../../../auth/auth-context', () => ({ useAuth: () => ({ me: ADMIN }) }));

import { DeviceCard } from './device-card';
import { ToastProvider } from '../../ui/toast';

const device = (over: Partial<IDevice> = {}): IDevice => ({
  name: 'Galaxy',
  host: 'http://127.0.0.1:4723',
  udid: 'U 1',
  sdk: '14',
  deviceType: 'real',
  offline: false,
  userBlocked: false,
  busy: false,
  platform: 'android',
  realDevice: true,
  session_id: null,
  teamId: null,
  ...over,
});

/**
 * The one route that assigns a team, as the server serves it: at the API
 * root, `PUT /xenon/api/device/:udid/team` (src/app/routers/grid.ts, the
 * `assignGridDeviceTeam` operation). Anything else is the 404 a missing route
 * gives, which is what the picker got when it called `/xenon/api/grid/...`.
 */
function fakeServer(answer: { status: number; body?: unknown } = { status: 200 }) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(url);
    calls.push({ method, url: path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'PUT' && /^\/xenon\/api\/device\/[^/]+\/team$/.test(path)) {
      return new Response(JSON.stringify(answer.body ?? { ok: true, updated: 1 }), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  });
  return { fn, calls };
}

const teams = new Map([
  ['t1', 'QA'],
  ['t2', 'Checkout'],
]);

function renderCard(over: Partial<IDevice> = {}) {
  const reloadDevices = vi.fn();
  render(
    <ToastProvider>
      <DeviceCard
        device={device(over)}
        reloadDevices={reloadDevices}
        navigate={vi.fn()}
        teams={teams}
      />
    </ToastProvider>,
  );
  return { reloadDevices };
}

/** ⋯ menu, then Assign team…, as an admin does. */
function openTeamPicker() {
  fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Assign team…' }));
  return screen.getByRole('combobox', { name: 'Team' }) as HTMLSelectElement;
}

describe('assigning a team from a device card', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sends the pick to the route the server serves, with the udid encoded', async () => {
    const server = fakeServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;
    const { reloadDevices } = renderCard();

    fireEvent.change(openTeamPicker(), { target: { value: 't1' } });

    await waitFor(() => expect(reloadDevices).toHaveBeenCalled());
    expect(server.calls).toEqual([
      { method: 'PUT', url: '/xenon/api/device/U%201/team', body: { teamId: 't1' } },
    ]);
    expect(await screen.findByText('Device assigned')).toBeInTheDocument();
  });

  it('returns the device to the shared pool with a null team', async () => {
    const server = fakeServer();
    globalThis.fetch = server.fn as unknown as typeof fetch;
    const { reloadDevices } = renderCard({ teamId: 't1' });

    fireEvent.change(openTeamPicker(), { target: { value: '' } });

    await waitFor(() => expect(reloadDevices).toHaveBeenCalled());
    expect(server.calls).toEqual([
      { method: 'PUT', url: '/xenon/api/device/U%201/team', body: { teamId: null } },
    ]);
    expect(await screen.findByText('Device returned to shared pool')).toBeInTheDocument();
  });

  it('says what the server said when it refuses, and does not reload', async () => {
    const server = fakeServer({ status: 404, body: { error: 'team not found' } });
    globalThis.fetch = server.fn as unknown as typeof fetch;
    const { reloadDevices } = renderCard();

    fireEvent.change(openTeamPicker(), { target: { value: 't2' } });

    expect(await screen.findByText('team not found')).toBeInTheDocument();
    expect(reloadDevices).not.toHaveBeenCalled();
  });
});
