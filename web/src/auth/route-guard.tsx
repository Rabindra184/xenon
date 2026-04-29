import * as React from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useAuth } from './auth-context';

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { loading, me } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>Loading…</div>
    );
  }
  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}
