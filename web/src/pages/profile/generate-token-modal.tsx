import * as React from 'react';
import { useState } from 'react';
import { createToken } from '../../api-service/profile';

export function GenerateTokenModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (info: { name: string; token: string }) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await createToken(name);
      onCreated({ name, token: r.token });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-md p-6">
        <h3 className="text-lg font-semibold mb-4">Generate Identity Token</h3>
        <label className="block text-xs text-[var(--text-dim)] mb-1">Description</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. mac, CI, etc."
          required
          className="w-full mb-4 h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm"
        />
        {error && <div className="text-xs text-[var(--red)] mb-2">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-md border border-[var(--border)] text-sm">
            Cancel
          </button>
          <button type="submit" disabled={busy || !name} className="h-9 px-4 rounded-md bg-[var(--green)] text-black text-sm font-medium disabled:opacity-50">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
