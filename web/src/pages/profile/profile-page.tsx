import * as React from 'react';
import { useState } from 'react';
import { PasswordTab } from './password-tab';
import { ApiTokensTab } from './api-tokens-tab';

type Tab = 'password' | 'tokens';

export default function ProfilePage() {
  const [tab, setTab] = useState<Tab>('password');
  return (
    <div className="flex">
      <nav className="w-56 shrink-0 border-r border-[var(--border)] py-6 px-3">
        <div className="text-sm font-semibold mb-4 px-2">Profile Settings</div>
        {[
          { id: 'password', label: 'Password & Authentication' } as const,
          { id: 'tokens', label: 'API Tokens' } as const,
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`block w-full text-left px-3 py-2 text-sm rounded-md mb-1 ${
              tab === t.id
                ? 'bg-[var(--green)]/10 text-[var(--green)]'
                : 'text-[var(--text)] hover:bg-[var(--surface)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <section className="flex-1 px-8 py-6">
        {tab === 'password' ? <PasswordTab /> : <ApiTokensTab />}
      </section>
    </div>
  );
}
