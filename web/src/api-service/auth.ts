const BASE = '/xenon/api/auth';

export async function login(email: string, password: string): Promise<void> {
  const r = await fetch(`${BASE}/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `Login failed (${r.status})`);
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
    headers: { 'Content-Type': 'application/json' },
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

export async function checkResetToken(token: string): Promise<boolean> {
  const r = await fetch(`${BASE}/reset-password/check/${encodeURIComponent(token)}`);
  return r.ok;
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const r = await fetch(`${BASE}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!r.ok && r.status !== 204) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `Reset failed (${r.status})`);
  }
}
