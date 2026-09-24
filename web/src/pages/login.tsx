import * as React from 'react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Clock,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  Mail,
} from 'lucide-react';
import { login } from '../api-service/auth';
import { cn } from '../lib/utils';
import { useAuth } from '../auth/auth-context';
import { clearSessionHint } from '../auth/session-hint';
import { usePasswordResetMode } from '../auth/use-password-reset-mode';
import { describeLoginError, formatWait } from './login-errors';
import { AuthShell } from './auth-shell';

// Placeholder --text-placeholder (#7a837f) is 5.0:1 on the field; the old --text-dim was 3.2:1.
const FIELD =
  'w-full h-11 pl-10 pr-3 rounded-lg bg-[var(--bg)] border border-[var(--border-strong)] text-sm text-[var(--text)] placeholder:text-[var(--text-placeholder)] outline-none transition-[border-color,box-shadow] duration-150 hover:border-[#3a4542] focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--accent-subtle)]';
const ICON =
  'pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]';

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { refresh } = useAuth();
  const params = new URLSearchParams(loc.search);
  const next = params.get('next') || '/overview';
  const expired = params.get('reason') === 'expired';
  const resetMode = usePasswordResetMode();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [srError, setSrError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The notice is on screen now; don't show it again on a later visit.
  useEffect(() => {
    if (expired) clearSessionHint();
  }, [expired]);

  // Tick once a second while rate-limited so the countdown and the disabled
  // button release on their own.
  useEffect(() => {
    if (lockedUntil === null) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        setLockedUntil(null);
        setError(null);
        setSrError(null);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [lockedUntil]);

  const waitSec = lockedUntil === null ? 0 : (lockedUntil - now) / 1000;
  const locked = lockedUntil !== null && waitSec > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked) return;
    setSubmitting(true);
    setError(null);
    setSrError(null);
    try {
      await login(email, password);
      await refresh();
      nav(next, { replace: true });
    } catch (err) {
      const problem = describeLoginError(err);
      setError(problem.message);
      setSrError(
        problem.retryAfterSec
          ? `${problem.message} Try again in ${formatWait(problem.retryAfterSec)}.`
          : problem.message,
      );
      if (problem.retryAfterSec) {
        const t = Date.now();
        setNow(t);
        setLockedUntil(t + problem.retryAfterSec * 1000);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function trackCapsLock(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState('CapsLock'));
  }

  return (
    <AuthShell>
      <form onSubmit={submit}>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Sign in</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">Use your Xenon account to continue.</p>

        {expired && (
          <div
            role="status"
            className="mb-5 flex items-start gap-2 rounded-lg border border-[var(--status-reserved-border)] bg-[var(--status-reserved-bg)] px-3 py-2.5 text-sm text-[var(--text)]"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--blue)]" aria-hidden="true" />
            <span>Your session has expired. Sign in again to pick up where you left off.</span>
          </div>
        )}

        <label
          htmlFor="login-email"
          className="block text-sm font-medium text-[var(--text)] mb-1.5"
        >
          Email
        </label>
        <div className="relative mb-4">
          <Mail className={ICON} aria-hidden="true" />
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
            className={FIELD}
          />
        </div>

        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="login-password" className="block text-sm font-medium text-[var(--text)]">
            Password
          </label>
          {/* Only when the server can really email a link — see
              passwordResetMode on the server. Otherwise the fallback below. */}
          {resetMode === 'email' && (
            <Link
              to="/forgot-password"
              className="text-sm text-[var(--color-accent)] underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          )}
        </div>
        <div className="relative">
          <Lock className={ICON} aria-hidden="true" />
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={trackCapsLock}
            onKeyUp={trackCapsLock}
            onBlur={() => setCapsLock(false)}
            aria-describedby={capsLock ? 'login-capslock' : undefined}
            required
            className={cn(FIELD, 'pr-11')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-white/5"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {capsLock && (
          <p
            id="login-capslock"
            className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--amber)]"
          >
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Caps Lock is on
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-3 py-2.5 text-sm text-[var(--text)]"
          >
            {locked ? (
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--red)]" aria-hidden="true" />
            ) : (
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--red)]"
                aria-hidden="true"
              />
            )}
            {/* The countdown ticks every second. Inside an alert region that
                would be re-announced each tick, so assistive tech gets the
                message once, with the wait as it stood when the limit hit. */}
            <span>
              <span className="sr-only">{srError}</span>
              <span aria-hidden="true">
                {error}
                {locked && <> Try again in {formatWait(waitSec)}.</>}
              </span>
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || locked}
          className="mt-6 flex w-full h-11 items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] text-black font-medium text-sm transition-colors hover:bg-[var(--color-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Signing in…
            </>
          ) : locked ? (
            `Try again in ${formatWait(waitSec)}`
          ) : (
            <>
              Sign in
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </>
          )}
        </button>

        {resetMode === 'admin' && (
          <p className="mt-5 text-center text-sm text-[var(--text-muted)]">
            Forgot your password? Ask a Xenon administrator to send you a reset link.
          </p>
        )}
      </form>
    </AuthShell>
  );
}
