import React, { useEffect, useState } from 'react';

interface Props {
  children: React.ReactNode;
}

export function ApiKeyGate({ children }: Props) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/xenon/api/health')
      .then(() => fetch('/xenon/api/sessions', { credentials: 'include' }))
      .then((r) => setAuthed(r.status !== 401))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div style={{ padding: 40 }}>Loading…</div>;
  if (authed) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/xenon/api/auth/dashboard-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ apiKey: value.trim() }),
    });
    if (res.ok) {
      setAuthed(true);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error || 'Invalid key');
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '120px auto', padding: 24 }}>
      <h2>Sign in to Xenon</h2>
      <p>
        Paste an API key. First-time setup: the bootstrap key is in{' '}
        <code>~/.cache/xenon/bootstrap-key.txt</code> on the server.
      </p>
      <form onSubmit={submit}>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="API key"
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
          autoFocus
        />
        <button type="submit" style={{ marginTop: 12, padding: '8px 16px' }}>
          Continue
        </button>
      </form>
      {error && <p style={{ color: 'crimson', marginTop: 12 }}>{error}</p>}
    </div>
  );
}
