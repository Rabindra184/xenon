import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Teams } from './teams';
import { ToastProvider } from '../ui/toast';

/**
 * A team's phones in Teams settings. A hub and its node can both list
 * emulator-5554, so the shared-pool menu offers each phone on its own and the
 * move names the phone's server.
 */
const H1 = 'http://10.0.4.21:4723';
const H2 = 'http://10.0.4.22:4723';
const TEAM = {
  id: 't1',
  name: 'Payments',
  createdAt: '2026-11-01T00:00:00Z',
  deviceCount: 1,
  memberCount: 0,
};

const DEVICES = [
  { udid: 'emulator-5554', host: H1, name: 'Hub phone', platform: 'android', teamId: null },
  { udid: 'emulator-5554', host: H2, name: 'Node phone', platform: 'android', teamId: null },
  { udid: 'emulator-5556', host: H1, name: 'Team phone', platform: 'android', teamId: 't1' },
  { udid: 'emulator-5556', host: H2, name: 'Other team phone', platform: 'android', teamId: 't1' },
];

let calls: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url === '/xenon/api/teams') return json([TEAM]);
      if (url === '/xenon/api/teams/t1/members') return json([]);
      if (url.startsWith('/xenon/api/users')) return json([]);
      if (url === '/xenon/api/device') return json(DEVICES);
      return json({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const openTeam = async () => {
  render(
    <ToastProvider>
      <Teams />
    </ToastProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Payments/ }));
  await screen.findByText(/Devices \(2\)/);
};

const puts = () => calls.filter((c) => c.init?.method === 'PUT');

describe('Teams settings: phones', () => {
  it('offers both phones of one udid, each with its own value and key', async () => {
    const error = vi.spyOn(console, 'error');
    await openTeam();
    const select = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    const hub = within(select).getByRole('option', { name: /Hub phone/ }) as HTMLOptionElement;
    const node = within(select).getByRole('option', { name: /Node phone/ }) as HTMLOptionElement;
    expect(hub.value).not.toBe(node.value);
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/);
  });

  it("assigns the phone picked, sending its server's host", async () => {
    await openTeam();
    const select = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    const node = within(select).getByRole('option', { name: /Node phone/ }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: node.value } });
    fireEvent.click(screen.getByRole('button', { name: /Assign/ }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].url).toBe('/xenon/api/device/emulator-5554/team');
    expect(JSON.parse(String(puts()[0].init?.body))).toEqual({ teamId: 't1', host: H2 });
  });

  it("names the server of each of the team's phones whose udid another has", async () => {
    await openTeam();
    const team = screen.getByText('Team phone').closest('tr') as HTMLElement;
    const other = screen.getByText('Other team phone').closest('tr') as HTMLElement;
    expect(team).toHaveTextContent('Team phone on 10.0.4.21:4723');
    expect(other).toHaveTextContent('Other team phone on 10.0.4.22:4723');
  });

  it("returns a team's phone to the shared pool by its server's host", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openTeam();
    const row = screen.getByText('Other team phone').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Return to shared pool' }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].url).toBe('/xenon/api/device/emulator-5556/team');
    expect(JSON.parse(String(puts()[0].init?.body))).toEqual({ teamId: null, host: H2 });
  });
});
