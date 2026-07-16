import * as React from 'react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { login } from '../api-service/auth';
import { useAuth } from '../auth/auth-context';
import { AuthShell } from './auth-shell';

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { refresh } = useAuth();
  const params = new URLSearchParams(loc.search);
  const next = params.get('next') || '/overview';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      await refresh();
      nav(next, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <form onSubmit={submit}>
        <h1 className="text-2xl font-semibold mb-1">Welcome back!</h1>
        <p className="text-sm text-[var(--text-dim)] mb-6">Sign in to your account</p>

        <label className="block text-xs text-[var(--text-dim)] mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
          className="w-full mb-4 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--green)] outline-none"
        />
        <label className="block text-xs text-[var(--text-dim)] mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full mb-2 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--green)] outline-none"
        />

        <div className="text-right mb-4">
          <Link to="/forgot-password" className="text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]">
            Forgot password?
          </Link>
        </div>

        {error && <div className="mt-3 text-xs text-[var(--red)]">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full h-10 rounded-md bg-[var(--green)] text-black font-medium text-sm disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
