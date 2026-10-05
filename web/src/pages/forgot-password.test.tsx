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

  // 'admin' means the server has no mail set up, or no address to put in the
  // link (XENON_PUBLIC_URL). The text must hold for both, so it says the
  // server doesn't email reset links rather than that it can't send email.
  it('explains the admin route instead of a form that emails nothing', async () => {
    opts.mode = 'admin';
    renderPage();
    expect(
      await screen.findByText(/This Xenon server isn't set up to email reset links/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/can't send email/)).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send reset link' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });
});
