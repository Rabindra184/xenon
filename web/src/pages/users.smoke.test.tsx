import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UsersPage from './users';

vi.mock('../api-service/users', () => ({
  listUsers: vi.fn().mockResolvedValue([]),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock('../api-service/auth', () => ({
  forgotPassword: vi.fn(),
}));

vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    me: {
      userId: 'me',
      role: 'SUPER_ADMIN',
      email: 'me@x.local',
      name: 'Me',
      accessKey: '',
      scopes: '',
      teamId: null,
      kind: 'user-session',
    },
    loading: false,
    refresh: async () => {},
    signOut: async () => {},
  }),
}));

describe('UsersPage smoke', () => {
  it('renders empty state when /users returns []', async () => {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/No users to show/i)).toBeInTheDocument());
    expect(screen.getByText(/Invite User/i)).toBeInTheDocument();
  });
});
