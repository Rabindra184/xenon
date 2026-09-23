import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './login';

// A plain function, not vi.fn(): the spy wrapper in this vitest version
// re-reports a rejected promise as an unhandled error even after the
// component has caught it, failing the test for the behaviour under test.
const auth = vi.hoisted(() => ({
  calls: [] as Array<[string, string]>,
  reject: null as Error | null,
}));
vi.mock('../api-service/auth', () => ({
  login: (email: string, password: string) => {
    auth.calls.push([email, password]);
    return auth.reject ? Promise.reject(auth.reject) : Promise.resolve();
  },
}));
vi.mock('../auth/auth-context', () => ({ useAuth: () => ({ refresh: async () => {} }) }));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    auth.calls = [];
    auth.reject = null;
  });

  it('links each label to its field', () => {
    renderLogin();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('toggles password visibility', () => {
    renderLogin();
    userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('announces a failed sign-in', async () => {
    auth.reject = new Error('Invalid email or password');
    renderLogin();
    userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    userEvent.type(screen.getByLabelText('Password'), 'nope');
    userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password'),
    );
    expect(auth.calls).toEqual([['a@b.co', 'nope']]);
  });
});
