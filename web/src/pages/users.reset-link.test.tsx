import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import UsersPage from './users';

const LINK = 'http://lab.local/xenon/reset-password/RAWTOKEN123';
// Plain functions, not vi.fn(): see login.test.tsx for why.
const api = vi.hoisted(() => ({
  result: null as any,
  calls: [] as string[],
}));
vi.mock('../api-service/users', () => ({
  listUsers: () =>
    Promise.resolve([
      { id: 'me', email: 'me@x.local', name: 'Me', role: 'SUPER_ADMIN', status: 'ACTIVE' },
      { id: 'm1', email: 'm@x.local', name: 'Mem', role: 'MEMBER', status: 'ACTIVE' },
    ]),
  createUser: () => Promise.resolve(),
  updateUser: () => Promise.resolve(),
  deleteUser: () => Promise.resolve(),
  createResetLink: (id: string) => {
    api.calls.push(id);
    return Promise.resolve(api.result);
  },
}));
vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({ me: { userId: 'me', role: 'SUPER_ADMIN' }, loading: false }),
}));

function resetButtons() {
  return screen.getAllByRole('button', { name: 'Reset password' });
}

describe('Users page — reset password', () => {
  const alerts: string[] = [];
  beforeEach(() => {
    api.calls = [];
    alerts.length = 0;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation((m?: unknown) => {
      alerts.push(String(m));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the link once when the server could not email it', async () => {
    api.result = { emailed: false, link: LINK, expiresAt: '2026-09-23T18:00:00Z' };
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );
    await screen.findByText('m@x.local');

    userEvent.click(resetButtons()[1]);

    expect(await screen.findByRole('dialog')).toHaveTextContent('Password-reset link');
    expect(screen.getByText(LINK)).toBeInTheDocument();
    expect(api.calls).toEqual(['m1']);
    expect(alerts).toEqual([]);
  });

  it('just confirms when the server emailed it', async () => {
    api.result = { emailed: true, expiresAt: '2026-09-23T18:00:00Z' };
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );
    await screen.findByText('m@x.local');

    userEvent.click(resetButtons()[1]);

    await vi.waitFor(() =>
      expect(alerts).toEqual(['A password-reset link was emailed to m@x.local.']),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables reset on your own row', async () => {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );
    await screen.findByText('me@x.local');
    expect(resetButtons()[0]).toBeDisabled();
    expect(resetButtons()[1]).toBeEnabled();
  });
});
