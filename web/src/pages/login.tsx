import * as React from 'react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { login } from '../api-service/auth';
import { cn } from '../lib/utils';
import { useAuth } from '../auth/auth-context';
import { AuthShell } from './auth-shell';

const FIELD =
  'w-full h-11 pl-10 pr-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] outline-none transition-[border-color,box-shadow] duration-150 hover:border-[var(--border-strong)] focus:border-[var(--green)] focus:shadow-[0_0_0_3px_var(--accent-subtle)]';
const ICON =
  'pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-dim)] transition-colors group-focus-within:text-[var(--green)]';

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { refresh } = useAuth();
  const params = new URLSearchParams(loc.search);
  const next = params.get('next') || '/overview';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Welcome back</h1>
        <p className="text-sm text-[var(--text-muted)] mb-8">Sign in to your Xenon workspace</p>

        <label
          htmlFor="login-email"
          className="block text-xs font-medium text-[var(--text-muted)] mb-1.5"
        >
          Email
        </label>
        <div className="group relative mb-4">
          <Mail className={ICON} aria-hidden="true" />
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
            className={FIELD}
          />
        </div>

        <div className="flex items-center justify-between mb-1.5">
          <label
            htmlFor="login-password"
            className="block text-xs font-medium text-[var(--text-muted)]"
          >
            Password
          </label>
          <Link
            to="/forgot-password"
            className="text-[11px] text-[var(--text-dim)] hover:text-[var(--green)] transition-colors"
          >
            Forgot password?
          </Link>
        </div>
        <div className="group relative">
          <Lock className={ICON} aria-hidden="true" />
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={cn(FIELD, 'pr-10')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-md text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-white/5 transition-colors"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-3 py-2.5 text-xs text-[var(--red)]"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="group mt-6 flex w-full h-11 items-center justify-center gap-2 rounded-lg bg-[var(--green)] text-black font-medium text-sm shadow-[0_8px_24px_rgba(34,197,94,0.25)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[#2fd66b] hover:shadow-[0_10px_30px_rgba(34,197,94,0.35)] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Signing in…
            </>
          ) : (
            <>
              Sign in
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </>
          )}
        </button>
      </form>
    </AuthShell>
  );
}
