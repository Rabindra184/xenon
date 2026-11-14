import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { RouteGuard } from './route-guard';

const user = { userId: 'u1', role: 'MEMBER' };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function LoginProbe() {
  return <div data-testid="login">{useLocation().search}</div>;
}

let auth: ReturnType<typeof useAuth>;
function Grab() {
  auth = useAuth();
  return null;
}

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/devices']}>
      <AuthProvider>
        <Grab />
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route
            path="*"
            element={
              <RouteGuard>
                <div>SHELL</div>
              </RouteGuard>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// Through 2.36 any /auth/me failure but a 401 (a restart, a 502 from a proxy,
// no network) left `me` null, and the guard sent a signed-in person to sign
// in with "Your session has expired".
describe('a server that cannot be reached is not a sign-out', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('xenon.hadSession', '1');
    calls.getMe.mockReset();
    calls.revive.mockReset();
    calls.refused = [];
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a network error shows the retry screen, never the sign-in page', async () => {
    calls.getMe.mockRejectedValue(new TypeError('Failed to fetch'));
    renderGuarded();
    await waitFor(() =>
      expect(screen.getByText("Can't reach the Xenon server")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('login')).toBeNull();
    expect(auth.status.kind).toBe('unreachable');
    expect(auth.loading).toBe(false);
    expect(auth.me).toBe(null);
    // The hint stays: an expiry later still reads as one.
    expect(localStorage.getItem('xenon.hadSession')).toBe('1');
  });

  it('a 5xx shows the retry screen too', async () => {
    calls.getMe.mockRejectedValue(new Error('Failed to fetch /me (502)'));
    renderGuarded();
    await waitFor(() =>
      expect(screen.getByText("Can't reach the Xenon server")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('login')).toBeNull();
  });

  it('tries again by itself, with growing waits, and opens the page once the server answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    calls.getMe
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(user);
    renderGuarded();
    await waitFor(() =>
      expect(screen.getByText("Can't reach the Xenon server")).toBeInTheDocument(),
    );
    expect(calls.getMe).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(calls.getMe).toHaveBeenCalledTimes(2);
    // The second wait is longer than the first.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(calls.getMe).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(calls.getMe).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(screen.getByText('SHELL')).toBeInTheDocument());
    expect(auth.status.kind).toBe('signedIn');
  });

  it('Try now asks at once', async () => {
    calls.getMe.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(user);
    renderGuarded();
    await waitFor(() =>
      expect(screen.getByText("Can't reach the Xenon server")).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try now' }));
    });
    await waitFor(() => expect(screen.getByText('SHELL')).toBeInTheDocument());
  });

  it('a server that answers "signed out" after an outage sends them to sign in', async () => {
    calls.getMe.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(null);
    renderGuarded();
    await waitFor(() =>
      expect(screen.getByText("Can't reach the Xenon server")).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try now' }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('login')).toHaveTextContent('?next=%2Fdevices&reason=expired'),
    );
  });

  it('a refused socket on a hiccup leaves the person signed in', async () => {
    calls.getMe.mockResolvedValueOnce(user).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderGuarded();
    await waitFor(() => expect(screen.getByText('SHELL')).toBeInTheDocument());
    await act(async () => {
      calls.refused.forEach((cb) => cb());
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('SHELL')).toBeInTheDocument();
    expect(auth.status.kind).toBe('signedIn');
  });
});

// The mount's check and the sign-in page's `await refresh()` overlap; they
// were applied in the order the network answered, so the mount's older
// "signed out" could land after the sign-in's "signed in".
describe('only the newest check applies', () => {
  beforeEach(() => {
    localStorage.clear();
    calls.getMe.mockReset();
    calls.revive.mockReset();
    calls.refused = [];
  });
  afterEach(cleanup);

  it('an older answer arriving last is dropped', async () => {
    const mountCheck = deferred<unknown>();
    const loginCheck = deferred<unknown>();
    calls.getMe.mockReturnValueOnce(mountCheck.promise).mockReturnValueOnce(loginCheck.promise);
    renderGuarded();
    let refreshed!: Promise<void>;
    act(() => {
      refreshed = auth.refresh();
    });
    await act(async () => {
      loginCheck.resolve(user);
      await refreshed;
    });
    await act(async () => {
      mountCheck.resolve(null);
    });
    await waitFor(() => expect(screen.getByText('SHELL')).toBeInTheDocument());
    expect(auth.status.kind).toBe('signedIn');
    expect(auth.me).toEqual(user);
  });
});
