import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProfilePage from './profile-page';

const MEMBER = { userId: 'me', role: 'MEMBER', email: 'me@x.local', name: 'Me', accessKey: '', scopes: '', teamId: null, teams: [], kind: 'user-session' };
const auth = vi.hoisted(() => ({ me: null as any }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ me: auth.me, loading: false, refresh: async () => {}, signOut: async () => {} }),
}));
vi.mock('../../api-service/auth', () => ({ changePassword: vi.fn() }));
vi.mock('../../api-service/profile', () => ({
  listTokens: vi.fn().mockResolvedValue([]),
  createToken: vi.fn(),
  deleteToken: vi.fn(),
  getAccessKey: vi.fn().mockResolvedValue('AK'),
  rotateAccessKey: vi.fn(),
}));

describe('ProfilePage views', () => {
  beforeEach(() => {
    auth.me = MEMBER;
  });

  it('marks the open view as current, not just by colour', () => {
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );
    const password = screen.getByRole('button', { name: 'Password & authentication' });
    const tokens = screen.getByRole('button', { name: 'API tokens' });
    expect(password).toHaveAttribute('aria-current', 'page');
    expect(tokens).not.toHaveAttribute('aria-current');

    fireEvent.click(tokens);
    expect(tokens).toHaveAttribute('aria-current', 'page');
    expect(password).not.toHaveAttribute('aria-current');
  });
});

describe('ProfilePage with auth disabled', () => {
  it('has no password view (there is no account password) and opens on API tokens', () => {
    auth.me = { ...MEMBER, userId: 'auth-disabled', name: 'Auth Disabled', role: 'SUPER_ADMIN', authDisabled: true };
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Password & authentication' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Update password' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API tokens' })).toHaveAttribute('aria-current', 'page');
  });
});
