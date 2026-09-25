import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LoginPage from './login';

// A plain function, not vi.fn(): the spy wrapper in this vitest version
// re-reports a rejected promise as an unhandled error even after the
// component has caught it, failing the test for the behaviour under test.
const auth = vi.hoisted(() => ({
  calls: [] as Array<[string, string]>,
  reject: null as Error | null,
  resetMode: 'email' as 'email' | 'admin',
  me: null as null | { authDisabled?: boolean },
}));
vi.mock('../api-service/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api-service/auth')>();
  return {
    LoginError: real.LoginError,
    getAuthOptions: () => Promise.resolve({ passwordReset: auth.resetMode }),
    login: (email: string, password: string) => {
      auth.calls.push([email, password]);
      return auth.reject ? Promise.reject(auth.reject) : Promise.resolve();
    },
  };
});
vi.mock('../auth/auth-context', () => ({ useAuth: () => ({ refresh: async () => {}, me: auth.me }) }));

import { LoginError } from '../api-service/auth';

function renderLogin(url = '/login') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

function signIn() {
  userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
  userEvent.type(screen.getByLabelText('Password'), 'nope');
  userEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    auth.calls = [];
    auth.reject = null;
    auth.resetMode = 'email';
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
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

  it('shows a readable message instead of the raw server string', async () => {
    auth.reject = new LoginError('invalid credentials', 401);
    renderLogin();
    signIn();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password.'),
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('invalid credentials');
    expect(auth.calls).toEqual([['a@b.co', 'nope']]);
  });

  it('counts down a rate limit and re-enables sign-in when it ends', async () => {
    // Fake only the clock and the interval, so promises and waitFor still
    // run on real time while the countdown is driven by hand.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    auth.reject = new LoginError('too many login attempts', 429, 3);
    renderLogin();
    signIn();
    const button = await screen.findByRole('button', { name: 'Try again in 3s' });
    expect(button).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many sign-in attempts. Try again in 3s.',
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: /Try again in [12]s/ })).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains an expired session and clears the hint', () => {
    localStorage.setItem('xenon.hadSession', '1');
    renderLogin('/login?next=%2Fdevices&reason=expired');
    expect(screen.getByRole('status')).toHaveTextContent('Your session has expired.');
    expect(localStorage.getItem('xenon.hadSession')).toBeNull();
  });

  it('shows no expiry notice on a normal visit', () => {
    renderLogin('/login?next=%2Fdevices');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers self-service reset only when the server can email', async () => {
    renderLogin();
    expect(await screen.findByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.queryByText(/Ask a Xenon administrator/)).toBeNull();
  });

  it('sends people to an administrator when the server cannot email', async () => {
    auth.resetMode = 'admin';
    renderLogin();
    expect(await screen.findByText(/Ask a Xenon administrator/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Forgot password?' })).toBeNull();
  });

  it('warns while Caps Lock is on in the password field', () => {
    renderLogin();
    const pw = screen.getByLabelText('Password');
    fireEvent.keyUp(pw, { key: 'A', modifierCapsLock: true });
    expect(screen.getByText('Caps Lock is on')).toBeInTheDocument();
    expect(pw).toHaveAttribute('aria-describedby', 'login-capslock');
    fireEvent.blur(pw);
    expect(screen.queryByText('Caps Lock is on')).toBeNull();
  });
});

describe('LoginPage with auth disabled', () => {
  afterEach(() => {
    auth.me = null;
  });

  it('goes straight to where the visitor was headed; there is no account to sign in to', () => {
    auth.me = { authDisabled: true };
    render(
      <MemoryRouter initialEntries={['/login?next=/devices']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/devices" element={<div>devices page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('devices page')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });
});
