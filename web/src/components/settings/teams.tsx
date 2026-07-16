import React, { useEffect, useState } from 'react';
import './settings.css';
import {
  Users,
  Plus,
  Trash2,
  ShieldAlert,
  RefreshCw,
  ArrowLeft,
  Smartphone,
} from 'lucide-react';
import { useToast } from '../ui/toast';
import { formatDate } from '../../utils/time';
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table';
import { FieldGroup } from '../ui/FieldGroup';
import { PageHeader } from '../ui/page-header';
import { Modal } from '../ui/Modal';
import { listUsers, UserRow } from '../../api-service/users';

interface TeamRow {
  id: string;
  name: string;
  createdAt: string;
  deviceCount: number;
  memberCount: number;
}
interface MemberRow {
  userId: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
  addedAt: string;
}
interface DeviceRow {
  udid: string;
  name: string;
  platform: string;
  teamId?: string | null;
}

const ROLE_LABELS: Record<MemberRow['role'], string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

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
      <div className="settings-container">
        <PageHeader
          icon={ShieldAlert}
          title="Teams"
          subtitle={
            <>
              Your key lacks the <code>admin</code> scope. Ask an administrator to promote your
              key before you can manage teams.
            </>
          }
        />
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

  const totalDevices = teams.reduce((sum, t) => sum + t.deviceCount, 0);
  const totalMembers = teams.reduce((sum, t) => sum + t.memberCount, 0);

  return (
    <div className="settings-container">
      <PageHeader
        icon={Users}
        title="Teams"
        subtitle="Group devices and members by team. Devices with no team assignment stay in the shared pool — visible to every authenticated user."
        action={
          teams.length > 0 ? (
            <button
              type="button"
              className="page-header-action"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={16} />
              <span>New team</span>
            </button>
          ) : undefined
        }
      />

      <div className="settings-content">
        {teams.length > 0 && (
          <div className="stat-strip">
            <div className="stat-strip__cell">
              <div className="stat-strip__value stat-strip__value--accent">{teams.length}</div>
              <div className="stat-strip__label">Teams</div>
            </div>
            <div className="stat-strip__cell">
              <div className="stat-strip__value">{totalMembers}</div>
              <div className="stat-strip__label">Members</div>
            </div>
            <div className="stat-strip__cell">
              <div className="stat-strip__value">{totalDevices}</div>
              <div className="stat-strip__label">Devices assigned</div>
            </div>
          </div>
        )}

        {teams.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Users size={28} />
            </div>
            <h3 className="empty-state__title">No teams yet</h3>
            <p className="empty-state__copy">
              Every device is in the shared pool until you create a team and assign it. Teams let
              you scope an API key to a subset of devices — useful for separating CI runners,
              staging fleets, or per-team device pools.
            </p>
            <button
              type="button"
              className="page-header-action empty-state__action"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={16} />
              <span>Create your first team</span>
            </button>
          </div>
        ) : (
          <div className="team-grid">
            {teams.map((t) => (
              <button
                type="button"
                key={t.id}
                className="team-card"
                onClick={() => setSelected(t)}
              >
                <div className="team-card__header">
                  <div className="team-card__icon">
                    <Users size={16} />
                  </div>
                  <div className="team-card__title">
                    <div className="team-card__name">{t.name}</div>
                    <div className="team-card__id">{t.id.slice(0, 8)}</div>
                  </div>
                  <span
                    className="team-card__delete"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DeleteTeamButton team={t} onDeleted={load} />
                  </span>
                </div>
                <div className="team-card__metrics">
                  <div className="team-card__metric">
                    <Smartphone size={13} />
                    <span className="team-card__metric-value">{t.deviceCount}</span>
                    <span className="team-card__metric-label">devices</span>
                  </div>
                  <div className="team-card__metric">
                    <Users size={13} />
                    <span className="team-card__metric-value">{t.memberCount}</span>
                    <span className="team-card__metric-label">members</span>
                  </div>
                </div>
                <div className="team-card__footer">
                  Created {formatDate(t.createdAt)}
                </div>
              </button>
            ))}
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
    <Modal
      open={true}
      onClose={onClose}
      title="New team"
      footer={
        <>
          <button className="reset-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="save-btn" onClick={submit} disabled={submitting}>
            {submitting ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={18} />}
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <FieldGroup label="Name" htmlFor="team-name">
          <input
            id="team-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="android-team, qa-ios, …"
            style={inputStyle}
            autoFocus
          />
        </FieldGroup>
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
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [sharedDevices, setSharedDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addUserId, setAddUserId] = useState('');
  const [assignUdid, setAssignUdid] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [m, u, d] = await Promise.all([
        api(`/xenon/api/teams/${team.id}/members`),
        listUsers(),
        api('/xenon/api/device'),
      ]);
      setMembers(m);
      setAllUsers(u);
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
    if (!addUserId) return;
    try {
      await api(`/xenon/api/teams/${team.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: addUserId }),
      });
      toast('Member added', 'success');
      setAddUserId('');
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const removeMember = async (userId: string) => {
    if (!window.confirm('Remove this member from the team?')) return;
    try {
      await api(`/xenon/api/teams/${team.id}/members/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
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

  const availableUsers = allUsers.filter((u) => !members.some((m) => m.userId === u.id));

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
            <div className="surface-card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <select
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="">Select a user to add…</option>
                  {availableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email}) — {ROLE_LABELS[u.role]}
                    </option>
                  ))}
                </select>
                <button className="save-btn" onClick={addMember} disabled={!addUserId}>
                  <Plus size={16} /> Add
                </button>
              </div>
              {members.length === 0 ? (
                <p style={{ opacity: 0.6, textAlign: 'center', padding: 24 }}>
                  No members yet. Add a user above.
                </p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Email</TH>
                      <TH>Role</TH>
                      <TH>Added</TH>
                      <TH style={{ textAlign: 'right' }}>Action</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {members.map((m) => (
                      <TR key={m.userId}>
                        <TD>{m.name}</TD>
                        <TD>
                          <code style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{m.email}</code>
                        </TD>
                        <TD>{ROLE_LABELS[m.role]}</TD>
                        <TD>{formatDate(m.addedAt)}</TD>
                        <TD style={{ textAlign: 'right' }}>
                          <button
                            className="reset-btn"
                            onClick={() => removeMember(m.userId)}
                            style={{ color: 'var(--status-error-fg)' }}
                            aria-label="Remove member"
                            title="Remove member"
                          >
                            <Trash2 size={14} />
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
            <div className="surface-card" style={{ padding: 12 }}>
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
