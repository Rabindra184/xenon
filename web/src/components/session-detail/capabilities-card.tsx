import React, { useState } from 'react';
import type { ISession } from '../../interfaces/ISession';
import { parseCapabilities, humanizeCapabilityValue } from './derive';

type Tab = 'desired' | 'session';

// What the client asked for, and what the driver ran with.
const TAB_LABEL: Record<Tab, string> = { desired: 'Requested', session: 'Actual' };

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
            className={`flex-1 h-9 text-[11px] font-semibold transition-colors border-b-2 ${
              tab === t
                ? 'border-[var(--color-accent)] text-[var(--text)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </header>

      {entries.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-[var(--text-dim)]">
          No {TAB_LABEL[tab].toLowerCase()} capabilities recorded for this session.
        </div>
      ) : (
        <dl className="divide-y divide-[var(--border)]">
          {entries.map(([k, v]) => (
            // Names wrap rather than being cut: appium:wdaConnectionTimeout
            // and appium:wdaLaunchTimeout differ only at the end.
            <div
              key={k}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-3 px-3 py-2"
            >
              <dt className="text-xs text-[var(--text-muted)] break-all">{k}</dt>
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
