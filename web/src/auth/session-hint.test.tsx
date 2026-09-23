import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from './auth-context';
import { RouteGuard } from './route-guard';

const me = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../api-service/auth', () => ({
  getMe: () => Promise.resolve(me.value),
  logout: () => Promise.resolve(),
  login: () => Promise.resolve(),
}));

function LoginProbe() {
  const loc = useLocation();
  return <div data-testid="login">{loc.search}</div>;
}

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/devices']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route
            path="*"
            element={
              <RouteGuard>
                <div>SHELL</div>
              </RouteGuard>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('session-expired hint', () => {
  beforeEach(() => {
    localStorage.clear();
    me.value = null;
  });

  it('marks the browser as having had a session once signed in', async () => {
    me.value = { userId: 'u1' };
    renderGuarded();
    await waitFor(() => expect(screen.getByText('SHELL')).toBeInTheDocument());
    expect(localStorage.getItem('xenon.hadSession')).toBe('1');
  });

  it('redirects with reason=expired when a previous session is gone', async () => {
    localStorage.setItem('xenon.hadSession', '1');
    renderGuarded();
    await waitFor(() =>
      expect(screen.getByTestId('login')).toHaveTextContent('?next=%2Fdevices&reason=expired'),
    );
  });

  it('redirects without a reason on a first visit', async () => {
    renderGuarded();
    await waitFor(() => expect(screen.getByTestId('login')).toHaveTextContent('?next=%2Fdevices'));
    expect(screen.getByTestId('login')).not.toHaveTextContent('reason');
  });
});
