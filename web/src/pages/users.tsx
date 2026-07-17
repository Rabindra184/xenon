import * as React from 'react';
import { useEffect, useState } from 'react';
import { Plus, Trash2, Edit, KeyRound, Users as UsersIcon } from 'lucide-react';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  UserRow,
} from '../api-service/users';
import { forgotPassword } from '../api-service/auth';
import { useAuth } from '../auth/auth-context';
import { formatDateTime } from '../utils/time';
import { PageHeader } from '../components/ui/page-header';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';

const ROLE_LABELS: Record<UserRow['role'], string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

export default function UsersPage() {
  const { me } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [revealedPassword, setRevealedPassword] = useState<{ email: string; password: string } | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setRows(await listUsers());
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function onDelete(u: UserRow) {
    if (!confirm(`Delete ${u.email}? This cannot be undone.`)) return;
    try {
      await deleteUser(u.id);
      setRows((rs) => rs.filter((r) => r.id !== u.id));
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function onResetPassword(u: UserRow) {
    if (!confirm(`Send a password-reset link to ${u.email}?`)) return;
    try {
      await forgotPassword(u.email);
      alert(`Reset link sent (or logged) for ${u.email}.`);
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div>
      <PageHeader
        icon={UsersIcon}
        title="Users"
        subtitle="Dashboard accounts, roles, and access status."
        action={
          <button type="button" className="page-header-action" onClick={() => setShowInvite(true)}>
            <Plus size={16} />
            <span>Invite user</span>
          </button>
        }
      />

      <div className="px-6 py-6">
        {error && <div className="text-sm text-[var(--red)] mb-4">{error}</div>}

        {loading ? (
          <div className="text-sm text-[var(--text-dim)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-[var(--text-dim)] py-8 text-center border border-dashed border-[var(--border)] rounded-md">
            No users to show — invite the first one above.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-[11px] text-[var(--text-dim)] uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2.5 px-4">Name</th>
                  <th className="text-left py-2.5 px-4">Email</th>
                  <th className="text-left py-2.5 px-4">Role</th>
                  <th className="text-left py-2.5 px-4">Status</th>
                  <th className="text-left py-2.5 px-4">Last Login</th>
                  <th className="w-px"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const isSelf = me?.userId === u.id;
                  return (
                    <tr key={u.id} className="border-t border-[var(--border)]">
                      <td className="py-2.5 px-4">{u.name}</td>
                      <td className="py-2.5 px-4 text-[var(--text-muted)]">{u.email}</td>
                      <td className="py-2.5 px-4">{ROLE_LABELS[u.role]}</td>
                      <td className="py-2.5 px-4">
                        {u.status === 'ACTIVE' ? (
                          <span className="text-[var(--green)]">Active</span>
                        ) : (
                          <span className="text-[var(--text-dim)]">Inactive</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-[var(--text-muted)]">
                        {formatDateTime(u.lastLoginAt)}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <button
                            onClick={() => setEditing(u)}
                            disabled={isSelf}
                            title={isSelf ? 'Use a different super-admin to manage your own account' : 'Edit'}
                            aria-label="Edit user"
                            className="text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-30"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => onResetPassword(u)}
                            title="Send password-reset link"
                            aria-label="Send password-reset link"
                            className="text-[var(--text-dim)] hover:text-[var(--text)]"
                          >
                            <KeyRound size={14} />
                          </button>
                          <button
                            onClick={() => onDelete(u)}
                            disabled={isSelf}
                            title={isSelf ? 'Use a different super-admin to manage your own account' : 'Delete'}
                            aria-label="Delete user"
                            className="text-[var(--red)] hover:opacity-80 disabled:opacity-30"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onCreated={(result) => {
            setShowInvite(false);
            if (result.temporaryPassword) {
              setRevealedPassword({ email: result.email, password: result.temporaryPassword });
            }
            refresh();
          }}
          callerRole={me?.role ?? 'MEMBER'}
        />
      )}

      {editing && (
        <EditModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {revealedPassword && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center" role="dialog">
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-md p-6">
            <h3 className="text-base font-semibold mb-2">User created</h3>
            <p className="text-xs text-[var(--text-dim)] mb-3">
              Temporary password for {revealedPassword.email}. Copy now — it will not be shown again.
            </p>
            <code className="block break-all px-3 py-2 rounded bg-[var(--surface)] border border-[var(--border)] text-xs mb-3">
              {revealedPassword.password}
            </code>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setRevealedPassword(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InviteModal({
  onClose,
  onCreated,
  callerRole,
}: {
  onClose: () => void;
  onCreated: (r: { email: string; temporaryPassword?: string }) => void;
  callerRole: UserRow['role'];
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRow['role']>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ADMIN can only invite MEMBERs; SUPER_ADMIN can invite anyone.
  const allowedRoles: UserRow['role'][] =
    callerRole === 'SUPER_ADMIN' ? ['SUPER_ADMIN', 'ADMIN', 'MEMBER'] : ['MEMBER'];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await createUser({ email, name, role });
      onCreated({ email: r.email, temporaryPassword: r.temporaryPassword });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center" role="dialog">
      <form onSubmit={submit} className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-md p-6">
        <h3 className="text-lg font-semibold mb-4">Invite User</h3>
        <label className="block text-xs text-[var(--text-dim)] mb-1">Email</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
          className="w-full mb-3"
        />
        <label className="block text-xs text-[var(--text-dim)] mb-1">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full mb-3"
        />
        <label className="block text-xs text-[var(--text-dim)] mb-1">Role</label>
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRow['role'])}
          className="mb-4"
        >
          {allowedRoles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        {error && <div className="text-xs text-[var(--red)] mb-2">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !email || !name}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function EditModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<UserRow['role']>(user.role);
  const [status, setStatus] = useState<UserRow['status']>(user.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateUser(user.id, { name, role, status });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center" role="dialog">
      <form onSubmit={submit} className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-md p-6">
        <h3 className="text-lg font-semibold mb-4">Edit User — {user.email}</h3>
        <label className="block text-xs text-[var(--text-dim)] mb-1">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full mb-3"
        />
        <label className="block text-xs text-[var(--text-dim)] mb-1">Role</label>
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRow['role'])}
          className="mb-3"
        >
          <option value="SUPER_ADMIN">Super Admin</option>
          <option value="ADMIN">Admin</option>
          <option value="MEMBER">Member</option>
        </Select>
        <label className="block text-xs text-[var(--text-dim)] mb-1">Status</label>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as UserRow['status'])}
          className="mb-4"
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
        {error && <div className="text-xs text-[var(--red)] mb-2">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}
