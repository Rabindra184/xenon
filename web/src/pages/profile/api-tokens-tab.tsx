import * as React from 'react';
import { useEffect, useState } from 'react';
import { Copy, RefreshCw, Trash2 } from 'lucide-react';
import {
  listTokens,
  deleteToken,
  getAccessKey,
  rotateAccessKey,
  TokenSummary,
} from '../../api-service/profile';
import { formatDate, formatDateTime } from '../../utils/time';
import { GenerateTokenModal } from './generate-token-modal';

export function ApiTokensTab() {
  const [accessKey, setAccessKey] = useState<string>('');
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; token: string; expiresAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [ak, t] = await Promise.all([getAccessKey(), listTokens()]);
      setAccessKey(ak);
      setTokens(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function rotate() {
    if (!confirm('Rotate access key? Existing tokens stay valid but the old accessKey will stop working immediately.')) return;
    try {
      setAccessKey(await rotateAccessKey());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rotate access key');
    }
  }
  async function remove(id: string) {
    if (!confirm('Delete this token? It will stop working immediately.')) return;
    try {
      await deleteToken(id);
      setTokens((t) => t.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete token');
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-xs text-[var(--text-dim)]">Access Key</span>
        <code className="px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs">
          {accessKey || '…'}
        </code>
        <button
          onClick={() => navigator.clipboard.writeText(accessKey)}
          aria-label="Copy access key"
          className="text-[var(--text-dim)] hover:text-[var(--text)]"
        >
          <Copy size={14} />
        </button>
        <button
          onClick={rotate}
          aria-label="Rotate access key"
          className="text-[var(--text-dim)] hover:text-[var(--text)]"
        >
          <RefreshCw size={14} />
        </button>
        <span className="text-[10px] text-[var(--text-dim)] ml-2">Public — paired with a token below</span>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">Identity Tokens</h2>
        <button
          onClick={() => setShowModal(true)}
          className="h-9 px-4 rounded-md bg-[var(--green)] text-black font-medium text-sm"
        >
          Generate New Token
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--text-dim)]">Loading…</div>
      ) : error ? (
        <div className="text-sm text-[var(--red)] py-6 text-center border border-dashed border-[var(--border)] rounded-md">
          {error}{' '}
          <button className="underline text-[var(--text)]" onClick={refresh}>
            Retry
          </button>
        </div>
      ) : tokens.length === 0 ? (
        <div className="text-sm text-[var(--text-dim)] py-6 text-center border border-dashed border-[var(--border)] rounded-md">
          No tokens yet — generate one to use programmatically.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[11px] text-[var(--text-dim)] uppercase tracking-wide">
            <tr>
              <th className="text-left py-2">Name</th>
              <th className="text-left py-2">Issued</th>
              <th className="text-left py-2">Last Used</th>
              <th className="text-left py-2">Expires</th>
              <th className="w-px"></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const expired = t.expiresAt ? new Date(t.expiresAt).getTime() <= Date.now() : false;
              return (
                <tr key={t.id} className="border-t border-[var(--border)]">
                  <td className="py-2">{t.name}</td>
                  <td className="py-2 text-[var(--text-muted)]">{formatDateTime(t.createdAt)}</td>
                  <td className="py-2 text-[var(--text-muted)]">
                    {t.lastUsedAt ? formatDateTime(t.lastUsedAt) : '—'}
                  </td>
                  <td className={`py-2 ${expired ? 'text-[var(--red)]' : 'text-[var(--text-muted)]'}`}>
                    {t.expiresAt
                      ? `${formatDate(t.expiresAt)}${expired ? ' (expired)' : ''}`
                      : 'Never'}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => remove(t.id)}
                      aria-label="Delete token"
                      className="text-[var(--red)] hover:opacity-80"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showModal && (
        <GenerateTokenModal
          onClose={() => setShowModal(false)}
          onCreated={(info) => {
            setShowModal(false);
            setRevealed(info);
            refresh();
          }}
        />
      )}

      {revealed && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center" role="dialog">
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-md p-6">
            <h3 className="text-base font-semibold mb-2">Token created</h3>
            <p className="text-xs text-[var(--text-dim)] mb-3">Copy this now — it will not be shown again.</p>
            <code className="block break-all px-3 py-2 rounded bg-[var(--surface)] border border-[var(--border)] text-xs mb-3">
              {revealed.token}
            </code>
            <p className="text-[11px] text-[var(--text-dim)] mb-4">
              {revealed.expiresAt
                ? `Expires ${formatDate(revealed.expiresAt)}`
                : 'No expiry — rotate manually.'}
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setRevealed(null)}
                className="h-9 px-4 rounded-md bg-[var(--green)] text-black text-sm font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
