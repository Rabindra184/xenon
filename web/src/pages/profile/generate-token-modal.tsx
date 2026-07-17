import * as React from 'react';
import { useState } from 'react';
import { createToken } from '../../api-service/profile';
import { formatDate } from '../../utils/time';
import { Select } from '../../components/ui/select';

type ExpiryPreset = '7d' | '30d' | '90d' | '1y' | 'never';

const PRESET_LABEL: Record<ExpiryPreset, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '1y': '1 year',
  never: 'No expiry',
};

const PRESET_DAYS: Record<Exclude<ExpiryPreset, 'never'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

function presetToISO(preset: ExpiryPreset): string | null {
  if (preset === 'never') return null;
  const ms = PRESET_DAYS[preset] * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

export function GenerateTokenModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (info: { name: string; token: string; expiresAt: string | null }) => void;
}) {
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<ExpiryPreset>('30d');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const expiresAt = presetToISO(expiry);
      const r = await createToken(name, undefined, expiresAt);
      onCreated({ name, token: r.token, expiresAt: r.expiresAt });
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
        <label className="block text-xs text-[var(--text-dim)] mb-1">Expires after</label>
        <Select
          value={expiry}
          onChange={(e) => setExpiry(e.target.value as ExpiryPreset)}
          className="mb-1"
        >
          {(Object.keys(PRESET_LABEL) as ExpiryPreset[]).map((p) => (
            <option key={p} value={p}>
              {PRESET_LABEL[p]}
            </option>
          ))}
        </Select>
        <p className="text-[11px] text-[var(--text-dim)] mb-4">
          {expiry === 'never'
            ? 'Token never expires. Rotate manually when needed.'
            : `Token will stop working on ${formatDate(presetToISO(expiry))}.`}
        </p>
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
