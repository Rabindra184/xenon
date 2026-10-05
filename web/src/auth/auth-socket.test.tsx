import * as React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  getMe: vi.fn(),
  revive: vi.fn(),
  refused: [] as Array<() => void>,
}));
vi.mock('../api-service/auth', () => ({
  getMe: calls.getMe,
  logout: vi.fn(async () => undefined),
}));
vi.mock('../hooks/socket-manager', () => ({
  reviveSharedSocket: calls.revive,
  onSocketRefused: (cb: () => void) => {
    calls.refused.push(cb);
    return () => {
      calls.refused = calls.refused.filter((c) => c !== cb);
    };
  },
}));

import { AuthProvider, useAuth } from './auth-context';

const user = { userId: 'u1', role: 'MEMBER' };

function Probe({ seen, onAuth }: { seen: Array<string | null>; onAuth?: (a: any) => void }) {
  const auth = useAuth();
  onAuth?.(auth);
  if (!auth.loading) seen.push(auth.me ? (auth.me as any).userId : null);
  return null;
}

const refuse = () => calls.refused.forEach((cb) => cb());

// The server closes the live socket of a sign-in it no longer accepts and
// refuses its reconnect, after which socket.io doesn't try again. The
// dashboard reads its sign-in again: gone, `me` is cleared and the route guard
// sends them to sign in. Signing in again revives the socket.
describe('AuthProvider and a refused live socket', () => {
  beforeEach(() => {
    calls.getMe.mockReset();
    calls.revive.mockReset();
    calls.refused = [];
  });

  it('reads the sign-in again; gone, it clears who is signed in', async () => {
    calls.getMe.mockResolvedValueOnce(user).mockResolvedValueOnce(null);
    const seen: Array<string | null> = [];
    render(
      <AuthProvider>
        <Probe seen={seen} />
      </AuthProvider>,
    );
    await waitFor(() => expect(seen[seen.length - 1]).toBe('u1'));

    refuse();

    await waitFor(() => expect(seen[seen.length - 1]).toBe(null));
    expect(calls.getMe).toHaveBeenCalledTimes(2);
  });

  it('still signed in, it reconnects nothing, so a refusal the sign-in does not explain cannot loop', async () => {
    calls.getMe.mockResolvedValue(user);
    const seen: Array<string | null> = [];
    render(
      <AuthProvider>
        <Probe seen={seen} />
      </AuthProvider>,
    );
    await waitFor(() => expect(calls.revive).toHaveBeenCalledTimes(1));

    refuse();

    await waitFor(() => expect(calls.getMe).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.revive).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1]).toBe('u1');
  });

  it('signing in again revives the socket', async () => {
    calls.getMe.mockResolvedValueOnce(null).mockResolvedValueOnce(user);
    let refresh: () => Promise<void> = async () => undefined;
    const seen: Array<string | null> = [];
    render(
      <AuthProvider>
        <Probe seen={seen} onAuth={(a) => (refresh = a.refresh)} />
      </AuthProvider>,
    );
    await waitFor(() => expect(seen[seen.length - 1]).toBe(null));
    expect(calls.revive).not.toHaveBeenCalled();

    // What the sign-in page does once /auth/login succeeds.
    await refresh();

    await waitFor(() => expect(seen[seen.length - 1]).toBe('u1'));
    expect(calls.revive).toHaveBeenCalledTimes(1);
  });

  it('stops listening when it unmounts', async () => {
    calls.getMe.mockResolvedValue(user);
    const { unmount } = render(
      <AuthProvider>
        <Probe seen={[]} />
      </AuthProvider>,
    );
    await waitFor(() => expect(calls.refused).toHaveLength(1));
    unmount();
    expect(calls.refused).toHaveLength(0);
  });
});
