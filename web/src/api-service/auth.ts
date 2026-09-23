import { SENSITIVE_BODY } from './sensitive';

const BASE = '/xenon/api/auth';

/**
 * A failed sign-in, keeping what the page needs to explain it: the HTTP
 * status (0 when the server was never reached) and, for a 429, how long the
 * server's rate limiter asked the client to wait.
 */
export class LoginError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

export async function login(email: string, password: string): Promise<void> {
  let r: Response;
  try {
    r = await fetch(`${BASE}/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...SENSITIVE_BODY },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    throw new LoginError((err as Error).message || 'Network error', 0);
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const retryAfter = Number(r.headers.get('Retry-After'));
    throw new LoginError(
      body.error || `Login failed (${r.status})`,
      r.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
}

export type PasswordResetMode = 'email' | 'admin';

/**
 * What the sign-in page may offer. Falls back to 'admin' if the server can't
 * be asked: better to send someone to an administrator than to promise an
 * email that may never arrive.
 */
export async function getAuthOptions(): Promise<{ passwordReset: PasswordResetMode }> {
  try {
    const r = await fetch(`${BASE}/options`, { credentials: 'include' });
    if (!r.ok) return { passwordReset: 'admin' };
    const body = await r.json();
    return { passwordReset: body.passwordReset === 'email' ? 'email' : 'admin' };
  } catch {
    return { passwordReset: 'admin' };
  }
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/logout`, { method: 'POST', credentials: 'include' });
}

export interface MePayload {
  userId: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
  accessKey: string;
  scopes: string;
  teamId: string | null;
  kind: 'user-session' | 'api-key';
  teams: { id: string; name: string }[];
}

export async function getMe(): Promise<MePayload | null> {
  const r = await fetch(`${BASE}/me`, { credentials: 'include' });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`Failed to fetch /me (${r.status})`);
  return r.json();
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const r = await fetch(`${BASE}/change-password`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...SENSITIVE_BODY },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `Change password failed (${r.status})`);
  }
}

export async function forgotPassword(email: string): Promise<void> {
  const r = await fetch(`${BASE}/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok && r.status !== 204) {
    if (r.status === 429) throw new Error('Too many attempts — try again later.');
    throw new Error(`Request failed (${r.status})`);
  }
}

// POST, token in the body: a token in a request URL lands in the server log.
export async function checkResetToken(token: string): Promise<boolean> {
  const r = await fetch(`${BASE}/reset-password/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...SENSITIVE_BODY },
    body: JSON.stringify({ token }),
  });
  return r.ok;
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const r = await fetch(`${BASE}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...SENSITIVE_BODY },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!r.ok && r.status !== 204) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `Reset failed (${r.status})`);
  }
}
