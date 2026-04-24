import React, { useEffect, useState } from 'react';
import './settings.css';
import {
  Users,
  Plus,
  Trash2,
  ShieldAlert,
  RefreshCw,
  ArrowLeft,
  X,
  AlertTriangle,
  Smartphone,
} from 'lucide-react';
import { useToast } from '../ui/toast';
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table';

interface TeamRow {
  id: string;
  name: string;
  createdAt: string;
  deviceCount: number;
  memberCount: number;
}
interface MemberRow {
  id: string;
  name: string;
  role: string;
  scopes: string;
  createdAt: string;
}
interface KeyRow {
  id: string;
  name: string;
  scopes: string;
  teamId?: string | null;
}
interface DeviceRow {
  udid: string;
  name: string;
  platform: string;
  teamId?: string | null;
}

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status });
  }
  return res.json();
}

export const Teams: React.FC = () => {
  const { toast } = useToast();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<TeamRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api('/xenon/api/teams');
      setTeams(rows);
      setForbidden(false);
    } catch (e: any) {
      if (e.status === 403) setForbidden(true);
      else toast(`Failed to load teams: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="settings-loading">
        <RefreshCw className="animate-spin" size={32} />
        <span>Loading teams…</span>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="settings-container mesh-gradient-infra">
        <div className="settings-header">
          <div className="settings-title-group">
            <ShieldAlert className="settings-icon infra-icon" size={28} />
            <h2>Teams</h2>
          </div>
          <p className="settings-subtitle">
            Your key lacks the <code>admin</code> scope. Ask an administrator to promote your key
            before you can manage teams.
          </p>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <TeamDetail
        team={selected}
        onBack={() => {
          setSelected(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="settings-container mesh-gradient-infra">
      <div className="settings-header">
        <div className="settings-title-group">
          <Users className="settings-icon infra-icon" size={28} />
          <h2>Teams</h2>
        </div>
        <p className="settings-subtitle">
          Group devices and API keys by team. Devices with no team assignment stay in the shared
          pool — visible to every authenticated key.
        </p>
      </div>

      <div className="settings-content">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button className="save-btn" onClick={() => setShowCreate(true)}>
            <Plus size={18} />
            New team
          </button>
        </div>

        {teams.length === 0 ? (
          <div className="setting-card" style={{ textAlign: 'center', padding: 48 }}>
            <AlertTriangle size={32} style={{ opacity: 0.4 }} />
            <p style={{ marginTop: 12 }}>
              No teams yet. Every device is in the shared pool until you create a team and assign
              it.
            </p>
          </div>
        ) : (
          <div className="setting-card" style={{ padding: 0, overflowX: 'auto' }}>
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Devices</TH>
                  <TH>Members</TH>
                  <TH>Created</TH>
                  <TH style={{ textAlign: 'right' }}>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {teams.map((t) => (
                  <TR
                    key={t.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected(t)}
                  >
                    <TD>
                      <strong>{t.name}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--text-subtle)', fontFamily: 'monospace' }}>
                        {t.id.slice(0, 8)}
                      </div>
                    </TD>
                    <TD>{t.deviceCount}</TD>
                    <TD>{t.memberCount}</TD>
                    <TD>{new Date(t.createdAt).toLocaleDateString()}</TD>
                    <TD style={{ textAlign: 'right' }}>
                      <DeleteTeamButton
                        team={t}
                        onDeleted={load}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateTeamModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
};

const CreateTeamModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({
  onClose,
  onCreated,
}) => {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast('Name required', 'error');
    setSubmitting(true);
    try {
      await api('/xenon/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      toast('Team created', 'success');
      onCreated();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} title="New team">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label>
          <div style={labelStyle}>Name</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="android-team, qa-ios, …"
            style={inputStyle}
            autoFocus
          />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="reset-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="save-btn" onClick={submit} disabled={submitting}>
            {submitting ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={18} />}
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

const DeleteTeamButton: React.FC<{ team: TeamRow; onDeleted: () => void }> = ({
  team,
  onDeleted,
}) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete team "${team.name}"? It must have no devices and no members.`))
      return;
    setBusy(true);
    try {
      await api(`/xenon/api/teams/${team.id}`, { method: 'DELETE' });
      toast('Team deleted', 'success');
      onDeleted();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="reset-btn" disabled={busy} onClick={handle} style={{ color: 'var(--status-error-fg)' }}>
      <Trash2 size={14} />
      {busy ? 'Deleting…' : 'Delete'}
    </button>
  );
};

const TeamDetail: React.FC<{ team: TeamRow; onBack: () => void }> = ({ team, onBack }) => {
  const { toast } = useToast();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [allKeys, setAllKeys] = useState<KeyRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [sharedDevices, setSharedDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addApiKeyId, setAddApiKeyId] = useState('');
  const [assignUdid, setAssignUdid] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [m, k, d] = await Promise.all([
        api(`/xenon/api/teams/${team.id}/members`),
        api('/xenon/api/apikeys'),
        api('/xenon/api/device'),
      ]);
      setMembers(m);
      setAllKeys(k);
      const allDevices = d as DeviceRow[];
      setDevices(allDevices.filter((x) => x.teamId === team.id));
      setSharedDevices(allDevices.filter((x) => !x.teamId));
    } catch (e: any) {
      toast(`Failed to load team detail: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [team.id]);

  const addMember = async () => {
    if (!addApiKeyId) return;
    try {
      await api(`/xenon/api/teams/${team.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeyId: addApiKeyId, role: 'member' }),
      });
      toast('Member added', 'success');
      setAddApiKeyId('');
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const removeMember = async (apiKeyId: string) => {
    if (!window.confirm('Remove this key from the team?')) return;
    try {
      await api(`/xenon/api/teams/${team.id}/members/${apiKeyId}`, { method: 'DELETE' });
      toast('Member removed', 'success');
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const assignDevice = async () => {
    if (!assignUdid) return;
    try {
      await api(`/xenon/api/device/${encodeURIComponent(assignUdid)}/team`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: team.id }),
      });
      toast('Device assigned', 'success');
      setAssignUdid('');
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const unassignDevice = async (udid: string) => {
    if (!window.confirm('Return this device to the shared pool?')) return;
    try {
      await api(`/xenon/api/device/${encodeURIComponent(udid)}/team`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: null }),
      });
      toast('Device unassigned', 'success');
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const availableKeys = allKeys.filter((k) => !members.some((m) => m.id === k.id));

  return (
    <div className="settings-container mesh-gradient-infra">
      <div className="settings-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onBack}
            className="reset-btn"
            style={{ padding: '4px 8px' }}
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="settings-title-group">
            <Users className="settings-icon infra-icon" size={28} />
            <h2>{team.name}</h2>
          </div>
        </div>
        <p className="settings-subtitle">
          Manage members and devices assigned to this team. To add a device, go to Devices and use
          "Assign to team."
        </p>
      </div>

      {loading ? (
        <div className="settings-loading">
          <RefreshCw className="animate-spin" size={32} />
        </div>
      ) : (
        <div className="settings-content" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <section>
            <h3 style={{ marginBottom: 12 }}>Members ({members.length})</h3>
            <div className="setting-card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <select
                  value={addApiKeyId}
                  onChange={(e) => setAddApiKeyId(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="">Select an API key to add…</option>
                  {availableKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.scopes})
                    </option>
                  ))}
                </select>
                <button className="save-btn" onClick={addMember} disabled={!addApiKeyId}>
                  <Plus size={16} /> Add
                </button>
              </div>
              {members.length === 0 ? (
                <p style={{ opacity: 0.6, textAlign: 'center', padding: 24 }}>
                  No members yet. Add any API key above.
                </p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Role</TH>
                      <TH>Scopes</TH>
                      <TH style={{ textAlign: 'right' }}>Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {members.map((m) => (
                      <TR key={m.id}>
                        <TD>{m.name}</TD>
                        <TD>{m.role}</TD>
                        <TD>
                          <code style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{m.scopes}</code>
                        </TD>
                        <TD style={{ textAlign: 'right' }}>
                          <button
                            className="reset-btn"
                            onClick={() => removeMember(m.id)}
                            style={{ color: 'var(--status-error-fg)' }}
                          >
                            <Trash2 size={14} /> Remove
                          </button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          </section>

          <section>
            <h3 style={{ marginBottom: 12 }}>Devices ({devices.length})</h3>
            <div className="setting-card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <select
                  value={assignUdid}
                  onChange={(e) => setAssignUdid(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="">Select a shared-pool device to assign…</option>
                  {sharedDevices.map((d) => (
                    <option key={d.udid} value={d.udid}>
                      {d.name} ({d.platform}) — {d.udid.slice(0, 12)}…
                    </option>
                  ))}
                </select>
                <button className="save-btn" onClick={assignDevice} disabled={!assignUdid}>
                  <Plus size={16} /> Assign
                </button>
              </div>
              {devices.length === 0 ? (
                <p style={{ opacity: 0.6, textAlign: 'center', padding: 24 }}>
                  No devices assigned. Use the Devices page to move devices into this team.
                </p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Platform</TH>
                      <TH>UDID</TH>
                      <TH style={{ textAlign: 'right' }}>Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {devices.map((d) => (
                      <TR key={d.udid}>
                        <TD>
                          <Smartphone size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                          {d.name}
                        </TD>
                        <TD>{d.platform}</TD>
                        <TD>
                          <code style={{ fontSize: '11px' }}>{d.udid.slice(0, 14)}…</code>
                        </TD>
                        <TD style={{ textAlign: 'right' }}>
                          <button className="reset-btn" onClick={() => unassignDevice(d.udid)}>
                            Return to shared pool
                          </button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

const Modal: React.FC<{ onClose: () => void; title: string; children: React.ReactNode }> = ({
  onClose,
  title,
  children,
}) => (
  <div
    onClick={onClose}
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
    }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 10,
        padding: 24,
        width: 'min(480px, 90vw)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const labelStyle: React.CSSProperties = {
  fontSize: '0.85em',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  opacity: 0.7,
  marginBottom: 6,
  fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: 'inherit',
  fontSize: '0.95em',
  boxSizing: 'border-box',
};
