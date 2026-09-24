import * as React from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { checkResetToken, resetPassword } from '../api-service/auth';
import { AuthShell } from './auth-shell';

/**
 * The token arrives in the URL fragment (#…), which browsers never send to
 * the server, so it can't reach a server log. Links issued before 1.20.7 put
 * it in the path instead; those still work.
 */
function readToken(pathToken: string | undefined): string | undefined {
  const fromHash = window.location.hash.replace(/^#/, '');
  return fromHash || pathToken || undefined;
}

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  // Read once: the effect below strips it from the address bar.
  const [token] = useState(() => readToken(params.token));
  const nav = useNavigate();
  const [state, setState] = useState<'checking' | 'invalid' | 'ready' | 'submitting' | 'done'>(
    'checking',
  );
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Take the token out of the address bar and browser history — a
  // credential shouldn't sit in either. replaceState, not a router
  // navigation, so this page doesn't remount and lose it.
  useEffect(() => {
    if (window.location.hash || params.token) {
      window.history.replaceState(null, '', `${import.meta.env.BASE_URL}reset-password`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }
    checkResetToken(token).then((ok) => setState(ok ? 'ready' : 'invalid'));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (pw.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setState('submitting');
    try {
      await resetPassword(token!, pw);
      setState('done');
      setTimeout(() => nav('/login', { replace: true }), 1500);
    } catch (err: any) {
      setError(err.message || 'Reset failed');
      setState('ready');
    }
  }

  if (state === 'checking') {
    return (
      <AuthShell>
        <div className="text-sm text-[var(--text-muted)] text-center">Checking link…</div>
      </AuthShell>
    );
  }
  if (state === 'invalid') {
    return (
      <AuthShell>
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-3">This link is invalid or expired</h1>
          <p className="text-sm text-[var(--text-muted)] mb-6">
            Reset links are good for 1 hour and single-use. Request a new one.
          </p>
          <Link
            to="/forgot-password"
            className="inline-block h-10 px-4 rounded-md bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-medium leading-10"
          >
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }
  if (state === 'done') {
    return (
      <AuthShell>
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-3">Password updated</h1>
          <p className="text-sm text-[var(--text-muted)]">Redirecting to sign in…</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={submit}>
        <h1 className="text-2xl font-semibold mb-1">Reset your password</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">Choose a new password to sign in with.</p>

        <label htmlFor="reset-password" className="block text-sm font-medium text-[var(--text)] mb-1.5">
          New password
        </label>
        <input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          required
          className="w-full mb-3 h-10 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border-strong)] text-sm text-[var(--text)] outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--accent-subtle)]"
        />
        <label htmlFor="reset-confirm" className="block text-sm font-medium text-[var(--text)] mb-1.5">
          Confirm new password
        </label>
        <input
          id="reset-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="w-full mb-3 h-10 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border-strong)] text-sm text-[var(--text)] outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--accent-subtle)]"
        />
        {error && <div role="alert" className="text-sm text-[var(--red)] mb-3">{error}</div>}
        <button
          type="submit"
          disabled={state === 'submitting' || pw.length < 8}
          className="mt-5 w-full h-10 rounded-md bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium text-sm disabled:opacity-50"
        >
          {state === 'submitting' ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  );
}
