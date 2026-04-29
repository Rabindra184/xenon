const BASE = '/xenon/api/profile';

export interface TokenSummary {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listTokens(): Promise<TokenSummary[]> {
  const r = await fetch(`${BASE}/tokens`, { credentials: 'include' });
  if (!r.ok) throw new Error(`listTokens failed (${r.status})`);
  return r.json();
}

export async function createToken(
  name: string,
  scopes?: string[],
): Promise<{ id: string; token: string }> {
  const r = await fetch(`${BASE}/tokens`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scopes }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `createToken failed (${r.status})`);
  }
  return r.json();
}

export async function deleteToken(id: string): Promise<void> {
  const r = await fetch(`${BASE}/tokens/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!r.ok && r.status !== 204) throw new Error(`deleteToken failed (${r.status})`);
}

export async function getAccessKey(): Promise<string> {
  const r = await fetch(`${BASE}/access-key`, { credentials: 'include' });
  if (!r.ok) throw new Error(`getAccessKey failed (${r.status})`);
  return (await r.json()).accessKey;
}

export async function rotateAccessKey(): Promise<string> {
  const r = await fetch(`${BASE}/access-key/rotate`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`rotateAccessKey failed (${r.status})`);
  return (await r.json()).accessKey;
}
