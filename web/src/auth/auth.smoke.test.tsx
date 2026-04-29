import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth-context';
import { RouteGuard } from './route-guard';

vi.mock('../api-service/auth', () => ({
  getMe: vi.fn().mockResolvedValue(null),
  logout: vi.fn(),
  login: vi.fn(),
}));

describe('RouteGuard', () => {
  it('redirects to /login when /auth/me returns null', async () => {
    render(
      <MemoryRouter initialEntries={['/devices']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div>LOGIN</div>} />
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
    await waitFor(() => expect(screen.getByText('LOGIN')).toBeInTheDocument());
  });
});
