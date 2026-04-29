import * as React from 'react';
import { useState } from 'react';
import { changePassword } from '../../api-service/auth';

export function PasswordTab() {
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
    <form onSubmit={submit} className="max-w-md">
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
  );
}
