import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProfilePage from './profile-page';

vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({
    me: { userId: 'me', role: 'MEMBER', email: 'me@x.local', name: 'Me', accessKey: '', scopes: '', teamId: null, teams: [], kind: 'user-session' },
    loading: false,
    refresh: async () => {},
    signOut: async () => {},
  }),
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
