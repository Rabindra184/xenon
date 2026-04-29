import * as React from 'react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { login } from '../api-service/auth';
import { useAuth } from '../auth/auth-context';

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
    <div className="min-h-screen w-full grid grid-cols-1 md:grid-cols-2 bg-[var(--bg)] text-[var(--text)]">
      <aside className="relative hidden md:flex flex-col justify-center px-12 overflow-hidden bg-gradient-to-br from-[#0a0e1a] via-[#131a2e] to-[#1a2548]">
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'radial-gradient(circle at 80% 20%, rgba(99,102,241,0.18), transparent 60%)' }} />
        <div className="relative">
          <div className="text-3xl font-semibold tracking-tight mb-2">Xenon</div>
          <p className="text-sm text-[var(--text-dim)] max-w-sm leading-relaxed mb-8">
            Enterprise-grade Appium device lab orchestration with AI self-healing,
            live device streaming, and proof-pack recording.
          </p>
          <div className="flex flex-wrap gap-2 max-w-sm">
            {['Hub-Node', '5-tier Healing', 'Live MJPEG', 'Mosaic Recording'].map((t) => (
              <span key={t} className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[var(--text-muted)]">
                {t}
              </span>
            ))}
          </div>
        </div>
      </aside>

      <main className="flex items-center justify-center px-6 md:px-12">
        <form onSubmit={submit} className="w-full max-w-sm">
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

          {error && <div className="mt-3 text-xs text-[var(--red)]">{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 w-full h-10 rounded-md bg-[var(--green)] text-black font-medium text-sm disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </main>
    </div>
  );
}
