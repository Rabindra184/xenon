import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  /** Lucide icon component for the title row's left side. Optional. */
  icon?: LucideIcon;
  /** Small uppercase label above the title. Optional. */
  eyebrow?: string;
  /** Main heading. Required. */
  title: React.ReactNode;
  /** Description shown beneath the title. Optional. */
  subtitle?: React.ReactNode;
  /** Right-aligned action area (one or more buttons). Optional. */
  action?: React.ReactNode;
}

/**
 * Standard page header used across Settings, Notifications, API Keys, Teams,
 * Devices, Apps, etc. Mirrors the Overview header rhythm: a small mono-uppercase
 * eyebrow, an Inter title with optional icon, an Inter subtitle in muted grey,
 * and a right-aligned action slot.
 */
export const PageHeader: React.FC<Props> = ({ icon: Icon, eyebrow, title, subtitle, action }) => (
  <header className="px-6 pt-6 pb-4 border-b border-[var(--border)]">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[var(--text-dim)] mb-1.5">
            {eyebrow}
          </div>
        )}
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-[var(--text)]">
          {Icon && <Icon className="h-5 w-5 text-[var(--green)] shrink-0" />}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-sm text-[var(--text-muted)] max-w-3xl">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  </header>
);
