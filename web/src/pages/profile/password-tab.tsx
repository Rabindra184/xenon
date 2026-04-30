import * as React from 'react';
import { useState } from 'react';
import { changePassword } from '../../api-service/auth';
import { useAuth } from '../../auth/auth-context';

export function PasswordTab() {
  const { me } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newPassword !== confirm) {
      setMsg({ kind: 'err', text: 'Passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await changePassword(oldPassword, newPassword);
      setMsg({ kind: 'ok', text: 'Password updated. Other sessions for your account were signed out.' });
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md">
      {me?.role === 'MEMBER' &&
        (me.teams.length > 0 ? (
          <div className="mb-6">
            <div className="text-xs text-[var(--text-dim)] uppercase tracking-wide mb-2">
              Your Teams
            </div>
            <div className="flex flex-wrap gap-2">
              {me.teams.map((t) => (
                <span
                  key={t.id}
                  className="inline-block px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs"
                >
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-6 text-xs text-[var(--text-dim)]">
            You're not on any team — ask an admin to add you so you can see team-scoped devices.
          </div>
        ))}
      <form onSubmit={submit}>
        <h2 className="text-xl font-semibold mb-4">Update Password</h2>
        {(['oldPassword', 'newPassword', 'confirm'] as const).map((id) => (
          <div key={id} className="mb-3">
            <label className="block text-xs text-[var(--text-dim)] mb-1">
              {id === 'oldPassword' ? 'Current password' : id === 'newPassword' ? 'New password' : 'Confirm new password'}
            </label>
            <input
              type="password"
              value={id === 'oldPassword' ? oldPassword : id === 'newPassword' ? newPassword : confirm}
              onChange={(e) => {
                if (id === 'oldPassword') setOldPassword(e.target.value);
                else if (id === 'newPassword') setNewPassword(e.target.value);
                else setConfirm(e.target.value);
              }}
              className="w-full h-10 px-3 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm"
            />
          </div>
        ))}
        {msg && (
          <div className={`text-xs mb-3 ${msg.kind === 'ok' ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
            {msg.text}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || newPassword.length < 8}
          className="h-10 px-4 rounded-md bg-[var(--green)] text-black font-medium text-sm disabled:opacity-50"
        >
          {busy ? 'Updating…' : 'Update Password'}
        </button>
      </form>
    </div>
  );
}
