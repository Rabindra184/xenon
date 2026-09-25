import * as React from 'react';
import { useState } from 'react';
import { UserCircle } from 'lucide-react';
import { PageHeader } from '../../components/ui/page-header';
import { PasswordTab } from './password-tab';
import { ApiTokensTab } from './api-tokens-tab';
import { useAuth } from '../../auth/auth-context';

type Tab = 'password' | 'tokens';

export default function ProfilePage() {
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>('password');
  // With auth disabled there's no account password: the synthetic admin has no
  // User row, so change-password can only fail. Drop the view. API tokens still
  // work (they act as the bootstrap admin; see profileIdentity.ts). Derived at
  // render, not in the initial state, so it holds if `me` loads after mount.
  const tabs: { id: Tab; label: string }[] = me?.authDisabled
    ? [{ id: 'tokens', label: 'API tokens' }]
    : [
        { id: 'password', label: 'Password & authentication' },
        { id: 'tokens', label: 'API tokens' },
      ];
  const current: Tab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={UserCircle}
        title="Profile"
        subtitle={
          me ? [me.name || me.email, me.role].filter(Boolean).join(' — ') : 'Your account settings.'
        }
      />
      <div className="flex flex-1 min-h-0">
        <nav className="w-56 shrink-0 border-r border-[var(--border)] py-6 px-3">
          <div className="text-sm font-semibold mb-4 px-2">Profile settings</div>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              // The highlight alone told only sighted users which view is open.
              aria-current={current === t.id ? 'page' : undefined}
              className={`block w-full text-left px-3 py-2 text-sm rounded-md mb-1 ${
                current === t.id
                  ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'text-[var(--text)] hover:bg-[var(--surface)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <section className="flex-1 px-8 py-6">
          {current === 'password' ? <PasswordTab /> : <ApiTokensTab />}
        </section>
      </div>
    </div>
  );
}
