import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

// Who /auth/me says is signed in: nobody until the form signs in.
const auth = vi.hoisted(() => ({ signedIn: false }));
vi.mock('../../api-service/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api-service/auth')>();
  return {
    ...real,
    getAuthOptions: async () => ({ passwordReset: 'admin' }),
    getMe: async () =>
      auth.signedIn
        ? {
            userId: 'u1',
            email: 'tess@lab.example',
            name: 'Tess',
            role: 'MEMBER',
            accessKey: 'ak',
            scopes: 'devices,sessions,read',
            teamId: null,
            kind: 'user-session',
            teams: [],
          }
        : null,
    login: async () => {
      auth.signedIn = true;
    },
    logout: async () => {},
  };
});
const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../api-service', () => ({
  default: { getOAuthConsent: api.read, answerOAuthConsent: vi.fn() },
}));

import { AuthProvider } from '../../auth/auth-context';
import { TopLevelRoutes } from '../../App';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

describe('the consent page route', () => {
  beforeEach(() => {
    auth.signedIn = false;
    localStorage.clear();
    api.read.mockReset().mockResolvedValue({
      ok: true,
      request: {
        requestId: 'req-1',
        client: { id: 'c1', name: 'Claude Code' },
        hub: 'https://xenon.example.com',
        redirectUri: 'http://127.0.0.1:47831/callback',
        scopes: ['xenon:devices:read'],
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    });
  });

  it('sends a signed-out visitor to sign in, then back to the consent page', async () => {
    render(
      <MemoryRouter initialEntries={['/oauth/consent/req-1']}>
        <AuthProvider>
          <TopLevelRoutes />
          <Where />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/login?next=%2Foauth%2Fconsent%2Freq-1',
      ),
    );
    userEvent.type(await screen.findByLabelText('Email'), 'tess@lab.example');
    userEvent.type(screen.getByLabelText('Password'), 'secret');
    userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByRole('heading', { name: 'Allow Claude Code to use Xenon?' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/oauth/consent/req-1');
    expect(api.read).toHaveBeenCalledWith('req-1');
  });

  it('shows a signed-in visitor the consent page on its own, without the dashboard around it', async () => {
    auth.signedIn = true;
    render(
      <MemoryRouter initialEntries={['/oauth/consent/req-1']}>
        <AuthProvider>
          <TopLevelRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Allow Claude Code to use Xenon?' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });
});
