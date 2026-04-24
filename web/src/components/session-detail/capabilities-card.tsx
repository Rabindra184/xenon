import React, { useState } from 'react';
import type { ISession } from '../../interfaces/ISession';
import { parseCapabilities, humanizeCapabilityValue } from './derive';

type Tab = 'desired' | 'session';

interface Props {
  session: ISession;
}

export const CapabilitiesCard: React.FC<Props> = ({ session }) => {
  const [tab, setTab] = useState<Tab>('desired');

  const desired = parseCapabilities(session.desired_capabilities);
  const sessionCaps = parseCapabilities(session.session_capabilities);
  const caps = tab === 'desired' ? desired : sessionCaps;
  const entries = Object.entries(caps);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <header className="flex items-center border-b border-[var(--border)]">
        {(['desired', 'session'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`flex-1 h-9 text-[10px] font-mono font-semibold uppercase tracking-widest transition-colors border-b-2 ${
              tab === t
                ? 'border-[var(--green)] text-[var(--text)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {t}
          </button>
        ))}
      </header>

      {entries.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-[var(--text-dim)]">
          No {tab} capabilities reported for this session.
        </div>
      ) : (
        <dl className="divide-y divide-[var(--border)]">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <dt className="text-xs text-[var(--text-muted)] truncate shrink-0 max-w-[45%]">{k}</dt>
              <dd className="font-mono text-xs text-[var(--text)] truncate text-right min-w-0" title={humanizeCapabilityValue(v, 500)}>
                {humanizeCapabilityValue(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
};
