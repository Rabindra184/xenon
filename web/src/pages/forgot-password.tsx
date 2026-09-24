import * as React from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api-service/auth';
import { usePasswordResetMode } from '../auth/use-password-reset-mode';
import { AuthShell } from './auth-shell';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = usePasswordResetMode();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await forgotPassword(email);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  // Without SMTP the form would accept an email and promise a link that only
  // ever reaches the server log. Say who can actually help instead.
  if (mode !== 'email') {
    return (
      <AuthShell>
        <h1 className="text-2xl font-semibold mb-1">Forgot password?</h1>
        {mode === 'admin' && (
          <p className="text-sm text-[var(--text-muted)] mb-6">
            This Xenon server can't send email, so passwords are reset by an administrator.
            Ask a Xenon admin to send you a reset link from the Users page.
          </p>
        )}
        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm text-[var(--color-accent)] underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={submit}>
        <h1 className="text-2xl font-semibold mb-1">Forgot password?</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">
          Enter your email and we'll send you a reset link if your account exists.
        </p>

        {submitted ? (
          <div className="text-sm text-[var(--text)] mb-6">
            If your email is registered, you'll receive a reset link shortly.
            Check your spam folder if you don't see it within a minute.
          </div>
        ) : (
          <>
            <label htmlFor="forgot-email" className="block text-sm font-medium text-[var(--text)] mb-1.5">
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
              className="w-full mb-4 h-10 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border-strong)] text-sm text-[var(--text)] outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--accent-subtle)]"
            />
            {error && <div role="alert" className="text-sm text-[var(--red)] mb-3">{error}</div>}
            <button
              type="submit"
              disabled={submitting || !email}
              className="mt-5 w-full h-10 rounded-md bg-[var(--color-accent)] text-black font-medium text-sm disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}

        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm text-[var(--color-accent)] underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
