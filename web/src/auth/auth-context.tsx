import * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getMe, MePayload, logout as apiLogout } from '../api-service/auth';
import { clearAllScreenshotStores } from '../components/device-control/screenshots/screenshotStore';
import { clearSessionHint, markSignedIn } from './session-hint';
import { onSocketRefused, reviveSharedSocket } from '../hooks/socket-manager';

/**
 * Where the sign-in stands, as one state. Only `signedOut` sends a person to
 * the sign-in page. Through 2.36 a server that couldn't be reached (a
 * restart, a proxy's 502, no network) left `me` null like a sign-out, and the
 * route guard sent a signed-in person to sign in with "Your session has
 * expired".
 */
export type AuthStatus =
  | { kind: 'checking' }
  | { kind: 'signedIn'; me: MePayload }
  | { kind: 'signedOut' }
  | { kind: 'unreachable'; error: Error };

interface AuthState {
  status: AuthStatus;
  /** True until the first check answers. */
  loading: boolean;
  /** Who is signed in; null unless `status` is `signedIn`. */
  me: MePayload | null;
  /** Reads the sign-in again. Never rejects: an unreachable server is a status. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** Waits between automatic checks while the server can't be reached. */
export function retryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** attempt, 30_000);
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>({ kind: 'checking' });
  // Each check is numbered when it is sent. An answer is applied only if no
  // check sent after it has been applied already: the mount's check and the
  // sign-in page's `await refresh()` overlap, and the network may answer
  // them in either order.
  const issued = useRef(0);
  const applied = useRef(0);
  const live = useRef(true);
  const retries = useRef(0);

  const apply = useCallback((id: number, next: AuthStatus): boolean => {
    if (!live.current || id < applied.current) return false;
    applied.current = id;
    if (next.kind !== 'unreachable') retries.current = 0;
    setStatus(next);
    return true;
  }, []);

  const refresh = useCallback(async () => {
    const id = ++issued.current;
    let next: AuthStatus;
    try {
      const me = await getMe();
      next = me ? { kind: 'signedIn', me } : { kind: 'signedOut' };
    } catch (e) {
      next = { kind: 'unreachable', error: e instanceof Error ? e : new Error(String(e)) };
    }
    if (apply(id, next) && next.kind === 'signedIn') {
      markSignedIn();
      // Signed in (again, in this tab): a socket whose handshake the server
      // refused can connect again, with this sign-in's cookie.
      reviveSharedSocket();
    }
  }, [apply]);

  async function signOut() {
    clearSessionHint();
    // Screenshots kept in this browser are the signed-in user's; bounded, so
    // sign-out never waits on storage.
    await Promise.all([apiLogout(), clearAllScreenshotStores()]);
    apply(++issued.current, { kind: 'signedOut' });
    window.location.href = '/xenon/login';
  }

  useEffect(() => {
    live.current = true;
    refresh();
    // The server refused the live socket: the sign-in is read again, and if
    // it is gone (signed out elsewhere, disabled) the route guard sends them
    // to sign in. Nothing reconnects from here, so a refusal the sign-in
    // doesn't explain can't loop; signing in again does (refresh). A check
    // that can't reach the server changes nothing.
    const stop = onSocketRefused(() => {
      const id = ++issued.current;
      getMe()
        .then((me) => {
          apply(id, me ? { kind: 'signedIn', me } : { kind: 'signedOut' });
        })
        .catch(() => undefined);
    });
    return () => {
      live.current = false;
      stop();
    };
  }, [refresh, apply]);

  // While the server can't be reached, ask again, waiting longer each time.
  useEffect(() => {
    if (status.kind !== 'unreachable') return;
    const t = window.setTimeout(() => {
      retries.current += 1;
      refresh();
    }, retryDelayMs(retries.current));
    return () => window.clearTimeout(t);
  }, [status, refresh]);

  const value: AuthState = {
    status,
    loading: status.kind === 'checking',
    me: status.kind === 'signedIn' ? status.me : null,
    refresh,
    signOut,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
