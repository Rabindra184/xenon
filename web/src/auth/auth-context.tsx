import * as React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { getMe, MePayload, logout as apiLogout } from '../api-service/auth';

interface AuthState {
  loading: boolean;
  me: MePayload | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MePayload | null>(null);

  async function refresh() {
    try {
      setMe(await getMe());
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await apiLogout();
    setMe(null);
    window.location.href = '/xenon/login';
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <AuthCtx.Provider value={{ loading, me, refresh, signOut }}>{children}</AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
