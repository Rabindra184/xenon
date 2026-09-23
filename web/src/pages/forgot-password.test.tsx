import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ForgotPasswordPage from './forgot-password';

const opts = vi.hoisted(() => ({ mode: 'email' as 'email' | 'admin' }));
vi.mock('../api-service/auth', () => ({
  getAuthOptions: () => Promise.resolve({ passwordReset: opts.mode }),
  forgotPassword: () => Promise.resolve(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    opts.mode = 'email';
  });

  it('shows the email form when the server can send email', async () => {
    renderPage();
    expect(await screen.findByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
  });

  it('explains the admin route instead of a form that emails nothing', async () => {
    opts.mode = 'admin';
    renderPage();
    expect(await screen.findByText(/can't send email/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send reset link' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });
});
