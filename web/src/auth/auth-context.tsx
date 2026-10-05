import * as React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { getMe, MePayload, logout as apiLogout } from '../api-service/auth';
import { clearAllScreenshotStores } from '../components/device-control/screenshots/screenshotStore';
import { clearSessionHint, markSignedIn } from './session-hint';
import { onSocketRefused, reviveSharedSocket } from '../hooks/socket-manager';

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
      const next = await getMe();
      if (next) {
        markSignedIn();
        // Signed in (again, in this tab): a socket whose handshake the
        // server refused can connect again, with this sign-in's cookie.
        reviveSharedSocket();
      }
      setMe(next);
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    clearSessionHint();
    // Screenshots kept in this browser are the signed-in user's; bounded, so
    // sign-out never waits on storage.
    await Promise.all([apiLogout(), clearAllScreenshotStores()]);
    setMe(null);
    window.location.href = '/xenon/login';
  }

  useEffect(() => {
    refresh();
    // The server refused the live socket: the sign-in is read again, and if
    // it is gone (signed out elsewhere, disabled) the route guard sends them
    // to sign in. Nothing reconnects from here, so a refusal the sign-in
    // doesn't explain can't loop; signing in again does (refresh).
    return onSocketRefused(() => {
      getMe()
        .then((next) => {
          if (!next) setMe(null);
        })
        .catch(() => undefined);
    });
  }, []);

  return <AuthCtx.Provider value={{ loading, me, refresh, signOut }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
