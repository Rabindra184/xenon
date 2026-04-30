const BASE = '/xenon/api/users';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  lastLoginAt: string | null;
}

export interface CreateUserResult {
  id: string;
  email: string;
  name: string;
  role: UserRow['role'];
  status: UserRow['status'];
  accessKey: string;
  // Returned only when the server generated the password (no `password`
  // supplied in the request). Shown once in the UI and never logged.
  temporaryPassword?: string;
}

export async function listUsers(): Promise<UserRow[]> {
  const r = await fetch(`${BASE}/`, { credentials: 'include' });
  if (!r.ok) throw new Error(`listUsers failed (${r.status})`);
  return r.json();
}

export async function createUser(input: {
  email: string;
  name: string;
  role: UserRow['role'];
  password?: string;
}): Promise<CreateUserResult> {
  const r = await fetch(`${BASE}/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `createUser failed (${r.status})`);
  }
  return r.json();
}

export async function updateUser(
  id: string,
  patch: { name?: string; role?: UserRow['role']; status?: UserRow['status'] },
): Promise<UserRow> {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `updateUser failed (${r.status})`);
  }
  return r.json();
}

export async function deleteUser(id: string): Promise<void> {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!r.ok && r.status !== 204) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `deleteUser failed (${r.status})`);
  }
}
