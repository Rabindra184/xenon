import React from 'react';
import type { LucideIcon } from 'lucide-react';
import './page-header.css';

interface TitleProps {
  /** Lucide icon shown left of the title, matching the page's sidebar icon. */
  icon?: LucideIcon;
  children: React.ReactNode;
}

/**
 * The page's single h1, in the one title style the app uses. Exported so a
 * page whose header is a toolbar (Live Devices) still titles itself the same
 * way as every PageHeader page.
 */
export const PageTitle: React.FC<TitleProps> = ({ icon: Icon, children }) => (
  <h1 className="flex items-center gap-2 text-title font-semibold tracking-tight text-[var(--text)]">
    {Icon && <Icon className="h-5 w-5 text-[var(--text-muted)] shrink-0" aria-hidden="true" />}
    <span className="truncate">{children}</span>
  </h1>
);

interface Props {
  /** Lucide icon for the title row, matching the page's sidebar icon. Optional. */
  icon?: LucideIcon;
  /** Small sentence-case label above the title (e.g. "Test quality"). Optional. */
  eyebrow?: string;
  /** Main heading. Required. */
  title: React.ReactNode;
  /** Description shown beneath the title. Optional. */
  subtitle?: React.ReactNode;
  /** Right-aligned action area (one or more buttons). Optional. */
  action?: React.ReactNode;
}

/**
 * What a section layout adds to every page header inside it, so the pages
 * don't have to: an eyebrow (the area's name) and a row of links under the
 * header (the Settings sections). A page's own `eyebrow` wins.
 */
export const PageHeaderNav = React.createContext<{ eyebrow?: string; nav?: React.ReactNode }>({});

/**
 * The page header every top-level page uses: optional eyebrow, the title
 * (PageTitle), a muted subtitle, and a right-aligned action slot, over a
 * bottom border. Pages used to mix four header styles; keep to this one.
 */
export const PageHeader: React.FC<Props> = ({ icon, eyebrow, title, subtitle, action }) => {
  const area = React.useContext(PageHeaderNav);
  const label = eyebrow ?? area.eyebrow;
  return (
    <header className={`px-6 pt-6 border-b border-[var(--border)] ${area.nav ? '' : 'pb-4'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {label && (
            <div className="text-caption font-semibold text-[var(--text-dim)] mb-1.5">{label}</div>
          )}
          <PageTitle icon={icon}>{title}</PageTitle>
          {subtitle && (
            <p className="mt-1.5 text-body text-[var(--text-muted)] max-w-3xl">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
      </div>
      {area.nav && <div className="mt-4">{area.nav}</div>}
    </header>
  );
};
