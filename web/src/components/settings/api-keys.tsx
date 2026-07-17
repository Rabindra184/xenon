import React, { useEffect, useState } from 'react';
import './settings.css';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  ShieldAlert,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { useToast } from '../ui/toast';
import { formatDate } from '../../utils/time';
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table';
import { FieldGroup } from '../ui/FieldGroup';
import { PageHeader } from '../ui/page-header';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

type Scope = 'read' | 'sessions' | 'devices' | 'admin';
const ALL_SCOPES: Scope[] = ['read', 'sessions', 'devices', 'admin'];

interface ApiKeyRow {
  id: string;
  name: string;
  scopes: string;
  rateLimit: number;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  teamId?: string | null;
}

type ExpiryPreset = '7d' | '30d' | '90d' | '1y' | 'never';
const EXPIRY_PRESET_LABEL: Record<ExpiryPreset, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '1y': '1 year',
  never: 'No expiry',
};
const EXPIRY_PRESET_DAYS: Record<Exclude<ExpiryPreset, 'never'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};
function expiryPresetToISO(preset: ExpiryPreset): string | null {
  if (preset === 'never') return null;
  return new Date(Date.now() + EXPIRY_PRESET_DAYS[preset] * 86_400_000).toISOString();
}

interface TeamOption {
  id: string;
  name: string;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export const ApiKeys: React.FC = () => {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [revealKey, setRevealKey] = useState<{ name: string; raw: string } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [newName, setNewName] = useState('');
  const [newScopes, setNewScopes] = useState<Record<Scope, boolean>>({
    read: true,
    sessions: true,
    devices: false,
    admin: false,
  });
  const [newRateLimit, setNewRateLimit] = useState(300);
  const [newTeamId, setNewTeamId] = useState<string>('');
  const [newExpiry, setNewExpiry] = useState<ExpiryPreset>('30d');
  const [submitting, setSubmitting] = useState(false);

  const teamNameById = (id?: string | null) =>
    id ? teams.find((t) => t.id === id)?.name || id.slice(0, 8) : 'Shared';

  const load = async () => {
    setLoading(true);
    try {
      const [keysRes, teamsRes] = await Promise.all([
        fetch('/xenon/api/apikeys', { credentials: 'include' }),
        fetch('/xenon/api/teams', { credentials: 'include' }),
      ]);
      if (keysRes.status === 403) {
        setForbidden(true);
        setKeys([]);
        return;
      }
      if (!keysRes.ok) throw new Error(`HTTP ${keysRes.status}`);
      setKeys(await keysRes.json());
      if (teamsRes.ok) setTeams(await teamsRes.json());
      setForbidden(false);
    } catch (e: any) {
      toast(`Failed to load API keys: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resetCreateForm = () => {
    setNewName('');
    setNewScopes({ read: true, sessions: true, devices: false, admin: false });
    setNewRateLimit(300);
    setNewTeamId('');
    setNewExpiry('30d');
  };

  const submitCreate = async () => {
    const scopes = ALL_SCOPES.filter((s) => newScopes[s]);
    if (!newName.trim()) {
      toast('Key name is required', 'error');
      return;
    }
    if (scopes.length === 0) {
      toast('Select at least one scope', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/xenon/api/apikeys', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          scopes,
          rateLimit: newRateLimit,
          teamId: newTeamId || null,
          expiresAt: expiryPresetToISO(newExpiry),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setShowCreate(false);
      resetCreateForm();
      setRevealKey({ name: newName.trim(), raw: body.key });
      await load();
    } catch (e: any) {
      toast(`Create failed: ${e.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const submitRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      const res = await fetch(`/xenon/api/apikeys/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('Key revoked', 'success');
      await load();
    } catch (e: any) {
      toast(`Revoke failed: ${e.message}`, 'error');
    } finally {
      setRevokingId(null);
    }
  };

  const copyKey = async (raw: string) => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Copy failed — select the text manually', 'error');
    }
  };

  if (loading) {
    return (
      <div className="settings-loading">
        <RefreshCw className="animate-spin" size={32} />
        <span>Loading API keys…</span>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="settings-container">
        <PageHeader
          icon={ShieldAlert}
          title="API Keys"
          subtitle={
            <>
              Your key lacks the <code>admin</code> scope. Ask an administrator to issue an admin
              key so you can manage access for other users.
            </>
          }
        />
      </div>
    );
  }

  // Stats
  const totalKeys = keys.length;
  const adminKeys = keys.filter((k) => k.scopes.includes('admin')).length;
  const recentlyUsed = keys.filter(
    (k) => k.lastUsedAt && Date.now() - new Date(k.lastUsedAt).getTime() < 86_400_000,
  ).length;

  return (
    <div className="settings-container">
      <PageHeader
        icon={Key}
        title="API Keys"
        subtitle={
          <>
            Issue scoped credentials for humans (dashboard login) and machines (CI, WebDriver
            clients via <code>xenon:accessKey</code>). Keys are shown only once at creation —
            copy the value before closing the dialog.
          </>
        }
        action={
          <button
            type="button"
            className="page-header-action"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={16} />
            <span>Create new key</span>
          </button>
        }
      />

      <div className="settings-content">
        {keys.length > 0 && (
          <div className="stat-strip">
            <div className="stat-strip__cell">
              <div className="stat-strip__value">{totalKeys}</div>
              <div className="stat-strip__label">Total keys</div>
            </div>
            <div className="stat-strip__cell">
              <div className="stat-strip__value stat-strip__value--accent">{adminKeys}</div>
              <div className="stat-strip__label">Admin scope</div>
            </div>
            <div className="stat-strip__cell">
              <div className="stat-strip__value">{recentlyUsed}</div>
              <div className="stat-strip__label">Active in last 24h</div>
            </div>
          </div>
        )}

        {keys.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Key size={28} />
            </div>
            <h3 className="empty-state__title">No API keys yet</h3>
            <p className="empty-state__copy">
              Issue your first key to authenticate WebDriver clients or CI pipelines. Keys are
              shown only once at creation — copy the value before closing the dialog.
            </p>
            <button
              type="button"
              className="page-header-action empty-state__action"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={16} />
              <span>Create your first key</span>
            </button>
          </div>
        ) : (
          <div className="data-card">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Team</TH>
                  <TH>Scopes</TH>
                  <TH>Rate limit</TH>
                  <TH>Last used</TH>
                  <TH>Created</TH>
                  <TH>Expires</TH>
                  <TH style={{ textAlign: 'right' }}>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {keys.map((k) => (
                  <TR key={k.id}>
                    <TD>
                      <strong>{k.name}</strong>
                      <div className="row-meta-mono">{k.id.slice(0, 8)}</div>
                    </TD>
                    <TD>
                      <span
                        className={`pill-chip ${
                          k.teamId ? 'pill-chip--team' : 'pill-chip--shared'
                        }`}
                      >
                        {teamNameById(k.teamId)}
                      </span>
                    </TD>
                    <TD>
                      <div className="scope-chips">
                        {k.scopes.split(',').map((s) => {
                          const scope = s.trim();
                          const isAdmin = scope === 'admin';
                          return (
                            <span
                              key={s}
                              className={`pill-chip ${
                                isAdmin ? 'pill-chip--admin' : 'pill-chip--scope'
                              }`}
                            >
                              {scope}
                            </span>
                          );
                        })}
                      </div>
                    </TD>
                    <TD className="row-mono">{k.rateLimit}/min</TD>
                    <TD className="row-mono">{fmtRelative(k.lastUsedAt)}</TD>
                    <TD className="row-mono">{fmtRelative(k.createdAt)}</TD>
                    <TD className="row-mono">
                      {k.expiresAt
                        ? new Date(k.expiresAt).getTime() <= Date.now()
                          ? <span style={{ color: 'var(--red)' }}>expired</span>
                          : formatDate(k.expiresAt)
                        : 'Never'}
                    </TD>
                    <TD style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="row-action row-action--danger"
                        disabled={revokingId === k.id}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Revoke "${k.name}"? Any client using this key will immediately fail.`,
                            )
                          ) {
                            submitRevoke(k.id);
                          }
                        }}
                      >
                        <Trash2 size={13} />
                        {revokingId === k.id ? 'Revoking…' : 'Revoke'}
                      </button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>

      <Modal
        open={showCreate}
        title="Create API key"
        width={520}
        onClose={() => setShowCreate(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitCreate} disabled={submitting}>
              {submitting ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={18} />}
              {submitting ? 'Creating…' : 'Create key'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <FieldGroup label="Name" htmlFor="apikey-name">
            <Input
              id="apikey-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="alice-laptop, ci-main, etc."
              className="w-full"
              autoFocus
            />
          </FieldGroup>

          <FieldGroup
            label="Scopes"
            description={
              <>
                <code>admin</code> grants full access including API-key management.{' '}
                <code>sessions</code> is required for WebDriver <code>xenon:accessKey</code>.
              </>
            }
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ALL_SCOPES.map((s) => (
                <label key={s} style={scopeLabel}>
                  <input
                    type="checkbox"
                    checked={newScopes[s]}
                    onChange={(e) =>
                      setNewScopes({ ...newScopes, [s]: e.target.checked })
                    }
                  />
                  <span>{s}</span>
                </label>
              ))}
            </div>
          </FieldGroup>

          <FieldGroup label="Rate limit (requests/min)" htmlFor="apikey-ratelimit">
            <Input
              id="apikey-ratelimit"
              type="number"
              min={10}
              step={10}
              value={newRateLimit}
              onChange={(e) => setNewRateLimit(parseInt(e.target.value) || 300)}
              className="w-full"
            />
          </FieldGroup>

          <FieldGroup
            label="Default team"
            description={
              <>
                Keys without a team can only reach shared-pool devices. Admins can override at
                session time via <code>xenon:team</code>.
              </>
            }
            htmlFor="apikey-team"
          >
            <Select
              id="apikey-team"
              value={newTeamId}
              onChange={(e) => setNewTeamId(e.target.value)}
              className="w-full"
            >
              <option value="">No team (shared pool only)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </FieldGroup>

          <FieldGroup
            label="Expires after"
            description={
              newExpiry === 'never'
                ? 'Key never expires. Rotate manually when needed.'
                : `Key will stop working on ${formatDate(expiryPresetToISO(newExpiry))}.`
            }
            htmlFor="apikey-expiry"
          >
            <Select
              id="apikey-expiry"
              value={newExpiry}
              onChange={(e) => setNewExpiry(e.target.value as ExpiryPreset)}
              className="w-full"
            >
              {(Object.keys(EXPIRY_PRESET_LABEL) as ExpiryPreset[]).map((p) => (
                <option key={p} value={p}>
                  {EXPIRY_PRESET_LABEL[p]}
                </option>
              ))}
            </Select>
          </FieldGroup>
        </div>
      </Modal>

      <Modal
        open={!!revealKey}
        title={revealKey ? `Key created: ${revealKey.name}` : ''}
        width={560}
        onClose={() => setRevealKey(null)}
        closeOnOverlayClick={false}
        footer={
          <>
            <Button
              variant="primary"
              onClick={() => revealKey && copyKey(revealKey.raw)}
              disabled={!revealKey}
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Copied' : 'Copy to clipboard'}
            </Button>
            <Button variant="secondary" onClick={() => setRevealKey(null)}>
              I've saved it
            </Button>
          </>
        }
      >
        {revealKey && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                background: 'var(--status-busy-bg)',
                border: '1px solid var(--status-busy-border)',
                borderRadius: 6,
                padding: 12,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>This key will not be shown again.</strong> Copy it now and store it in your
                password manager, CI secret store, or client config.
              </div>
            </div>
            <div
              style={{
                fontFamily: 'monospace',
                padding: 12,
                background: 'rgba(0,0,0,0.3)',
                borderRadius: 6,
                wordBreak: 'break-all',
                fontSize: '0.9em',
              }}
            >
              {revealKey.raw}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

const scopeLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  background: 'rgba(255,255,255,0.04)',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '0.9em',
};
