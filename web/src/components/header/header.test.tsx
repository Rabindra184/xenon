import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Header from './header';

const auth = vi.hoisted(() => ({ me: null as any, signOut: vi.fn() }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ me: auth.me, signOut: auth.signOut }) }));
vi.mock('../../hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ tone: 'live', label: 'Live', title: 'Connected' }),
}));

const ME = { userId: 'u1', email: 'a@x.local', name: 'Ada', role: 'ADMIN', accessKey: '', scopes: '', teamId: null, kind: 'user-session', teams: [] };

function openMenu() {
  render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { expanded: false }));
}

afterEach(() => {
  auth.me = null;
  auth.signOut.mockReset();
});

describe('Header account menu', () => {
  it('offers Logout to a signed-in user', () => {
    auth.me = { ...ME, authDisabled: false };
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('has no Logout when auth is disabled, and says why', () => {
    auth.me = { ...ME, userId: 'auth-disabled', name: 'Auth Disabled', role: 'SUPER_ADMIN', authDisabled: true };
    openMenu();
    expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
    expect(screen.getByText('Sign-in is off on this server.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument();
  });
});
