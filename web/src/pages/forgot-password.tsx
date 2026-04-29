import * as React from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api-service/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <form onSubmit={submit} className="w-full max-w-sm px-6">
        <h1 className="text-2xl font-semibold mb-1">Forgot password?</h1>
        <p className="text-sm text-[var(--text-dim)] mb-6">
          Enter your email and we'll send you a reset link if your account exists.
        </p>

        {submitted ? (
          <div className="text-sm text-[var(--text)] mb-6">
            If your email is registered, you'll receive a reset link shortly.
            Check your spam folder if you don't see it within a minute.
          </div>
        ) : (
          <>
            <label className="block text-xs text-[var(--text-dim)] mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
              className="w-full mb-4 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--green)] outline-none"
            />
            {error && <div className="text-xs text-[var(--red)] mb-3">{error}</div>}
            <button
              type="submit"
              disabled={submitting || !email}
              className="w-full h-10 rounded-md bg-[var(--green)] text-black font-medium text-sm disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}

        <div className="mt-6 text-center">
          <Link to="/login" className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">
            Back to sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
