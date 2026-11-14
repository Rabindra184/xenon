import * as React from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useAuth } from './auth-context';
import { hadSession } from './session-hint';
import { Button } from '../components/ui/button';

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { status, refresh } = useAuth();
  const location = useLocation();

  if (status.kind === 'checking') {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>Loading…</div>
    );
  }
  // Not a sign-out: the page comes back by itself once the server answers
  // (the provider keeps asking), and the person stays signed in.
  if (status.kind === 'unreachable') {
    return <ServerUnreachable onRetry={refresh} />;
  }
  if (status.kind === 'signedOut') {
    const next = encodeURIComponent(location.pathname + location.search);
    const reason = hadSession() ? '&reason=expired' : '';
    return <Navigate to={`/login?next=${next}${reason}`} replace />;
  }
  return <>{children}</>;
}

function ServerUnreachable({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <div
      role="status"
      className="flex min-h-screen flex-col items-center justify-center gap-3 p-10 text-center"
    >
      <h1 className="text-heading font-semibold text-[var(--text)]">
        Can't reach the Xenon server
      </h1>
      <p className="max-w-md text-sm text-[var(--text-muted)]">
        Trying again automatically. This page opens as soon as the server answers.
      </p>
      <Button variant="secondary" size="sm" onClick={() => void onRetry()}>
        Try now
      </Button>
    </div>
  );
}
