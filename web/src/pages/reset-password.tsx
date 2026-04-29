import * as React from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { checkResetToken, resetPassword } from '../api-service/auth';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const [state, setState] = useState<'checking' | 'invalid' | 'ready' | 'submitting' | 'done'>(
    'checking',
  );
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

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
      <div className="min-h-screen flex items-center justify-center text-sm text-[var(--text-dim)]">
        Checking link…
      </div>
    );
  }
  if (state === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-6">
        <div>
          <h1 className="text-xl font-semibold mb-3">This link is invalid or expired</h1>
          <p className="text-sm text-[var(--text-dim)] mb-6">
            Reset links are good for 1 hour and single-use. Request a new one.
          </p>
          <Link
            to="/forgot-password"
            className="inline-block h-10 px-4 rounded-md bg-[var(--green)] text-black text-sm font-medium leading-10"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }
  if (state === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-6">
        <div>
          <h1 className="text-xl font-semibold mb-3">Password updated</h1>
          <p className="text-sm text-[var(--text-dim)]">Redirecting to sign in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <form onSubmit={submit} className="w-full max-w-sm px-6">
        <h1 className="text-2xl font-semibold mb-1">Reset your password</h1>
        <p className="text-sm text-[var(--text-dim)] mb-6">Choose a new password to sign in with.</p>

        <label className="block text-xs text-[var(--text-dim)] mb-1">New password</label>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          required
          className="w-full mb-3 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--green)] outline-none"
        />
        <label className="block text-xs text-[var(--text-dim)] mb-1">Confirm new password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="w-full mb-3 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--green)] outline-none"
        />
        {error && <div className="text-xs text-[var(--red)] mb-3">{error}</div>}
        <button
          type="submit"
          disabled={state === 'submitting' || pw.length < 8}
          className="w-full h-10 rounded-md bg-[var(--green)] text-black font-medium text-sm disabled:opacity-50"
        >
          {state === 'submitting' ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
