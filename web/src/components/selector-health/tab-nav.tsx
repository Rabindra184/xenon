import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Zap,
  Hourglass,
  CheckCircle2,
  VolumeX,
  LucideIcon,
} from 'lucide-react';

export type Tab = 'active' | 'pending' | 'resolved' | 'muted';

interface Counts {
  active?: number | null;
  pending?: number | null;
  resolved?: number | null;
  muted?: number | null;
}

interface Props {
  current: Tab;
  counts?: Counts;
}

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon; color?: string }> = [
  { id: 'active', label: 'Active', icon: Zap },
  { id: 'pending', label: 'Pending', icon: Hourglass, color: 'var(--accent, #60a5fa)' },
  { id: 'resolved', label: 'Resolved', icon: CheckCircle2, color: 'var(--green, #4ade80)' },
  { id: 'muted', label: 'Muted', icon: VolumeX, color: 'var(--text-muted)' },
];

// URL-persisted tab navigation for /selector-health. The tab id round-trips
// through `?tab=...` so links and back/forward navigation behave naturally.
// Counts are best-effort — show only when the parent has them.
export function TabNav({ current, counts = {} }: Props) {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const switchTab = (id: Tab) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    navigate({ search: next.toString() });
  };

  return (
    <nav className="sh-tab-nav" role="tablist" aria-label="Selector Health tabs">
      {TABS.map((t) => {
        const count = counts[t.id];
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={current === t.id}
            onClick={() => switchTab(t.id)}
            className={`sh-tab ${current === t.id ? 'sh-tab--active' : ''}`}
          >
            <span className="sh-tab__icon" aria-hidden="true" style={t.color ? { color: t.color } : undefined}>
              <Icon size={14} />
            </span>
            <span className="sh-tab__label">{t.label}</span>
            {typeof count === 'number' && (
              <span className="sh-tab__count" aria-label={`${count} ${t.label}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
