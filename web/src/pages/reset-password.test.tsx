import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ResetPasswordPage from './reset-password';

const TOKEN = 'RAWTOKEN_fragment_abc123';
// Plain function, not vi.fn(): see login.test.tsx.
const api = vi.hoisted(() => ({ checked: [] as string[] }));
vi.mock('../api-service/auth', () => ({
  checkResetToken: (t: string) => {
    api.checked.push(t);
    return Promise.resolve(true);
  },
  resetPassword: () => Promise.resolve(),
}));

function renderAt(routerPath: string) {
  return render(
    <MemoryRouter initialEntries={[routerPath]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ResetPasswordPage token handling', () => {
  beforeEach(() => {
    api.checked = [];
  });

  it('reads the token from the fragment and removes it from the address bar', async () => {
    window.history.replaceState(null, '', `/xenon/reset-password#${TOKEN}`);
    renderAt('/reset-password');

    expect(await screen.findByText('Reset your password')).toBeInTheDocument();
    expect(api.checked).toEqual([TOKEN]);
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.pathname).toBe('/xenon/reset-password');
  });

  it('still accepts a pre-1.20.7 link with the token in the path', async () => {
    window.history.replaceState(null, '', `/xenon/reset-password/${TOKEN}`);
    renderAt(`/reset-password/${TOKEN}`);

    expect(await screen.findByText('Reset your password')).toBeInTheDocument();
    expect(api.checked).toEqual([TOKEN]);
    expect(window.location.href).not.toContain(TOKEN);
  });
});
